// Lyrics engine orchestrator.
//
// Search order:
//   1. Local .lrc sidecar cache
//   2. LRCLib exact-match fast path (single request)
//   3. Concurrent multi-provider sweep (LRCLib / NetEase / KuGou) over a
//      deduplicated set of query strategies
//   4. Candidate scoring (title similarity + duration difference)
//   5. Timeline calibration (AI when configured, math offset otherwise)
//   6. AI lyrics generation fallback
//
// The final result is converted to the user's preferred Chinese variant and
// cached next to the audio file as raw (unconverted) LRC.

import path from 'node:path'
import fs from 'node:fs/promises'
import * as mm from 'music-metadata'
import { type LyricCandidate, lrclibGetExact, lrclibSearch, neteaseSearch, kugouSearch } from './providers'
import { type AiConfig, callAI, isAiEnabled } from './ai'
import {
    cleanString, convertLyrics, extractChinese, getTitleMatchScore, hasChinese,
    type LyricsLang, parseArtistTitle, parseChineseSongInfo, stripMarkdownFences, toSimplified
} from './text'
import { parseYouTubeFilename } from '../../src/utils/youtubeFilename'

export interface LyricsRequest {
    title?: string
    artist?: string
    filePath?: string
    duration?: number
    aiConfig?: AiConfig | null
}

const log = (...args: unknown[]) => console.log('[Lyrics]', ...args)

const PLACEHOLDER_ARTISTS = new Set([
    '未知演出者', '未知藝術家', '未知艺术家', 'unknown', 'unknown artist', 'various artists'
])

function usableArtist(value?: string): string {
    const artist = (value || '').trim()
    return PLACEHOLDER_ARTISTS.has(artist.toLowerCase()) ? '' : artist
}

function resolveLang(aiConfig?: AiConfig | null): LyricsLang {
    const lang = aiConfig?.lang
    if (lang === 'tw' || lang === 'original') return lang
    return 'cn'
}

function lrcPathFor(filePath: string): string {
    const ext = path.extname(filePath)
    return filePath.slice(0, filePath.length - ext.length) + '.lrc'
}

async function readLocalLrc(filePath?: string): Promise<string | null> {
    if (!filePath) return null
    try {
        const cached = await fs.readFile(lrcPathFor(filePath), 'utf8')
        return cached.trim().length > 0 ? cached : null
    } catch {
        return null
    }
}

async function writeLocalLrc(filePath: string | undefined, lyrics: string): Promise<void> {
    if (!filePath || !lyrics) return
    try {
        await fs.writeFile(lrcPathFor(filePath), lyrics, 'utf8')
        log(`Cached LRC next to audio file`)
    } catch (e) {
        console.error('[Lyrics] Failed to write local cache file:', e)
    }
}

// Build the set of search queries, deduplicated. Order matters only for
// logging — all queries run concurrently.
function buildQueries(title: string, artist: string, filePath?: string): string[] {
    const queries = new Set<string>()
    const push = (q: string) => {
        const norm = q.replace(/\s+/g, ' ').trim()
        if (norm.length > 0) queries.add(norm)
    }

    // Chinese core: only CJK characters, high precision for Chinese songs
    if (title && hasChinese(title)) {
        const cnTitle = extractChinese(title)
        const cnArtist = artist && hasChinese(artist) ? extractChinese(artist) : (artist || '')
        const words = Array.from(new Set(`${cnTitle} ${cnArtist}`.split(/\s+/)))
        push(words.join(' '))
    }

    if (title) push(`${title} ${artist || ''}`)

    const cTitle = cleanString(title)
    const cArtist = cleanString(artist)
    if (cTitle) push(`${cTitle} ${cArtist}`)

    if (filePath) {
        const filename = path.basename(filePath, path.extname(filePath))
        const parsedFilename = parseYouTubeFilename(filename)
        parsedFilename.queries.forEach(query => {
            push(query)
            const simplified = toSimplified(query)
            if (simplified !== query) push(simplified)
        })

        // Variety-show pattern: "歌手《歌名》..."
        const varietyMatch = filename.match(/(.+?)《(.+?)》(.*)/)
        if (varietyMatch) {
            const cA = cleanString(varietyMatch[1]).replace(/合唱/g, '').trim()
            const cT = cleanString(varietyMatch[2])
            if (cT) {
                push(`${cT} ${cA}`)
                push(cT)
            }
        }

        const parsed = parseArtistTitle(filename.replace(/_/g, ' '))
        if (parsed) push(`${parsed[1]} ${parsed[0]}`)

        push(cleanString(filename))
    }

    return Array.from(queries)
}

