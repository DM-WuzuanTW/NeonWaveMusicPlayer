import React from 'react'
import { Music, AudioWaveform, Heart, Film } from 'lucide-react'
import styles from './Playlist.module.css'
import { Track } from '../../hooks/useAudioPlayer'

// LRU artwork cache + request queue.
// The virtualized list still mounts many visible items at once, so we cap
// concurrent artwork lookups to keep scrolling responsive.
const ARTWORK_CACHE_MAX = 80
const artworkCache = new Map<string, string>()
const artworkResultCache = new Map<string, { artwork?: string; duration?: number }>()
const artworkPromiseCache = new Map<string, Promise<{ artwork?: string; duration?: number }>>()
const ARTWORK_LOAD_CONCURRENCY = 2
let activeArtworkLoads = 0
const artworkLoadQueue: Array<() => void> = []

function getCachedArtwork(key: string): string | undefined {
    const val = artworkCache.get(key)
    if (val) {
        // Move to end (most recently used)
        artworkCache.delete(key)
        artworkCache.set(key, val)
    }
    return val
}

function setCachedArtwork(key: string, value: string) {
    if (artworkCache.has(key)) {
        artworkCache.delete(key)
    } else if (artworkCache.size >= ARTWORK_CACHE_MAX) {
        // Evict oldest entry
        const oldest = artworkCache.keys().next().value!
        artworkCache.delete(oldest)
    }
    artworkCache.set(key, value)
}

function setCachedArtworkResult(key: string, value: { artwork?: string; duration?: number }) {
    artworkResultCache.set(key, value)
    if (value.artwork) {
        setCachedArtwork(key, value.artwork)
    }
}

function runNextArtworkLoad() {
    if (activeArtworkLoads >= ARTWORK_LOAD_CONCURRENCY) return
    const next = artworkLoadQueue.shift()
    if (!next) return
    activeArtworkLoads += 1
    next()
}

function scheduleArtworkLoad<T>(work: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        const task = () => {
            work()
                .then(resolve, reject)
                .finally(() => {
                    activeArtworkLoads -= 1
                    runNextArtworkLoad()
                })
        }

        artworkLoadQueue.push(task)
        runNextArtworkLoad()
    })
}

function loadTrackArtwork(track: Track): Promise<{ artwork?: string; duration?: number }> {
    const cached = artworkResultCache.get(track.path)
    if (cached) return Promise.resolve(cached)

    const cachedPromise = artworkPromiseCache.get(track.path)
    if (cachedPromise) return cachedPromise

    const promise = scheduleArtworkLoad(async () => {
        if (track.path.startsWith('shared:')) {
            const query = track.path.replace('shared:', '')
            const results = await window.ipcRenderer.searchYouTube(query)
            const first = results?.[0]
            const resolved = {
                artwork: first?.thumbnail || undefined,
                duration: first?.duration || undefined
            }
            setCachedArtworkResult(track.path, resolved)
            return resolved
        }

        const art = await window.ipcRenderer.getAudioArtwork(track.path)
        const resolved = { artwork: art || undefined }
        if (resolved.artwork) {
            setCachedArtworkResult(track.path, resolved)
        } else {
            artworkResultCache.set(track.path, resolved)
        }
        return resolved
    }).finally(() => {
        artworkPromiseCache.delete(track.path)
    })

    artworkPromiseCache.set(track.path, promise)
    return promise
}

interface TrackItemProps {
    id?: string
    style?: React.CSSProperties
    track: Track
    isActive: boolean
    isFavorite?: boolean
    isHighlighted?: boolean
    onClick: () => void
    onToggleFavorite?: () => void
    trackIndex?: number
}

export const TrackItem: React.FC<TrackItemProps> = ({ id, style, track, isActive, isFavorite, isHighlighted, onClick, onToggleFavorite, trackIndex }) => {
    const [artwork, setArtwork] = React.useState<string | undefined>(() => {
        return track.artwork || getCachedArtwork(track.path) || artworkResultCache.get(track.path)?.artwork
    })
    const [resolvedDuration, setResolvedDuration] = React.useState<number | undefined>(() => track.duration)
    const itemRef = React.useRef<HTMLDivElement>(null)

    // Sync artwork from props (e.g. when currentTrack provides it)
    React.useEffect(() => {
        if (track.artwork) {
            setArtwork(track.artwork)
            setCachedArtwork(track.path, track.artwork)
            setCachedArtworkResult(track.path, { artwork: track.artwork, duration: track.duration })
        }
        if (track.duration) {
            setResolvedDuration(track.duration)
        }
    }, [track.artwork, track.duration, track.path])

    // Reuse results already fetched elsewhere without touching IPC again.
    React.useEffect(() => {
        const cached = artworkResultCache.get(track.path)
        if (!cached) return

        if (cached.artwork && cached.artwork !== artwork) {
            setArtwork(cached.artwork)
        }

        if (cached.duration && !resolvedDuration) {
            setResolvedDuration(cached.duration)
        }
    }, [artwork, resolvedDuration, track.path])

    // Lazy-load artwork when visible (via IntersectionObserver) with a small debounce/delay
    React.useEffect(() => {
        if (artwork || !itemRef.current) return

        let timeoutId: ReturnType<typeof setTimeout> | null = null
        let cancelled = false

        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                timeoutId = setTimeout(() => {
                    loadTrackArtwork(track)
                        .then((result) => {
                            if (cancelled) return
                            if (result.artwork) {
                                setArtwork(result.artwork)
                            }
                            if (result.duration && !resolvedDuration) {
                                setResolvedDuration(result.duration)
                            }
                        })
                        .catch(() => {})
                }, 80)
                observer.disconnect()
            }
        }, { rootMargin: '160px 0px' })

        observer.observe(itemRef.current)

        return () => {
            cancelled = true
            observer.disconnect()
            if (timeoutId) {
                clearTimeout(timeoutId)
            }
        }
    }, [artwork, resolvedDuration, track.path])

    return (
        <div
            id={id}
            ref={itemRef}
            className={`${styles.trackItem} ${isActive ? styles.active : ''} ${isHighlighted ? styles.highlighted : ''}`}
            onClick={onClick}
            style={style}
        >
            <span className={styles.trackIndex}>{trackIndex}</span>
            <div className={styles.icon}>
                {artwork ? (
                    <img
                        src={artwork}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        className={styles.artwork}
                        onError={() => {
                            setArtwork(undefined)
                        }}
                    />
                ) : (
                    isActive ? <AudioWaveform size={20} /> : track.mediaType === 'video' ? <Film size={20} /> : <Music size={20} />
                )}
            </div>
            <div className={styles.info}>
                <div className={styles.titleLine}>
                    <span className={styles.title}>{track.title}</span>
                    {track.mediaType === 'video' && <span className={styles.mediaBadge}>影片</span>}
                </div>
                <div className={styles.artist}>{track.artist || '未知演出者'}</div>
            </div>

            <button
                className={styles.favBtn}
                onClick={(e) => {
                    e.stopPropagation()
                    onToggleFavorite && onToggleFavorite()
                }}
            >
                <Heart size={16} fill={isFavorite ? "var(--accent-primary)" : "none"} color={isFavorite ? "var(--accent-primary)" : "var(--text-muted)"} />
            </button>

            <div className={styles.duration}>
                {resolvedDuration ? formatTime(resolvedDuration) : ''}
            </div>
        </div>
    )
}

function formatTime(s: number) {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
}
