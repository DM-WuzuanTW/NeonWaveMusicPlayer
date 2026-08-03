import { ipcRenderer, contextBridge } from 'electron'

contextBridge.exposeInMainWorld('ipcRenderer', {
  on(channel: string, listener: (event: any, ...args: any[]) => void) {
    const wrappedListener = (event: any, ...args: any[]) => listener(event, ...args)
    ipcRenderer.on(channel, wrappedListener)
    return () => ipcRenderer.removeListener(channel, wrappedListener)
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  listMusicFiles: (path: string) => ipcRenderer.invoke('files:listMusic', path),
  getAudioMetadata: (path: string, options?: { loadArtwork: boolean }) => ipcRenderer.invoke('files:getMetadata', path, options),
  getAudioMetadataBatch: (paths: string[]) => ipcRenderer.invoke('files:getMetadataBatch', paths),
  getAudioArtwork: (path: string) => ipcRenderer.invoke('files:getArtwork', path),
  readFileBufferPartial: (path: string, maxBytes: number) => ipcRenderer.invoke('files:readBufferPartial', path, maxBytes),
  readFileBuffer: (path: string, maxBytes?: number) => ipcRenderer.invoke('files:readBuffer', path, maxBytes),

  
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  onUpdateStatus: (callback: (status: any) => void) => {
    ipcRenderer.on('update-status', (_, data) => callback(data))
    return () => ipcRenderer.removeAllListeners('update-status')
  },
  getArtistImage: (name: string) => ipcRenderer.invoke('search:artistImage', name),
  searchYouTube: (query: string, pagesToLoad?: number) => ipcRenderer.invoke('search:youtube', query, pagesToLoad),
  getYouTubePreview: (url: string, title?: string, artist?: string) => ipcRenderer.invoke('search:youtubePreview', url, title, artist),
  downloadYouTube: (url: string, title: string, artist?: string, format?: string) => ipcRenderer.invoke('download:youtube', url, title, artist, format),
  downloadYouTubeToDir: (url: string, title: string, artist: string, dir: string, limitRate?: string, fileTimestamp?: number, format?: string) => ipcRenderer.invoke('download:youtubeToDir', url, title, artist, dir, limitRate, fileTimestamp, format),
  getLyrics: (title: string, artist: string, filePath?: string, duration?: number, aiConfig?: any) => ipcRenderer.invoke('search:lyrics', title, artist, filePath, duration, aiConfig),
  getGpuLyricsStatus: () => ipcRenderer.invoke('lyrics:gpuStatus'),
  getLyricsComputeDevices: () => ipcRenderer.invoke('lyrics:computeDevices'),
  calibrateLyricsGpu: (audioPath: string, rawLyrics: string | undefined, mode: string, force?: boolean, computeConfig?: any) => ipcRenderer.invoke('lyrics:gpuCalibrate', audioPath, rawLyrics, mode, force, computeConfig),
  onGpuLyricsProgress: (callback: (data: any) => void) => {
    const listener = (_: any, data: any) => callback(data)
    ipcRenderer.on('lyrics:gpuProgress', listener)
    return () => ipcRenderer.removeListener('lyrics:gpuProgress', listener)
  },
  onDownloadProgress: (callback: (data: { url: string, speed: string, percent?: number }) => void) => {
    ipcRenderer.on('download:progress', (_, data) => callback(data))
  },
  offDownloadProgress: () => {
    ipcRenderer.removeAllListeners('download:progress')
  },
  updateDiscordPresence: (data: any) => ipcRenderer.invoke('discord:updatePresence', data),
  clearDiscordPresence: () => ipcRenderer.invoke('discord:clearPresence')
})
