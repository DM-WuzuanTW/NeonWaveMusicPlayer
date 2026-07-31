/// <reference types="vite/client" />

interface Window {
    ipcRenderer: {
        invoke<T = any>(channel: string, ...args: any[]): Promise<T>
        openDirectory(): Promise<string | null>
        listMusicFiles(path: string): Promise<string[]>
        getAudioMetadata(path: string, options?: { loadArtwork: boolean }): Promise<any>
        getAudioMetadataBatch(paths: string[]): Promise<any[]>
        getAudioArtwork(path: string): Promise<string | null>

        checkUpdate(): Promise<{ ok: boolean; error?: string }>
        installUpdate(): Promise<{ ok: boolean; error?: string }>
        getAppVersion(): Promise<string>
        onUpdateStatus(callback: (status: any) => void): () => void
        searchYouTube(query: string, pagesToLoad?: number): Promise<any[]>
        getYouTubePreview(url: string, title?: string, artist?: string): Promise<{ url: string, startTime: number } | null>
        downloadYouTube(url: string, title: string, artist?: string, format?: string): Promise<string | null>
        downloadYouTubeToDir(url: string, title: string, artist: string, dir: string, limitRate?: string, fileTimestamp?: number, format?: string): Promise<string | null>
        getArtistImage(name: string): Promise<string | null>
        getLyrics(title: string, artist: string, filePath?: string, duration?: number, aiConfig?: any): Promise<string | null>
        invoke(channel: 'party:status'): Promise<{
            active: boolean
            roomId: string | null
            inviteUrl: string | null
            localUrl: string | null
            publicUrl: string | null
            tunnelStatus: 'idle' | 'starting' | 'connected' | 'error'
            tunnelMessage?: string
            cloudflaredAvailable: boolean
            cloudflaredState: 'idle' | 'downloading' | 'ready' | 'error'
            cloudflaredMessage?: string
            cloudflaredProgress?: number
            track: {
                title: string
                artist: string
                album?: string
                artwork?: string
                currentTime: number
                duration: number
                isPlaying: boolean
                streamable: boolean
            } | null
        }>
        invoke(channel: 'party:start', options?: { autoTunnel?: boolean }): Promise<any>
        invoke(channel: 'party:stop'): Promise<boolean>
        onDownloadProgress(callback: (data: { url: string, speed: string, percent?: number }) => void): void
        offDownloadProgress(): void

        // Discord Bot
        invoke(channel: 'discord:login', token: string): Promise<{ username: string; avatar: string | null }>
        invoke(channel: 'discord:getGuilds'): Promise<any[]>
        invoke(channel: 'discord:getChannels', guildId: string): Promise<any[]>
        invoke(channel: 'discord:join', guildId: string, channelId: string): Promise<boolean>
        invoke(channel: 'discord:leave'): Promise<boolean>
        invoke(channel: 'discord:play', filePath: string, startTime?: number): Promise<void>
        invoke(channel: 'discord:pause'): Promise<void>
        invoke(channel: 'discord:resume'): Promise<void>
        invoke(channel: 'discord:stop'): Promise<void>
        invoke(channel: 'discord:setVolume', volume: number): Promise<boolean>
        invoke(channel: 'discord:startStreamMode'): Promise<boolean>
        invoke(channel: 'discord:status'): Promise<{ isConnected: boolean; username: string | null; avatar: string | null; currentGuildId: string | null; currentChannelId: string | null; currentGuildName: string | null; currentChannelName: string | null; isPlaying: boolean; nowPlaying: { title: string; artist: string } | null }>

        on(channel: string, listener: (...args: any[]) => void): void
        off(channel: string, listener: (...args: any[]) => void): void
        send(channel: string, ...args: any[]): void
    }
}
