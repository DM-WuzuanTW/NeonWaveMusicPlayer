export interface ParsedMediaName {
    title: string
    artist: string
    queries: string[]
    confidence: 'high' | 'medium' | 'low'
}

const MEDIA_EXTENSION = /\.(?:m4a|mp3|mp4|flac|wav|ogg|opus|webm|mov|avi|wmv)$/i
const LEADING_LABEL = /^\s*(?:(?:【|\[)\s*(?:hd|mv|clip|stage|live|純享(?:版)?|纯享(?:版)?|單曲純享|单曲纯享|完整版|官方)[^】\]]*(?:】|\])|『\s*mv\s*』|\(\s*完整版\s*\))\s*/i
const NOISE_WORDS = /(?:official|music\s*video|lyric(?:s)?\s*(?:video)?|dynamic\s*lyrics|官方(?:完整)?版?|完整版|高清|高畫質|高音質|无损|無損|字幕|動態歌詞|动态歌词|歌詞版?|歌词版?|vietsub|pinyin|mangotv|iqiyi|zjstv|youtube|華納|华纳|avex)/i
const VERSION_WORDS = /(?:live|現場|现场|stage|cover|翻唱|原唱|remix|改編|改编|加速|變速|变速|抖音|女聲|女声|男聲|男声|深情|溫柔|温柔|emo|新版|完整版|純享|纯享|伴奏|karaoke|prod\.?\s*by)/i
const SHOW_WORDS = /(?:天賜的聲音|天赐的声音|中國好聲音|中国好声音|夢想的聲音|梦想的声音|聲生不息|声生不息|披荊斬棘|披荆斩棘|時光音樂會|时光音乐会|call me by fire|infinity and beyond|sing.?china|ep\.?\s*\d+|第\s*\d+\s*期)/i
const PERFORMANCE_VERBS = /(?:傾情|倾情|深情|聯手|联手|默契|高燃|走心|經典|经典)?(?:演唱|翻唱|合唱|對唱|对唱|演繹|演绎|唱|帶來|带来|獻唱|献唱).*$/

