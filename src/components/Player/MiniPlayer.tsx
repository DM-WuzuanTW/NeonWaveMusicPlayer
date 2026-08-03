import { useEffect, useMemo, useState } from 'react'
import { GripHorizontal, Maximize2, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import styles from './MiniPlayer.module.css'

interface TrackInfo {
    title: string
    artist: string
    artwork?: string
    currentTime: number
    duration: number
    isPlaying: boolean
    isGameModeActive?: boolean
}

const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
    const minutes = Math.floor(seconds / 60)
    return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}

export function MiniPlayer() {
    const [track, setTrack] = useState<TrackInfo | null>(null)

    useEffect(() => window.ipcRenderer.on('player:sync', (_event, data: TrackInfo) => {
        setTrack(previous => ({
            ...data,
            artwork: data.artwork !== undefined ? data.artwork : previous?.artwork
        }))
    }), [])

    const progress = useMemo(() => {
        if (!track?.duration) return 0
        return Math.min(100, Math.max(0, (track.currentTime / track.duration) * 100))
    }, [track?.currentTime, track?.duration])

    const invoke = (channel: string) => window.ipcRenderer.invoke(channel).catch(console.error)
    const close = () => {
        localStorage.setItem('neonwave_mini_player', 'false')
        void window.ipcRenderer.invoke('window:setMiniPlayer', false)
    }

    return (
        <div className={`${styles.shell}${track?.isGameModeActive ? ` ${styles.passThrough}` : ''}`}>
            <div className={styles.dragHandle} title="拖曳迷你播放器">
                <GripHorizontal size={15} />
            </div>

            <div className={styles.artwork} aria-hidden="true">
                <img
                    src={track?.artwork || '/logo.png'}
                    alt=""
                    draggable={false}
                    decoding="async"
                />
                <span className={track?.isPlaying ? styles.playing : ''} />
            </div>

            <div className={styles.content}>
                <div className={styles.heading}>
                    <div className={styles.trackText}>
                        <strong title={track?.title}>{track?.title || 'NeonWave'}</strong>
                        <span title={track?.artist}>{track?.artist || '尚未播放歌曲'}</span>
                    </div>
                    <div className={styles.windowActions}>
                        <button type="button" title="回到主視窗" onClick={() => invoke('window:restoreMain')}><Maximize2 size={13} /></button>
                        <button type="button" title="關閉迷你播放器" onClick={close}><X size={14} /></button>
                    </div>
                </div>

                <div className={styles.timeline}>
                    <div><span style={{ width: `${progress}%` }} /></div>
                    <small>{formatTime(track?.currentTime || 0)}</small>
                    <small>{formatTime(track?.duration || 0)}</small>
                </div>

                <div className={styles.controls}>
                    <button type="button" aria-label="上一首" onClick={() => invoke('window:previousTrack')}><SkipBack size={15} fill="currentColor" /></button>
                    <button className={styles.playButton} type="button" aria-label={track?.isPlaying ? '暫停' : '播放'} onClick={() => invoke('window:togglePlay')}>
                        {track?.isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                    </button>
                    <button type="button" aria-label="下一首" onClick={() => invoke('window:nextTrack')}><SkipForward size={15} fill="currentColor" /></button>
                    {track?.isGameModeActive && <span className={styles.modeBadge}>點擊穿透</span>}
                </div>
            </div>
        </div>
    )
}
