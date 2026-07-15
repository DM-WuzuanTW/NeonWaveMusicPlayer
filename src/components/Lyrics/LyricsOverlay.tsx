import React, { useEffect, useState, useCallback, useRef } from 'react'
import { parseLrc, LyricLine, getCurrentLineIndex } from '../../utils/lrcParser'

interface LyricsOverlayProps {
    visible: boolean
    onClose: () => void
    trackTitle: string
    trackArtist: string
    trackPath?: string
    trackArtwork?: string
    trackDuration?: number
    currentTime: number
}

// Pure CSS danmaku styles injected once
const DANMAKU_STYLES = `
@keyframes danmaku-scroll {
    from { transform: translateX(100vw); }
    to   { transform: translateX(-100%); }
}

@keyframes lyrics-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
}

@keyframes lyrics-fade-out {
    from { opacity: 1; }
    to   { opacity: 0; }
}

@keyframes status-slide-in {
    from { transform: translateX(-50%) translateY(-50px); opacity: 0; }
    to   { transform: translateX(-50%) translateY(0); opacity: 1; }
}

@keyframes status-slide-out {
    from { transform: translateX(-50%) translateY(0); opacity: 1; }
    to   { transform: translateX(-50%) translateY(-50px); opacity: 0; }
}

@keyframes spin-loader {
    to { transform: rotate(360deg); }
}

.danmaku-item {
    position: absolute;
    white-space: nowrap;
    will-change: transform;
    animation: danmaku-scroll var(--danmaku-duration) linear forwards;
    pointer-events: none;
    contain: layout style paint;
}

.danmaku-item.style-neon {
    font-weight: 900;
    -webkit-text-stroke: 1px rgba(0,0,0,0.5);
}

.danmaku-item.style-minimal {
    font-weight: 700;
    color: #ffffff !important;
    text-shadow:
        1.5px 1.5px 0 #000, -1.5px -1.5px 0 #000,
        1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000,
        2px 2px 4px rgba(0,0,0,0.8);
}

.danmaku-item.style-cyberpunk {
    font-weight: 900;
    letter-spacing: 0.15em;
    text-shadow:
        3px 3px 0px #ff0055,
        -1px -1px 0px #000,
        1px -1px 0px #000,
        -1px 1px 0px #000,
        1px 1px 0px #000;
    -webkit-text-stroke: 1px #000;
}

.danmaku-item.style-glass {
    font-weight: 600;
    color: #ffffff !important;
    background: rgba(255, 255, 255, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 24px;
    padding: 8px 20px;
    box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
}

.lyrics-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    pointer-events: none;
    overflow: hidden;
    background: transparent;
    font-family: "Outfit", sans-serif;
    animation: lyrics-fade-in 0.3s ease forwards;
}

.lyrics-overlay.closing {
    animation: lyrics-fade-out 0.3s ease forwards;
}

.lyrics-status {
    position: absolute;
    top: 5%;
    left: 50%;
    transform: translateX(-50%);
    color: #fff;
    background: rgba(0,0,0,0.6);
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 600;
    backdrop-filter: blur(4px);
    border: 1px solid rgba(255,255,255,0.1);
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 100;
    animation: status-slide-in 0.3s ease forwards;
}

.lyrics-status.hiding {
    animation: status-slide-out 0.3s ease forwards;
}

.lyrics-status .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin-loader 0.6s linear infinite;
}

.lyrics-error {
    position: absolute;
    bottom: 10%;
    width: 100%;
    text-align: center;
    opacity: 0.7;
    color: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
}
`

// Inject styles once
let stylesInjected = false
function injectStyles() {
    if (stylesInjected) return
    const style = document.createElement('style')
    style.textContent = DANMAKU_STYLES
    document.head.appendChild(style)
    stylesInjected = true
}

const NEON_COLORS = ['#ffffff', '#00fff2', '#ff00ff', '#f8fafc']
const CYBERPUNK_MAP: Record<string, string> = {
    '#ffffff': '#ffe600', '#f8fafc': '#ffe600', '#00fff2': '#ffe600'
}
const MAX_CONCURRENT = 6
const lyricsCache = new Map<string, LyricLine[]>()

function buildLyricsCacheKey(trackTitle: string, trackArtist: string, trackPath?: string, trackDuration?: number) {
    return [trackPath || '', trackTitle || '', trackArtist || '', trackDuration ?? ''].join('|')
}

