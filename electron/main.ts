import { app, BrowserWindow, ipcMain, dialog, Notification, screen, protocol, net, powerSaveBlocker } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import { autoUpdater } from 'electron-updater'
import { spawn } from 'node:child_process'
import * as mm from 'music-metadata'
import { DiscordBotManager } from './discordBot'
import { DiscordRPCManager } from './discordRPC'
import { searchArtistImage } from './utils/artistSearch'
import { searchTrackArtwork } from './utils/artworkSearch'
import { PartyRoomService, type PartyCommand } from './partyRoom'
import { searchLyrics } from './lyrics'
import { getGpuCalibrationStatus, runGpuLyricsCalibration, type GpuCalibrationMode } from './lyrics/gpuCalibration'

// Register custom standard protocol for local media playback to bypass CORS restrictions for Web Audio API
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { bypassCSP: true, standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])

// Opt-in Chrome DevTools Protocol endpoint for automated smoke tests:
//   NW_REMOTE_DEBUG=9223 npm run dev
if (process.env.NW_REMOTE_DEBUG) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.NW_REMOTE_DEBUG)
}

// Music capture must keep running while the player is minimized, covered by
// Discord, or otherwise not the foreground window. BrowserWindow's
// backgroundThrottling option covers most cases; these switches also protect
// Chromium's renderer, timer and occlusion paths on Windows.
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

const require = createRequire(import.meta.url)
let ffmpegPath = require('ffmpeg-static')
if (app.isPackaged) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked')
}


// Disable hardware acceleration to prevent GPU TDR crashes (nvlddmkm Event 153)
// We will conditionally enable/disable it below based on system libraries
if (process.platform === 'win32') {
  const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
  const hasMfplat = fsSync.existsSync(path.join(system32, 'mfplat.dll'))
  const hasVcruntime = fsSync.existsSync(path.join(system32, 'vcruntime140.dll'))

  if (!hasMfplat || !hasVcruntime) {
    // Fallback: System lacks media features or C++ runtime, disable GPU entirely to prevent startup crashes
    app.disableHardwareAcceleration()
    app.commandLine.appendSwitch('disable-gpu')
    app.commandLine.appendSwitch('disable-software-rasterizer')
    app.commandLine.appendSwitch('disable-gpu-sandbox')
    app.commandLine.appendSwitch('no-sandbox')
  } else {
    // Normal Windows environment: Keep GPU acceleration enabled, but disable sandbox to prevent AMD GPU / LTSC driver conflicts
    app.commandLine.appendSwitch('disable-gpu-sandbox')
    app.commandLine.appendSwitch('no-sandbox')
  }
}
// macOS/Linux: keep hardware acceleration enabled — the TDR workaround above
// only targets Windows driver crashes.




autoUpdater.allowPrerelease = true
autoUpdater.autoInstallOnAppQuit = false
autoUpdater.autoDownload = true

let updateCheckPromise: Promise<unknown> | null = null
let updateDownloaded = false

type UpdateStatusPayload = {
  status: string
  error?: string
  info?: unknown
  progress?: unknown
}

function sendUpdateStatus(data: UpdateStatusPayload) {
  console.log('[AutoUpdate]', data)
  win?.webContents.send('update-status', data)
}

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.setAlwaysOnTop(true)
      win.focus()
      win.setAlwaysOnTop(false)
    }
  })
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

Object.defineProperty(globalThis, '__filename', { value: __filename })
Object.defineProperty(globalThis, '__dirname', { value: __dirname })

process.env.APP_ROOT = path.join(__dirname, '..')

let logStream: fsSync.WriteStream | null = null

export function writeLog(type: string, ...args: any[]) {
  if (!logStream) return
  const timestamp = new Date().toISOString()
  const message = args.map(arg => {
    if (typeof arg === 'object') {
      try { return JSON.stringify(arg) } catch (e) { return String(arg) }
    }
    return String(arg)
  }).join(' ')
  logStream.write(`[${timestamp}] [${type}] ${message}\n`)
}

function setupFileLogging() {
  const logPath = path.join(app.getPath('userData'), 'debug.log')
  try {
    fsSync.writeFileSync(logPath, `=== NeonWave Debug Session Started at ${new Date().toLocaleString()} ===\n`)
    logStream = fsSync.createWriteStream(logPath, { flags: 'a' })

    const originalLog = console.log
    const originalError = console.error
    const originalWarn = console.warn

    console.log = (...args) => {
      originalLog(...args)
      writeLog('INFO', ...args)
    }
    console.error = (...args) => {
      originalError(...args)
      writeLog('ERROR', ...args)
    }
    console.warn = (...args) => {
      originalWarn(...args)
      writeLog('WARN', ...args)
    }

    process.on('uncaughtException', (error) => {
      writeLog('CRITICAL', 'Uncaught Exception:', error.message, error.stack)
      originalError('Uncaught Exception:', error)
    })

    process.on('unhandledRejection', (reason) => {
      writeLog('CRITICAL', 'Unhandled Rejection:', reason)
      originalError('Unhandled Rejection:', reason)
    })
  } catch (e) {
    console.error('Failed to setup file logging:', e)
  }
}

setupFileLogging()

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let miniWin: BrowserWindow | null = null
let activeWindowName = "unknown"
let monitorProcess: any = null
let discordBot: any = null
let partyRoomService: PartyRoomService | null = null
let discordPowerSaveBlockerId: number | null = null

function startDiscordPowerSaveBlocker() {
  if (discordPowerSaveBlockerId !== null && powerSaveBlocker.isStarted(discordPowerSaveBlockerId)) return
  discordPowerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension')
  console.log('[DiscordBot] Background playback protection enabled')
}

function stopDiscordPowerSaveBlocker() {
  if (discordPowerSaveBlockerId !== null && powerSaveBlocker.isStarted(discordPowerSaveBlockerId)) {
    powerSaveBlocker.stop(discordPowerSaveBlockerId)
  }
  discordPowerSaveBlockerId = null
}

