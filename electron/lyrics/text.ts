// Text utilities for the lyrics engine: cleaning noisy titles/filenames,
// Chinese variant conversion and fuzzy title matching.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export type LyricsLang = 'original' | 'cn' | 'tw'

// OpenCC converters are expensive to construct — build each direction once.
let toCnConverter: ((s: string) => string) | null = null
let toTwConverter: ((s: string) => string) | null = null

function getConverter(lang: 'cn' | 'tw'): ((s: string) => string) | null {
    try {
        const OpenCC = require('opencc-js')
        if (lang === 'cn') {
            if (!toCnConverter) toCnConverter = OpenCC.Converter({ from: 'tw', to: 'cn' })
            return toCnConverter
        }
        if (!toTwConverter) toTwConverter = OpenCC.Converter({ from: 'cn', to: 'tw' })
        return toTwConverter
    } catch {
        return null
    }
}

export function toSimplified(text: string): string {
    const conv = getConverter('cn')
    return conv ? conv(text) : text
}

export function convertLyrics(text: string | null, lang: LyricsLang): string | null {
    if (!text) return null
    if (lang === 'original') return text
    const conv = getConverter(lang)
    return conv ? conv(text) : text
}

export const hasChinese = (str: string) => /[一-龥]/.test(str)

export const extractChinese = (str: string) => {
    const matches = str.match(/[一-龥]+/g)
    return matches ? matches.join(' ') : ''
}

const JUNK_KEYWORDS = [
    'official', 'music video', 'preview', 'trailer', 'teaser',
    'lyric', 'lyrics', 'sub', 'vietsub', 'pinyin', 'engsub',
    '動態歌詞', '动态歌词', '歌詞', '歌词', '字幕',
    'concert', 'stage', 'performance', '現場', '现场',
    'cover', 'remix', 'medley', 'live',
    'version', 'ver', '版', '翻唱', '原唱',
    'ost', 'soundtrack', 'theme song', 'op', 'ed',
    'hd', 'hq', 'sq', '4k', '1080p', 'hi-res',
    'pure', 'full', 'complete', '純享', '纯享',
    'feat', 'ft', '合唱',
    'prod', 'presents',
    '好聲音', '好声音', '歌手', '聲生不息', '声生不息', '天賜的聲音', '天赐的声音',
    '蒙面唱將', '蒙面唱将', '我們的歌', '我们的歌', '時光音樂會', '时光音乐会',
    'mangotv', 'call me by fire', '乘風破浪', '披荊斬棘'
]

const LOOSE_JUNK = [
    'Official Music Video', 'Official Lyric Video', 'Official Video', 'Official Audio', 'Official MV',
    'Music Video', 'Lyric Video', 'Theme Song', 'Ending Theme', 'Opening Theme', 'Dynamic Lyrics'
]

const WORDS_TO_REMOVE = [
    'official', 'mv', 'lyric', 'lyrics', 'video', 'hd', 'hq', 'sq', '4k',
    'live', 'cover', 'remix', 'feat', 'ft', 'mangotv',
    '動態歌詞', '单纯', '純享', '纯享', 'vietsub', 'pinyin'
]