function dedupeCandidates(candidates: LyricCandidate[]): LyricCandidate[] {
    const unique = new Map<string, LyricCandidate>()
    for (const c of candidates) {
        const key = `${c.source}-${c.id}`
        if (!unique.has(key)) unique.set(key, c)
    }
    return Array.from(unique.values())
}

function selectBest(
    candidates: LyricCandidate[],
    targetTitles: string[],
    duration?: number
): LyricCandidate | null {
    if (candidates.length === 0) return null

    let pool = dedupeCandidates(candidates)
    const cleanTargets = targetTitles.map(cleanString).filter(Boolean)
    pool.forEach(c => {
        c.titleScore = Math.max(0, ...cleanTargets.map(target => getTitleMatchScore(c.track, target)))
    })

    // Duration is not an identity signal: unrelated songs frequently have the
    // same length. Require a credible title first, then use duration to choose
    // between versions of that title.
    const strongTitleMatches = pool.filter(c => (c.titleScore || 0) >= 0.8)
    const plausibleTitleMatches = pool.filter(c => (c.titleScore || 0) >= 0.55)
    if (strongTitleMatches.length > 0) {
        pool = strongTitleMatches
    } else if (plausibleTitleMatches.length > 0) {
        pool = plausibleTitleMatches
    } else {
        const topScore = Math.max(0, ...pool.map(c => c.titleScore || 0))
        log(`No candidate passed title threshold; best score=${topScore.toFixed(2)}`)
        return null
    }

    if (duration && duration > 0) {
        const strict = pool.filter(c => c.diff <= 4)
        if (strict.length > 0) {
            log(`Calibration: ${strict.length} strict duration matches (<=4s)`)
            pool = strict
        } else {
            const lenient = pool.filter(c => c.diff <= 10)
            if (lenient.length > 0) {
                log(`Calibration: ${lenient.length} lenient duration matches (<=10s)`)
                pool = lenient
            } else {
                log('Calibration: no duration matches, using full pool')
            }
        }
    }

    pool.sort((a, b) => {
        const scoreDiff = (b.titleScore || 0) - (a.titleScore || 0)
        if (Math.abs(scoreDiff) > 0.05) return scoreDiff
        return a.diff - b.diff
    })

    const top = pool[0]
    log(`Selected: "${top.track}" by ${top.artist} [${top.source}] diff=${top.diff.toFixed(2)}s score=${(top.titleScore || 0).toFixed(2)}`)
    return top
}