const LyricsOverlayView: React.FC<LyricsOverlayProps> = ({
    visible, onClose, trackTitle, trackArtist, trackPath, trackDuration, currentTime
}) => {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(false)
    const [lyrics, setLyrics] = useState<LyricLine[]>([])
    const [activeIndex, setActiveIndex] = useState(-1)
    const [statusMsg, setStatusMsg] = useState<string | null>(null)
    const [statusVisible, setStatusVisible] = useState(false)
    const [subStyle, setSubStyle] = useState<string>(() => localStorage.getItem('neonwave_subtitle_style') || 'neon')
    const [fetchTrigger, setFetchTrigger] = useState(0)

    const containerRef = useRef<HTMLDivElement>(null)
    const activeCountRef = useRef(0)
    const statusTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const statusClearTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const fetchSeqRef = useRef(0)

    useEffect(() => {
        injectStyles()
    }, [])

    useEffect(() => {
        const handleSettingsChange = () => {
            setSubStyle(localStorage.getItem('neonwave_subtitle_style') || 'neon')
        }
        window.addEventListener('neonwave:settings-changed', handleSettingsChange)
        return () => window.removeEventListener('neonwave:settings-changed', handleSettingsChange)
    }, [])

    const showStatus = useCallback((msg: string) => {
        if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
        if (statusClearTimerRef.current) clearTimeout(statusClearTimerRef.current)
        setStatusMsg(msg)
        setStatusVisible(true)
        statusTimerRef.current = setTimeout(() => {
            setStatusVisible(false)
            statusClearTimerRef.current = setTimeout(() => setStatusMsg(null), 300) // Wait for fade-out animation
        }, 3000)
    }, [])

    useEffect(() => {
        return () => {
            fetchSeqRef.current += 1
            if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
            if (statusClearTimerRef.current) clearTimeout(statusClearTimerRef.current)
        }
    }, [])

    useEffect(() => {
        if (visible) {
            showStatus("歌詞模式：開啟")
        }
    }, [visible, showStatus])

    useEffect(() => {
        if (lyrics.length === 0) {
            setActiveIndex(-1)
            return
        }
        const idx = getCurrentLineIndex(lyrics, currentTime)
        if (idx !== activeIndex) {
            setActiveIndex(idx)
        }
    }, [currentTime, lyrics, activeIndex])

    // Lyrics fetching
    const fetchLyrics = useCallback(async (title: string, artist: string, path: string = '', duration: number = 0) => {
        const requestId = ++fetchSeqRef.current
        const isStale = () => requestId !== fetchSeqRef.current
        const cacheKey = buildLyricsCacheKey(title, artist, path, duration)

        const applyLyrics = (lines: LyricLine[]) => {
            const cloned = lines.map(line => ({ ...line }))
            lyricsCache.set(cacheKey, cloned)
            setLyrics(cloned)
            setError(false)
            setActiveIndex(-1)
        }

        const cached = lyricsCache.get(cacheKey)
        if (cached && cached.length > 0) {
            applyLyrics(cached)
            showStatus("已載入同步歌詞")
            return
        }

        setLoading(true)
        setError(false)
        setLyrics([])
        setActiveIndex(-1)
        showStatus(`搜尋中: ${title}...`)
        try {
            const aiConfig = {
                provider: localStorage.getItem('neonwave_lyrics_ai_provider') || 'default',
                apiKey: localStorage.getItem('neonwave_lyrics_ai_key') || '',
                endpoint: localStorage.getItem('neonwave_lyrics_ai_endpoint') || '',
                model: localStorage.getItem('neonwave_lyrics_ai_model') || '',
                mode: localStorage.getItem('neonwave_lyrics_ai_mode') || 'filename',
                reasoning: localStorage.getItem('neonwave_lyrics_ai_reasoning') || 'none',
                lang: localStorage.getItem('neonwave_lyrics_lang') || 'cn'
            }
            const rawLrc = await window.ipcRenderer.getLyrics(title, artist, path, duration, aiConfig)
            if (isStale()) return

            if (rawLrc) {
                let parsed = parseLrc(rawLrc)

                const isLocalCalEnabled = localStorage.getItem('neonwave_local_audio_calibration') !== 'false'
                if (isLocalCalEnabled && path && parsed.length > 0) {
                    try {
                        console.log(`[Lyrics Local Calibration] Reading first 2MB of track: ${path}`)
                        const fileBuf = await (window as any).ipcRenderer.readFileBufferPartial(path, 2 * 1024 * 1024)
                        if (isStale()) return
                        if (fileBuf) {
                            const calCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
                            try {
                                const audioBuf = await calCtx.decodeAudioData(fileBuf.slice(0))
                                if (isStale()) return
                                const channelData = audioBuf.getChannelData(0)
                                const sampleRate = audioBuf.sampleRate

                                const threshold = Math.pow(10, -30 / 20)
                                let localStart = 0
                                let consecutiveAbove = 0
                                const requiredConsecutive = Math.floor(sampleRate * 0.02) // 20ms of continuous sound
                                
                                for (let i = 0; i < channelData.length; i++) {
                                    if (Math.abs(channelData[i]) > threshold) {
                                        consecutiveAbove++
                                        if (consecutiveAbove >= requiredConsecutive) {
                                            localStart = (i - consecutiveAbove) / sampleRate
                                            break
                                        }
                                    } else {
                                        consecutiveAbove = 0
                                    }
                                }

                                console.log(`[Lyrics Local Calibration] Detected local sound start at: ${localStart.toFixed(2)}s`)

                                const firstValidLine = parsed.find(line => line.time >= 0 && line.text.trim().length > 0)
                                const firstLyricTime = firstValidLine ? firstValidLine.time : 1.5

                                const calculatedOffset = localStart - firstLyricTime
                                console.log(`[Lyrics Local Calibration] First lyric is at ${firstLyricTime.toFixed(2)}s. Applying calculated offset: ${calculatedOffset.toFixed(2)}s`)
                                
                                if (Math.abs(calculatedOffset) > 0.1) {
                                    parsed = parsed.map(line => ({
                                        ...line,
                                        time: Math.max(0, line.time + calculatedOffset)
                                    }))
                                }
                            } finally {
                                calCtx.close()
                            }
                        }
                    } catch (calErr) {
                        console.error("[Lyrics Local Calibration] Failed:", calErr)
                    }
                }

                if (isStale()) return

                if (parsed.length > 0) {
                    applyLyrics(parsed)
                    showStatus("已載入同步歌詞")
                } else {
                    setError(true)
                    showStatus("未找到同步歌詞")
                }
            } else {
                setError(true)
                showStatus("未找到同步歌詞")
            }
        } catch (e) {
            if (isStale()) return
            console.error(e)
            setError(true)
            showStatus("載入歌詞時發生錯誤")
        } finally {
            if (!isStale()) {
                setLoading(false)
            }
        }
    }, [showStatus])

    useEffect(() => {
        if (!visible || !trackTitle) return
        fetchLyrics(trackTitle, trackArtist, trackPath, trackDuration)
        return () => {
            fetchSeqRef.current += 1
        }
    }, [trackTitle, trackArtist, trackPath, visible, trackDuration, fetchTrigger, fetchLyrics])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && visible) {
                onClose()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [visible, onClose])

    // Clear danmaku on track change
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.replaceChildren()
            activeCountRef.current = 0
        }
    }, [trackTitle, visible, lyrics])

    // Spawn danmaku items via direct DOM manipulation — zero React re-renders
    useEffect(() => {
        if (!visible || activeIndex === -1 || !lyrics[activeIndex] || !containerRef.current) return

        // Cap concurrent items
        if (activeCountRef.current >= MAX_CONCURRENT) {
            const oldest = containerRef.current.querySelector('.danmaku-item')
            if (oldest) {
                oldest.remove()
                activeCountRef.current--
            }
        }

        const currentLine = lyrics[activeIndex]
        const color = NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)]
        const top = Math.floor(Math.random() * 75) + 10
        const duration = Math.random() * 5 + 8
        const size = Math.random() * 1.5 + 2

        const el = document.createElement('div')
        el.className = `danmaku-item style-${subStyle}`
        el.textContent = currentLine.text
        el.style.top = `${top}%`
        el.style.setProperty('--danmaku-duration', `${duration}s`)

        // Style-specific inline properties
        switch (subStyle) {
            case 'neon':
                el.style.fontSize = `${size}rem`
                el.style.color = color
                el.style.textShadow = `2px 2px 0 #000, -1px -1px 0 #000, 0 0 10px ${color}`
                break
            case 'minimal':
                el.style.fontSize = `${size * 0.9}rem`
                break
            case 'cyberpunk': {
                const cyberpunkColor = CYBERPUNK_MAP[color] || '#00ffff'
                el.style.fontSize = `${size * 1.1}rem`
                el.style.color = cyberpunkColor
                break
            }
            case 'glass':
                el.style.fontSize = `${size * 0.85}rem`
                break
        }

        // Self-cleanup on animation end — no React involvement
        activeCountRef.current++
        el.addEventListener('animationend', () => {
            el.remove()
            activeCountRef.current--
        }, { once: true })

        containerRef.current.appendChild(el)

    }, [activeIndex, lyrics, visible, subStyle])

    if (!visible) return null

    return (
        <div className="lyrics-overlay" style={{ pointerEvents: 'none' }}>
            {/* Close button */}
            <div
                style={{
                    position: 'absolute', top: '5%', right: '2%',
                    pointerEvents: 'auto', cursor: 'pointer',
                    color: 'rgba(255,255,255,0.5)', fontSize: '12px',
                    background: 'rgba(0,0,0,0.4)', borderRadius: '20px',
                    padding: '6px 14px', border: '1px solid rgba(255,255,255,0.1)',
                    backdropFilter: 'blur(4px)',
                    transition: 'all 0.2s',
                    userSelect: 'none',
                    zIndex: 100
                }}
                onClick={onClose}
                onMouseOver={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(0,0,0,0.7)' }}
                onMouseOut={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; e.currentTarget.style.background = 'rgba(0,0,0,0.4)' }}
            >
                ✕ 關閉 (ESC)
            </div>

            {/* Status bar */}
            {(statusMsg || loading) && (
                <div className={`lyrics-status ${!statusVisible ? 'hiding' : ''}`}>
                    {loading && <div className="spinner" />}
                    {loading ? '搜尋中...' : statusMsg}
                </div>
            )}

            {/* Danmaku container — items added/removed via direct DOM */}
            <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />

            {/* Error fallback with retry */}
            {error && (
                <div className="lyrics-error" style={{ pointerEvents: 'auto' }}>
                    <div>未找到歌詞</div>
                    <button
                        onClick={() => setFetchTrigger(t => t + 1)}
                        style={{
                            marginTop: '12px',
                            padding: '8px 20px',
                            borderRadius: '20px',
                            background: 'rgba(255,255,255,0.1)',
                            border: '1px solid rgba(255,255,255,0.2)',
                            color: '#fff',
                            cursor: 'pointer',
                            fontSize: '14px',
                            transition: 'all 0.2s'
                        }}
                        onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.2)' }}
                        onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
                    >
                        🔄 重新搜尋
                    </button>
                </div>
            )}

            {/* Manual refresh when lyrics loaded — show refresh hint */}
            {!loading && !error && lyrics.length > 0 && (
                <div
                    style={{
                        position: 'absolute', bottom: '3%', right: '2%',
                        pointerEvents: 'auto', cursor: 'pointer',
                        color: 'rgba(255,255,255,0.2)', fontSize: '11px',
                        transition: 'all 0.2s',
                        userSelect: 'none'
                    }}
                    onClick={() => setFetchTrigger(t => t + 1)}
                    onMouseOver={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)' }}
                    onMouseOut={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.2)' }}
                >
                    🔄 重新搜尋歌詞
                </div>
            )}
        </div>
    )
}

export const LyricsOverlay = React.memo(LyricsOverlayView, (prev, next) => {
    if (prev.visible !== next.visible) return false
    if (!prev.visible && !next.visible) {
        return prev.trackTitle === next.trackTitle
            && prev.trackArtist === next.trackArtist
            && prev.trackPath === next.trackPath
            && prev.trackDuration === next.trackDuration
    }

    return prev.trackTitle === next.trackTitle
        && prev.trackArtist === next.trackArtist
        && prev.trackPath === next.trackPath
        && prev.trackDuration === next.trackDuration
        && prev.currentTime === next.currentTime
        && prev.trackArtwork === next.trackArtwork
})
