import { net } from 'electron'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import extract from 'extract-zip'
import { pinyin } from 'pinyin-pro'
import { toSimplified } from './text'
import { stabilizeInterludeGaps } from '../../src/utils/lyricsTimelineStability'

export type GpuCalibrationMode = 'gpu-fast' | 'gpu-precision' | 'gpu-studio'
export type CalibrationBackend = 'auto' | 'hybrid' | 'cuda' | 'cpu' | 'multi-gpu'
export interface CalibrationComputeConfig {
    backend: CalibrationBackend
    gpuDevices: number[]
    cpuThreads: number
    cpuProcessors: number
}

export interface GpuCalibrationProgress {
    stage: 'checking' | 'downloading-engine' | 'installing-engine' | 'downloading-model' | 'preparing' | 'transcribing' | 'aligning' | 'saving' | 'complete' | 'error'
    percent: number
    message: string
}

export interface GpuCalibrationResult {
    ok: boolean
    lyrics?: string
    confidence?: number
    savedPath?: string
    historyPath?: string
    runs?: number
    cached?: boolean
    error?: string
}

const ENGINE_VERSION = 'v1.9.1'
const ENGINE_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${ENGINE_VERSION}/whisper-cublas-12.4.0-bin-x64.zip`
const ENGINE_BYTES = 677887125
const ENGINE_SHA256 = '106a2030eff8998e4ef320fe72e263a78449e9040386ee27c41ea80b001b601b'
const MODEL_ROOT = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
const MODES: Record<GpuCalibrationMode, { model: string; label: string; beam: number; rank: number; bytes: number; sha256: string }> = {
    'gpu-fast': { model: 'ggml-small-q5_1.bin', label: 'GPU 快速', beam: 3, rank: 1, bytes: 190085487, sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb' },
    'gpu-precision': { model: 'ggml-medium-q5_0.bin', label: 'GPU 精準', beam: 5, rank: 2, bytes: 539212467, sha256: '19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f' },
    'gpu-studio': { model: 'ggml-large-v3-turbo-q8_0.bin', label: 'GPU 錄音室', beam: 7, rank: 3, bytes: 874188075, sha256: '317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1' }
}

type ParsedLine = { time: number; text: string; originalIndex: number }
type TimedChar = { char: string; time: number }
type CalibrationHistory = {
    version: 1
    runs: number
    bestConfidence: number
    mode: GpuCalibrationMode
    updatedAt: string
    anchors: Array<{ line: number; time: number; samples: number }>
}

const emit = (callback: ((progress: GpuCalibrationProgress) => void) | undefined, progress: GpuCalibrationProgress) => callback?.(progress)

function sidecarPaths(audioPath: string) {
    const base = audioPath.slice(0, audioPath.length - path.extname(audioPath).length)
    return {
        source: `${base}.lrc`,
        calibrated: `${base}.neonwave.lrc`,
        history: `${base}.neonwave-calibration.json`
    }
}

async function sha256File(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256')
        const stream = fsSync.createReadStream(filePath)
        stream.on('data', chunk => hash.update(chunk))
        stream.on('error', reject)
        stream.on('end', () => resolve(hash.digest('hex')))
    })
}

async function isVerifiedFile(filePath: string, expectedBytes: number, expectedSha256: string) {
    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat || stat.size !== expectedBytes) return false
    const markerPath = `${filePath}.verified`
    const marker = await fs.readFile(markerPath, 'utf8').catch(() => '')
    if (marker.trim() === expectedSha256) return true
    const actual = await sha256File(filePath)
    if (actual !== expectedSha256) return false
    await fs.writeFile(markerPath, expectedSha256, 'utf8')
    return true
}

async function downloadWithSystemCurl(url: string, temporary: string, expectedBytes: number, onProgress: (percent: number) => void) {
    await new Promise<void>((resolve, reject) => {
        const child = spawn('curl.exe', [
            '--fail', '--location', '--retry', '5', '--retry-delay', '2',
            '--continue-at', '-', '--output', temporary, url
        ], { windowsHide: true })
        let stderr = ''
        const progressTimer = setInterval(async () => {
            const size = (await fs.stat(temporary).catch(() => null))?.size || 0
            if (expectedBytes > 0) onProgress(Math.min(100, Math.round(size / expectedBytes * 100)))
        }, 500)
        const timeout = setTimeout(() => {
            child.kill()
            reject(new Error('系统下载超过 30 分钟，已停止并保留续传暂存'))
        }, 30 * 60 * 1000)
        const finish = () => {
            clearInterval(progressTimer)
            clearTimeout(timeout)
        }
        child.stderr.on('data', chunk => { stderr += String(chunk) })
        child.on('error', error => { finish(); reject(error) })
        child.on('close', code => {
            finish()
            code === 0 ? resolve() : reject(new Error(stderr.trim() || `curl 下载结束代码 ${code}`))
        })
    })
}

async function downloadFile(url: string, destination: string, expectedBytes: number, expectedSha256: string, onProgress: (percent: number) => void) {
    await fs.mkdir(path.dirname(destination), { recursive: true })
    if (await isVerifiedFile(destination, expectedBytes, expectedSha256)) {
        onProgress(100)
        return
    }
    await fs.rm(destination, { force: true })
    await fs.rm(`${destination}.verified`, { force: true })
    const temporary = `${destination}.download`
    let existingBytes = (await fs.stat(temporary).catch(() => null))?.size || 0
    if (expectedBytes > 0 && existingBytes >= expectedBytes) {
        if (existingBytes === expectedBytes && await sha256File(temporary) === expectedSha256) {
            await fs.rename(temporary, destination)
            await fs.writeFile(`${destination}.verified`, expectedSha256, 'utf8')
            onProgress(100)
            return
        }
        await fs.rm(temporary, { force: true })
        existingBytes = 0
    }

    if (process.platform === 'win32') {
        await downloadWithSystemCurl(url, temporary, expectedBytes, onProgress)
        const finalSize = (await fs.stat(temporary)).size
        if (finalSize !== expectedBytes) throw new Error(`下载档案不完整（${finalSize}/${expectedBytes} bytes）`)
        const actualSha256 = await sha256File(temporary)
        if (actualSha256 !== expectedSha256) {
            await fs.rm(temporary, { force: true })
            throw new Error('下载档案 SHA-256 不符，已丢弃损坏缓存')
        }
        await fs.rename(temporary, destination)
        await fs.writeFile(`${destination}.verified`, expectedSha256, 'utf8')
        onProgress(100)
        return
    }

    const controller = new AbortController()
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null
    const resetInactivityTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer)
        inactivityTimer = setTimeout(() => controller.abort(new Error('下載超過 45 秒沒有收到資料，請重試')), 45000)
    }
    resetInactivityTimer()
    const response = await net.fetch(url, {
        signal: controller.signal,
        headers: existingBytes > 0 ? { Range: `bytes=${existingBytes}-` } : undefined
    })
    if (!response.ok || !response.body) throw new Error(`下載失敗：HTTP ${response.status}`)
    const resumed = response.status === 206
    if (!resumed) existingBytes = 0
    const contentRange = response.headers.get('content-range')
    const rangeTotal = Number(contentRange?.match(/\/(\d+)$/)?.[1] || 0)
    const total = rangeTotal || expectedBytes || Number(response.headers.get('content-length') || 0)
    let received = existingBytes
    const stream = Readable.fromWeb(response.body as never)
    const file = fsSync.createWriteStream(temporary, { flags: resumed ? 'a' : 'w' })
    stream.on('data', (chunk: Buffer) => {
        resetInactivityTimer()
        received += chunk.length
        if (total > 0) onProgress(Math.min(100, Math.round(received / total * 100)))
    })
    try {
        await new Promise<void>((resolve, reject) => {
            stream.on('error', reject)
            file.on('error', reject)
            file.on('finish', resolve)
            stream.pipe(file)
        })
    } finally {
        if (inactivityTimer) clearTimeout(inactivityTimer)
    }
    const finalSize = (await fs.stat(temporary)).size
    if (expectedBytes > 0 && finalSize !== expectedBytes) throw new Error(`下載檔案不完整（${finalSize}/${expectedBytes} bytes）`)
    const actualSha256 = await sha256File(temporary)
    if (actualSha256 !== expectedSha256) {
        await fs.rm(temporary, { force: true })
        throw new Error(`下載檔案 SHA-256 不符，已丟棄損壞快取`)
    }
    await fs.rename(temporary, destination)
    await fs.writeFile(`${destination}.verified`, expectedSha256, 'utf8')
}

async function downloadWithRetries(
    url: string,
    destination: string,
    expectedBytes: number,
    expectedSha256: string,
    onProgress: (percent: number) => void,
    onRetry: (attempt: number, message: string) => void
) {
    let lastError: unknown = null
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await downloadFile(url, destination, expectedBytes, expectedSha256, onProgress)
            return
        } catch (error) {
            lastError = error
            if (attempt >= 3) break
            const message = error instanceof Error ? error.message : String(error)
            onRetry(attempt + 1, message)
            await new Promise(resolve => setTimeout(resolve, 1200 * attempt))
        }
    }
    throw lastError
}

async function findFile(root: string, name: string): Promise<string | null> {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
        const fullPath = path.join(root, entry.name)
        if (entry.isFile() && entry.name.toLocaleLowerCase() === name.toLocaleLowerCase()) return fullPath
        if (entry.isDirectory()) {
            const nested = await findFile(fullPath, name)
            if (nested) return nested
        }
    }
    return null
}

let engineInstall: Promise<string> | null = null
async function ensureEngine(runtimeRoot: string, callback?: (progress: GpuCalibrationProgress) => void): Promise<string> {
    if (engineInstall) return engineInstall
    engineInstall = (async () => {
        const engineRoot = path.join(runtimeRoot, 'engine', ENGINE_VERSION)
        const existing = await findFile(engineRoot, 'whisper-cli.exe')
        if (existing) return existing
        const zipPath = path.join(runtimeRoot, 'downloads', `whisper-cuda-${ENGINE_VERSION}.zip`)
        emit(callback, { stage: 'downloading-engine', percent: 0, message: '首次使用：下載 CUDA 校正引擎' })
        await downloadWithRetries(
            ENGINE_URL,
            zipPath,
            ENGINE_BYTES,
            ENGINE_SHA256,
            percent => emit(callback, { stage: 'downloading-engine', percent, message: `下載 CUDA 校正引擎 ${percent}%` }),
            (attempt, message) => emit(callback, {
                stage: 'downloading-engine', percent: 0, message: `連線中斷，從暫存續傳（第 ${attempt}/3 次）· ${message}`
            })
        )
        emit(callback, { stage: 'installing-engine', percent: 0, message: '正在解壓縮 CUDA 引擎，請稍候' })
        const stagingRoot = `${engineRoot}.installing`
        await fs.rm(stagingRoot, { recursive: true, force: true })
        await fs.mkdir(stagingRoot, { recursive: true })
        await extract(zipPath, { dir: stagingRoot })
        const stagedExecutable = await findFile(stagingRoot, 'whisper-cli.exe')
        if (!stagedExecutable) throw new Error('CUDA 引擎壓縮檔不完整：找不到 whisper-cli.exe')
        await fs.rm(engineRoot, { recursive: true, force: true })
        await fs.rename(stagingRoot, engineRoot)
        await fs.rm(zipPath, { force: true })
        const executable = await findFile(engineRoot, 'whisper-cli.exe')
        if (!executable) throw new Error('CUDA 引擎安裝完成，但找不到 whisper-cli.exe')
        return executable
    })().catch(error => {
        engineInstall = null
        throw error
    })
    return engineInstall
}

async function ensureModel(runtimeRoot: string, mode: GpuCalibrationMode, callback?: (progress: GpuCalibrationProgress) => void) {
    const filename = MODES[mode].model
    const modelPath = path.join(runtimeRoot, 'models', filename)
    if (fsSync.existsSync(modelPath)) return modelPath
    emit(callback, { stage: 'downloading-model', percent: 0, message: `首次使用：下載 ${MODES[mode].label} 模型` })
    await downloadWithRetries(
        `${MODEL_ROOT}/${filename}`,
        modelPath,
        MODES[mode].bytes,
        MODES[mode].sha256,
        percent => emit(callback, { stage: 'downloading-model', percent, message: `下載 ${MODES[mode].label} 模型 ${percent}%` }),
        (attempt, message) => emit(callback, {
            stage: 'downloading-model', percent: 0, message: `模型下載中斷，從暫存續傳（第 ${attempt}/3 次）· ${message}`
        })
    )
    return modelPath
}

function runProcess(executable: string, args: string[], onStderr?: (text: string) => void, timeoutMs = 30 * 60 * 1000): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, args, { windowsHide: true })
        let stderr = ''
        let settled = false
        const finish = (error?: Error) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            error ? reject(error) : resolve()
        }
        const timeout = setTimeout(() => {
            child.kill()
            finish(new Error(`GPU 校正程序超過 ${Math.round(timeoutMs / 60000)} 分鐘，已停止並保留原始歌詞`))
        }, timeoutMs)
        child.stderr.on('data', chunk => {
            const text = String(chunk)
            stderr += text
            onStderr?.(text)
        })
        child.on('error', error => finish(error))
        child.on('close', code => code === 0 ? finish() : finish(new Error(stderr.trim() || `程序結束代碼 ${code}`)))
    })
}

function parseLrc(lyrics: string): { metadata: string[]; lines: ParsedLine[] } {
    const metadata: string[] = []
    const lines: ParsedLine[] = []
    for (const rawLine of lyrics.split(/\r?\n/)) {
        const matches = [...rawLine.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]
        const text = rawLine.replace(/\[(\d+):(\d+(?:\.\d+)?)\]/g, '').trim()
        if (!matches.length) {
            if (rawLine.trim()) metadata.push(rawLine.trim())
            continue
        }
        for (const match of matches) {
            lines.push({ time: Number(match[1]) * 60 + Number(match[2]), text, originalIndex: lines.length })
        }
    }
    return { metadata, lines }
}

function normalize(value: string): string[] {
    return Array.from(toSimplified(value).toLocaleLowerCase())
        .filter(char => /[\p{L}\p{N}]/u.test(char))
        .map(char => /\p{Script=Han}/u.test(char)
            ? `zh:${pinyin(char, { toneType: 'none', type: 'string', traditional: true })}`
            : `raw:${char}`)
}

function timeFromToken(token: any, fallbackStart: number, fallbackEnd: number) {
    const from = Number(token?.offsets?.from)
    const to = Number(token?.offsets?.to)
    return {
        start: Number.isFinite(from) ? from / 1000 : fallbackStart,
        end: Number.isFinite(to) ? to / 1000 : fallbackEnd
    }
}

function transcriptCharacters(json: any): TimedChar[] {
    const result: TimedChar[] = []
    const segments = Array.isArray(json?.transcription) ? json.transcription : []
    for (const segment of segments) {
        const segmentStart = Number(segment?.offsets?.from || 0) / 1000
        const segmentEnd = Number(segment?.offsets?.to || 0) / 1000
        const tokens = Array.isArray(segment?.tokens) && segment.tokens.length
            ? segment.tokens
            : [{ text: segment?.text || '', offsets: { from: segmentStart * 1000, to: segmentEnd * 1000 } }]
        for (const token of tokens) {
            const chars = normalize(String(token?.text || ''))
            if (!chars.length) continue
            const timing = timeFromToken(token, segmentStart, segmentEnd)
            chars.forEach((char, index) => result.push({
                char,
                time: timing.start + (timing.end - timing.start) * index / Math.max(1, chars.length)
            }))
        }
    }
    return result
}

function alignLyrics(lines: ParsedLine[], transcript: TimedChar[]) {
    const source: Array<{ char: string; line: number; position: number }> = []
    lines.forEach((line, lineIndex) => normalize(line.text).forEach((char, position) => source.push({ char, line: lineIndex, position })))
    if (!source.length || !transcript.length) throw new Error('歌詞或辨識結果沒有可對齊的文字')

    const columns = transcript.length + 1
    const dp = new Uint16Array((source.length + 1) * columns)
    for (let i = 1; i <= source.length; i++) {
        const row = i * columns
        const previous = (i - 1) * columns
        for (let j = 1; j <= transcript.length; j++) {
            dp[row + j] = source[i - 1].char === transcript[j - 1].char
                ? dp[previous + j - 1] + 1
                : Math.max(dp[previous + j], dp[row + j - 1])
        }
    }

    const matchedByLine = new Map<number, Array<{ time: number; position: number }>>()
    let i = source.length
    let j = transcript.length
    let matches = 0
    while (i > 0 && j > 0) {
        if (source[i - 1].char === transcript[j - 1].char) {
            const list = matchedByLine.get(source[i - 1].line) || []
            list.push({ time: transcript[j - 1].time, position: source[i - 1].position })
            matchedByLine.set(source[i - 1].line, list)
            matches++
            i--; j--
        } else if (dp[(i - 1) * columns + j] >= dp[i * columns + j - 1]) {
            i--
        } else {
            j--
        }
    }

    const anchors = lines.map((line, lineIndex) => {
        const points = (matchedByLine.get(lineIndex) || []).sort((a, b) => a.position - b.position)
        const charCount = Math.max(1, normalize(line.text).length)
        const coverage = points.length / charCount
        if (coverage < 0.24 || points.length < 2) return null

        // Whisper may miss the first one or two sung characters. Estimate the
        // line intercept from all matched characters instead of using the first
        // accidental match as the line start.
        const meanX = points.reduce((sum, point) => sum + point.position, 0) / points.length
        const meanY = points.reduce((sum, point) => sum + point.time, 0) / points.length
        let numerator = 0
        let denominator = 0
        for (const point of points) {
            numerator += (point.position - meanX) * (point.time - meanY)
            denominator += (point.position - meanX) ** 2
        }
        const secondsPerCharacter = Math.max(0.04, Math.min(0.85, denominator > 0 ? numerator / denominator : 0.22))
        const estimatedStart = meanY - secondsPerCharacter * meanX
        const earliest = Math.min(...points.map(point => point.time))
        const time = Math.max(0, Math.min(earliest, Math.max(earliest - 1.2, estimatedStart)))
        return { line: lineIndex, time, coverage }
    })
    const validAnchors = anchors.filter((value): value is NonNullable<typeof value> => value !== null)
    const calibrated = lines.map((line, lineIndex) => {
        const direct = anchors[lineIndex]
        if (direct) return direct.time
        const before = [...validAnchors].reverse().find(anchor => anchor.line < lineIndex)
        const after = validAnchors.find(anchor => anchor.line > lineIndex)
        if (before && after) {
            const sourceRange = lines[after.line].time - lines[before.line].time
            const ratio = sourceRange > 0 ? (line.time - lines[before.line].time) / sourceRange : 0
            return before.time + (after.time - before.time) * ratio
        }
        if (before) return before.time + (line.time - lines[before.line].time)
        if (after) return Math.max(0, after.time - (lines[after.line].time - line.time))
        return line.time
    })
    const characterScore = matches / Math.max(1, source.length)
    const lineScore = validAnchors.length / Math.max(1, lines.length)
    const coverageScore = validAnchors.length
        ? validAnchors.reduce((sum, anchor) => sum + anchor.coverage, 0) / validAnchors.length
        : 0
    const stabilized = stabilizeInterludeGaps(lines, calibrated)
    return {
        times: stabilized.times,
        confidence: Math.min(0.98, characterScore * 0.5 + lineScore * 0.32 + coverageScore * 0.18),
        anchors: validAnchors.length,
        protectedGaps: stabilized.protectedGaps
    }
}

function formatTimestamp(time: number) {
    const safe = Math.max(0, time)
    const minutes = Math.floor(safe / 60)
    const seconds = safe - minutes * 60
    return `[${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}]`
}

function buildLrc(metadata: string[], lines: ParsedLine[], times: number[], confidence: number, mode: GpuCalibrationMode, runs: number) {
    const safeMetadata = metadata.filter(line => !/^\[nw-(gpu|calibration)/i.test(line))
    const header = [
        ...safeMetadata,
        `[nw-gpu-mode:${mode}]`,
        `[nw-calibration-confidence:${confidence.toFixed(4)}]`,
        `[nw-calibration-runs:${runs}]`
    ]
    return [...header, ...lines.map((line, index) => `${formatTimestamp(times[index])} ${line.text}`)].join('\n')
}

async function readHistory(historyPath: string): Promise<CalibrationHistory | null> {
    try { return JSON.parse(await fs.readFile(historyPath, 'utf8')) as CalibrationHistory } catch { return null }
}

export async function getGpuCalibrationStatus(runtimeRoot: string) {
    const executable = await findFile(path.join(runtimeRoot, 'engine', ENGINE_VERSION), 'whisper-cli.exe')
    const models = Object.fromEntries(await Promise.all(Object.entries(MODES).map(async ([mode, config]) => [
        mode, fsSync.existsSync(path.join(runtimeRoot, 'models', config.model))
    ])))
    return { engineReady: !!executable, models, engineVersion: ENGINE_VERSION }
}

export async function runGpuLyricsCalibration(options: {
    audioPath: string
    rawLyrics?: string
    mode: GpuCalibrationMode
    force?: boolean
    runtimeRoot: string
    ffmpegPath: string
    computeConfig?: CalibrationComputeConfig
    onProgress?: (progress: GpuCalibrationProgress) => void
}): Promise<GpuCalibrationResult> {
    const { audioPath, mode, force = false, runtimeRoot, ffmpegPath, onProgress } = options
    const config = MODES[mode]
    if (!config) return { ok: false, error: '未知的 GPU 校正模式' }
    const sidecars = sidecarPaths(audioPath)
    try {
        emit(onProgress, { stage: 'checking', percent: 0, message: '檢查 GPU 引擎與校正紀錄' })
        const history = await readHistory(sidecars.history)
        if (!force && history && MODES[history.mode]?.rank >= config.rank && fsSync.existsSync(sidecars.calibrated)) {
            return {
                ok: true,
                lyrics: await fs.readFile(sidecars.calibrated, 'utf8'),
                confidence: history.bestConfidence,
                savedPath: sidecars.calibrated,
                historyPath: sidecars.history,
                runs: history.runs,
                cached: true
            }
        }

        const sourceLyrics = options.rawLyrics || await fs.readFile(sidecars.source, 'utf8')
        const parsed = parseLrc(sourceLyrics)
        if (parsed.lines.length < 3) throw new Error('同步歌詞行數不足，無法執行語音對齊')

        const enginePath = await ensureEngine(runtimeRoot, onProgress)
        const modelPath = await ensureModel(runtimeRoot, mode, onProgress)
        const jobRoot = path.join(runtimeRoot, 'jobs', `${Date.now()}-${Math.random().toString(16).slice(2)}`)
        await fs.mkdir(jobRoot, { recursive: true })
        const wavPath = path.join(jobRoot, 'audio.wav')
        const outputBase = path.join(jobRoot, 'transcription')
        try {
            emit(onProgress, { stage: 'preparing', percent: 0, message: '轉換 16kHz 人聲分析音訊' })
            await runProcess(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', audioPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wavPath], undefined, 10 * 60 * 1000)

            const prompt = parsed.lines.map(line => line.text).join('，').slice(0, 1600)
            emit(onProgress, { stage: 'transcribing', percent: 0, message: `${config.label} 正在辨識歌聲` })
            const requestedCompute = options.computeConfig || { backend: 'auto', gpuDevices: [0], cpuThreads: 8, cpuProcessors: 1 }
            const compute = {
                backend: requestedCompute.backend,
                gpuDevices: requestedCompute.gpuDevices?.length ? requestedCompute.gpuDevices : [0],
                cpuThreads: Math.max(1, Math.min(128, requestedCompute.cpuThreads || 8)),
                cpuProcessors: Math.max(1, Math.min(8, requestedCompute.cpuProcessors || 1))
            }
            const passDevices: Array<number | null> = compute.backend === 'cpu'
                ? [null]
                : compute.backend === 'multi-gpu' ? compute.gpuDevices : [compute.gpuDevices[0] ?? 0]
            const passProgress = new Array(passDevices.length).fill(0)
            const passOutputs = passDevices.map((_, passIndex) => `${outputBase}-${passIndex}`)

            await Promise.all(passDevices.map(async (device, passIndex) => {
                const hardwareArgs = device === null
                    ? ['-ng']
                    : ['-dev', String(device), '-fa']
                await runProcess(enginePath, [
                    '-m', modelPath, '-f', wavPath, '-l', 'auto', '-ojf', '-of', passOutputs[passIndex],
                    '-bs', String(config.beam), '-t', String(compute.cpuThreads), '-p', String(compute.cpuProcessors),
                    '-sow', '-sns', '--prompt', prompt, '-pp', ...hardwareArgs
                ], text => {
                    const match = text.match(/progress\s*=\s*(\d+)%/)
                    if (!match) return
                    passProgress[passIndex] = Number(match[1])
                    const percent = Math.round(passProgress.reduce((sum, value) => sum + value, 0) / passProgress.length)
                    const deviceLabel = device === null
                        ? 'CPU'
                        : compute.backend === 'hybrid' ? `CPU + GPU ${device}` : `GPU ${device}`
                    emit(onProgress, {
                        stage: 'transcribing', percent,
                        message: passDevices.length > 1
                            ? `${config.label} 多 GPU 共識 ${percent}% · ${deviceLabel}`
                            : `${config.label} ${deviceLabel} 辨識中 ${percent}%`
                    })
                })
            }))

            emit(onProgress, { stage: 'aligning', percent: 0, message: '比對辨識文字與原始歌詞時間軸' })
            const alignments = await Promise.all(passOutputs.map(async passOutput => {
                const transcript = JSON.parse(await fs.readFile(`${passOutput}.json`, 'utf8'))
                return alignLyrics(parsed.lines, transcriptCharacters(transcript))
            }))
            const aligned = alignments.length === 1 ? alignments[0] : {
                times: parsed.lines.map((_, lineIndex) => {
                    const values = alignments.map(alignment => alignment.times[lineIndex]).sort((a, b) => a - b)
                    const middle = Math.floor(values.length / 2)
                    return values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle]
                }),
                confidence: Math.min(0.98,
                    alignments.reduce((sum, alignment) => sum + alignment.confidence, 0) / alignments.length + 0.035
                ),
                anchors: Math.round(alignments.reduce((sum, alignment) => sum + alignment.anchors, 0) / alignments.length),
                protectedGaps: Math.max(...alignments.map(alignment => alignment.protectedGaps))
            }
            if (aligned.confidence < 0.32) throw new Error(`語音與歌詞相似度過低（${Math.round(aligned.confidence * 100)}%），已取消寫入`)
            if (history && aligned.confidence < history.bestConfidence * 0.72 && fsSync.existsSync(sidecars.calibrated)) {
                emit(onProgress, {
                    stage: 'complete',
                    percent: 100,
                    message: `本次可信度較低，保留既有校正版 ${Math.round(history.bestConfidence * 100)}%`
                })
                return {
                    ok: true,
                    lyrics: await fs.readFile(sidecars.calibrated, 'utf8'),
                    confidence: history.bestConfidence,
                    savedPath: sidecars.calibrated,
                    historyPath: sidecars.history,
                    runs: history.runs,
                    cached: true
                }
            }

            const runs = (history?.runs || 0) + 1
            let times = aligned.times
            if (history?.anchors?.length === parsed.lines.length && aligned.confidence >= history.bestConfidence * 0.72) {
                const upgradedModel = config.rank > (MODES[history.mode]?.rank || 0)
                times = aligned.times.map((time, index) => {
                    const previous = history.anchors[index]
                    const previousWeight = upgradedModel ? 1 : Math.min(4, previous?.samples || 0)
                    return previous ? (previous.time * previousWeight + time) / (previousWeight + 1) : time
                })
            }
            const confidence = Math.max(history?.bestConfidence || 0, aligned.confidence)
            const calibratedLrc = buildLrc(parsed.metadata, parsed.lines, times, confidence, mode, runs)
            const nextHistory: CalibrationHistory = {
                version: 1,
                runs,
                bestConfidence: confidence,
                mode: MODES[history?.mode || mode]?.rank > config.rank ? history!.mode : mode,
                updatedAt: new Date().toISOString(),
                anchors: times.map((time, line) => ({
                    line,
                    time,
                    samples: Math.min(5, (history?.anchors?.[line]?.samples || 0) + 1)
                }))
            }

            emit(onProgress, { stage: 'saving', percent: 0, message: '寫入獨立校正版與學習紀錄' })
            await fs.writeFile(sidecars.calibrated, calibratedLrc, 'utf8')
            await fs.writeFile(sidecars.history, JSON.stringify(nextHistory, null, 2), 'utf8')
            const gapMessage = aligned.protectedGaps > 0 ? ` · 保護 ${aligned.protectedGaps} 段間奏` : ''
            emit(onProgress, { stage: 'complete', percent: 100, message: `校正完成 · 可信度 ${Math.round(confidence * 100)}% · 第 ${runs} 次學習${gapMessage}` })
            return {
                ok: true,
                lyrics: calibratedLrc,
                confidence,
                savedPath: sidecars.calibrated,
                historyPath: sidecars.history,
                runs,
                cached: false
            }
        } finally {
            await fs.rm(jobRoot, { recursive: true, force: true }).catch(() => undefined)
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        emit(onProgress, { stage: 'error', percent: 0, message })
        if (fsSync.existsSync(sidecars.calibrated)) {
            const history = await readHistory(sidecars.history)
            return {
                ok: true,
                lyrics: await fs.readFile(sidecars.calibrated, 'utf8'),
                confidence: history?.bestConfidence,
                savedPath: sidecars.calibrated,
                historyPath: sidecars.history,
                runs: history?.runs,
                cached: true,
                error: message
            }
        }
        return { ok: false, error: message }
    }
}