// Adjust LRC timestamps when the local file's duration differs from the
// matched source (different intro/outro edits, live cuts, etc.).
function annotateSourceDuration(lyrics: string, sourceDuration: number): string {
    if (!Number.isFinite(sourceDuration) || sourceDuration <= 0 || /\[nw-source-duration:/i.test(lyrics)) {
        return lyrics
    }
    return `[nw-source-duration:${sourceDuration.toFixed(3)}]\n${lyrics}`
}

async function calibrateTimeline(
    lyrics: string,
    sourceDuration: number,
    targetDuration: number,
    aiConfig?: AiConfig | null
): Promise<string> {
    // Timeline correction is opt-in. The renderer performs non-destructive
    // playback calibration so disabling it restores the original LRC timing.
    if (aiConfig?.calibrationEnabled !== true) return lyrics

    const gap = Math.abs(targetDuration - sourceDuration)
    if (gap <= 2.0 || gap >= 30.0) return lyrics

    if (isAiEnabled(aiConfig)) {
        log(`AI timeline calibration: source=${Math.round(sourceDuration)}s target=${Math.floor(targetDuration)}s`)
        try {
            const system =
                'You are a professional lyrics synchronization tool.\n' +
                `You will receive an LRC synced lyrics text. Your task is to adjust all timestamps (e.g. [01:23.45]) to fit the target audio duration of ${Math.floor(targetDuration)} seconds. The original duration of this LRC text is ${Math.round(sourceDuration)} seconds.\n` +
                'If the target version has a longer or shorter intro/outro, apply a uniform mathematical shift, or stretch the timestamps proportionally so that the lyric lines align correctly from start to finish.\n' +
                'Return ONLY the adjusted LRC lyrics. DO NOT wrap the output in markdown code blocks (```) or include any explanations.'
            const user = `Please adjust these LRC lyrics to fit target duration ${Math.floor(targetDuration)}s (original is ${Math.round(sourceDuration)}s):\n\n${lyrics}`

            const output = await callAI(aiConfig, { system, user, timeoutMs: 40000, reasoning: 'none' })
            if (output) {
                const cleaned = stripMarkdownFences(output)
                if (cleaned && cleaned.includes('[')) {
                    log('AI timeline calibration succeeded')
                    return cleaned
                }
            }
        } catch (e) {
            console.error('[Lyrics] AI calibration failed, falling back to math offset:', e)
        }
    }

    const offsetMs = Math.round((targetDuration - sourceDuration) * 1000)
    return `[offset:${offsetMs}]\n${lyrics}`
}

async function generateWithAI(req: LyricsRequest): Promise<string | null> {
    const { aiConfig, filePath, duration } = req
    if (!isAiEnabled(aiConfig)) return null

    log('DB search failed — falling back to AI lyrics generation')
    try {
        const searchInfo = {
            title: req.title || '',
            artist: req.artist || '',
            filename: filePath ? path.basename(filePath) : ''
        }

        // Optionally refresh title/artist from the file's tags
        if (filePath && (aiConfig.mode === 'audio' || aiConfig.mode === 'audio_filename')) {
            try {
                const metadata = await mm.parseFile(filePath, { skipCovers: true })
                if (metadata.common.title) searchInfo.title = metadata.common.title
                if (metadata.common.artist) searchInfo.artist = metadata.common.artist
            } catch (err) {
                console.warn('[Lyrics] Failed to read tags for AI search:', err)
            }
        }

        const parsedSong = parseChineseSongInfo(searchInfo.filename || searchInfo.title)
        const cleanTitle = cleanString(parsedSong.title || searchInfo.title)
        const cleanArtist = cleanString(parsedSong.artist || searchInfo.artist)
        const cleanFilename = cleanString(searchInfo.filename)

        let promptDetails = ''
        if (aiConfig.mode === 'filename') {
            promptDetails += `- Cleaned Track Title: "${cleanTitle}"\n- Cleaned Artist: "${cleanArtist}"\n- Raw Filename: "${searchInfo.filename || searchInfo.title}"\n`
        } else if (aiConfig.mode === 'audio') {
            promptDetails += `- Cleaned Track Title: "${cleanTitle}"\n- Cleaned Artist: "${cleanArtist}"\n- Raw Track Title: "${searchInfo.title}"\n- Raw Artist: "${searchInfo.artist}"\n`
        } else {
            promptDetails += `- Cleaned Track Title: "${cleanTitle}"\n- Cleaned Artist: "${cleanArtist}"\n- Cleaned Filename: "${cleanFilename}"\n- Raw Track Title: "${searchInfo.title}"\n- Raw Artist: "${searchInfo.artist}"\n- Raw Filename: "${searchInfo.filename}"\n`
        }
        if (duration) {
            promptDetails += `- Song Duration: ${Math.floor(duration)} seconds\n`
        }

        const system =
            'You are a professional lyrics database and synchronization tool. Your job is to provide accurate synchronized lyrics (LRC format) for requested songs.\n\n' +
            'IMPORTANT GUIDELINES:\n' +
            '1. If you KNOW or REMEMBER the lyrics to the song, output them in LRC format with [mm:ss.xx] timestamps.\n' +
            '2. If you are NOT SURE about the lyrics, you can make reasonable estimates based on similar songs or common patterns, but clearly indicate uncertainty.\n' +
            '3. If you have absolutely NO information about the song, output: "UNKNOWN: <song title> by <artist>"\n' +
            '4. DO NOT output "Lyrics not found" unless you truly have no information about the song.\n' +
            '5. Output ONLY the raw LRC content. No explanations, no markdown blocks.'

        const user =
            'Please provide the synchronized lyrics (LRC format) for this song.\n' +
            'The lyrics MUST contain timestamps in the [minutes:seconds.hundredths] format (e.g., [00:12.34]).\n\n' +
            `Song details:\n${promptDetails}\n\n` +
            'REQUIREMENTS:\n' +
            '1. Output ONLY the raw LRC content with timestamps.\n' +
            '2. DO NOT wrap the output in markdown code blocks (```), HTML, or any other explanations.\n' +
            `3. If this is a cover version (翻唱), ensure the lyrics and timestamps match this version, particularly aligning with the total duration of ${duration ? Math.floor(duration) : 'unknown'} seconds.\n` +
            '4. If you don\'t know the exact lyrics but can guess, provide your best estimate.\n' +
            `5. If you have absolutely no information about this song, output exactly: "UNKNOWN: ${cleanTitle} by ${cleanArtist}"\n\n` +
            'Please try your best to find or recall the lyrics for this song!'

        log(`AI generation via provider: ${aiConfig.provider}, model: ${aiConfig.model || '(default)'}`)
        const output = await callAI(aiConfig, {
            system,
            user,
            timeoutMs: 120000,
            reasoning: aiConfig.reasoning
        })
        if (!output) {
            log('AI generation failed: empty output')
            return null
        }

        const cleaned = stripMarkdownFences(output)
        if (cleaned.toLowerCase().startsWith('unknown:')) {
            log(`AI has no information about this song: ${cleaned.slice(0, 120)}`)
            return null
        }
        if (!cleaned.includes('[')) {
            log('AI generation failed: output has no timestamps')
            return null
        }
        log('AI generation succeeded')
        return cleaned
    } catch (err) {
        console.error('[Lyrics] AI generation failed:', err)
        return null
    }
}

export async function searchLyrics(req: LyricsRequest): Promise<string | null> {
    const title = req.title || ''
    const artist = usableArtist(req.artist)
    const { filePath, duration } = req
    const lang = resolveLang(req.aiConfig)
    const parsedFilename = filePath ? parseYouTubeFilename(filePath) : null
    const effectiveTitle = title
        || parseChineseSongInfo(filePath ? path.basename(filePath) : '').title
        || parsedFilename?.title
        || (filePath ? cleanString(path.basename(filePath, path.extname(filePath))) : '')
    const titleCandidates = [effectiveTitle]
    if (parsedFilename?.title) titleCandidates.push(parsedFilename.title)
    if (parsedFilename?.confidence === 'medium' && parsedFilename.artist) {
        titleCandidates.push(parsedFilename.artist)
    }
    const uniqueTitleCandidates = Array.from(new Set(titleCandidates.filter(Boolean)))

    try {
        log(`Request: title="${title}" artist="${artist}" duration=${duration} provider=${req.aiConfig?.provider || 'default'}`)

        // 1. Local sidecar cache
        const cached = await readLocalLrc(filePath)
        if (cached) {
            log('Found local .lrc cache')
            return convertLyrics(cached, lang)
        }

        // 2. LRCLib exact-match fast path. Parsed filename pairs are search-only
        // and never replace the track metadata shown by the renderer.
        const exactPairs: Array<{ title: string; artist: string }> = []
        const addExactPair = (pairTitle: string, pairArtist: string) => {
            if (!pairTitle || !pairArtist) return
            if (!exactPairs.some(pair => pair.title === pairTitle && pair.artist === pairArtist)) {
                exactPairs.push({ title: pairTitle, artist: pairArtist })
            }
        }
        addExactPair(title, artist)
        addExactPair(toSimplified(title), toSimplified(artist))
        if (parsedFilename) {
            addExactPair(parsedFilename.title, parsedFilename.artist)
            addExactPair(toSimplified(parsedFilename.title), toSimplified(parsedFilename.artist))
            if (parsedFilename.confidence === 'medium') {
                addExactPair(parsedFilename.artist, parsedFilename.title)
                addExactPair(toSimplified(parsedFilename.artist), toSimplified(parsedFilename.title))
            }
        }
        const exactCandidates = (await Promise.all(
            exactPairs.map(pair => lrclibGetExact(pair.title, pair.artist, duration).catch(() => null))
        )).filter((candidate): candidate is LyricCandidate => candidate !== null)
        const exact = selectBest(exactCandidates, uniqueTitleCandidates, duration)
        if (exact && (!duration || exact.diff <= 4)) {
            log(`Fast path hit: "${exact.track}" [LRCLib exact] diff=${exact.diff.toFixed(2)}s`)
            const sourceLyrics = annotateSourceDuration(exact.lyrics, exact.duration)
            const calibrated = await calibrateTimeline(sourceLyrics, exact.duration, duration || 0, req.aiConfig)
            await writeLocalLrc(filePath, calibrated)
            return convertLyrics(calibrated, lang)
        }

        // 3. Multi-provider sweep over deduplicated queries
        const queries = buildQueries(title, artist, filePath)
        log(`Sweep: ${queries.length} queries × 3 providers`)
        const settled = await Promise.allSettled(
            queries.flatMap(q => [
                lrclibSearch(q, duration),
                neteaseSearch(q, duration),
                kugouSearch(q, duration)
            ])
        )
        const candidates: LyricCandidate[] = []
        candidates.push(...exactCandidates)
        for (const result of settled) {
            if (result.status === 'fulfilled') candidates.push(...result.value)
        }
        log(`Sweep collected ${candidates.length} raw candidates`)

        // 4. Score and select
        const best = selectBest(candidates, uniqueTitleCandidates, duration)

        if (best) {
            // 5. Timeline calibration
            const sourceLyrics = annotateSourceDuration(best.lyrics, best.duration)
            const calibrated = (duration && best.duration)
                ? await calibrateTimeline(sourceLyrics, best.duration, duration, req.aiConfig)
                : sourceLyrics
            await writeLocalLrc(filePath, calibrated)
            return convertLyrics(calibrated, lang)
        }

        // 6. AI generation fallback
        const generated = await generateWithAI(req)
        if (generated) {
            await writeLocalLrc(filePath, generated)
            return convertLyrics(generated, lang)
        }

        log('No lyrics found via DB or AI')
        return null
    } catch (e) {
        console.error('[Lyrics] Unexpected error:', e)
        return null
    }
}
