import { useState, useEffect, useRef } from 'react'
import { Track } from './useAudioPlayer'

const STORAGE_KEY_FOLDERS_V2 = 'neonwave_folders_v2' 
const STORAGE_KEY_FAVORITES = 'neonwave_favorites'
const STORAGE_KEY_CUSTOM_PLAYLISTS = 'neonwave_custom_playlists'

interface FolderData {
    path: string
    name: string
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.wmv', '.avi'])

function getMediaType(filePath: string): Track['mediaType'] {
    const ext = filePath.match(/\.[^.\\/]+$/)?.[0]?.toLowerCase()
    return ext && VIDEO_EXTENSIONS.has(ext) ? 'video' : 'audio'
}

export interface Playlist {
    id: string
    name: string
    type: 'folder' | 'favorites' | 'custom'
    tracks: Track[]
    path?: string 
}

export function useLibrary() {
    const [playlists, setPlaylists] = useState<Playlist[]>([])
    const [favorites, setFavorites] = useState<Track[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [downloadProgress, setDownloadProgress] = useState<{ current: number; total: number; currentTracks: string[]; isPaused: boolean; eta?: string; speedStr?: string } | null>(null)
    const downloadControlRef = useRef({ isPaused: false, isCancelled: false, startTime: 0, pauseStartTime: 0, totalPausedMs: 0, activeTracks: [] as string[] })
    const downloadSpeedsRef = useRef<Record<string, string>>({})

    useEffect(() => {
        loadSavedData()
        
        if (window.ipcRenderer && window.ipcRenderer.onDownloadProgress) {
            window.ipcRenderer.onDownloadProgress((data) => {
                downloadSpeedsRef.current[data.url] = data.speed
                
                let totalBps = 0;
                for (const s of Object.values(downloadSpeedsRef.current)) {
                    if (!s) continue;
                    const match = s.match(/([0-9.]+)([a-zA-Z]+)\/s/);
                    if (match) {
                        let val = parseFloat(match[1]);
                        const unit = match[2].toUpperCase();
                        if (unit.includes('K')) val *= 1024;
                        else if (unit.includes('M')) val *= 1024 * 1024;
                        else if (unit.includes('G')) val *= 1024 * 1024 * 1024;
                        totalBps += val;
                    }
                }
                
                let combinedSpeedStr = "";
                if (totalBps > 1024 * 1024) combinedSpeedStr = (totalBps / (1024 * 1024)).toFixed(2) + " MB/s";
                else if (totalBps > 1024) combinedSpeedStr = (totalBps / 1024).toFixed(2) + " KB/s";
                else combinedSpeedStr = totalBps.toFixed(0) + " B/s";

                setDownloadProgress(prev => prev ? { ...prev, speedStr: combinedSpeedStr } : null)
            })
        }

        return () => {
            if (window.ipcRenderer && window.ipcRenderer.offDownloadProgress) {
                window.ipcRenderer.offDownloadProgress()
            }
        }
    }, [])

    const loadSavedData = async () => {
        setIsLoading(true)
        try {
            
            const favJson = localStorage.getItem(STORAGE_KEY_FAVORITES)
            if (favJson) setFavorites(JSON.parse(favJson))

            
            
            let folderData: FolderData[] = []
            const v2Json = localStorage.getItem(STORAGE_KEY_FOLDERS_V2)

            if (v2Json) {
                folderData = JSON.parse(v2Json)
            } else {
                
                const v1Json = localStorage.getItem('neonwave_folders')
                if (v1Json) {
                    const paths: string[] = JSON.parse(v1Json)
                    folderData = paths.map(p => ({
                        path: p,
                        name: p.split(/[\\/]/).pop() || '未命名資料夾'
                    }))
                    // Save to new format immediately
                    localStorage.setItem(STORAGE_KEY_FOLDERS_V2, JSON.stringify(folderData))
                }
            }

            const loadedPlaylists: Playlist[] = []

            for (const item of folderData) {
                const tracks = await scanFolder(item.path)
                loadedPlaylists.push({
                    id: item.path,
                    name: item.name,
                    type: 'folder',
                    path: item.path,
                    tracks: tracks
                })
            }

            // 3. Load Custom Playlists (Imported)
            const customJson = localStorage.getItem(STORAGE_KEY_CUSTOM_PLAYLISTS)
            if (customJson) {
                const customPlaylists = JSON.parse(customJson) as Playlist[]
                loadedPlaylists.push(...customPlaylists)
            }

            setPlaylists(loadedPlaylists)

        } catch (e) {
            console.error("Error loading library data", e)
        } finally {
            setIsLoading(false)
        }
    }

    const scanFolder = async (folderPath: string): Promise<Track[]> => {
        try {
            const files: string[] = await window.ipcRenderer.listMusicFiles(folderPath)

            const chunk = <T>(arr: T[], size: number) =>
                Array.from({ length: Math.ceil(arr.length / size) }, (_: any, i: number) =>
                    arr.slice(i * size, i * size + size));

            // Batch metadata read — the main process caches by path+mtime, so
            // relaunches only re-parse new/changed files instead of every track.
            const chunks = chunk(files, 200)
            const allTracks: Track[] = []

            for (const batch of chunks) {
                const metas: any[] = await window.ipcRenderer.getAudioMetadataBatch(batch)
                const metaByPath = new Map(metas.map(m => [m.path, m]))

                for (const filePath of batch) {
                    const filename = filePath.replace(/^.*[\\/]/, '')
                    const meta = metaByPath.get(filePath)
                    allTracks.push({
                        path: filePath,
                        mediaType: getMediaType(filePath),
                        title: meta?.title || filename,
                        artist: meta?.artist || '未知演出者',
                        album: meta?.album || '未知專輯',
                        artwork: undefined, // Loaded lazily on play
                        duration: meta?.duration || 0,
                        codec: meta?.codec,
                        bitrate: meta?.bitrate,
                        sampleRate: meta?.sampleRate
                    })
                }
            }

            return allTracks
        } catch (e) {
            console.error("Failed to scan folder", folderPath, e)
            return []
        }
    }

    const addFolder = async () => {
        setIsLoading(true)
        try {
            const folderPath = await window.ipcRenderer.openDirectory()
            if (!folderPath) {
                setIsLoading(false)
                return
            }

            const currentData: FolderData[] = JSON.parse(localStorage.getItem(STORAGE_KEY_FOLDERS_V2) || '[]')

            // Check dupes
            if (currentData.some(f => f.path === folderPath)) {
                alert('這個資料夾已經在音樂庫中了！')
                setIsLoading(false)
                return
            }

            // Default name = folder name
            const defaultName = folderPath.split(/[\\/]/).pop() || '新資料夾'

            const newItem: FolderData = { path: folderPath, name: defaultName }
            const newData = [...currentData, newItem]

            localStorage.setItem(STORAGE_KEY_FOLDERS_V2, JSON.stringify(newData))

            
            const tracks = await scanFolder(folderPath)
            const newPlaylist: Playlist = {
                id: folderPath,
                name: defaultName,
                type: 'folder',
                path: folderPath,
                tracks: tracks
            }

            setPlaylists(prev => [...prev, newPlaylist])

        } catch (error) {
            console.error("Failed to add folder:", error)
        } finally {
            setIsLoading(false)
        }
    }

    const removeFolder = (idToRemove: string) => {
        
        const isCustom = playlists.find(p => p.id === idToRemove)?.type === 'custom'
        
        if (isCustom) {
            const currentData: Playlist[] = JSON.parse(localStorage.getItem(STORAGE_KEY_CUSTOM_PLAYLISTS) || '[]')
            const newData = currentData.filter(p => p.id !== idToRemove)
            localStorage.setItem(STORAGE_KEY_CUSTOM_PLAYLISTS, JSON.stringify(newData))
        } else {
            const currentData: FolderData[] = JSON.parse(localStorage.getItem(STORAGE_KEY_FOLDERS_V2) || '[]')
            const newData = currentData.filter(p => p.path !== idToRemove)
            localStorage.setItem(STORAGE_KEY_FOLDERS_V2, JSON.stringify(newData))
        }
        
        setPlaylists(prev => prev.filter(p => p.id !== idToRemove))
    }

    const renameFolder = (idToRename: string, newName: string) => {
        
        const isCustom = playlists.find(p => p.id === idToRename)?.type === 'custom'
        
        if (isCustom) {
            const currentData: Playlist[] = JSON.parse(localStorage.getItem(STORAGE_KEY_CUSTOM_PLAYLISTS) || '[]')
            const newData = currentData.map(item => {
                if (item.id === idToRename) {
                    return { ...item, name: newName }
                }
                return item
            })
            localStorage.setItem(STORAGE_KEY_CUSTOM_PLAYLISTS, JSON.stringify(newData))
        } else {
            const currentData: FolderData[] = JSON.parse(localStorage.getItem(STORAGE_KEY_FOLDERS_V2) || '[]')
            const newData = currentData.map(item => {
                if (item.path === idToRename) {
                    return { ...item, name: newName }
                }
                return item
            })
            localStorage.setItem(STORAGE_KEY_FOLDERS_V2, JSON.stringify(newData))
        }

        
        setPlaylists(prev => prev.map(pl => {
            if (pl.id === idToRename || pl.path === idToRename) {
                return { ...pl, name: newName }
            }
            return pl
        }))
    }

    const toggleFavorite = (track: Track) => {
        setFavorites(prev => {
            const exists = prev.some(t => t.path === track.path)
            let newFavs
            if (exists) {
                newFavs = prev.filter(t => t.path !== track.path)
            } else {
                newFavs = [...prev, track]
            }
            localStorage.setItem(STORAGE_KEY_FAVORITES, JSON.stringify(newFavs))
            return newFavs
        })
    }

    const exportPlaylist = (playlist: Playlist) => {
        const exportData = {
            version: 1,
            name: playlist.name,
            tracks: playlist.tracks.map(t => ({ title: t.title, artist: t.artist }))
        }
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${playlist.name}.nwp`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }

    const readImportFile = (): Promise<any> => {
        return new Promise<any>((resolve, reject) => {
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = '.nwp,.json'
            input.onchange = (e: any) => {
                const file = e.target.files[0]
                if (!file) { resolve(null); return }
                
                const reader = new FileReader()
                reader.onload = (re) => {
                    try {
                        const data = JSON.parse(re.target!.result as string)
                        if (!data.tracks) throw new Error("Invalid playlist format")
                        resolve(data)
                    } catch (err) {
                        alert("匯入失敗：檔案格式不正確")
                        reject(err)
                    }
                }
                reader.readAsText(file)
            }
            input.click()
        })
    }

    const processStreamImport = (data: any) => {
        const newPlaylist: Playlist = {
            id: `custom-${Date.now()}`,
            name: data.name || '匯入歌單',
            type: 'custom',
            tracks: data.tracks.map((t: any) => ({
                title: t.title,
                artist: t.artist || '',
                path: `shared:${t.title} ${t.artist || ''}`.trim()
            }))
        }
        
        const currentData: Playlist[] = JSON.parse(localStorage.getItem(STORAGE_KEY_CUSTOM_PLAYLISTS) || '[]')
        localStorage.setItem(STORAGE_KEY_CUSTOM_PLAYLISTS, JSON.stringify([...currentData, newPlaylist]))
        setPlaylists(prev => [...prev, newPlaylist])
        alert(`成功匯入串流歌單: ${newPlaylist.name}`)
    }

    const processDownloadImport = async (data: any) => {
        const targetDir = await window.ipcRenderer.openDirectory()
        if (!targetDir) {
            alert("取消匯入：未選擇下載儲存資料夾。")
            return
        }
        
        setIsLoading(true)
        downloadControlRef.current = { isPaused: false, isCancelled: false, startTime: Date.now(), pauseStartTime: 0, totalPausedMs: 0, activeTracks: [] }

        let successCount = 0
        let completedCount = 0
        const total = data.tracks.length
        
        setDownloadProgress({ current: 0, total: 1, currentTracks: ['分析現有檔案，準備增量更新...'], isPaused: false, eta: '分析中...' })
        
        let existingFiles = new Set<string>()
        try {
            const files = await window.ipcRenderer.listMusicFiles(targetDir)
            existingFiles = new Set(files.map(f => f.replace(/^.*[\\/]/, '').toLowerCase()))
        } catch (e) {}
        
        const tracksToDownload = data.tracks
            .map((t: Track, index: number) => {
                // Fix for old imported tracks: remove extensions from title
                let cleanTitle = (t.title || '').replace(/\.(mp3|wav|wma|m4a|flac|ogg|mp4|mov|wmv|avi)$/i, '').trim()
                
                
                let cleanArtist = t.artist || ''
                if (['未知演出者', '未知專輯', 'Unknown', 'Unknown Artist'].includes(cleanArtist)) {
                    cleanArtist = ''
                }
                
                return { t: { ...t, title: cleanTitle, artist: cleanArtist }, index }
            })
            .filter(({ t }: { t: Track }) => {
                const safeTitle = (t.title || '').replace(/[\\/:*?"<>|]/g, '_').trim()
                const expectedM4a = `${safeTitle}.m4a`.toLowerCase()
                const expectedMp4 = `${safeTitle}.mp4`.toLowerCase()
                
                // Only skip if the EXACT safe filename already exists (check both formats)
                return !existingFiles.has(expectedM4a) && !existingFiles.has(expectedMp4)
            })
            
        const totalToDownload = tracksToDownload.length
        
        if (totalToDownload === 0) {
            alert(`目標資料夾已經包含此歌單的所有歌曲，無須更新！`)
            setIsLoading(false)
            setDownloadProgress(null)
            return
        }
        
        downloadSpeedsRef.current = {}
        // Reset start time so ETA won't count folder scan time
        downloadControlRef.current.startTime = Date.now()
        
        const concurrency = parseInt(localStorage.getItem('neonwave_download_concurrency') || '2')
        const speedLimit = localStorage.getItem('neonwave_download_speed') || '0'

        // Map timestamps from oldest to newest (2022 ~ Now)
        const nowMs = Date.now()
        const start2022Ms = new Date('2022-01-01T00:00:00Z').getTime()
        const stepMs = total > 1 ? (nowMs - start2022Ms) / (total - 1) : 0

        let currentIndex = 0
        
        // Initial state
        setDownloadProgress({ current: 0, total: totalToDownload, currentTracks: [`準備下載 ${totalToDownload} 首新歌...`], isPaused: false, eta: '計算中...' })
        
        const worker = async () => {
            while (true) {
                // Check if cancelled
                if (downloadControlRef.current.isCancelled) {
                    break
                }
                
                // Check if paused
                if (downloadControlRef.current.isPaused) {
                    setDownloadProgress(prev => prev ? { ...prev, isPaused: true } : null)
                    await new Promise(r => setTimeout(r, 1000))
                    continue
                } else {
                    setDownloadProgress(prev => prev ? { ...prev, isPaused: false } : null)
                }

                // Get next track
                let taskIndex = -1
                // We need to coordinate between workers safely.
                // In JS, synchronous blocks are atomic.
                taskIndex = currentIndex++
                
                if (taskIndex >= totalToDownload) {
                    break
                }

                const { t, index: originalIndex } = tracksToDownload[taskIndex]
                
                // 由新到舊分配時間 (使用原始歌單的 Index, 而非下載 Task Index)
                const trackMs = nowMs - originalIndex * stepMs
                
                // Update state: Add to active tracks
                const currentDownloadingTitle = t.title || '處理中...'
                downloadControlRef.current.activeTracks.push(currentDownloadingTitle)
                setDownloadProgress(prev => prev ? { ...prev, currentTracks: [...downloadControlRef.current.activeTracks] } : null)
                
                try {
                    const query = `${t.title} ${t.artist || ''}`.trim()
                    const results = await window.ipcRenderer.searchYouTube(query)
                    if (results && results.length > 0) {
                        const format = localStorage.getItem('neonwave_download_format') || 'm4a'
                        await window.ipcRenderer.downloadYouTubeToDir(results[0].url, t.title, t.artist || '', targetDir, speedLimit, trackMs, format)
                        if (!downloadControlRef.current.isCancelled) successCount++
                    }
                } catch(err) {
                    console.error("Failed to download track", t, err)
                }
                
                if (!downloadControlRef.current.isCancelled) {
                    completedCount++
                    
                    // Remove from active tracks
                    downloadControlRef.current.activeTracks = downloadControlRef.current.activeTracks.filter(name => name !== currentDownloadingTitle)

                    let etaStr = '計算中...'
                    if (completedCount > 0) {
                        const ref = downloadControlRef.current
                        let activeMs = Date.now() - ref.startTime - ref.totalPausedMs
                        if (ref.isPaused && ref.pauseStartTime > 0) {
                            activeMs -= (Date.now() - ref.pauseStartTime)
                        }
                        activeMs = Math.max(1000, activeMs)
                        
                        const avgMsPerTrack = activeMs / completedCount
                        const remainingTracks = totalToDownload - completedCount
                        const remainingMs = avgMsPerTrack * remainingTracks
                        
                        const remainingSec = Math.floor(remainingMs / 1000)
                        if (remainingSec < 60) {
                            etaStr = `約 ${remainingSec} 秒`
                        } else {
                            const remainingMin = Math.floor(remainingSec / 60)
                            const remainingSecRem = remainingSec % 60
                            etaStr = `約 ${remainingMin} 分 ${remainingSecRem} 秒`
                        }
                    }
                    
                    setDownloadProgress(prev => prev ? { ...prev, current: completedCount, currentTracks: [...downloadControlRef.current.activeTracks], eta: etaStr } : null)
                }
            }
        }
        
        // Start workers
        const workers = []
        for (let i = 0; i < concurrency; i++) {
            workers.push(worker())
        }
        
        await Promise.all(workers)

        const finalSuccessCount = successCount
        const isCancelled = downloadControlRef.current.isCancelled

        // Clear UI states instantly
        setDownloadProgress(null)
        setIsLoading(false)

        setTimeout(async () => {
            if (isCancelled) {
                alert(`已取消下載。排程已終止 (本次新增 ${finalSuccessCount} 首)。\n即使取消，已成功下載的新歌曲仍會為您加入音樂庫中！`)
            } else {
                alert(`更新結束！本次新增了 ${finalSuccessCount} 首歌曲 (歌單總計 ${total} 首)。\n正在將資料夾加入音樂庫...`)
            }
            
            const currentFolders: FolderData[] = JSON.parse(localStorage.getItem(STORAGE_KEY_FOLDERS_V2) || '[]')
            if (!currentFolders.some(f => f.path === targetDir)) {
                const defaultName = data.name || targetDir.split(/[\\/]/).pop() || '新歌單'
                const newItem: FolderData = { path: targetDir, name: defaultName }
                localStorage.setItem(STORAGE_KEY_FOLDERS_V2, JSON.stringify([...currentFolders, newItem]))
            }
            
            // Refresh library to pickup new files
            await loadSavedData()
        }, 300)
    }

    // Flatten all tracks for "All Songs" view
    const allTracks = playlists.flatMap(p => p.tracks)

    return {
        playlists,
        favorites,
        allTracks,
        addFolder,
        removeFolder,
        renameFolder,
        toggleFavorite,
        exportPlaylist,
        readImportFile,
        processStreamImport,
        processDownloadImport,
        isLoading,
        downloadProgress,
        pauseDownload: () => { 
            downloadControlRef.current.isPaused = true; 
            downloadControlRef.current.pauseStartTime = Date.now();
            setDownloadProgress(prev => prev ? { ...prev, isPaused: true } : null); 
        },
        resumeDownload: () => { 
            downloadControlRef.current.isPaused = false; 
            if (downloadControlRef.current.pauseStartTime > 0) {
                downloadControlRef.current.totalPausedMs += Date.now() - downloadControlRef.current.pauseStartTime;
                downloadControlRef.current.pauseStartTime = 0;
            }
            setDownloadProgress(prev => prev ? { ...prev, isPaused: false } : null); 
        },
        cancelDownload: () => { 
            downloadControlRef.current.isCancelled = true;
            setDownloadProgress(null); 
        },
        refreshLibrary: loadSavedData
    }
}
