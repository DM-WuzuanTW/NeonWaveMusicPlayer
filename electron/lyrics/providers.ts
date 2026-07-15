// Synced-lyrics providers: LRCLib, NetEase Cloud Music and KuGou.
// Every provider returns normalized LyricCandidate objects and never throws.

export interface LyricCandidate {
    source: 'LRCLib' | 'Netease' | 'Kugou'
    id: string | number
    track: string
    artist: string
    duration: number
    lyrics: string
    diff: number
    titleScore?: number
}

const durationDiff = (candDur: number, targetDur?: number) =>
    targetDur && targetDur > 0 ? Math.abs(candDur - targetDur) : 0

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 10000): Promise<any | null> {
    try {
        const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
        if (!res.ok) return null
        return await res.json()
    } catch {
        return null
    }
}

// --- LRCLib -----------------------------------------------------------------

// Exact-match endpoint. When the track has clean metadata this resolves in a
// single request and is the most precise source available.
export async function lrclibGetExact(
    title: string,
    artist: string,
    duration?: number
): Promise<LyricCandidate | null> {
    if (!title || !artist) return null
    const params = new URLSearchParams({ track_name: title, artist_name: artist })
    if (duration && duration > 0) params.set('duration', String(Math.round(duration)))
    const data = await fetchJson(`https://lrclib.net/api/get?${params.toString()}`, {}, 8000)
    if (!data || !data.syncedLyrics) return null
    return {
        source: 'LRCLib',
        id: data.id,
        track: data.trackName,
        artist: data.artistName,
        duration: data.duration,
        lyrics: data.syncedLyrics,
        diff: durationDiff(data.duration, duration)
    }
}

export async function lrclibSearch(query: string, targetDur?: number): Promise<LyricCandidate[]> {
    const list = await fetchJson(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, {}, 10000)
    if (!Array.isArray(list)) return []
    return list
        .filter((t: any) => t.syncedLyrics && t.syncedLyrics.length > 0)
        .map((t: any) => ({
            source: 'LRCLib' as const,
            id: t.id,
            track: t.trackName,
            artist: t.artistName,
            duration: t.duration,
            lyrics: t.syncedLyrics,
            diff: durationDiff(t.duration, targetDur)
        }))
}

// --- NetEase ----------------------------------------------------------------

const NETEASE_HEADERS = { Referer: 'https://music.163.com/', Cookie: 'appver=2.0.2' }

export async function neteaseSearch(query: string, targetDur?: number): Promise<LyricCandidate[]> {
    const searchUrl = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(query)}&type=1&offset=0&total=true&limit=5`
    const data = await fetchJson(searchUrl, { headers: NETEASE_HEADERS }, 12000)
    if (!data?.result?.songs) return []

    let candidates = data.result.songs.map((s: any) => ({
        id: s.id,
        track: s.name,
        artist: s.artists?.[0]?.name || 'Unknown',
        duration: s.duration / 1000,
        diff: durationDiff(s.duration / 1000, targetDur)
    }))

    if (targetDur && targetDur > 0) {
        candidates = candidates.filter((c: any) => c.diff <= 15)
        candidates.sort((a: any, b: any) => a.diff - b.diff)
    }
    if (candidates.length === 0) return []

    const best = candidates[0]
    const lrcData = await fetchJson(
        `https://music.163.com/api/song/lyric?id=${best.id}&lv=1&kv=1&tv=-1`,
        { headers: NETEASE_HEADERS },
        12000
    )
    if (!lrcData?.lrc?.lyric) return []

    return [{
        source: 'Netease',
        id: best.id,
        track: best.track,
        artist: best.artist,
        duration: best.duration,
        lyrics: lrcData.lrc.lyric,
        diff: best.diff
    }]
}

// --- KuGou ------------------------------------------------------------------
// Three-step flow: song search -> krc candidate lookup -> LRC download.
// Very strong coverage for Chinese songs.

export async function kugouSearch(query: string, targetDur?: number): Promise<LyricCandidate[]> {
    const searchUrl = `https://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(query)}&page=1&pagesize=5`
    const data = await fetchJson(searchUrl, {}, 10000)
    const songs: any[] = data?.data?.info
    if (!Array.isArray(songs) || songs.length === 0) return []

    let candidates = songs.map((s: any) => ({
        hash: s.hash,
        track: s.songname || '',
        artist: s.singername || 'Unknown',
        duration: Number(s.duration) || 0,
        diff: durationDiff(Number(s.duration) || 0, targetDur)
    })).filter(c => c.hash)

    if (targetDur && targetDur > 0) {
        candidates = candidates.filter(c => c.diff <= 15)
        candidates.sort((a, b) => a.diff - b.diff)
    }
    if (candidates.length === 0) return []

    const best = candidates[0]
    const krc = await fetchJson(
        `https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=&duration=&hash=${encodeURIComponent(best.hash)}`,
        {},
        10000
    )
    const cand = krc?.candidates?.[0]
    if (!cand?.id || !cand?.accesskey) return []

    const dl = await fetchJson(
        `https://krcs.kugou.com/download?ver=1&client=pc&id=${cand.id}&accesskey=${cand.accesskey}&fmt=lrc&charset=utf8`,
        {},
        10000
    )
    if (!dl?.content) return []

    let lyrics: string
    try {
        lyrics = Buffer.from(dl.content, 'base64').toString('utf8')
    } catch {
        return []
    }
    if (!lyrics.includes('[')) return []

    return [{
        source: 'Kugou',
        id: best.hash,
        track: best.track,
        artist: best.artist,
        duration: best.duration,
        lyrics,
        diff: best.diff
    }]
}