export function cleanString(str: string): string {
    if (!str) return ''
    let s = str

    // Remove Japanese-style quotes
    s = s.replace(/『[^』]*』/g, '').replace(/「[^」]*」/g, '')

    const isJunk = (text: string) => JUNK_KEYWORDS.some(k => text.toLowerCase().includes(k))

    const replaceSmart = (text: string, open: string, close: string) => {
        const esc = (c: string) => '\\' + c
        const regex = new RegExp(`${esc(open)}([^${esc(close)}]*)?${esc(close)}`, 'gi')
        return text.replace(regex, (_, content) => {
            if (!content) return ' '
            if (isJunk(content)) return ' '
            // Keep content but remove brackets
            return ' ' + content + ' '
        })
    }

    s = replaceSmart(s, '(', ')')
    s = replaceSmart(s, '（', '）')
    s = replaceSmart(s, '[', ']')
    s = replaceSmart(s, '【', '】')
    s = replaceSmart(s, '{', '}')
    s = replaceSmart(s, '《', '》')

    for (const p of LOOSE_JUNK) {
        const regex = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
        s = s.replace(regex, ' ')
    }

    for (const w of WORDS_TO_REMOVE) {
        if (/^[a-z0-9]+$/i.test(w)) {
            s = s.replace(new RegExp(`\\b${w}\\b`, 'gi'), ' ')
        } else {
            s = s.replace(new RegExp(w, 'gi'), ' ')
        }
    }

    // Normalize symbols
    s = s.replace(/[:"'_\|\.,!@#$%^&*+=?\/\\♪♫~`\-]/g, ' ')
    return s.replace(/\s+/g, ' ').trim()
}

export function parseChineseSongInfo(rawStr: string): { title: string; artist: string } {
    let titleVal = ''
    let artistVal = ''

    // Case 1: "Artist《Title》" or "Artist 演唱《Title》"
    const mvMatch = rawStr.match(/([^\s【\]\(\)（）]+?)(?:导师|老師|大秀|導師)?(?:演唱|翻唱|唱|帶來|版本)?《([^》]+)》/)
    if (mvMatch) {
        artistVal = mvMatch[1]
        titleVal = mvMatch[2]
    } else {
        // Case 2: standard book quotes 《Title》
        const bookMatch = rawStr.match(/[《〈「『]([^》〉」』]+)[》〉」』]/)
        if (bookMatch) {
            titleVal = bookMatch[1]
            const beforeStr = rawStr.substring(0, rawStr.indexOf(bookMatch[0])).trim()
            const cleanBefore = beforeStr.replace(/【[^】]*】/g, '').replace(/\[[^\]]*\]/g, '').trim()
            if (cleanBefore) {
                artistVal = cleanBefore.split(/\s+/).pop() || ''
            }
        }
    }

    // Case 3: "Artist - [Title/EnglishTitle]" or "Artist - Title [Subtitle]"
    if (!titleVal) {
        const bracketMatch = rawStr.match(/(?:^|[-–—]\s*)(?:[^\[\]]+?)?\[([^\]]+)\]/)
        if (bracketMatch) {
            const bracketContent = bracketMatch[1]
            // Extract Chinese title from bracket (e.g., "失語者/Aphasia" -> "失語者")
            const chineseMatch = bracketContent.match(/([一-龥]+)/)
            if (chineseMatch) {
                titleVal = chineseMatch[1]
            } else {
                titleVal = bracketContent.split(/[\/\-–—]/)[0].trim()
            }

            const beforeBracket = rawStr.substring(0, rawStr.indexOf('[')).trim()
            const artistMatch = beforeBracket.match(/([^\s-–—]+(?:\s+[A-Za-z]+)*)$/)
            if (artistMatch) {
                artistVal = artistMatch[1].trim()
            }
        }
    }

    // Case 4: standard dash splitting
    if (!titleVal) {
        try {
            const getArtistTitle = require('get-artist-title')
            const parsed = getArtistTitle(rawStr)
            if (parsed) {
                artistVal = parsed[0]
                titleVal = parsed[1]
            }
        } catch { /* optional dependency path */ }
    }

    return { title: titleVal.trim(), artist: artistVal.trim() }
}

export function parseArtistTitle(input: string): [string, string] | null {
    try {
        const getArtistTitle = require('get-artist-title')
        const parsed = getArtistTitle(input)
        if (parsed && parsed.length === 2) return parsed as [string, string]
    } catch { /* ignore */ }
    return null
}

// Fuzzy similarity between a candidate track name and the target title.
// 1.0 exact (after cleaning + simplification), 0.8 containment, otherwise
// character-set Jaccard overlap.
export function getTitleMatchScore(candTitle: string, targetTitle: string): number {
    const c1 = cleanString(toSimplified(candTitle || '')).toLowerCase().replace(/\s+/g, '')
    const c2 = cleanString(toSimplified(targetTitle || '')).toLowerCase().replace(/\s+/g, '')
    if (!c1 || !c2) return 0
    if (c1 === c2) return 1.0
    if (c1.includes(c2) || c2.includes(c1)) return 0.8

    const set1 = new Set(c1.split(''))
    const set2 = new Set(c2.split(''))
    let intersection = 0
    set1.forEach(char => {
        if (set2.has(char)) intersection++
    })
    const union = new Set([...set1, ...set2]).size
    return union > 0 ? intersection / union : 0
}

export function stripMarkdownFences(text: string): string {
    let cleaned = text.trim()
    cleaned = cleaned.replace(/```(?:lrc|ini|txt|)?\n([\s\S]*?)\n```/g, '$1')
    cleaned = cleaned.replace(/```([\s\S]*?)```/g, '$1')
    return cleaned.trim()
}
