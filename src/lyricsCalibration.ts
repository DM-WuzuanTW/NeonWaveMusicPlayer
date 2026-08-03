export type CalibrationPrecision = 'conservative' | 'balanced' | 'aggressive'
export type CalibrationAnchor = 'start' | 'middle' | 'end'

export interface TrackCalibration {
    offsetMs: number
    ratePercent: number
    anchor: CalibrationAnchor
}

export type CalibrationBackend = 'auto' | 'hybrid' | 'cuda' | 'cpu' | 'multi-gpu'
export interface CalibrationComputeConfig {
    backend: CalibrationBackend
    gpuDevices: number[]
    cpuThreads: number
    cpuProcessors: number
}

export const DEFAULT_TRACK_CALIBRATION: TrackCalibration = {
    offsetMs: 0,
    ratePercent: 100,
    anchor: 'start'
}

export const DEFAULT_COMPUTE_CONFIG: CalibrationComputeConfig = {
    backend: 'auto',
    gpuDevices: [0],
    cpuThreads: Math.max(2, Math.min(8, navigator.hardwareConcurrency || 4)),
    cpuProcessors: 1
}

export function getCalibrationComputeConfig(): CalibrationComputeConfig {
    try {
        const stored = JSON.parse(localStorage.getItem('neonwave_lyrics_compute_config') || '{}') as Partial<CalibrationComputeConfig>
        const backend = stored.backend === 'hybrid' || stored.backend === 'cuda' || stored.backend === 'cpu' || stored.backend === 'multi-gpu'
            ? stored.backend : 'auto'
        const gpuDevices = Array.isArray(stored.gpuDevices)
            ? [...new Set(stored.gpuDevices.map(Number).filter(Number.isInteger))]
            : [0]
        return {
            backend,
            gpuDevices: gpuDevices.length ? gpuDevices : [0],
            cpuThreads: Math.max(1, Math.min(128, Number(stored.cpuThreads) || DEFAULT_COMPUTE_CONFIG.cpuThreads)),
            cpuProcessors: Math.max(1, Math.min(8, Number(stored.cpuProcessors) || 1))
        }
    } catch {
        return { ...DEFAULT_COMPUTE_CONFIG }
    }
}

export function saveCalibrationComputeConfig(config: CalibrationComputeConfig) {
    localStorage.setItem('neonwave_lyrics_compute_config', JSON.stringify(config))
}

const trackKey = (path: string) => `neonwave_lyrics_track_calibration:${path.trim().toLocaleLowerCase()}`

export function getCalibrationPrecision(): CalibrationPrecision {
    const value = localStorage.getItem('neonwave_lyrics_calibration_precision')
    return value === 'conservative' || value === 'aggressive' ? value : 'balanced'
}

export function getTrackCalibration(path?: string): TrackCalibration {
    if (!path) return { ...DEFAULT_TRACK_CALIBRATION }
    try {
        const stored = JSON.parse(localStorage.getItem(trackKey(path)) || '{}') as Partial<TrackCalibration>
        const offsetMs = Number(stored.offsetMs)
        const ratePercent = Number(stored.ratePercent)
        const anchor = stored.anchor === 'middle' || stored.anchor === 'end' ? stored.anchor : 'start'
        return {
            offsetMs: Number.isFinite(offsetMs) ? Math.max(-10000, Math.min(10000, offsetMs)) : 0,
            ratePercent: Number.isFinite(ratePercent) ? Math.max(85, Math.min(115, ratePercent)) : 100,
            anchor
        }
    } catch {
        return { ...DEFAULT_TRACK_CALIBRATION }
    }
}

export function saveTrackCalibration(path: string, calibration: TrackCalibration) {
    if (!path) return
    localStorage.setItem(trackKey(path), JSON.stringify(calibration))
}

export function isTrackCalibrationChanged(calibration: TrackCalibration) {
    return Math.abs(calibration.offsetMs) >= 1 || Math.abs(calibration.ratePercent - 100) >= 0.001
}
