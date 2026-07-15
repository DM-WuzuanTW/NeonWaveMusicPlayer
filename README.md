# NeonWave Music Player

[![CI](https://github.com/wu-zuan/NeonWaveMusicPlayer/actions/workflows/ci.yml/badge.svg)](https://github.com/wu-zuan/NeonWaveMusicPlayer/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/wu-zuan/NeonWaveMusicPlayer)](https://github.com/wu-zuan/NeonWaveMusicPlayer/releases)

高質感桌面音樂播放器 — 8D 環繞音效、同步歌詞彈幕、Discord 整合、Listening Party 即時分享。

Electron + React + TypeScript + Web Audio API。

## 功能

- 🎵 **本機音樂庫** — mp3 / m4a / flac / wav / ogg,以及 mp4 / mov 等影片播放
- 🎧 **音效引擎** — 8D 環繞旋轉、空間殘響(演唱會 / 音樂廳 / 房間 / 賽車 / FPS)、距離模擬、專注模式、響度正規化
- 📝 **智慧歌詞** — LRCLib 精準比對快速路徑 + 網易雲 + 酷狗三來源並行搜尋、標題/時長評分選擇、時間軸自動校正、簡繁轉換,找不到時可用 AI 生成(OpenAI / Claude / Gemini / OpenRouter / Ollama / Open WebUI)
- 🎮 **情境偵測** — 偵測前景程式,遊戲 / 工作模式自動調整(Windows)
- 💬 **Discord** — Rich Presence 歌曲與封面顯示(iTunes/Deezer 封面查詢)、Bot 語音頻道串流播放
- 🎉 **Listening Party** — 內建房間伺服器 + Cloudflare Tunnel 一鍵產生公開連結,朋友用瀏覽器同步聆聽
- ⬇️ **YouTube** — 搜尋、串流預覽(自動跳副歌)、yt-dlp 下載(自動附中繼資料與封面)
- 🔄 **自動更新** — 透過 GitHub Releases(Windows NSIS / macOS zip)

## 下載

到 [Releases](https://github.com/wu-zuan/NeonWaveMusicPlayer/releases) 下載:

| 平台 | 檔案 |
|------|------|
| Windows | `NeonWave-Windows-x.y.z-Setup.exe` |
| macOS (Apple Silicon) | `NeonWave-Mac-x.y.z-arm64.dmg` |
| Linux | `NeonWave-Linux-x.y.z.AppImage` |

> macOS 版未經 Apple 簽章,首次開啟請在 App 上按右鍵 → 打開;或執行
> `xattr -cr /Applications/NeonWave.app`。
> Linux AppImage 需要 `libfuse2`(`chmod +x` 後直接執行)。
> 簽名設定方式見 [docs/signing.md](docs/signing.md)。

## 開發

```bash
npm install
npm run dev        # 開發模式(Vite + Electron)
npm run typecheck  # TypeScript 檢查
npm run build      # 本機完整打包(electron-builder)
npm run build:dir  # 只打包目錄不做安裝檔(快速驗證)
```

## 發佈

```bash
npm run release
```

腳本會把 patch 版號 +1、commit、推送 `v*` 標籤;GitHub Actions
(`.github/workflows/release.yml`)接手編譯 **Windows / macOS / Linux**
三平台安裝檔並發佈到 GitHub Release。

## 專案結構

```
src/                    # React renderer
  components/           #   播放器 UI、歌詞彈幕、搜尋、設定、Discord 面板
  hooks/                #   useAudioPlayer / useLibrary / useAppDetection
  utils/AudioEngine.ts  #   Web Audio 音效管線(panner、殘響、壓縮器)
electron/               # 主行程
  main.ts               #   視窗、IPC、yt-dlp、自動更新
  lyrics/               #   歌詞引擎(providers / 評分 / AI 封裝 / 協調器)
  discordBot.ts         #   Discord 語音串流
  discordRPC.ts         #   Rich Presence
  partyRoom.ts          #   Listening Party 伺服器 + cloudflared
```
