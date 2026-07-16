
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

  // Discord stream sync with debounce to prevent rapid re-initialization on quick track changes
  useEffect(() => {
    let active = true
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const handleSync = async () => {
      try {
        const status = await window.ipcRenderer.invoke('discord:status')

        if (!active) return

        if (status.isConnected && status.currentChannelId) {
          if (isPlaying) {
            if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
              console.log('[App] Starting Discord Stream...')

              await window.ipcRenderer.invoke('discord:startStreamMode')
              discordStreamActiveRef.current = true

              const stream = getAudioStream()
              if (stream) {
                const preferredMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                  ? 'audio/webm;codecs=opus'
                  : MediaRecorder.isTypeSupported('audio/webm')
                    ? 'audio/webm'
                    : ''
                const recorder = new MediaRecorder(stream, {
                  ...(preferredMime ? { mimeType: preferredMime } : {}),
                  audioBitsPerSecond: 96000
                })

                let chunkWrite = Promise.resolve()
                recorder.ondataavailable = (e) => {
                  if (e.data.size > 0) {
                    chunkWrite = chunkWrite
                      .then(async () => {
                        const buffer = await e.data.arrayBuffer()
                        window.ipcRenderer.send('discord:audio-chunk', buffer)
                      })
                      .catch(error => {
                        console.error('[App] Failed to send Discord audio chunk:', error)
                      })
                  }
                }

                recorder.onerror = (event) => {
                  console.error('[App] Discord MediaRecorder error:', event)
                }

                recorder.start(250)
                mediaRecorderRef.current = recorder
              } else {
                console.warn('[App] Discord stream unavailable from AudioEngine')
                discordStreamActiveRef.current = false
                window.ipcRenderer.invoke('discord:stop').catch(console.error)
              }

              if (mediaRecorderRef.current) {
                setLocalMute(true)
                window.ipcRenderer.invoke('discord:setVolume', 100).catch(console.error)
              }
            } else {
              if (mediaRecorderRef.current.state === 'paused') mediaRecorderRef.current.resume()
              window.ipcRenderer.invoke('discord:resume').catch(console.error)
            }
          } else {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
              mediaRecorderRef.current.pause()
              window.ipcRenderer.invoke('discord:pause').catch(console.error)
            }
          }
        } else {
          if (mediaRecorderRef.current) {
            mediaRecorderRef.current.stop()
            mediaRecorderRef.current = null
          }
          if (discordStreamActiveRef.current) {
            discordStreamActiveRef.current = false
            window.ipcRenderer.invoke('discord:stop').catch(console.error)
          }
          setLocalMute(false)
        }
      } catch (error) {
        console.error('[App] Discord stream sync failed:', error)
        if (mediaRecorderRef.current) {
          try { mediaRecorderRef.current.stop() } catch (e) {
            console.warn('[App] Discord recorder was already stopped:', e)
          }
          mediaRecorderRef.current = null
        }
        discordStreamActiveRef.current = false
        window.ipcRenderer.invoke('discord:stop').catch(console.error)
        setLocalMute(false)
      }
    }

    // Debounce: wait 300ms after the last change before executing
    debounceTimer = setTimeout(() => {
      if (active) handleSync()
    }, 300)

    return () => {
      active = false
      if (debounceTimer) clearTimeout(debounceTimer)
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
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
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

      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        position: 'relative'
      }}>
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

        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '100px' }}>
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
            <SettingsView />
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