function createWindow() {
  // Frameless title bar with overlay controls works on Windows/macOS.
  // Linux has no overlay window controls, so keep the native frame there.
  const frameOptions: Electron.BrowserWindowConstructorOptions =
    process.platform === 'linux'
      ? {}
      : {
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            color: '#00000000',
            symbolColor: '#ffffff',
            height: 30
          }
        }

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(process.env.VITE_PUBLIC!, 'logo.png'),
    ...frameOptions,
    show: false,
    backgroundColor: '#020617',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      backgroundThrottling: false,
      devTools: true
    },
  })

  win.webContents.on('console-message', (_, level, message, line, sourceId) => {
    const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR']
    const levelStr = levels[level] || 'INFO'
    writeLog(`RENDERER-MAIN-${levelStr}`, `[${path.basename(sourceId)}:${line}] ${message}`)
  })

  
  win.once('ready-to-show', () => {
    if (win) {
      win.show()
      win.focus()
      win.setAlwaysOnTop(true)
      win.focus()
      win.setAlwaysOnTop(false)
    }
  })

  
  win.on('unresponsive', () => {
    console.warn('Renderer unresponsive')
    dialog.showMessageBox(win!, {
      type: 'warning',
      title: 'NeonWave 無回應',
      message: '應用程式似乎沒有回應，是否重新載入？',
      buttons: ['重新載入', '稍候'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) win?.reload()
    })
  })

  
  // Handle GPU process crash (TDR recovery)
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process gone:', details.reason)
    if (details.reason === 'crashed' || details.reason === 'killed') {
      // GPU TDR or crash — silently reload after a short delay
      console.warn('[GPU Recovery] Renderer crashed/killed, auto-reloading in 2s...', details.reason)
      setTimeout(() => {
        if (win && !win.isDestroyed()) {
          win.reload()
        }
      }, 2000)
    } else if (details.reason !== 'clean-exit') {
      dialog.showMessageBox(win!, {
        type: 'error',
        title: 'NeonWave 錯誤',
        message: '渲染進程意外終止，應用程式將嘗試重新載入。',
        detail: `原因: ${details.reason}`
      }).then(() => {
        win?.reload()
      })
    }
  })

  // Handle child GPU process crashes specifically
  app.on('child-process-gone', (_event, details) => {
    if (details.type === 'GPU') {
      console.warn('[GPU Recovery] GPU child process gone:', details.reason)
      // Electron will restart the GPU process automatically;
      // we just log and let it recover
    }
  })

  
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.warn(`Page failed to load: ${errorCode} ${errorDescription}`)
    
    if (VITE_DEV_SERVER_URL) {
      setTimeout(() => {
        win?.loadURL(VITE_DEV_SERVER_URL)
      }, 1000)
    }
  })

  
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  win.on('closed', () => {
    win = null
    if (miniWin && !miniWin.isDestroyed()) {
      try { miniWin.close() } catch (e) {}
      miniWin = null
    }
    app.quit()
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  
  
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

autoUpdater.on('checking-for-update', () => {
  sendUpdateStatus({ status: 'checking' })
})
autoUpdater.on('update-available', (info) => {
  updateDownloaded = false
  sendUpdateStatus({ status: 'available', info })
})
autoUpdater.on('update-not-available', (info) => {
  updateCheckPromise = null
  updateDownloaded = false
  sendUpdateStatus({ status: 'not-available', info })
})
autoUpdater.on('error', (err) => {
  updateCheckPromise = null
  sendUpdateStatus({ status: 'error', error: err.message || String(err) })
})
autoUpdater.on('download-progress', (progressObj) => {
  sendUpdateStatus({ status: 'downloading', progress: progressObj })
})
autoUpdater.on('update-downloaded', (info) => {
  updateCheckPromise = null
  updateDownloaded = true
  sendUpdateStatus({ status: 'downloaded', info })

  
  const notification = new Notification({
    title: 'NeonWave 更新',
    body: '新版本已下載完成，將於重啟後自動安裝。',
    icon: path.join(process.env.VITE_PUBLIC!, 'logo.png')
  })
  notification.show()
})

app.whenReady().then(() => {
  // media:// protocol — serves audio/video to the renderer with CORS headers
  // so Web Audio (MediaElementAudioSourceNode) gets un-tainted samples while
  // webSecurity stays enabled.
  //   media:///<abs path>        → local file (Range supported)
  //   media://remote/?u=<url>    → main-process proxy for remote streams
  //                                (e.g. googlevideo URLs without CORS headers)
  protocol.handle('media', async (request) => {
    const { host, pathname, searchParams } = new URL(request.url)
    const range = request.headers.get('range')
    const fetchInit: RequestInit = range ? { headers: { Range: range } } : {}

    let upstream: Response
    if (host === 'remote') {
      const target = searchParams.get('u')
      if (!target || !/^https?:\/\//i.test(target)) {
        return new Response('bad remote url', { status: 400 })
      }
      upstream = await net.fetch(target, { ...fetchInit, redirect: 'follow' })
    } else {
      let decodedPath = decodeURIComponent(pathname)
      // Windows paths arrive as "/D:/dir/file" — strip the leading slash.
      // POSIX paths ("/home/user/file") must keep it.
      if (process.platform === 'win32') decodedPath = decodedPath.replace(/^\/+/, '')
      const filePath = path.normalize(decodedPath)
      const stat = await fs.stat(filePath)
      const fileSize = stat.size
      const extension = path.extname(filePath).toLowerCase()
      const contentTypes: Record<string, string> = {
        '.mp3': 'audio/mpeg',
        '.m4a': 'audio/mp4',
        '.aac': 'audio/aac',
        '.flac': 'audio/flac',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.oga': 'audio/ogg',
        '.mp4': 'video/mp4',
        '.mkv': 'video/x-matroska',
        '.webm': 'video/webm'
      }
      const headers = new Headers({
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Content-Type': contentTypes[extension] || 'application/octet-stream'
      })

      let start = 0
      let end = Math.max(0, fileSize - 1)
      let status = 200

      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim())
        if (!match || (!match[1] && !match[2])) {
          headers.set('Content-Range', `bytes */${fileSize}`)
          return new Response(null, { status: 416, headers })
        }

        if (!match[1]) {
          const suffixLength = Number(match[2])
          start = Math.max(0, fileSize - suffixLength)
        } else {
          start = Number(match[1])
        }
        if (match[2] && match[1]) end = Math.min(Number(match[2]), fileSize - 1)

        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= fileSize || end < start) {
          headers.set('Content-Range', `bytes */${fileSize}`)
          return new Response(null, { status: 416, headers })
        }

        status = 206
        headers.set('Content-Range', `bytes ${start}-${end}/${fileSize}`)
      }

      headers.set('Content-Length', String(fileSize === 0 ? 0 : end - start + 1))
      if (request.method === 'HEAD' || fileSize === 0) {
        return new Response(null, { status, headers })
      }

      const body = Readable.toWeb(fsSync.createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>
      return new Response(body, { status, headers })
    }

    const headers = new Headers(upstream.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    })
  })
  
  if (process.platform === 'win32') {
    app.setAppUserModelId('NeonWave')
  }

  // PowerShell polling loop that prints the foreground process name whenever
  // it changes. Embedded (not shipped as a file) so it also works when the
  // app is packaged into app.asar.
  const ACTIVE_WINDOW_MONITOR_PS = `
$code = @"
    using System;
    using System.Runtime.InteropServices;

    public class User32 {
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
    }
"@

if (-not ([System.Management.Automation.PSTypeName]'User32').Type) {
    try { Add-Type $code -ErrorAction SilentlyContinue } catch {}
}

$lastProcessName = ""

while ($true) {
    try {
        $hwnd = [User32]::GetForegroundWindow()
        if ($hwnd -ne [System.IntPtr]::Zero) {
            $pidOut = 0
            [void][User32]::GetWindowThreadProcessId($hwnd, [ref]$pidOut)
            if ($pidOut -gt 0) {
                $process = Get-Process -Id $pidOut -ErrorAction SilentlyContinue
                if ($process) {
                    $name = $process.ProcessName
                    if ($name -ne $lastProcessName) {
                        $lastProcessName = $name
                        Write-Output $name
                    }
                }
            }
        }
    } catch {}
    Start-Sleep -Seconds 2
}
`

  function startActiveWindowMonitor() {
    if (process.platform !== 'win32') return

    try {
      monitorProcess = spawn('powershell.exe', [
        '-ExecutionPolicy', 'Bypass',
        '-NoProfile',
        '-EncodedCommand', Buffer.from(ACTIVE_WINDOW_MONITOR_PS, 'utf16le').toString('base64')
      ], {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
      })

      monitorProcess.stdout.on('data', (data: Buffer) => {
        // A chunk may contain several lines; the last one is the newest.
        const lines = data.toString().split(/\r?\n/).map(s => s.trim()).filter(Boolean)
        if (lines.length > 0) {
          activeWindowName = lines[lines.length - 1]
        }
      })

      monitorProcess.on('error', (err: Error) => {
        console.warn('Active window monitor failed to start:', err.message)
      })

      monitorProcess.on('close', () => {
        if ((app as any).isQuitting) return
        setTimeout(startActiveWindowMonitor, 5000)
      })
    } catch (e) {
      console.error('Failed to start active window monitor:', e)
    }
  }

  startActiveWindowMonitor()

  partyRoomService = new PartyRoomService((command: PartyCommand) => {
    if (!win || win.isDestroyed()) return
    win.webContents.send('party:command', command)
  })

  app.on('will-quit', () => {
    (app as any).isQuitting = true
    if (monitorProcess) {
      try { monitorProcess.kill() } catch (e) {}
    }
    if (partyRoomService) {
      try { partyRoomService.stop() } catch (e) {}
    }
    if (discordBot) {
      try { discordBot.stop() } catch (e) {}
      try { discordBot.leaveChannel() } catch (e) {}
      if (discordBot.client) {
        try { discordBot.client.destroy() } catch (e) {}
      }
    }
  })
  
  createWindow()

  
  const discordRPC = new DiscordRPCManager()

  
  // LRU image cache — limit to 200 entries to prevent unbounded memory growth
  const IMAGE_CACHE_MAX = 200;
  const imageCache = new Map<string, string>();

  function getFromImageCache(key: string): string | undefined {
    const val = imageCache.get(key);
    if (val) {
      // Move to end (most recently used)
      imageCache.delete(key);
      imageCache.set(key, val);
    }
    return val;
  }

  function setImageCache(key: string, value: string) {
    if (imageCache.has(key)) {
      imageCache.delete(key);
    } else if (imageCache.size >= IMAGE_CACHE_MAX) {
      // Evict oldest entry
      const oldest = imageCache.keys().next().value!;
      imageCache.delete(oldest);
    }
    imageCache.set(key, value);
  }

  ipcMain.handle('discord:updatePresence', async (_, data) => {
    const cacheKey = `${data.title}-${data.artist}`;
    let artworkUrl = 'logo';


    const cached = getFromImageCache(cacheKey);
    if (cached) {
        artworkUrl = cached;
    } else if (data.artworkUrl && data.artworkUrl.startsWith('http') && !data.artworkUrl.includes('localhost')) {
        artworkUrl = data.artworkUrl;
    }


    discordRPC.setActivity({ ...data, artworkUrl }).catch(() => {});

    // No usable artwork URL yet — look the track up on iTunes/Deezer in the
    // background and refresh the presence once found.
    if (artworkUrl === 'logo' && (data.title || data.artist)) {
        (async () => {
             try {
                const foundUrl = await searchTrackArtwork(data.title, data.artist);
                if (foundUrl) {
                    setImageCache(cacheKey, foundUrl);

                    discordRPC.setActivity({ ...data, artworkUrl: foundUrl }).catch(() => {});
                }
             } catch (e) {
                 console.error('[DiscordRPC] Background artwork lookup failed:', e);
             }
        })();
    }

    return true;
  })

  ipcMain.handle('discord:clearCache', () => {
    imageCache.clear();
    return true;
  })

  ipcMain.handle('discord:scanAndUpload', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections']
    });

    if (result.canceled || result.filePaths.length === 0) return { status: 'canceled' };

    const folderPath = result.filePaths[0];
    
    const walk = async (dir: string): Promise<string[]> => {
      let files: string[] = [];
      const list = await fs.readdir(dir);
      for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) files = files.concat(await walk(fullPath));
        else if (/\.(mp3|m4a|flac|wav|ogg)$/i.test(file)) files.push(fullPath);
      }
      return files;
    };

    const files = await walk(folderPath);
    let successCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const metadata = await mm.parseFile(file, { skipCovers: true });
        const title = metadata.common.title;
        const artist = metadata.common.artist;

        if (title && artist) {
          const cacheKey = `${title}-${artist}`;
          if (!getFromImageCache(cacheKey)) {
            const foundUrl = await searchTrackArtwork(title, artist);
            if (foundUrl) {
              setImageCache(cacheKey, foundUrl);
              successCount++;
            }
          }
        }
      } catch (e) {
        console.error(`[ArtworkPreload] Error handling ${file}:`, e);
      }


      win?.webContents.send('discord:scanProgress', {
        current: i + 1,
        total: files.length,
        success: successCount
      });
    }

    return { status: 'completed', total: files.length, success: successCount };
  });

  ipcMain.handle('discord:clearPresence', () => {
    return discordRPC.clearActivity()
  })

  
  discordBot = new DiscordBotManager()

  ipcMain.handle('discord:login', async (_, token) => {
    return await discordBot.login(token)
  })

  ipcMain.handle('discord:getGuilds', () => {
    return discordBot.getGuilds()
  })

  ipcMain.handle('discord:getChannels', (_, guildId) => {
    return discordBot.getChannels(guildId)
  })

  ipcMain.handle('discord:join', async (_, guildId, channelId) => {
    const joined = await discordBot.joinChannel(guildId, channelId)
    if (joined) startDiscordPowerSaveBlocker()
    return joined
  })

  ipcMain.handle('discord:leave', async () => {
    const left = await discordBot.leaveChannel()
    stopDiscordPowerSaveBlocker()
    return left
  })

  ipcMain.handle('discord:disconnect', async () => {
    const result = await discordBot.disconnect()
    stopDiscordPowerSaveBlocker()
    return result
  })

  ipcMain.handle('discord:play', async (_, filePath, startTime = 0) => {
    
    
    return await discordBot.playFile(filePath, ffmpegPath, startTime)
  })

  ipcMain.handle('discord:stop', () => {
    return discordBot.stop()
  })

  ipcMain.handle('discord:pause', () => {
    return discordBot.pause()
  })

  ipcMain.handle('discord:resume', () => {
    return discordBot.resume()
  })

  ipcMain.handle('discord:setVolume', (_, volume) => {
    return discordBot.setVolume(volume)
  })

  ipcMain.handle('discord:status', () => {
    return discordBot.getStatus()
  })

  
  ipcMain.handle('discord:startStreamMode', async () => {
    return await discordBot.playReceiverStream(ffmpegPath)
  })

  
  
  
  
  ipcMain.on('discord:audio-chunk', (_, buffer) => {
    discordBot.writeAudioChunk(new Uint8Array(buffer))
  })

  
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) {
      const error = '自動更新只會在打包安裝版中運作，開發模式無法檢查 GitHub 更新。'
      sendUpdateStatus({ status: 'error', error })
      return { ok: false, error }
    }

    if (updateCheckPromise) {
      await updateCheckPromise
      return { ok: true }
    }

    updateDownloaded = false
    updateCheckPromise = autoUpdater.checkForUpdates()
      .then(() => ({ ok: true }))
      .catch((err) => {
        const error = err instanceof Error ? err.message : String(err)
        sendUpdateStatus({ status: 'error', error })
        return { ok: false, error }
      })
      .finally(() => {
        updateCheckPromise = null
      })

    return await updateCheckPromise
  })

  ipcMain.handle('update:install', () => {
    if (!app.isPackaged) {
      const error = '開發模式不能安裝更新。'
      sendUpdateStatus({ status: 'error', error })
      return { ok: false, error }
    }

    if (!updateDownloaded) {
      const error = '更新尚未下載完成，請先檢查並下載更新。'
      sendUpdateStatus({ status: 'error', error })
      return { ok: false, error }
    }

    sendUpdateStatus({ status: 'installing' })
    ;(app as any).isQuitting = true
    setImmediate(() => {
      autoUpdater.quitAndInstall(false, true)
    })
    return { ok: true }
  })

    ipcMain.handle('window:togglePlay', () => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('player:togglePlay')
        }
    })

    ipcMain.handle('window:restoreMain', () => {
        if (win && !win.isDestroyed()) {
            if (win.isMinimized()) win.restore()
            win.show()
            win.focus()
            win.setAlwaysOnTop(true)
            win.focus()
            win.setAlwaysOnTop(false)
        }
    })

    ipcMain.handle('app:version', () => {
        try {
            const version = app.getVersion()
            if (version && version !== '0.0.0') return version
            return require('../package.json').version || version
        } catch (e) {
            return app.getVersion()
        }
    })

    ipcMain.handle('party:status', () => {
        return partyRoomService?.getStatus() ?? {
            active: false,
            roomId: null,
            inviteUrl: null,
            localUrl: null,
            publicUrl: null,
            tunnelStatus: 'idle',
            tunnelMessage: undefined,
            cloudflaredAvailable: false,
            cloudflaredState: 'idle',
            cloudflaredMessage: undefined,
            cloudflaredProgress: undefined,
            track: null
        }
    })

    ipcMain.handle('party:start', async (_event, options?: { autoTunnel?: boolean }) => {
        if (!partyRoomService) throw new Error('Party service unavailable')
        return await partyRoomService.start(options)
    })

    ipcMain.handle('party:stop', async () => {
        if (!partyRoomService) return false
        await partyRoomService.stop()
        return true
    })

    
    let lastIgnoreMouseEvents: boolean | null = null
    ipcMain.on('player:sync', (_, data) => {
        if (miniWin && !miniWin.isDestroyed()) {
            miniWin.webContents.send('player:sync', data)
            
            const shouldIgnore = !!(data && data.isGameModeActive)
            if (lastIgnoreMouseEvents !== shouldIgnore) {
                lastIgnoreMouseEvents = shouldIgnore
                miniWin.setIgnoreMouseEvents(shouldIgnore, { forward: true })
            }
        }
        if (partyRoomService) {
            partyRoomService.updatePlayback({
                path: data?.path,
                title: data?.title,
                artist: data?.artist,
                artwork: data?.artwork,
                currentTime: Number(data?.currentTime || 0),
                duration: Number(data?.duration || 0),
                isPlaying: !!data?.isPlaying
            })
        }
        // Mirror the current track onto the bot's "Listening to ..." presence
        if (discordBot && discordBot.isConnected && discordBot.currentChannelId) {
            try {
                discordBot.updateNowPlaying(data?.title || '', data?.artist || '', !!data?.isPlaying)
            } catch (e) {
                // Presence updates must never break player sync.
            }
        }
    })

    ipcMain.handle('window:toggleMiniPlayer', () => {
        if (miniWin && !miniWin.isDestroyed()) {
            miniWin.close()
            miniWin = null
            return false
        }

        const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize
        const miniWidth = 180
        const miniHeight = 180
        const margin = 20

        miniWin = new BrowserWindow({
            width: miniWidth,
            height: miniHeight,
            x: screenWidth - miniWidth - margin,
            y: margin,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            resizable: false,
            skipTaskbar: true,
            thickFrame: false, 
            hasShadow: false, 
            backgroundColor: '#00000000',
            webPreferences: {
                preload: path.join(__dirname, 'preload.mjs'),
            }
        })

        miniWin.webContents.on('console-message', (_, level, message, line, sourceId) => {
            const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR']
            const levelStr = levels[level] || 'INFO'
            writeLog(`RENDERER-MINI-${levelStr}`, `[${path.basename(sourceId)}:${line}] ${message}`)
        })

        if (VITE_DEV_SERVER_URL) {
            miniWin.loadURL(`${VITE_DEV_SERVER_URL}?mini=true`)
        } else {
            miniWin.loadFile(path.join(RENDERER_DIST, 'index.html'), { query: { mini: 'true' } })
        }

        miniWin.on('closed', () => {
            miniWin = null
        })

        return true
    })

  
  ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory']
    })
    if (canceled) {
      return null
    }
    return filePaths[0]
  })

  ipcMain.handle('files:listMusic', async (_, folderPath) => {
    if (!folderPath) return []
    try {
      const files = await fs.readdir(folderPath)
      const supportedExtensions = ['.mp3', '.wav', '.wma', '.m4a', '.flac', '.ogg', '.mp4', '.mov', '.wmv', '.avi']

      const fileStats = await Promise.all(files.map(async file => {
        const fullPath = path.join(folderPath, file)
        const ext = path.extname(file).toLowerCase()
        if (!supportedExtensions.includes(ext)) return null

        try {
          const stats = await fs.stat(fullPath)
          return {
            fullPath,
            mtime: stats.mtime.getTime()
          }
        } catch (e) {
          return null
        }
      }))

      return fileStats
        .filter((f): f is { fullPath: string, mtime: number } => f !== null)
        .sort((a, b) => b.mtime - a.mtime)
        .map(f => f.fullPath)
    } catch (error) {
      console.error('Error reading directory:', error)
      return []
    }
  })

  // Persistent metadata cache (userData/metadata-cache.json), keyed by
  // "path\0mtime" so an edited/replaced file is re-scanned automatically.
  // Avoids re-parsing every track's tags on every app launch.
  const metaCachePath = path.join(app.getPath('userData'), 'metadata-cache.json')
  let metaCache: Record<string, any> = {}
  let metaCacheLoaded = false
  let metaCacheDirty = false
  let metaCacheFlushTimer: NodeJS.Timeout | null = null

  const loadMetaCache = async () => {
    if (metaCacheLoaded) return
    metaCacheLoaded = true
    try {
      metaCache = JSON.parse(await fs.readFile(metaCachePath, 'utf8'))
    } catch {
      metaCache = {}
    }
  }

  const scheduleMetaFlush = () => {
    metaCacheDirty = true
    if (metaCacheFlushTimer) return
    metaCacheFlushTimer = setTimeout(async () => {
      metaCacheFlushTimer = null
      if (!metaCacheDirty) return
      metaCacheDirty = false
      try {
        await fs.writeFile(metaCachePath, JSON.stringify(metaCache))
      } catch (e) {
        console.warn('[MetaCache] flush failed:', e)
      }
    }, 1500)
  }

  // Batch metadata read for a folder scan. Returns lightweight metadata for
  // every path, hitting the disk parser only for new/changed files.
  ipcMain.handle('files:getMetadataBatch', async (_, filePaths: string[]) => {
    await loadMetaCache()
    const results = await Promise.all((filePaths || []).map(async (filePath) => {
      let mtime = 0
      try {
        mtime = (await fs.stat(filePath)).mtimeMs
      } catch {
        return null
      }
      const key = `${filePath}\0${Math.round(mtime)}`
      const cached = metaCache[key]
      if (cached) return { path: filePath, ...cached }

      try {
        const metadata = await mm.parseFile(filePath, { skipCovers: true })
        const entry = {
          title: metadata.common.title || null,
          artist: metadata.common.artist || null,
          album: metadata.common.album || null,
          duration: metadata.format.duration || 0,
          codec: metadata.format.codec || null,
          bitrate: metadata.format.bitrate || null,
          sampleRate: metadata.format.sampleRate || null
        }
        // Drop any older entry for this path (different mtime) before caching
        for (const k of Object.keys(metaCache)) {
          if (k.startsWith(`${filePath}\0`)) delete metaCache[k]
        }
        metaCache[key] = entry
        scheduleMetaFlush()
        return { path: filePath, ...entry }
      } catch {
        return { path: filePath, title: null, artist: null, album: null, duration: 0 }
      }
    }))
    return results.filter(Boolean)
  })

  ipcMain.handle('files:readBufferPartial', async (_, filePath, maxBytes) => {
    try {
      const fd = await fs.open(filePath, 'r')
      const buffer = Buffer.alloc(maxBytes)
      const { bytesRead } = await fd.read(buffer, 0, maxBytes, 0)
      await fd.close()
      return buffer.subarray(0, bytesRead)
    } catch (error) {
      console.error('Error reading partial file:', error)
      return null
    }
  })

  ipcMain.handle('files:readBuffer', async (_, filePath, maxBytes = 128 * 1024 * 1024) => {
    try {
      const stat = await fs.stat(filePath)
      if (stat.size > maxBytes) {
        throw new Error(`Audio file is too large for in-memory calibration (${stat.size} bytes)`)
      }
      const buffer = await fs.readFile(filePath)
      // Electron's structured clone does not guarantee that a Node Buffer
      // arrives in the renderer as an ArrayBuffer. Return an exact standalone
      // ArrayBuffer so decodeAudioData always receives the browser-native type.
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    } catch (error) {
      console.error('Error reading audio file for calibration:', error)
      return null
    }
  })

  const fileArtworkCache = new Map<string, string | null>()

  ipcMain.handle('files:getArtwork', async (_, filePath) => {
    if (fileArtworkCache.has(filePath)) {
      return fileArtworkCache.get(filePath)
    }
    try {
      const metadata = await mm.parseFile(filePath, { skipCovers: false }) 
      let result: string | null = null
      if (metadata.common.picture && metadata.common.picture.length > 0) {
        const pic = metadata.common.picture[0]
        result = `data:${pic.format};base64,${Buffer.from(pic.data).toString('base64')}`
      }
      if (fileArtworkCache.size >= 500) {
        const firstKey = fileArtworkCache.keys().next().value
        if (firstKey) fileArtworkCache.delete(firstKey)
      }
      fileArtworkCache.set(filePath, result)
      return result
    } catch (e) {
      return null
    }
  })

  ipcMain.handle('files:getMetadata', async (_, filePath, options = { loadArtwork: true }) => {
    try {
      const parseOptions = options.loadArtwork ? {} : { skipCovers: true }
      const metadata = await mm.parseFile(filePath, parseOptions)

      let artwork = null
      if (options.loadArtwork) {
        if (fileArtworkCache.has(filePath)) {
          artwork = fileArtworkCache.get(filePath) || null
        } else if (metadata.common.picture && metadata.common.picture.length > 0) {
          const pic = metadata.common.picture[0]
          artwork = `data:${pic.format};base64,${Buffer.from(pic.data).toString('base64')}`
          if (fileArtworkCache.size >= 500) {
            const firstKey = fileArtworkCache.keys().next().value
            if (firstKey) fileArtworkCache.delete(firstKey)
          }
          fileArtworkCache.set(filePath, artwork)
        } else {
          fileArtworkCache.set(filePath, null)
        }
      }

      return {
        title: metadata.common.title,
        artist: metadata.common.artist,
        album: metadata.common.album,
        artwork: artwork,
        duration: metadata.format.duration,
        codec: metadata.format.codec,
        bitrate: metadata.format.bitrate,
        sampleRate: metadata.format.sampleRate
      }
    } catch (e) {
      
      return null
    }
  })

  ipcMain.handle('app:active-window', () => {
    return activeWindowName
  })


  const YtDlpWrap = createRequire(import.meta.url)('yt-dlp-wrap').default

  
  const updateYtDlpInBackground = async () => {
    const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
    const binaryPath = path.join(app.getPath('userData'), binaryName)
    try {
      const wrapper = new YtDlpWrap(binaryPath)
      console.log("[Main] Checking for yt-dlp updates in background...")
      await wrapper.execPromise(["-U"])
      console.log("[Main] yt-dlp updated successfully.")
    } catch (e: any) {
      console.warn("[Main] Failed to update yt-dlp (background):", e.message)
    }
  }

  
  
  const getYtDlp = async () => {
    const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
    const binaryPath = path.join(app.getPath('userData'), binaryName)

    
    try {
      await fs.access(binaryPath)
    } catch {
      
      console.log('Downloading yt-dlp binary...')
      await YtDlpWrap.downloadFromGithub(binaryPath)
      console.log('Downloaded yt-dlp to', binaryPath)
    }

    return new YtDlpWrap(binaryPath)
  }

  
  updateYtDlpInBackground()

  
  ipcMain.handle('search:youtube', async (_, query, pagesToLoad = 1) => {
    try {
      const ytSearch = createRequire(import.meta.url)('yt-search')
      const pages = Math.max(1, Math.min(Number(pagesToLoad) || 1, 5))
      const r = await ytSearch({ query, pages })
      if (!r || !r.videos) return []
      
      const results = r.videos.map((v: any) => ({
        id: v.videoId,
        title: v.title,
        artist: v.author?.name || 'Unknown',
        duration: v.seconds,
        thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        url: v.url
      }))

      return results
    } catch (e) {
      console.error("yt-search error:", e)
      return []
    }
  })

  ipcMain.handle('search:youtubePreview', async (_, url, title?: string, artist?: string) => {
    try {
      const yt = await getYtDlp()
      const stdout = await yt.execPromise([url, '-J'])
      const dat = JSON.parse(stdout)
      let bestStart = 0
      let hasHeatmap = false

      if (dat.heatmap && dat.heatmap.length > 0) {
        
        const duration = dat.duration || 0
        const validHeatmap = dat.heatmap.filter((h: any) => h.start_time >= 15 && (duration === 0 || h.start_time <= duration - 15))
        const pool = validHeatmap.length > 0 ? validHeatmap : dat.heatmap
        
        const best = [...pool].sort((a: any, b: any) => b.value - a.value)[0]
        bestStart = best.start_time
        hasHeatmap = true
      }

      
      
      
      
      if (!hasHeatmap && title) {
        try {
          const query = artist ? `${title} ${artist}` : title
          const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`)
          if (res.ok) {
            const data: any[] = await res.json()
            if (data && data.length > 0 && data[0].syncedLyrics) {
              const lyrics = data[0].syncedLyrics
              const lines = lyrics.split('\n')
              const parsed: { time: number, text: string }[] = []
              const regex = /\[(\d{2}):(\d{2}\.\d{2})\]\s*(.*)/

              for (const line of lines) {
                const match = line.match(regex)
                if (match) {
                  const m = parseInt(match[1])
                  const s = parseFloat(match[2])
                  const text = match[3].trim()
                  if (text.length > 2) parsed.push({ time: m * 60 + s, text })
                }
              }

              if (parsed.length > 0) {
                const lineFreq = new Map<string, number>()
                for (const p of parsed) {
                  const t = p.text.toLowerCase()
                  lineFreq.set(t, (lineFreq.get(t) || 0) + 1)
                }

                let maxScore = 0
                let bestIdx = -1
                const WINDOW = 4
                for (let i = 0; i <= parsed.length - WINDOW; i++) {
                  let score = 0
                  for (let j = 0; j < WINDOW; j++) {
                    const t = parsed[i + j].text.toLowerCase()
                    const count = lineFreq.get(t) || 0
                    if (count > 1) score += count
                  }
                  if (score > maxScore) {
                    maxScore = score
                    bestIdx = i
                  }
                }

                
                if (bestIdx !== -1 && maxScore >= 4) {
                  bestStart = parsed[bestIdx].time
                } else {
                  
                  if (dat.duration) bestStart = Math.floor(dat.duration / 3)
                }
              }
            }
          }
        } catch (e) {   }
      }

      
      if (bestStart === 0 && dat.duration) {
        bestStart = Math.floor(dat.duration / 3)
      }

      
      const formats = dat.formats || []
      let audioFormats = formats.filter((f: any) => f.acodec !== 'none' && f.vcodec === 'none')
      let streamUrl = ''

      if (audioFormats.length > 0) {
        
        const m4aFormats = audioFormats.filter((f: any) => f.ext === 'm4a')
        if (m4aFormats.length > 0) audioFormats = m4aFormats

        audioFormats.sort((a: any, b: any) => (b.tbr || 0) - (a.tbr || 0))
        streamUrl = audioFormats[0].url
      } else {
        
        formats.sort((a: any, b: any) => (b.tbr || 0) - (a.tbr || 0))
        if (formats.length > 0) streamUrl = formats[0].url
      }

      return {
        url: streamUrl,
        startTime: bestStart
      }
    } catch (e: any) {
      console.error("Youtube preview error:", e)
      return null
    }
  })

  ipcMain.handle('download:youtube', async (_, url, inputTitle, inputArtist, format = 'm4a') => {
    try {
      const yt = await getYtDlp()

      
      const ffmpegPath = createRequire(import.meta.url)('ffmpeg-static')
        .replace('app.asar', 'app.asar.unpacked') 

      
      
      let safeTitle = inputTitle.replace(/[\\/:*?"<>|]/g, '_').trim()

      // 2. Pick path
      const defaultExt = format === 'mp4' ? 'mp4' : 'm4a'
      const { filePath } = await dialog.showSaveDialog(win!, {
        title: '下載歌曲',
        defaultPath: `${safeTitle}.${defaultExt}`,
        filters: format === 'mp4' ? [
           { name: 'Media (mp4)', extensions: ['mp4'] },
           { name: 'Audio (m4a)', extensions: ['m4a'] }
        ] : [
           { name: 'Audio (m4a)', extensions: ['m4a'] }
        ]
      })

      if (!filePath) return null

      // 3. Download
      return new Promise((resolve, reject) => {
        // Prepare args
        const fArg = format === 'mp4' ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/bestaudio[ext=m4a]/best' : 'bestaudio[ext=m4a]'
        const args = [
          url,
          '--no-playlist',
          '--force-overwrites',
          '-f', fArg,
          '--ffmpeg-location', ffmpegPath,
          '--add-metadata',
          '--embed-thumbnail',
          '-o', filePath
        ]

        // If we have explicit artist/title, force them into metadata
        // Note: yt-dlp parse-metadata syntax: "STRING:%(field)s"
        if (inputArtist) {
          args.push('--parse-metadata', `${inputArtist}:%(artist)s`)
          args.push('--parse-metadata', `${inputArtist}:%(album_artist)s`)
        }
        if (inputTitle) {
          args.push('--parse-metadata', `${inputTitle}:%(title)s`)
        }

        const eventEmitter = yt.exec(args)

        eventEmitter.on('progress', () => {
          // Could send progress to renderer if we wanted
          // win?.webContents.send('download-progress', progress)
        })

        eventEmitter.on('error', (err: any) => {
          console.error("yt-dlp error:", err)
          reject(new Error(`下載錯誤: ${err.message}`))
        })

        eventEmitter.on('close', () => {
          resolve(filePath)
        })
      })

    } catch (e: any) {
      console.error("Download fatal error:", e)
      throw new Error(e.message) // Propagate pure message
    }
  })

  ipcMain.handle('download:youtubeToDir', async (_, url, inputTitle, inputArtist, outputDir, limitRate, fileTimestamp, format = 'm4a') => {
    try {
      const yt = await getYtDlp()

      // Get ffmpeg path
      const ffmpegPath = createRequire(import.meta.url)('ffmpeg-static')
        .replace('app.asar', 'app.asar.unpacked') // Fix for production builds

      let safeTitle = inputTitle.replace(/[\\/:*?"<>|]/g, '_').trim()
      const basePath = path.join(outputDir, safeTitle)

      return new Promise((resolve, reject) => {
        const fArg = format === 'mp4' ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/bestaudio[ext=m4a]/best' : 'bestaudio[ext=m4a]'
        const args = [
          url,
          '--no-playlist',
          '--force-overwrites',
          '-f', fArg
        ]

        if (limitRate && limitRate !== '0') {
          args.push('--limit-rate', limitRate)
        }

        args.push(
          '--ffmpeg-location', ffmpegPath,
          '--add-metadata',
          '--embed-thumbnail',
          '-o', `${basePath}.%(ext)s`
        )

        if (inputArtist) {
          args.push('--parse-metadata', `${inputArtist}:%(artist)s`)
          args.push('--parse-metadata', `${inputArtist}:%(album_artist)s`)
        }
        if (inputTitle) {
          args.push('--parse-metadata', `${inputTitle}:%(title)s`)
        }

        const eventEmitter = yt.exec(args)

        eventEmitter.on('progress', (progress: any) => {
          // Send progress updates to renderer
          if (win && progress && progress.currentSpeed) {
            win.webContents.send('download:progress', {
              url: url,
              speed: progress.currentSpeed,
              percent: progress.percent
            })
          }
        })

        // Fallback for manual parsing just in case
        eventEmitter.on('ytDlpEvent', (eventType: string, eventData: string) => {
          if (eventType === 'download' && eventData.includes('at')) {
            const speedMatch = eventData.match(/at\s+([0-9.]+[a-zA-Z]+\/s)/)
            if (speedMatch && win) {
              win.webContents.send('download:progress', { url: url, speed: speedMatch[1] })
            }
          }
        })

        eventEmitter.on('error', (err: any) => {
          console.error("yt-dlp error:", err)
          reject(new Error(`下載錯誤: ${err.message}`))
        })

        eventEmitter.on('close', async () => {
          let finalPath = path.join(outputDir, `${safeTitle}.mp4`)
          try {
            await fs.access(finalPath)
          } catch {
            finalPath = path.join(outputDir, `${safeTitle}.m4a`)
            try {
              await fs.access(finalPath)
            } catch {
              finalPath = path.join(outputDir, `${safeTitle}.webm`)
              try { await fs.access(finalPath) } catch {
                finalPath = path.join(outputDir, `${safeTitle}.mp3`) // Just in case
              }
            }
          }

          if (fileTimestamp) {
            try {
              const timeDate = new Date(fileTimestamp);
              await fs.utimes(finalPath, timeDate, timeDate);
            } catch (e) {
              console.error("Failed to set file timestamp:", e)
            }
          }
          resolve(finalPath)
        })
      })

    } catch (e: any) {
      console.error("Download fatal error:", e)
      throw new Error(e.message) // Propagate pure message
    }
  })

  ipcMain.handle('search:artistImage', async (_, artistName) => {
    return searchArtistImage(artistName)
  })

  ipcMain.handle('search:lyrics', async (_, title, artist, filePath, duration, aiConfig) => {
    return searchLyrics({ title, artist, filePath, duration, aiConfig })
  })

  const gpuLyricsRoot = path.join(app.getPath('userData'), 'gpu-lyrics')
  ipcMain.handle('lyrics:gpuStatus', async () => {
    const status = await getGpuCalibrationStatus(gpuLyricsRoot)
    const gpuInfo = await app.getGPUInfo('basic').catch(() => null)
    const devices = Array.isArray((gpuInfo as any)?.gpuDevice) ? (gpuInfo as any).gpuDevice : []
    return {
      ...status,
      gpuName: devices.map((device: any) => device?.deviceString).filter(Boolean).join(' / ') || 'NVIDIA GPU'
    }
  })

  ipcMain.handle('lyrics:computeDevices', async () => {
    const gpus = await new Promise<Array<{ index: number; name: string; memoryMb: number }>>(resolve => {
      const child = spawn('nvidia-smi', ['--query-gpu=index,name,memory.total', '--format=csv,noheader,nounits'], { windowsHide: true })
      let output = ''
      child.stdout.on('data', chunk => { output += String(chunk) })
      child.on('error', () => resolve([]))
      child.on('close', code => {
        if (code !== 0) return resolve([])
        resolve(output.trim().split(/\r?\n/).filter(Boolean).map(line => {
          const [index, name, memory] = line.split(',').map(value => value.trim())
          return { index: Number(index), name, memoryMb: Number(memory) }
        }).filter(gpu => Number.isInteger(gpu.index)))
      })
    })
    return {
      gpus,
      cpu: {
        name: os.cpus()[0]?.model || 'CPU',
        logicalThreads: os.cpus().length,
        totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024)
      }
    }
  })

  ipcMain.handle('lyrics:gpuCalibrate', async (event, audioPath: string, rawLyrics: string | undefined, mode: GpuCalibrationMode, force = false, computeConfig?: any) => {
    return runGpuLyricsCalibration({
      audioPath,
      rawLyrics,
      mode,
      force,
      runtimeRoot: gpuLyricsRoot,
      ffmpegPath,
      computeConfig,
      onProgress: progress => {
        if (!event.sender.isDestroyed()) event.sender.send('lyrics:gpuProgress', progress)
      }
    })
  })
})
