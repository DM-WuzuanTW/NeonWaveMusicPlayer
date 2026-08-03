
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Sidebar } from './components/Layout/Sidebar'
import { TrackList } from './components/Playlist/TrackList'
import { PlayerBar } from './components/Player/PlayerBar'
import { SettingsView } from './components/Layout/SettingsView'
import { SearchView } from './components/Search/SearchView'
import { useAudioPlayer } from './hooks/useAudioPlayer'
import { useLibrary } from './hooks/useLibrary'
import { useAppDetection } from './hooks/useAppDetection'
import './index.css'

import { LyricsOverlay } from './components/Lyrics/LyricsOverlay'
import { DiscordControlPanel } from './components/DiscordBot/DiscordControlPanel'
import { ImportChoiceModal } from './components/UI/ImportChoiceModal'
import { DownloadProgressModal } from './components/UI/DownloadProgressModal'
import { MiniPlayer } from './components/Player/MiniPlayer'
import { VideoSurface } from './components/Player/VideoSurface'

function App() {
  const isMini = new URLSearchParams(window.location.search).get('mini') === 'true'
  return isMini ? <MiniModeApp /> : <MainApp />
}

function MiniModeApp() {
  useEffect(() => {
    document.body.classList.add('mini-mode')
    document.documentElement.classList.add('mini-mode')
    return () => {
      document.body.classList.remove('mini-mode')
      document.documentElement.classList.remove('mini-mode')
    }
  }, [])

  return <MiniPlayer />
}