function compact(value: string): string {
    return value
        .normalize('NFKC')
        .replace(/[–—−]/g, '-')
        .replace(/[｜|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function isNoiseBlock(value: string): boolean {
    return NOISE_WORDS.test(value) || SHOW_WORDS.test(value) || VERSION_WORDS.test(value)
}

function removeBracketNoise(value: string): string {
    let output = value
    for (let pass = 0; pass < 3; pass++) {
        output = output.replace(/(\[|【|\(|（)([^\]】)）]*)(\]|】|\)|）)/g, (whole, _open, content) => {
            return isNoiseBlock(content) || /(?:電影|电影|電視劇|电视剧|影集|動畫|动画|主題曲|主题曲|片尾曲|片頭曲|片头曲|插曲|ost)/i.test(content)
                ? ' '
                : whole
        })
    }
    return output
}

function cleanArtist(value: string): string {
    const leadingTags = value.match(/^\s*((?:#[\p{L}\p{N}_.-]+\s*)+)/u)?.[1]
    if (leadingTags) {
        const artists = [...leadingTags.matchAll(/#([\p{L}\p{N}_.-]+)/gu)]
            .map(match => match[1])
            .filter(tag => !isNoiseBlock(tag))
        if (artists.length > 0) return artists.join(' ')
    }
    return compact(value
        .replace(LEADING_LABEL, '')
        .replace(/^#+[^\s]+(?:\s+#+[^\s]+)*\s*/, '')
        .replace(PERFORMANCE_VERBS, '')
        .replace(/^(?:完整版|純享版|纯享版|單曲純享|单曲纯享)\s*/i, '')
        .replace(/[：:].*$/, '')
        .replace(/(?:官方|official).*$/i, '')
        .replace(/^(?:《|【|\[)|(?:》|】|\])$/g, ''))
}

export function sanitizeSongText(value: string): string {
    let output = compact(value.replace(MEDIA_EXTENSION, ''))
    output = output.replace(/『[^』]{8,}』|「[^」]{8,}」|“[^”]{12,}”|"[^"]{12,}"/g, ' ')
    output = removeBracketNoise(output)
    output = output
        .replace(/#[\p{L}\p{N}_-]+/gu, ' ')
        .replace(/\b(?:official|music|video|mv|lyrics?|audio|hd|hq|4k|full|version)\b/gi, ' ')
        .replace(/(?:動態歌詞|动态歌词|歌詞版?|歌词版?|官方完整版|官方版|高清|高畫質|高音質|無損音質|无损音质)/gi, ' ')
        .replace(/[♪♫🎶💥]+/gu, ' ')
        .replace(/\s*_\s*/g, ' ')
    return compact(output).replace(/^[-:：]+|[-:：]+$/g, '').trim()
}

function cleanTitle(value: string): string {
    let output = sanitizeSongText(value)
    output = output.replace(/[（(]([^）)]*)[）)]/g, (whole, content) => isNoiseBlock(content) ? ' ' : whole)
    output = output
        .replace(new RegExp(`\\s*(?:-|·)?\\s*(?:${VERSION_WORDS.source})(?:歌曲|版|音樂|音乐|\\s*\\d+(?:\\.\\d+)?x?)?.*$`, 'i'), ' ')
        .replace(/\s+(?:feat\.?|ft\.?)\s+.+$/i, '')
        .replace(/\s+(?:官方|official)(?:\s+.*)?$/i, '')
    return compact(output)
}

function addQuery(target: string[], title: string, artist = ''): void {
    const query = compact(`${title} ${artist}`)
    if (query && !target.some(existing => existing.toLocaleLowerCase() === query.toLocaleLowerCase())) {
        target.push(query)
    }
}

function usefulBracket(value: string): boolean {
    const cleaned = compact(value)
    return cleaned.length > 0 && cleaned.length <= 80 && !isNoiseBlock(cleaned)
}

function extractExplicit(raw: string): { title: string; artist: string } | null {
    const candidates = [...raw.matchAll(/《([^》]+)》/g)]
        .map(match => ({ match, title: cleanTitle(match[1].replace(/^\s*#/, '')) }))
        .filter(item => usefulBracket(item.title))

    const square = [...raw.matchAll(/(?:【|\[)([^】\]]+)(?:】|\])/g)]
        .map(match => ({ match, title: cleanTitle(match[1].replace(/^\s*#/, '')) }))
        .filter(item => usefulBracket(item.title))
    const selected = [...candidates, ...square]
        .sort((a, b) => (a.match.index || 0) - (b.match.index || 0))[0]
    if (!selected) return null

    const index = selected.match.index || 0
    const before = raw.slice(0, index)
    const after = raw.slice(index + selected.match[0].length)
    let artist = cleanArtist(before)

    if (!artist || /^(?:mv|stage|clip)$/i.test(artist)) {
        const afterArtist = after.match(/^\s*[-_:：]?\s*([^【[(（#|]{1,50})/)
        artist = afterArtist ? cleanArtist(afterArtist[1]) : ''
    }
    return { title: selected.title, artist }
}

function splitDash(raw: string): { left: string; right: string } | null {
    for (let index = 1; index < raw.length - 1; index++) {
        if (raw[index] !== '-') continue
        const before = raw[index - 1]
        const after = raw[index + 1]
        const hasSpacing = /\s/.test(before) || /\s/.test(after)
        // Preserve hyphens inside romanized names and channel identifiers.
        if (!hasSpacing && /[A-Za-z0-9]/.test(before) && /[A-Za-z0-9]/.test(after)) continue

        const left = cleanTitle(raw.slice(0, index))
        const right = cleanTitle(raw.slice(index + 1).split(/[『「“#【[]/)[0])
        if (!left || !right || isNoiseBlock(right)) continue
        return { left, right }
    }
    return null
}

function looksLikeTitleFirst(left: string, right: string): boolean {
    if (left.length > 12 || right.length > 35) return false
    const artistSignal = /(?:樂隊|乐队|组合|兄弟|先生|小姐|[&,+、]|\b(?:and|band|team)\b)/i
    return artistSignal.test(right) && !artistSignal.test(left)
}

export function parseYouTubeFilename(input: string): ParsedMediaName {
    const stem = compact(input.replace(/^.*[\\/]/, '').replace(MEDIA_EXTENSION, ''))
        .replace(LEADING_LABEL, '')
    const queries: string[] = []
    const explicit = extractExplicit(stem)
    if (explicit?.title) {
        addQuery(queries, explicit.title, explicit.artist)
        addQuery(queries, explicit.title)
        return { ...explicit, queries, confidence: 'high' }
    }

    const dash = splitDash(stem)
    if (dash) {
        const titleFirst = looksLikeTitleFirst(dash.left, dash.right)
        const title = titleFirst ? dash.left : dash.right
        const artist = titleFirst ? dash.right : dash.left
        addQuery(queries, title, artist)
        addQuery(queries, artist, title)
        addQuery(queries, title)
        // A bare "A - B" has no universal direction. Search both sides alone
        // because some providers return no results for an otherwise-correct
        // title + artist query (especially across Traditional/Simplified names).
        addQuery(queries, artist)
        return { title, artist, queries, confidence: 'medium' }
    }

    const quoted = stem.match(/[“"]\s*([^”"]{1,50})\s*[”"]\s*(?:official|stage|theme)/i)
    if (quoted) {
        const title = cleanTitle(quoted[1])
        const artist = cleanArtist(stem.slice(0, quoted.index))
        addQuery(queries, title, artist)
        return { title, artist, queries, confidence: 'high' }
    }

    const cleaned = cleanTitle(stem)
        .replace(SHOW_WORDS, ' ')
        .replace(/\s+(?:mv|official).*$/i, '')
        .trim()
    addQuery(queries, cleaned)
    const chineseSegments = cleaned.match(/[一-龥]{2,}/g) || []
    chineseSegments.forEach(segment => addQuery(queries, segment))
    return { title: cleaned || stem, artist: '', queries, confidence: 'low' }
}
