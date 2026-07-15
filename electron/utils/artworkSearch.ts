// Track artwork URL lookup for Discord Rich Presence.
// Replaces the old telegra.ph upload flow (that API is dead) — instead of
// uploading the user's local cover image, look the song up on public music
// APIs and use their CDN artwork URL directly. No user data leaves the machine.

async function fetchJson(url: string, timeoutMs = 8000): Promise<any | null> {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
        if (!res.ok) return null
        return await res.json()
    } catch {
        return null
    }
}

export async function searchTrackArtwork(title: string, artist: string): Promise<string | null> {
    const term = `${title || ''} ${artist || ''}`.trim()
    if (!term) return null

    // 1. iTunes Search API — no auth, stable CDN URLs
    const itunes = await fetchJson(
        `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=1`
    )
    const itunesArt = itunes?.results?.[0]?.artworkUrl100
    if (typeof itunesArt === 'string' && itunesArt) {
        return itunesArt.replace('100x100bb', '512x512bb')
    }

    // 2. Deezer fallback
    const deezer = await fetchJson(
        `https://api.deezer.com/search?q=${encodeURIComponent(term)}&limit=1`
    )
    const deezerArt = deezer?.data?.[0]?.album?.cover_big
    if (typeof deezerArt === 'string' && deezerArt) {
        return deezerArt
    }

    return null
}