function MainApp() {
  // === All hooks MUST be called before any conditional return (React rules of hooks) ===

  const {
    playlists, favorites, allTracks,
    addFolder, removeFolder, renameFolder, toggleFavorite, refreshLibrary,
    exportPlaylist, readImportFile, processStreamImport, processDownloadImport,
    downloadProgress, pauseDownload, resumeDownload, cancelDownload
  } = useLibrary()

  const { contextMode } = useAppDetection()

  const {
    isPlaying, currentTrack, currentTime, duration, volume, is8D,
    isShuffle, repeatMode,
    playTrack, togglePlay, setVolume, setIs8D, seek,
    toggleShuffle, toggleRepeat, handleNext, handlePrev,
    setDistance, setSpaceMode, setPosition, setFocusMode, setNormalization,
    getAudioStream, getMediaElement, setLocalMute
  } = useAudioPlayer(contextMode)

  const [view, setView] = useState('all_songs')
  const [showLyrics, setShowLyrics] = useState(false)
  const [importModalData, setImportModalData] = useState<any | null>(null)
  const [discordSyncSignal, setDiscordSyncSignal] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const discordStreamActiveRef = useRef(false)
  const discordStreamStartedAtRef = useRef(0)
  const discordSyncInFlightRef = useRef(false)
  const discordRestartHistoryRef = useRef<number[]>([])
  const discordRestartBlockedUntilRef = useRef(0)

  // Listen for playback toggle commands from the mini player (PIP)
  useEffect(() => {
    const cleanup = (window as any).ipcRenderer.on('player:togglePlay', () => {
      togglePlay()
    })
    return () => { if (cleanup) cleanup() }
  }, [togglePlay])

  useEffect(() => {
    if (!(window as any).ipcRenderer?.on) return

    const cleanup = (window as any).ipcRenderer.on('party:command', (_event: any, command: any) => {
      if (!command || !command.action) return

      if (command.action === 'toggle-play') {
        togglePlay()
      } else if (command.action === 'next') {
        handleNext()
      } else if (command.action === 'prev') {
        handlePrev()
      } else if (command.action === 'seek') {
        const nextTime = Number(command.value)
        if (!Number.isNaN(nextTime)) seek(nextTime)
      } else if (command.action === 'volume') {
        const nextVolume = Number(command.value)
        if (!Number.isNaN(nextVolume)) setVolume(nextVolume)
      }
    })

    return () => { if (cleanup) cleanup() }
  }, [togglePlay, handleNext, handlePrev, seek, setVolume])

  useEffect(() => {
    if (contextMode === 'work') {
      setFocusMode(true)
    } else if (contextMode === 'normal') {
      setFocusMode(false)
    }
    
  }, [contextMode])

  useEffect(() => {
    const triggerDiscordSync = () => setDiscordSyncSignal(signal => signal + 1)
    window.addEventListener('neonwave:discord-bot-state-changed', triggerDiscordSync)
    return () => window.removeEventListener('neonwave:discord-bot-state-changed', triggerDiscordSync)
  }, [])

  // Keep the renderer capture, FFmpeg decoder and Discord player healthy as one
  // pipeline. A MediaRecorder can remain "recording" after FFmpeg/player exit,
  // so recorder state alone is not a sufficient liveness check.
  useEffect(() => {
    let active = true
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let healthTimer: ReturnType<typeof setInterval> | null = null

    const destroyRecorder = () => {
      const recorder = mediaRecorderRef.current
      if (!recorder) return
      // Do not let the final chunk from an old WebM session enter the newly
      // created FFmpeg process; it does not contain a fresh initialization header.
      recorder.ondataavailable = null
      recorder.onerror = null
      if (recorder.state !== 'inactive') recorder.stop()
      mediaRecorderRef.current = null
    }

    const stopDiscordPipeline = async () => {
      destroyRecorder()
      discordStreamActiveRef.current = false
      discordStreamStartedAtRef.current = 0
      await window.ipcRenderer.invoke('discord:stop').catch(console.error)
    }

    const startDiscordPipeline = async () => {
      await window.ipcRenderer.invoke('discord:startStreamMode')

      const stream = getAudioStream()
      if (!stream) throw new Error('Discord stream unavailable from AudioEngine')

      const preferredMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : ''
      const recorder = new MediaRecorder(stream, {
        ...(preferredMime ? { mimeType: preferredMime } : {}),
        audioBitsPerSecond: 96_000
      })

      let chunkWrite = Promise.resolve()
      recorder.ondataavailable = event => {
        if (event.data.size === 0) return
        chunkWrite = chunkWrite.then(async () => {
          const buffer = await event.data.arrayBuffer()
          if (mediaRecorderRef.current === recorder) {
            window.ipcRenderer.send('discord:audio-chunk', buffer)
          }
        }).catch(error => {
          console.error('[App] Failed to send Discord audio chunk:', error)
        })
      }
      recorder.onerror = event => {
        console.error('[App] Discord MediaRecorder error:', event)
      }
      recorder.start(250)
      mediaRecorderRef.current = recorder
      discordStreamActiveRef.current = true
      discordStreamStartedAtRef.current = Date.now()
    }

    const handleSync = async () => {
      if (discordSyncInFlightRef.current) return
      discordSyncInFlightRef.current = true
      try {
        const status = await window.ipcRenderer.invoke('discord:status')

        if (!active) return

        if (status.isConnected && status.currentChannelId) {
          if (isPlaying) {
            const now = Date.now()
            const streamAge = now - discordStreamStartedAtRef.current
            const inputStalled = status.streamLastInputAt > 0 && now - status.streamLastInputAt > 6_000
            const decodeStalled = status.streamLastDecodedAt > 0 && now - status.streamLastDecodedAt > 6_000
            const backendFailed = discordStreamActiveRef.current && streamAge > 8_000 && (
              !!status.streamError ||
              status.playbackStatus === 'idle' ||
              status.playbackStatus === 'autopaused' ||
              inputStalled ||
              decodeStalled
            )

            if (backendFailed) {
              console.warn('[App] Discord pipeline stalled; rebuilding it', {
                playbackStatus: status.playbackStatus,
                streamError: status.streamError,
                inputStalled,
                decodeStalled
              })
              setLocalMute(false)
              await stopDiscordPipeline()

              const recentRestarts = discordRestartHistoryRef.current.filter(time => now - time < 60_000)
              discordRestartHistoryRef.current = recentRestarts
              if (recentRestarts.length >= 3) {
                console.error('[App] Discord pipeline restart limit reached; keeping local audio enabled')
                discordRestartBlockedUntilRef.current = now + 60_000
                return
              }
              discordRestartHistoryRef.current.push(now)
            }

            let startedNow = false
            if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
              if (now < discordRestartBlockedUntilRef.current) {
                setLocalMute(false)
                return
              }
              await startDiscordPipeline()
              startedNow = true
            } else if (mediaRecorderRef.current.state === 'paused') {
              mediaRecorderRef.current.resume()
            }

            await window.ipcRenderer.invoke('discord:resume')
            // Keep local playback audible during startup/recovery. Mute it only
            // after Discord confirms that packets are actually playing.
            setLocalMute(!startedNow && status.playbackStatus === 'playing' && !backendFailed)
            if (status.playbackStatus === 'playing' && !backendFailed) {
              discordRestartHistoryRef.current = []
              discordRestartBlockedUntilRef.current = 0
            }
            window.ipcRenderer.invoke('discord:setVolume', 100).catch(console.error)
          } else if (mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.pause()
            await window.ipcRenderer.invoke('discord:pause')
          }
        } else {
          await stopDiscordPipeline()
          setLocalMute(false)
        }
      } catch (error) {
        console.error('[App] Discord stream sync failed:', error)
        await stopDiscordPipeline()
        setLocalMute(false)
      } finally {
        discordSyncInFlightRef.current = false
      }
    }

    // Debounce: wait 300ms after the last change before executing
    debounceTimer = setTimeout(() => {
      if (active) handleSync()
    }, 300)
    healthTimer = setInterval(() => {
      if (active) handleSync()
    }, 2_000)

    return () => {
      active = false
      if (debounceTimer) clearTimeout(debounceTimer)
      if (healthTimer) clearInterval(healthTimer)
    }
  }, [isPlaying, currentTrack, discordSyncSignal, getAudioStream, setLocalMute])

  const handleImportClick = async () => {
    const data = await readImportFile()
    if (data) {
      setImportModalData(data)
    }
  }

  const handleSelectStream = () => {
    if (importModalData) processStreamImport(importModalData)
    setImportModalData(null)
  }

  const handleSelectDownload = () => {
    if (importModalData) processDownloadImport(importModalData)
    setImportModalData(null)
  }

  
  const { displayedTracks, viewTitle } = useMemo(() => {
    if (view === 'all_songs') {
      return { displayedTracks: allTracks, viewTitle: '所有歌曲' }
    }

    if (view === 'favorites') {
      return { displayedTracks: favorites, viewTitle: '我的最愛' }
    }

    const pl = playlists.find(p => p.id === view)
    if (pl) {
      return { displayedTracks: pl.tracks, viewTitle: pl.name }
    }

    return { displayedTracks: allTracks, viewTitle: '所有歌曲' }
  }, [view, allTracks, favorites, playlists])

  const handleToggleLyrics = useCallback(() => {
    setShowLyrics(v => !v)
  }, [])

  return (
    <div className="app-shell">
      <Sidebar
        playlists={playlists}
        onOpenFolder={addFolder}
        onRemoveFolder={removeFolder}
        onRenameFolder={renameFolder}
        onRefreshLibrary={refreshLibrary}
        onExportPlaylist={exportPlaylist}
        onImportPlaylist={handleImportClick}
        currentView={view}
        onChangeView={setView}
      />

      <main className="app-main">
        {/* Draggable Title Bar Area */}
        <div style={{
          height: '32px',
          width: '100%',
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: 90,
          WebkitAppRegion: 'drag'
        } as any} />

        <div className="theme-chrome" aria-hidden="true">
          <div className="theme-window-actions"><span /><span /><span /></div>
          <div className="theme-context" />
          <div className="theme-status" />
        </div>

        <div className="app-scroll">
          {currentTrack?.mediaType === 'video' && (
            <VideoSurface
              track={currentTrack}
              getMediaElement={getMediaElement}
            />
          )}

          {(view === 'all_songs' || view === 'favorites' || playlists.some(p => p.id === view)) && (
            <TrackList
              title={viewTitle}
              tracks={displayedTracks}
              currentTrack={currentTrack}
              onPlay={(track) => playTrack(track, displayedTracks)}
              onToggleFavorite={toggleFavorite}
              favorites={favorites}
            />
          )}

          {view === 'search' && (
            <SearchView />
          )}

          {view === 'settings' && (
            <SettingsView currentTrack={currentTrack ? { path: currentTrack.path, title: currentTrack.title } : null} />
          )}

          {view === 'discord' && (
            <DiscordControlPanel />
          )}

        </div>

        <LyricsOverlay
          visible={showLyrics}
          onClose={() => setShowLyrics(false)}
          trackTitle={currentTrack?.title || ''}
          trackArtist={currentTrack?.artist || ''}
          trackPath={currentTrack?.path}
          trackArtwork={currentTrack?.artwork || undefined}
          trackDuration={duration}
          currentTime={currentTime}
        />

        <PlayerBar
          isPlaying={isPlaying}
          currentTrack={currentTrack}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          is8D={is8D}
          isShuffle={isShuffle}
          repeatMode={repeatMode}
          onTogglePlay={togglePlay}
          onSeek={seek}
          onVolumeChange={setVolume}
          onToggle8D={() => setIs8D(!is8D)}
          onToggleShuffle={toggleShuffle}
          onToggleRepeat={toggleRepeat}
          onNext={handleNext}
          onPrev={handlePrev}
          onSetDistance={setDistance}
          onSetSpace={setSpaceMode}
          onSetPosition={setPosition}
          onSetFocusMode={setFocusMode}
          onSetNormalization={setNormalization}
          onToggleLyrics={handleToggleLyrics}
        />

        <ImportChoiceModal
          isOpen={!!importModalData}
          playlistName={importModalData?.name || ''}
          onSelectStream={handleSelectStream}
          onSelectDownload={handleSelectDownload}
          onCancel={() => setImportModalData(null)}
        />

        <DownloadProgressModal 
          progress={downloadProgress} 
          onPause={pauseDownload}
          onResume={resumeDownload}
          onCancel={cancelDownload}
        />
      </main>
    </div>
  )
}

export default App
