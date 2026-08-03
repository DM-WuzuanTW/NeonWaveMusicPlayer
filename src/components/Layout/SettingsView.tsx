import { useState, useEffect, useRef } from 'react'
import { RefreshCw, Download, CheckCircle, AlertCircle, Globe, Palette, Check, Bot, Languages, Info, Users, Captions, AudioLines } from 'lucide-react'
import { ListeningPartyPanel } from '../Party/ListeningPartyPanel'
import { applyTheme, getStoredTheme, THEMES, type AppTheme } from '../../theme'
import {
    DEFAULT_TRACK_CALIBRATION, getCalibrationComputeConfig, getCalibrationPrecision, getTrackCalibration,
    saveCalibrationComputeConfig, saveTrackCalibration, type CalibrationAnchor, type CalibrationComputeConfig,
    type CalibrationPrecision, type TrackCalibration
} from '../../lyricsCalibration'

const ScanProgress = () => {
    const [scanData, setScanData] = useState<{ current: number, total: number, success: number } | null>(null);

    useEffect(() => {
        const remove = (window as any).ipcRenderer.on('discord:scanProgress', (_: any, data: any) => {
            setScanData(data);
            if (data.current === data.total) {
                setTimeout(() => setScanData(null), 5000);
            }
        });
        return () => { if (remove) remove(); };
    }, []);

    if (!scanData) return null;

    const percentage = Math.round((scanData.current / scanData.total) * 100);

    return (
        <div style={{ marginTop: '16px', padding: '15px', background: 'rgba(0,0,0,0.2)', borderRadius: '10px', border: '1px solid var(--glass-border)' }}>
            <div style={{ fontSize: '14px', marginBottom: '8px', color: 'var(--text-main)', display: 'flex', justifyContent: 'space-between' }}>
                <span>正在預載封面圖...</span>
                <span>{scanData.current} / {scanData.total} ({percentage}%)</span>
            </div>
            <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${percentage}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.3s ease' }}></div>
            </div>
            <div style={{ fontSize: '12px', marginTop: '8px', color: '#4ade80' }}>
                成功取得封面: {scanData.success}
            </div>
        </div>
    );
};

type UpdateInvokeResult = {
    ok: boolean
    error?: string
}

type UpdateStatusPayload = {
    status: string
    error?: string
    progress?: {
        percent?: number
    }
}

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
            })
        ])
    } finally {
        if (timeoutId) clearTimeout(timeoutId)
    }
}

export function useUpdater() {
    const [status, setStatus] = useState<string>('idle')
    const [progress, setProgress] = useState<UpdateStatusPayload['progress'] | null>(null)
    const [version, setVersion] = useState<string>('...')
    const [error, setError] = useState<string>('')

    useEffect(() => {
        window.ipcRenderer.getAppVersion().then(setVersion)

        const cleanup = window.ipcRenderer.onUpdateStatus((data: UpdateStatusPayload) => {
            console.log('Update Status:', data)
            setStatus(data.status)
            if (data.status === 'checking' || data.status === 'available') {
                setError('')
            }
            if (data.status === 'downloading') {
                setError('')
                setProgress(data.progress || null)
            }
            if (data.status === 'downloaded' || data.status === 'not-available') {
                setProgress(null)
            }
            if (data.status === 'error') {
                setProgress(null)
                setError(data.error || '更新檢查失敗')
            }
        })

        return cleanup
    }, [])

    const checkForUpdates = async () => {
        setStatus('checking')
        setError('')
        setProgress(null)
        try {
            const result = await withTimeout<UpdateInvokeResult>(
                window.ipcRenderer.checkUpdate(),
                45000,
                '檢查更新逾時，請確認網路連線後重試。'
            )
            if (result && result.ok === false) {
                setStatus('error')
                setError(result.error || '檢查更新失敗')
            }
        } catch (e) {
            setStatus('error')
            setError(e instanceof Error ? e.message : '檢查更新失敗')
        }
    }

    const installUpdate = async () => {
        setStatus('installing')
        setError('')
        try {
            const result = await withTimeout<UpdateInvokeResult>(
                window.ipcRenderer.installUpdate(),
                10000,
                '啟動更新安裝逾時，請重新開啟程式後再試。'
            )
            if (result && result.ok === false) {
                setStatus('error')
                setError(result.error || '安裝更新失敗')
            }
        } catch (e) {
            setStatus('error')
            setError(e instanceof Error ? e.message : '安裝更新失敗')
        }
    }

    return { status, progress, version, error, checkForUpdates, installUpdate }
}

interface CustomSelectOption {
    value: string
    label: string
    icon: React.ReactNode
}

const OpenAIIcon = ({ size = 16, color = '#10a37f' }: { size?: number; color?: string }) => (
    <svg fill={color} fillRule="evenodd" height={size} width={size} viewBox="0 0 24 24" style={{ flex: 'none' }} xmlns="http://www.w3.org/2000/svg">
        <path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" />
    </svg>
)

const OpenRouterIcon = ({ size = 16, color = '#a855f7' }: { size?: number; color?: string }) => (
    <svg fill={color} fillRule="evenodd" height={size} width={size} viewBox="0 0 24 24" style={{ flex: 'none' }} xmlns="http://www.w3.org/2000/svg">
        <path d="M16.804 1.957l7.22 4.105v.087L16.73 10.21l.017-2.117-.821-.03c-1.059-.028-1.611.002-2.268.11-1.064.175-2.038.577-3.147 1.352L8.345 11.03c-.284.195-.495.336-.68.455l-.515.322-.397.234.385.23.53.338c.476.314 1.17.796 2.701 1.866 1.11.775 2.083 1.177 3.147 1.352l.3.045c.694.091 1.375.094 2.825.033l.022-2.159 7.22 4.105v.087L16.589 22l.014-1.862-.635.022c-1.386.042-2.137.002-3.138-.162-1.694-.28-3.26-.926-4.881-2.059l-2.158-1.5a21.997 21.997 0 00-.755-.498l-.467-.28a55.927 55.927 0 00-.76-.43C2.908 14.73.563 14.116 0 14.116V9.888l.14.004c.564-.007 2.91-.622 3.809-1.124l1.016-.58.438-.274c.428-.28 1.072-.726 2.686-1.853 1.621-1.133 3.186-1.78 4.881-2.059 1.152-.19 1.974-.213 3.814-.138l.02-1.907z" />
    </svg>
)

const OllamaIcon = ({ size = 16, color = '#eab308' }: { size?: number; color?: string }) => (
    <svg fill={color} fillRule="evenodd" height={size} width={size} viewBox="0 0 24 24" style={{ flex: 'none' }} xmlns="http://www.w3.org/2000/svg">
        <path d="M7.905 1.09c.216.085.411.225.588.41.295.306.544.744.734 1.263.191.522.315 1.1.362 1.68a5.054 5.054 0 012.049-.636l.051-.004c.87-.07 1.73.087 2.48.474.101.053.2.11.297.17.05-.569.172-1.134.36-1.644.19-.52.439-.957.733-1.264a1.67 1.67 0 01.589-.41.257-.1.53-.118.796-.042.401.114.745.368 1.016.737.248.337.434.769.561 1.287.23.934.27 2.163.115 3.645l.053.04.026.019c.757.576 1.284 1.397 1.563 2.35.435 1.487.216 3.155-.534 4.088l-.018.021.002.003c.417.762.67 1.567.724 2.4l.002.03c.064 1.065-.2 2.137-.814 3.19l-.007.01.01.024c.472 1.157.62 2.322.438 3.486l-.006.039a.651.651 0 01-.747.536.648.648 0 01-.54-.742c.167-1.033.01-2.069-.48-3.123a.643.643 0 01.04-.617l.004-.006c.604-.924.854-1.83.8-2.72-.046-.779-.325-1.544-.8-2.273a.644.644 0 01.18-.886l.009-.006c.243-.159.467-.565.58-1.12a4.229 4.229 0 00-.095-1.974c-.205-.7-.58-1.284-1.105-1.683-.595-.454-1.383-.673-2.38-.61a.653.653 0 01-.632-.371c-.314-.665-.772-1.141-1.343-1.436a3.288 3.288 0 00-1.772-.332c-1.245.099-2.343.801-2.67 1.686a.652.652 0 01-.61.425c-1.067.002-1.893.252-2.497.703-.522.39-.878.935-1.066 1.588a4.07 4.07 0 00-.068 1.886c.112.558.331 1.02.582 1.269l.008.007c.212.207.257.53.109.785-.36.622-.629 1.549-.673 2.44-.05 1.018.186 1.902.719 2.536l.016.019a.643.643 0 01.095.69c-.576 1.236-.753 2.252-.562 3.052a.652.652 0 01-1.269.298c-.243-1.018-.078-2.184.473-3.498l.014-.035-.008-.012a4.339 4.339 0 01-.598-1.309l-.005-.019a5.764 5.764 0 01-.177-1.785c.044-.91.278-1.842.622-2.59l.012-.026-.002-.002c-.293-.418-.51-.953-.63-1.545l-.005-.024a5.352 5.352 0 01.093-2.49c.262-.915.777-1.701 1.536-2.269.06-.045.123-.09.186-.132-.159-1.493-.119-2.73.112-3.67.127-.518.314-.95.562-1.287.27-.368.614-.622 1.015-.737.266-.076.54-.059.797.042zm4.116 9.09c.936 0 1.8.313 2.446.855.63.527 1.005 1.235 1.005 1.94 0 .888-.406 1.58-1.133 2.022-.62.375-1.451.557-2.403.557-1.009 0-1.871-.259-2.493-.734-.617-.47-.963-1.13-.963-1.845 0-.707.398-1.417 1.056-1.946.668-.537 1.55-.849 2.485-.849zm0 .896a3.07 3.07 0 00-1.916.65c-.461.37-.722.835-.722 1.25 0 .428.21.829.61 1.134.455.347 1.124.548 1.943.548.799 0 1.473-.147 1.932-.426.463-.28.7-.686.7-1.257 0-.423-.246-.89-.683-1.256-.484-.405-1.14-.643-1.864-.643zm.662 1.21l.004.004c.12.151.095.37-.056.49l-.292.23v.446a.375.375 0 01-.376.373.375.375 0 01-.376-.373v-.46l-.271-.218a.347.347 0 01-.052-.49.353.353 0 01.494-.051l.215.172.22-.174a.353.353 0 01.49.051zm-5.04-1.919c.478 0 .867.39.867.871a.87.87 0 01-.868.871.87.87 0 01-.867-.87.87.87 0 01.867-.872zm8.706 0c.48 0 .868.39.868.871a.87.87 0 01-.868.871.87.87 0 01-.867-.87.87.87 0 01.867-.872zM7.44 2.3l-.003.002a.659.659 0 00-.285.238l-.005.006c-.138.189-.258.467-.348.832-.17.692-.216 1.631-.124 2.782.43-.128.899-.208 1.404-.237l.01-.001.019-.034c.046-.082.095-.161.148-.239.123-.771.022-1.692-.253-2.444-.134-.364-.297-.65-.453-.813a.628.628 0 00-.107-.09L7.44 2.3zm9.174.04l-.002.001a.628.628 0 00-.107.09c-.156.163-.32.45-.453.814-.29.794-.387 1.776-.23 2.572l.058.097.008.014h.03a5.184 5.184 0 011.466.212c.086-1.124.038-2.043-.128-2.722-.09-.365-.21-.643-.349-.832l-.004-.006a.659.659 0 00-.285-.239h-.004z" />
    </svg>
)

const OpenWebUIIcon = ({ size = 16, color = '#3b82f6' }: { size?: number; color?: string }) => (
    <svg fill={color} fillRule="evenodd" height={size} width={size} viewBox="0 0 24 24" style={{ flex: 'none' }} xmlns="http://www.w3.org/2000/svg">
        <path clipRule="evenodd" d="M17.697 12c0 4.97-3.962 9-8.849 9C3.962 21 0 16.97 0 12s3.962-9 8.848-9c4.887 0 8.849 4.03 8.849 9zm-3.636 0c0 2.928-2.334 5.301-5.213 5.301-2.878 0-5.212-2.373-5.212-5.301S5.97 6.699 8.848 6.699c2.88 0 5.213 2.373 5.213 5.301z" />
        <path d="M24 3h-3.394v18H24V3z" />
    </svg>
)

const GeminiIcon = ({ size = 16, color = '#3b82f6' }: { size?: number; color?: string }) => (
    <svg fill={color} fillRule="evenodd" height={size} width={size} viewBox="0 0 24 24" style={{ flex: 'none' }} xmlns="http://www.w3.org/2000/svg">
        <path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" />
    </svg>
)

const ClaudeIcon = ({ size = 16, color = '#f97316' }: { size?: number; color?: string }) => (
    <svg fill={color} fillRule="evenodd" height={size} width={size} viewBox="0 0 24 24" style={{ flex: 'none' }} xmlns="http://www.w3.org/2000/svg">
        <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" />
    </svg>
)

const CustomSelect = ({ value, onChange, options }: {
    value: string
    onChange: (val: string) => void
    options: CustomSelectOption[]
}) => {
    const [isOpen, setIsOpen] = useState(false)
    const selected = options.find(o => o.value === value) || options[0]

    return (
        <div style={{ position: 'relative', width: '240px', zIndex: 10 }}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="settings-select"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    textAlign: 'left',
                    backgroundPosition: 'right 12px center',
                    backgroundImage: 'none',
                    paddingRight: '36px'
                }}
            >
                {selected.icon}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.label}</span>
                <span style={{ fontSize: '10px', opacity: 0.5 }}>{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
                <>
                    <div
                        onClick={() => setIsOpen(false)}
                        style={{ position: 'fixed', inset: 0, zIndex: 999 }}
                    />
                    <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        marginTop: '6px',
                        background: '#18181c',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: '10px',
                        overflow: 'hidden',
                        boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
                        zIndex: 1000
                    }}>
                        {options.map(o => (
                            <button
                                key={o.value}
                                type="button"
                                onClick={() => {
                                    onChange(o.value)
                                    setIsOpen(false)
                                }}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    width: '100%',
                                    padding: '10px 16px',
                                    border: 'none',
                                    background: o.value === value ? 'var(--accent, #8b5cf6)' : 'transparent',
                                    color: '#fff',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    transition: 'all 0.15s ease',
                                    outline: 'none'
                                }}
                                onMouseOver={(e) => {
                                    if (o.value !== value) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                                }}
                                onMouseOut={(e) => {
                                    if (o.value !== value) e.currentTarget.style.background = 'transparent'
                                }}
                            >
                                {o.icon}
                                <span>{o.label}</span>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    )
}

interface SettingsViewProps {
    currentTrack?: { path: string; title: string } | null
}

export function SettingsView({ currentTrack }: SettingsViewProps) {
    const { status, progress, version, error, checkForUpdates, installUpdate } = useUpdater()

    const [lyricsProvider, setLyricsProvider] = useState(() => localStorage.getItem('neonwave_lyrics_ai_provider') || 'default')
    const [lyricsKey, setLyricsKey] = useState(() => localStorage.getItem('neonwave_lyrics_ai_key') || '')
    const [lyricsEndpoint, setLyricsEndpoint] = useState(() => localStorage.getItem('neonwave_lyrics_ai_endpoint') || '')
    const [lyricsModel, setLyricsModel] = useState(() => localStorage.getItem('neonwave_lyrics_ai_model') || '')
    const [lyricsMode, setLyricsMode] = useState(() => localStorage.getItem('neonwave_lyrics_ai_mode') || 'filename')
    const [lyricsReasoning, setLyricsReasoning] = useState(() => localStorage.getItem('neonwave_lyrics_ai_reasoning') || 'none')
    const [saveSuccess, setSaveSuccess] = useState(false)
    const [theme, setTheme] = useState<AppTheme>(getStoredTheme)
    const [activeCategory, setActiveCategory] = useState<'appearance' | 'presentation' | 'calibration' | 'lyrics' | 'connections' | 'downloads' | 'community' | 'about'>('appearance')
    const [lyricsPresentation, setLyricsPresentation] = useState(() => localStorage.getItem('neonwave_lyrics_presentation') || 'danmaku')
    const [calibrationEnabled, setCalibrationEnabled] = useState(() => localStorage.getItem('neonwave_lyrics_calibration_enabled') === 'true')
    const [calibrationMode, setCalibrationMode] = useState(() => localStorage.getItem('neonwave_lyrics_calibration_mode') || 'adaptive')
    const [calibrationPrecision, setCalibrationPrecision] = useState<CalibrationPrecision>(getCalibrationPrecision)
    const [trackCalibration, setTrackCalibration] = useState<TrackCalibration>(() => getTrackCalibration(currentTrack?.path))
    const calibrationDispatchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [gpuStatus, setGpuStatus] = useState<{ engineReady: boolean; models: Record<string, boolean>; engineVersion: string; gpuName: string } | null>(null)
    const [gpuProgress, setGpuProgress] = useState<{ stage: string; percent: number; message: string } | null>(null)
    const [gpuBusy, setGpuBusy] = useState(false)
    const [gpuResult, setGpuResult] = useState<string>('')
    const [computeDevices, setComputeDevices] = useState<{ gpus: Array<{ index: number; name: string; memoryMb: number }>; cpu: { name: string; logicalThreads: number; totalMemoryMb: number } } | null>(null)
    const [computeConfig, setComputeConfig] = useState<CalibrationComputeConfig>(getCalibrationComputeConfig)

    useEffect(() => {
        setTrackCalibration(getTrackCalibration(currentTrack?.path))
    }, [currentTrack?.path])

    useEffect(() => () => {
        if (calibrationDispatchTimer.current) clearTimeout(calibrationDispatchTimer.current)
    }, [])

    useEffect(() => {
        window.ipcRenderer.getGpuLyricsStatus().then(setGpuStatus).catch(() => setGpuStatus(null))
        window.ipcRenderer.getLyricsComputeDevices().then(setComputeDevices).catch(() => setComputeDevices(null))
        return window.ipcRenderer.onGpuLyricsProgress(progress => setGpuProgress(progress))
    }, [])

    const categoryCopy = {
        appearance: ['外觀與介面', '主題與迷你播放器顯示方式'],
        presentation: ['歌詞呈現', '決定同步歌詞如何出現在播放畫面'],
        calibration: ['歌詞校正', '針對翻唱、現場版與不同速度重新調整時間軸'],
        lyrics: ['歌詞與 AI', '歌詞來源、AI 模型與辨識偏好'],
        connections: ['連線與整合', 'Discord 狀態、圖片快取與服務整合'],
        downloads: ['下載', '下載效能與檔案格式'],
        community: ['一起聆聽', '建立或加入同步播放空間'],
        about: ['關於 NeonWave', '版本資訊、應用程式更新與診斷']
    } as const

    const handleThemeChange = (nextTheme: AppTheme) => {
        setTheme(nextTheme)
        applyTheme(nextTheme)
    }

    const handleLyricsPresentationChange = (mode: string) => {
        setLyricsPresentation(mode)
        localStorage.setItem('neonwave_lyrics_presentation', mode)
        window.dispatchEvent(new Event('neonwave:settings-changed'))
    }

    const handleCalibrationEnabledChange = (enabled: boolean) => {
        setCalibrationEnabled(enabled)
        localStorage.setItem('neonwave_lyrics_calibration_enabled', String(enabled))
        window.dispatchEvent(new Event('neonwave:settings-changed'))
    }

    const handleCalibrationModeChange = (mode: string) => {
        setCalibrationMode(mode)
        localStorage.setItem('neonwave_lyrics_calibration_mode', mode)
        window.dispatchEvent(new Event('neonwave:settings-changed'))
    }

    const handleCalibrationPrecisionChange = (precision: CalibrationPrecision) => {
        setCalibrationPrecision(precision)
        localStorage.setItem('neonwave_lyrics_calibration_precision', precision)
        window.dispatchEvent(new Event('neonwave:settings-changed'))
    }

    const updateTrackCalibration = (patch: Partial<TrackCalibration>) => {
        if (!currentTrack?.path) return
        const candidate = { ...trackCalibration, ...patch }
        const next: TrackCalibration = {
            ...candidate,
            offsetMs: Number.isFinite(candidate.offsetMs) ? Math.max(-10000, Math.min(10000, candidate.offsetMs)) : 0,
            ratePercent: Number.isFinite(candidate.ratePercent) ? Math.max(85, Math.min(115, candidate.ratePercent)) : 100
        }
        setTrackCalibration(next)
        saveTrackCalibration(currentTrack.path, next)
        if (calibrationDispatchTimer.current) clearTimeout(calibrationDispatchTimer.current)
        calibrationDispatchTimer.current = setTimeout(() => {
            window.dispatchEvent(new Event('neonwave:settings-changed'))
        }, 420)
    }

    const runGpuCalibration = async () => {
        if (!currentTrack?.path || !calibrationMode.startsWith('gpu-')) return
        setGpuBusy(true)
        setGpuResult('')
        try {
            const result = await window.ipcRenderer.calibrateLyricsGpu(currentTrack.path, undefined, calibrationMode, true, computeConfig)
            if (!result.ok) {
                setGpuResult(result.error || 'GPU 校正失敗')
                return
            }
            setGpuResult(`已存檔 · 可信度 ${Math.round((result.confidence || 0) * 100)}% · 第 ${result.runs || 1} 次學習`)
            setGpuStatus(await window.ipcRenderer.getGpuLyricsStatus())
            window.dispatchEvent(new Event('neonwave:settings-changed'))
        } catch (error) {
            setGpuResult(error instanceof Error ? error.message : 'GPU 校正失敗')
        } finally {
            setGpuBusy(false)
        }
    }

    const updateComputeConfig = (patch: Partial<CalibrationComputeConfig>) => {
        const next = { ...computeConfig, ...patch }
        setComputeConfig(next)
        saveCalibrationComputeConfig(next)
        window.dispatchEvent(new Event('neonwave:settings-changed'))
    }

    return (
        <div className="settings-view">
            <header className="settings-page-header">
                <div>
                    <span className="settings-eyebrow">NEONWAVE CONTROL CENTER</span>
                    <h2>設定</h2>
                    <p>調整播放器外觀、服務與聆聽體驗</p>
                </div>
                <div className="settings-version-badge">v{version}</div>
            </header>

            <div className="settings-layout">
                <nav className="settings-nav" aria-label="設定分類">
                    <button className={activeCategory === 'appearance' ? 'active' : ''} onClick={() => setActiveCategory('appearance')}><Palette size={18} /><span><strong>外觀與介面</strong><small>主題與顯示</small></span></button>
                    <button className={activeCategory === 'presentation' ? 'active' : ''} onClick={() => setActiveCategory('presentation')}><Captions size={18} /><span><strong>歌詞呈現</strong><small>字幕與彈幕方式</small></span></button>
                    <button className={activeCategory === 'calibration' ? 'active' : ''} onClick={() => setActiveCategory('calibration')}><AudioLines size={18} /><span><strong>歌詞校正</strong><small>翻唱時間軸</small></span></button>
                    <button className={activeCategory === 'lyrics' ? 'active' : ''} onClick={() => setActiveCategory('lyrics')}><Languages size={18} /><span><strong>歌詞與 AI</strong><small>來源與模型</small></span></button>
                    <button className={activeCategory === 'connections' ? 'active' : ''} onClick={() => setActiveCategory('connections')}><Bot size={18} /><span><strong>連線與整合</strong><small>Discord 與服務</small></span></button>
                    <button className={activeCategory === 'downloads' ? 'active' : ''} onClick={() => setActiveCategory('downloads')}><Download size={18} /><span><strong>下載</strong><small>效能與格式</small></span></button>
                    <button className={activeCategory === 'community' ? 'active' : ''} onClick={() => setActiveCategory('community')}><Users size={18} /><span><strong>一起聆聽</strong><small>同步播放空間</small></span></button>
                    <div className="settings-nav-spacer" />
                    <button className={activeCategory === 'about' ? 'active' : ''} onClick={() => setActiveCategory('about')}><Info size={18} /><span><strong>關於</strong><small>版本與更新</small></span></button>
                </nav>

                <main className="settings-content">
                    <div className="settings-content-heading">
                        <h3>{categoryCopy[activeCategory][0]}</h3>
                        <p>{categoryCopy[activeCategory][1]}</p>
                    </div>

                    <section className={`settings-category settings-community ${activeCategory === 'community' ? '' : 'settings-category-hidden'}`}>
                        <ListeningPartyPanel />
                    </section>

            <div className={`glass settings-panel ${activeCategory === 'community' ? 'settings-panel-hidden' : ''}`}>
                <section className={`settings-category settings-about ${activeCategory === 'about' ? '' : 'settings-category-hidden'}`}>
                <h3 style={{ fontSize: '20px', marginBottom: '24px' }}>關於 NeonWave</h3>

                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
                    <img src="logo.png" alt="NeonWave Logo" style={{
                        width: '64px', height: '64px', borderRadius: '16px',
                        objectFit: 'cover',
                        boxShadow: '0 0 20px var(--accent-glow)'
                    }} />
                    <div>
                        <div style={{ fontSize: '24px', fontWeight: 700 }}>NeonWave</div>
                        <div style={{ color: 'var(--text-muted)' }}>v{version}</div>
                    </div>
                </div>

                <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '24px' }}>
                    <h4 style={{ marginBottom: '16px', color: 'var(--text-main)' }}>更新狀態</h4>

                    {status === 'idle' && (
                        <button
                            onClick={checkForUpdates}
                            style={{
                                padding: '12px 24px', borderRadius: '12px',
                                background: 'rgba(255,255,255,0.1)',
                                display: 'flex', alignItems: 'center', gap: '8px',
                                fontWeight: 600, transition: 'all 0.2s'
                            }}
                        >
                            <RefreshCw size={18} /> 檢查更新
                        </button>
                    )}

                    {status === 'checking' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-muted)' }}>
                            <RefreshCw size={18} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
                            正在檢查更新...
                        </div>
                    )}

                    {status === 'not-available' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#4ade80' }}>
                            <CheckCircle size={18} />
                            目前已是最新版本！
                        </div>
                    )}

                    {status === 'available' && (
                        <div style={{ color: 'var(--accent-primary)' }}>
                            發現新版本！正在自動下載...
                        </div>
                    )}

                    {status === 'downloading' && progress && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px' }}>
                                <span>正在下載更新...</span>
                                <span>{Math.round(progress.percent ?? 0)}%</span>
                            </div>
                            <div style={{
                                height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden'
                            }}>
                                <div style={{
                                    width: `${progress.percent ?? 0}%`, height: '100%',
                                    background: 'var(--accent-primary)',
                                    transition: 'width 0.2s ease'
                                }}></div>
                            </div>
                        </div>
                    )}

                    {status === 'downloaded' && (
                        <div>
                            <div style={{ marginBottom: '16px', color: '#4ade80', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <CheckCircle size={18} />
                                更新已下載完成，準備安裝。
                            </div>
                            <button
                                onClick={installUpdate}
                                style={{
                                    padding: '12px 24px', borderRadius: '12px',
                                    background: 'var(--accent-primary)', color: '#000',
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                    fontWeight: 700,
                                    boxShadow: '0 0 20px var(--accent-glow)'
                                }}
                            >
                                <Download size={18} /> 重啟並安裝
                            </button>
                        </div>
                    )}

                    {status === 'installing' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-muted)' }}>
                            <RefreshCw size={18} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
                            正在重啟並安裝更新...
                        </div>
                    )}

                    {status === 'error' && (
                        <div style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <AlertCircle size={18} />
                            更新失敗: {error}
                            <button onClick={checkForUpdates} style={{ marginLeft: '16px', textDecoration: 'underline' }}>重試</button>
                        </div>
                    )}
                </div>
                </section>

                    <section className={`settings-category settings-connections ${activeCategory === 'connections' ? '' : 'settings-category-hidden'}`}>
                        <h4 style={{ marginBottom: '16px', color: 'var(--text-main)' }}>Discord RPC</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '16px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ color: 'var(--text-muted)' }}>啟用 Discord 狀態顯示</span>
                                <label className="switch">
                                    <input
                                        type="checkbox"
                                        defaultChecked={localStorage.getItem('neonwave_enable_discord_rpc') !== 'false'}
                                        onChange={(e) => {
                                            const enabled = e.target.checked;
                                            localStorage.setItem('neonwave_enable_discord_rpc', enabled.toString());
                                            if (!enabled) {
                                                window.ipcRenderer.invoke('discord:clearPresence');
                                            }
                                        }}
                                    />
                                    <span className="slider round"></span>
                                </label>
                            </div>
                        </div>

                        <h4 style={{ marginBottom: '16px', marginTop: '24px', color: 'var(--text-main)' }}>Discord 狀態優化</h4>
                        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
                            <button
                                onClick={async (e) => {
                                    const btn = e.currentTarget;
                                    const originalText = btn.innerHTML;
                                    try {
                                        await window.ipcRenderer.invoke('discord:clearCache');
                                        btn.innerHTML = '<span style="color:#4ade80">✓ 快取已清理，重新播放即可更新</span>';
                                        setTimeout(() => btn.innerHTML = originalText, 3000);
                                    } catch (e) { }
                                }}
                                style={{
                                    padding: '10px 20px', borderRadius: '10px',
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid var(--glass-border)',
                                    fontSize: '14px', transition: 'all 0.2s',
                                }}
                            >
                                清除圖片快取
                            </button>

                            <button
                                onClick={() => window.ipcRenderer.invoke('discord:scanAndUpload')}
                                style={{
                                    padding: '10px 20px', borderRadius: '10px',
                                    background: 'rgba(255,255,255,0.1)',
                                    border: '1px solid var(--glass-border)',
                                    fontSize: '14px', transition: 'all 0.2s',
                                    color: 'var(--accent)'
                                }}
                            >
                                批量預載資料夾封面圖
                            </button>
                        </div>

                        {/* Progress UI managed by React state */}
                        <ScanProgress />
                    </section>

                    <section className={`settings-category settings-appearance ${activeCategory === 'appearance' ? '' : 'settings-category-hidden'}`}>
                        <h4 style={{ marginBottom: '16px', color: 'var(--text-main)' }}>介面設定</h4>

                        <div style={{ marginBottom: '24px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '9px', color: 'var(--text-main)', marginBottom: '5px' }}>
                                <Palette size={18} color="var(--accent-primary)" />
                                <span>整體介面主題</span>
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                                每個主題包含專屬排版、間距、元件造型與配色；NeonWave 保留原本外觀。
                            </div>
                            <div className="theme-grid" role="radiogroup" aria-label="整體主題">
                                {THEMES.map(option => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        role="radio"
                                        aria-checked={theme === option.id}
                                        className={`theme-card${theme === option.id ? ' theme-card-selected' : ''}`}
                                        onClick={() => handleThemeChange(option.id)}
                                    >
                                        <span className="theme-swatches" aria-hidden="true">
                                            {option.colors.map(color => (
                                                <span key={color} style={{ background: color }} />
                                            ))}
                                        </span>
                                        <span className="theme-card-copy">
                                            <strong>{option.name}</strong>
                                            <small>{option.description}</small>
                                        </span>
                                        {theme === option.id && <Check className="theme-check" size={17} />}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <div style={{ color: 'var(--text-main)' }}>啟用 迷你播放器 (PIP)</div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>在螢幕右上角顯示懸浮圓形播放器</div>
                            </div>
                            <label className="switch">
                                <input
                                    type="checkbox"
                                    defaultChecked={localStorage.getItem('neonwave_mini_player') === 'true'}
                                    onChange={async (e) => {
                                        const enabled = e.target.checked;
                                        localStorage.setItem('neonwave_mini_player', enabled.toString());
                                        await window.ipcRenderer.invoke('window:toggleMiniPlayer');
                                        window.dispatchEvent(new Event('neonwave:settings-changed'));
                                    }}
                                />
                                <span className="slider round"></span>
                            </label>
                        </div>

                        {/* Mini Player Game Mode Option */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', borderTop: '1px dashed rgba(255,255,255,0.08)', paddingTop: '16px' }}>
                            <div>
                                <div style={{ color: 'var(--text-main)' }}>迷你播放器遊戲模式 (點擊穿透)</div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', maxWidth: '480px', marginTop: '4px', lineHeight: '1.5' }}>
                                    當偵測到執行遊戲（如 <b>Valorant 瓦羅蘭</b>、<b>League of Legends 英雄聯盟</b> 等）時：
                                    <br />
                                    • <b>自動</b>：自動設定為點擊穿透，完全不影響滑鼠與瞄準，並降低不透明度與縮小以防干擾。切回桌面時自動恢復正常。
                                    <br />
                                    • <b>始終點擊穿透</b>：始終點擊穿透，不受遊戲狀態限制，適合當作純桌面小組件的玩家。
                                </div>
                            </div>
                            <select
                                className="settings-select"
                                defaultValue={localStorage.getItem('neonwave_mini_game_mode') || 'auto'}
                                onChange={(e) => {
                                    localStorage.setItem('neonwave_mini_game_mode', e.target.value);
                                    window.dispatchEvent(new Event('neonwave:settings-changed'));
                                }}
                            >
                                <option value="off">🚫 關閉 (正常點擊與移動)</option>
                                <option value="auto">🎮 自動 (偵測到遊戲時點擊穿透)</option>
                                <option value="always">🔒 始終啟用 (始終點擊穿透)</option>
                            </select>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', borderTop: '1px dashed rgba(255,255,255,0.08)', paddingTop: '16px' }}>
                            <div>
                                <div style={{ color: 'var(--text-main)' }}>歌詞語言</div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', maxWidth: '480px', marginTop: '4px', lineHeight: '1.5' }}>
                                    顯示歌詞時自動轉換中文字形（不影響原始歌詞檔）。
                                </div>
                            </div>
                            <select
                                className="settings-select"
                                defaultValue={localStorage.getItem('neonwave_lyrics_lang') || 'cn'}
                                onChange={(e) => {
                                    localStorage.setItem('neonwave_lyrics_lang', e.target.value);
                                    window.dispatchEvent(new Event('neonwave:settings-changed'));
                                }}
                            >
                                <option value="cn">簡體中文</option>
                                <option value="tw">繁體中文</option>
                                <option value="original">原文（不轉換）</option>
                            </select>
                        </div>
                    </section>

                <section className={`settings-category settings-presentation ${activeCategory === 'presentation' ? '' : 'settings-category-hidden'}`}>
                    <h4>歌詞顯示方式</h4>
                    <div className="presentation-grid" role="radiogroup" aria-label="歌詞呈現方式">
                        {[
                            { id: 'danmaku', icon: '→', title: '橫向彈幕', description: '歌詞從畫面右側滑過，保留目前的動態效果' },
                            { id: 'focus', icon: '◎', title: '中央聚焦', description: '目前歌詞置中顯示，下一句淡化預覽' },
                            { id: 'subtitle', icon: '▱', title: '底部字幕', description: '像影片字幕一樣固定顯示於畫面底部' },
                            { id: 'panel', icon: '≡', title: '沉浸歌詞', description: '以垂直歌詞面板顯示前後段落與目前進度' }
                        ].map(mode => (
                            <button
                                key={mode.id}
                                type="button"
                                role="radio"
                                aria-checked={lyricsPresentation === mode.id}
                                className={`presentation-card${lyricsPresentation === mode.id ? ' selected' : ''}`}
                                onClick={() => handleLyricsPresentationChange(mode.id)}
                            >
                                <span className="presentation-icon">{mode.icon}</span>
                                <span className="presentation-copy">
                                    <strong>{mode.title}</strong>
                                    <small>{mode.description}</small>
                                </span>
                                {lyricsPresentation === mode.id && <Check size={17} />}
                            </button>
                        ))}
                    </div>
                    <div className="presentation-note">
                        這項設定只改變歌詞出現的位置與動態方式，不會修改主題顏色或原始歌詞檔。
                    </div>
                </section>

                <section className={`settings-category settings-calibration ${activeCategory === 'calibration' ? '' : 'settings-category-hidden'}`}>
                    <h4>自動校正</h4>
                    <div className="calibration-master">
                        <div>
                            <strong>啟用歌詞時間軸校正</strong>
                            <small>預設關閉。開啟後會在載入歌曲時分析前奏與歌曲長度。</small>
                        </div>
                        <label className="switch">
                            <input
                                type="checkbox"
                                checked={calibrationEnabled}
                                onChange={(event) => handleCalibrationEnabledChange(event.target.checked)}
                            />
                            <span className="slider round" />
                        </label>
                    </div>

                    <div className={`calibration-modes${calibrationEnabled ? '' : ' disabled'}`} role="radiogroup" aria-label="歌詞校正模式">
                        {[
                            { id: 'quick', badge: 'CPU · 快速', title: '整體偏移', description: '分析多句附近的聲音起點，只在結果一致時整體平移歌詞。' },
                            { id: 'stretch', badge: 'CPU · 平衡', title: '翻唱比例', description: '依來源版本與目前歌曲的完整時長縮放時間軸，適合速度不同的翻唱。' },
                            { id: 'adaptive', badge: '推薦', title: '智慧自動', description: '讀取完整音訊並結合來源時長；可信度不足時保留原始時間，不強行校正。' },
                            { id: 'manual', badge: '精準控制', title: '手動精修', description: '略過自動猜測，只套用這首歌曲的偏移、比例與錨點設定。' },
                            { id: 'gpu-fast', badge: '推薦 · 190 MB', title: 'Small 穩定對齊', description: '目前實測對原唱與翻唱最穩定，速度、顯存與逐句準確度最平衡。' },
                            { id: 'gpu-precision', badge: '進階 · 539 MB', title: 'Medium 深度辨識', description: '適合咬字較清楚的長歌曲；模型更大，但歌聲對齊不一定比 Small 穩定。' },
                            { id: 'gpu-studio', badge: '大型 · 874 MB', title: 'Large V3 Turbo', description: '適合複雜音源的實驗模式，耗時與顯存較高，建議校正失敗時再使用。' }
                        ].map(mode => (
                            <button
                                key={mode.id}
                                type="button"
                                role="radio"
                                disabled={!calibrationEnabled}
                                aria-checked={calibrationMode === mode.id}
                                className={`calibration-card${calibrationMode === mode.id ? ' selected' : ''}`}
                                onClick={() => handleCalibrationModeChange(mode.id)}
                            >
                                <span className="calibration-badge">{mode.badge}</span>
                                <strong>{mode.title}</strong>
                                <small>{mode.description}</small>
                                {calibrationMode === mode.id && <Check size={17} />}
                            </button>
                        ))}
                    </div>

                    <div className={`gpu-calibration-panel${calibrationMode.startsWith('gpu-') ? '' : ' gpu-hidden'}${calibrationEnabled ? '' : ' disabled'}`}>
                        <div className="gpu-calibration-hero">
                            <div className="gpu-orb"><AudioLines size={22} /></div>
                            <div>
                                <span>CUDA VOICE ALIGNMENT</span>
                                <strong>{gpuStatus?.gpuName || 'NVIDIA RTX GPU'}</strong>
                                <small>Whisper.cpp {gpuStatus?.engineVersion || ''} · 原歌詞提示辨識 · 單調時間軸對齊</small>
                            </div>
                            <div className={`gpu-ready-pill${gpuStatus?.engineReady ? ' ready' : ''}`}>
                                {gpuStatus?.engineReady ? '引擎已就緒' : '首次執行時安裝'}
                            </div>
                        </div>
                        <div className="compute-config-panel">
                            <div className="compute-config-title">
                                <div><strong>運算裝置</strong><small>模型品質與硬體分開設定</small></div>
                                <div className="compute-backend-tabs">
                                    {([
                                        ['auto', '自動'], ['hybrid', 'CPU＋GPU · 推薦'], ['cuda', '單張 GPU'], ['cpu', 'CPU-only'], ['multi-gpu', '多 GPU 共識']
                                    ] as [CalibrationComputeConfig['backend'], string][]).map(([value, label]) => (
                                        <button key={value} type="button" className={computeConfig.backend === value ? 'active' : ''} onClick={() => updateComputeConfig({ backend: value })}>{label}</button>
                                    ))}
                                </div>
                            </div>

                            {computeConfig.backend !== 'cpu' && (
                                <div className="compute-device-list">
                                    {(computeDevices?.gpus || []).map(gpu => {
                                        const checked = computeConfig.gpuDevices.includes(gpu.index)
                                        const multi = computeConfig.backend === 'multi-gpu'
                                        return (
                                            <label key={gpu.index} className={checked ? 'selected' : ''}>
                                                <input
                                                    type={multi ? 'checkbox' : 'radio'}
                                                    name={multi ? undefined : 'lyrics-gpu-device'}
                                                    checked={checked}
                                                    onChange={() => updateComputeConfig({
                                                        gpuDevices: multi
                                                            ? checked
                                                                ? computeConfig.gpuDevices.filter(index => index !== gpu.index)
                                                                : [...computeConfig.gpuDevices, gpu.index].sort((a, b) => a - b)
                                                            : [gpu.index]
                                                    })}
                                                />
                                                <span><b>GPU {gpu.index}</b><strong>{gpu.name}</strong><small>{Math.round(gpu.memoryMb / 1024)} GB VRAM</small></span>
                                            </label>
                                        )
                                    })}
                                    {!computeDevices?.gpus.length && <div className="compute-empty">沒有偵測到 NVIDIA CUDA 顯示卡</div>}
                                </div>
                            )}

                            <div className="compute-cpu-grid">
                                <label>
                                    <span><strong>CPU 執行緒</strong><output>{computeConfig.cpuThreads}</output></span>
                                    <input type="range" min="1" max={computeDevices?.cpu.logicalThreads || 32} step="1" value={computeConfig.cpuThreads} onChange={(event) => updateComputeConfig({ cpuThreads: Number(event.target.value) })} />
                                    <small>{computeDevices?.cpu.name || 'CPU'} · {computeDevices?.cpu.logicalThreads || '?'} logical threads</small>
                                </label>
                                <label>
                                    <span><strong>並行處理器</strong><output>{computeConfig.cpuProcessors}</output></span>
                                    <input type="range" min="1" max="4" step="1" value={computeConfig.cpuProcessors} onChange={(event) => updateComputeConfig({ cpuProcessors: Number(event.target.value) })} />
                                    <small>會複製模型工作區；記憶體足夠時才提高。</small>
                                </label>
                            </div>
                            {computeConfig.backend === 'multi-gpu' && computeConfig.gpuDevices.length < 2 && (
                                <div className="compute-warning">多 GPU 共識至少要選擇兩張顯示卡；只有一張時會以單卡執行。</div>
                            )}
                            {computeConfig.backend === 'hybrid' && (
                                <div className="compute-warning">推薦給 RTX 3060 Ti：GPU 執行語音模型，CPU 同時負責音訊前處理、解碼與歌詞對齊，可調整上方執行緒用量。</div>
                            )}
                        </div>
                        <div className="gpu-calibration-body">
                            <div className="gpu-learning-copy">
                                <strong>自動校正與持續學習</strong>
                                <small>每次重新學習會把新辨識錨點和歷史結果加權融合；低可信度結果不會覆蓋現有校正版。</small>
                                <span>{currentTrack ? `目前歌曲 · ${currentTrack.title}` : '請先播放要校正的歌曲'}</span>
                            </div>
                            <button
                                type="button"
                                className="gpu-run-button"
                                disabled={!calibrationEnabled || !currentTrack || gpuBusy}
                                onClick={runGpuCalibration}
                            >
                                {gpuBusy ? <RefreshCw className="gpu-spin" size={15} /> : <AudioLines size={15} />}
                                {gpuBusy ? 'GPU 分析中' : '校正並存檔'}
                            </button>
                        </div>
                        {(gpuBusy || gpuProgress) && (
                            <div className="gpu-progress-block">
                                <div><span>{gpuProgress?.message || '準備 GPU 校正'}</span><b>{gpuProgress?.percent || 0}%</b></div>
                                <div className="gpu-progress-track"><i style={{ width: `${gpuProgress?.percent || 0}%` }} /></div>
                            </div>
                        )}
                        {gpuResult && <div className={`gpu-result${gpuResult.includes('失敗') ? ' error' : ''}`}>{gpuResult}</div>}
                        <div className="gpu-save-note">
                            儲存為同資料夾的 <code>.neonwave.lrc</code> 與 <code>.neonwave-calibration.json</code>；原始 <code>.lrc</code> 不會被覆蓋。
                        </div>
                    </div>

                    <div className={`calibration-workbench${calibrationMode.startsWith('gpu-') ? ' gpu-hidden' : ''}${calibrationEnabled ? '' : ' disabled'}`}>
                        <div className="calibration-workbench-head">
                            <div>
                                <span>ADVANCED TIMELINE</span>
                                <strong>精細校正工作台</strong>
                                <small>{currentTrack ? `目前歌曲 · ${currentTrack.title}` : '請先播放一首歌曲以啟用單曲精修'}</small>
                            </div>
                            <button
                                type="button"
                                className="calibration-reset"
                                disabled={!calibrationEnabled || !currentTrack}
                                onClick={() => updateTrackCalibration(DEFAULT_TRACK_CALIBRATION)}
                            >
                                <RefreshCw size={13} /> 重設單曲
                            </button>
                        </div>

                        <div className="calibration-precision-row">
                            <div>
                                <strong>自動分析精準度</strong>
                                <small>越積極越容易套用結果，也更可能受到伴奏誤判影響。</small>
                            </div>
                            <div className="calibration-segments" role="radiogroup" aria-label="自動分析精準度">
                                {([
                                    ['conservative', '保守'], ['balanced', '平衡'], ['aggressive', '積極']
                                ] as [CalibrationPrecision, string][]).map(([value, label]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        disabled={!calibrationEnabled || calibrationMode === 'manual'}
                                        className={calibrationPrecision === value ? 'active' : ''}
                                        onClick={() => handleCalibrationPrecisionChange(value)}
                                    >{label}</button>
                                ))}
                            </div>
                        </div>

                        <div className="calibration-fine-grid">
                            <label className="calibration-control">
                                <span><strong>整體時間偏移</strong><span className="calibration-number-wrap"><input className="calibration-number" type="number" min="-10000" max="10000" step="10" disabled={!calibrationEnabled || !currentTrack} value={trackCalibration.offsetMs} onChange={(event) => updateTrackCalibration({ offsetMs: Number(event.target.value) })} /><em>ms</em></span></span>
                                <input
                                    type="range" min="-5000" max="5000" step="50"
                                    disabled={!calibrationEnabled || !currentTrack}
                                    value={trackCalibration.offsetMs}
                                    onChange={(event) => updateTrackCalibration({ offsetMs: Number(event.target.value) })}
                                />
                                <small>歌詞太慢往負值調，太快往正值調；每格 50 毫秒。</small>
                            </label>

                            <label className="calibration-control">
                                <span><strong>時間軸速度比例</strong><span className="calibration-number-wrap"><input className="calibration-number" type="number" min="85" max="115" step="0.1" disabled={!calibrationEnabled || !currentTrack} value={trackCalibration.ratePercent} onChange={(event) => updateTrackCalibration({ ratePercent: Number(event.target.value) })} /><em>%</em></span></span>
                                <input
                                    type="range" min="90" max="110" step="0.1"
                                    disabled={!calibrationEnabled || !currentTrack}
                                    value={trackCalibration.ratePercent}
                                    onChange={(event) => updateTrackCalibration({ ratePercent: Number(event.target.value) })}
                                />
                                <small>後段逐漸跑掉時使用；低於 100% 提前，高於 100% 延後。</small>
                            </label>
                        </div>

                        <div className="calibration-anchor-row">
                            <div>
                                <strong>比例縮放錨點</strong>
                                <small>選擇調整速度時固定不動的位置。</small>
                            </div>
                            <div className="calibration-segments" role="radiogroup" aria-label="比例縮放錨點">
                                {([['start', '開頭'], ['middle', '中段'], ['end', '結尾']] as [CalibrationAnchor, string][]).map(([value, label]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        disabled={!calibrationEnabled || !currentTrack}
                                        className={trackCalibration.anchor === value ? 'active' : ''}
                                        onClick={() => updateTrackCalibration({ anchor: value })}
                                    >{label}</button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="calibration-info">
                        建議先用「智慧自動」，再用整體偏移修正固定誤差；若歌曲越到後面偏差越大，再微調速度比例。單曲精修會依檔案個別保存。
                    </div>
                </section>

                <section className={`settings-category settings-lyrics ${activeCategory === 'lyrics' ? '' : 'settings-category-hidden'}`}>
                    <h4 style={{ marginBottom: '16px', color: 'var(--text-main)' }}>AI 歌詞設定</h4>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: 'var(--text-muted)' }}>歌詞來源 / AI 服務商</span>
                            <CustomSelect
                                value={lyricsProvider}
                                onChange={(val) => {
                                    setLyricsProvider(val)
                                }}
                                options={[
                                    { value: 'default', label: '預設模式 (猜測搜尋 - 免費)', icon: <Globe size={16} /> },
                                    { value: 'openai', label: 'OpenAI', icon: <OpenAIIcon size={16} /> },
                                    { value: 'openrouter', label: 'OpenRouter', icon: <OpenRouterIcon size={16} /> },
                                    { value: 'ollama', label: 'Ollama', icon: <OllamaIcon size={16} /> },
                                    { value: 'opwebui', label: 'Open WebUI', icon: <OpenWebUIIcon size={16} /> },
                                    { value: 'chatgpt', label: 'ChatGPT (自訂/代理)', icon: <OpenAIIcon size={16} /> },
                                    { value: 'gemini', label: 'Google Gemini', icon: <GeminiIcon size={16} /> },
                                    { value: 'claude', label: 'Anthropic Claude', icon: <ClaudeIcon size={16} /> }
                                ]}
                            />
                        </div>

                        {lyricsProvider !== 'default' && (
                            <>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>API 金鑰 (API Key)</span>
                                    <input
                                        type="password"
                                        placeholder={lyricsProvider === 'ollama' ? 'Ollama 預設不需要 API Key' : '請輸入 API 金鑰...'}
                                        value={lyricsKey}
                                        onChange={(e) => {
                                            setLyricsKey(e.target.value)
                                        }}
                                        style={{
                                            background: 'rgba(0,0,0,0.4)',
                                            color: '#fff',
                                            border: '1px solid rgba(255,255,255,0.15)',
                                            padding: '10px 16px',
                                            borderRadius: '10px',
                                            outline: 'none',
                                            fontSize: '14px'
                                        }}
                                    />
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>API 端點 URL (Endpoint)</span>
                                    <input
                                        type="text"
                                        placeholder={
                                            lyricsProvider === 'openai' ? 'https://api.openai.com/v1/chat/completions (留空使用預設)' :
                                                lyricsProvider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions (留空使用預設)' :
                                                    lyricsProvider === 'ollama' ? 'http://localhost:11434/v1/chat/completions (留空使用預設)' :
                                                        lyricsProvider === 'opwebui' ? 'http://localhost:3000/api/v1/chat/completions (留空使用預設)' :
                                                            '請輸入自訂 API 端點路徑...'
                                        }
                                        value={lyricsEndpoint}
                                        onChange={(e) => {
                                            setLyricsEndpoint(e.target.value)
                                        }}
                                        style={{
                                            background: 'rgba(0,0,0,0.4)',
                                            color: '#fff',
                                            border: '1px solid rgba(255,255,255,0.15)',
                                            padding: '10px 16px',
                                            borderRadius: '10px',
                                            outline: 'none',
                                            fontSize: '14px'
                                        }}
                                    />
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>模型名稱 (Model Name)</span>
                                    <input
                                        type="text"
                                        placeholder={
                                            lyricsProvider === 'openai' ? 'gpt-4o / gpt-4o-mini' :
                                                lyricsProvider === 'openrouter' ? 'meta-llama/llama-3-8b-instruct:free 等' :
                                                    lyricsProvider === 'ollama' ? 'llama3 / qwen2.5 等' :
                                                        lyricsProvider === 'gemini' ? 'gemini-1.5-flash / gemini-1.5-pro' :
                                                            lyricsProvider === 'claude' ? 'claude-3-5-sonnet-20241022' :
                                                                '請輸入模型代號...'
                                        }
                                        value={lyricsModel}
                                        onChange={(e) => {
                                            setLyricsModel(e.target.value)
                                        }}
                                        style={{
                                            background: 'rgba(0,0,0,0.4)',
                                            color: '#fff',
                                            border: '1px solid rgba(255,255,255,0.15)',
                                            padding: '10px 16px',
                                            borderRadius: '10px',
                                            outline: 'none',
                                            fontSize: '14px'
                                        }}
                                    />
                                    {/* Recommended model pills */}
                                    {(() => {
                                        const recs: Record<string, string[]> = {
                                            openai: ['gpt-4o-mini', 'gpt-4o', 'o3-mini'],
                                            chatgpt: ['gpt-4o-mini', 'gpt-4o', 'o3-mini'],
                                            openrouter: ['meta-llama/llama-3-8b-instruct:free', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat'],
                                            ollama: ['llama3', 'qwen2.5', 'gemma2', 'mistral'],
                                            opwebui: ['llama3', 'qwen2.5', 'gpt-4o-mini'],
                                            gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
                                            claude: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest']
                                        }
                                        const list = recs[lyricsProvider]
                                        if (!list) return null
                                        return (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}>
                                                <span style={{ color: 'var(--text-muted)', fontSize: '12px', alignSelf: 'center' }}>💡 推薦熱門模型 (點擊填入)：</span>
                                                {list.map(rec => (
                                                    <button
                                                        key={rec}
                                                        type="button"
                                                        onClick={() => {
                                                            setLyricsModel(rec)
                                                        }}
                                                        style={{
                                                            padding: '4px 10px',
                                                            borderRadius: '6px',
                                                            background: 'rgba(255, 255, 255, 0.08)',
                                                            border: '1px solid rgba(255, 255, 255, 0.12)',
                                                            color: 'var(--text-main)',
                                                            fontSize: '12px',
                                                            cursor: 'pointer',
                                                            transition: 'all 0.15s ease',
                                                            outline: 'none'
                                                        }}
                                                        onMouseOver={(e) => {
                                                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'
                                                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)'
                                                            e.currentTarget.style.transform = 'translateY(-1px)'
                                                        }}
                                                        onMouseOut={(e) => {
                                                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
                                                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)'
                                                            e.currentTarget.style.transform = 'none'
                                                        }}
                                                    >
                                                        {rec.split('/').pop()}
                                                    </button>
                                                ))}
                                            </div>
                                        )
                                    })()}
                                </div>
                            </>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                            <span style={{ color: 'var(--text-muted)' }}>辨識模式 (如何抓取歌曲資訊)</span>
                            <select
                                className="settings-select"
                                value={lyricsMode}
                                onChange={(e) => {
                                    setLyricsMode(e.target.value)
                                }}
                            >
                                <option value="filename">📁 依據檔案名稱 (預設)</option>
                                <option value="audio">🎵 依據音檔內嵌標籤 (ID3 Tags)</option>
                                <option value="audio_filename">🔀 混合模式 (音檔內嵌標籤 + 檔案名稱)</option>
                            </select>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '-8px', lineHeight: '1.5' }}>
                            * 註：當使用 AI 辨識且產生歌詞後，將會自動於歌曲資料夾下寫入一個同名的 <b>.lrc</b> 檔案。下次播放時會優先讀取該檔案，每首歌只處理一次。
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                            <span style={{ color: 'var(--text-muted)' }}>思考強度 / 思考時間 (Reasoning Effort)</span>
                            <select
                                className="settings-select"
                                value={lyricsReasoning}
                                onChange={(e) => {
                                    setLyricsReasoning(e.target.value)
                                }}
                            >
                                <option value="none">🚫 關閉 (None - 最快)</option>
                                <option value="minimal">⚡ 最低 (Minimal)</option>
                                <option value="low">📉 低 (Low)</option>
                                <option value="medium">📊 中 (Medium)</option>
                                <option value="high">📈 高 (High)</option>
                            </select>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
                            <button
                                type="button"
                                onClick={() => {
                                    localStorage.setItem('neonwave_lyrics_ai_provider', lyricsProvider)
                                    localStorage.setItem('neonwave_lyrics_ai_key', lyricsKey)
                                    localStorage.setItem('neonwave_lyrics_ai_endpoint', lyricsEndpoint)
                                    localStorage.setItem('neonwave_lyrics_ai_model', lyricsModel)
                                    localStorage.setItem('neonwave_lyrics_ai_mode', lyricsMode)
                                    localStorage.setItem('neonwave_lyrics_ai_reasoning', lyricsReasoning)
                                    window.dispatchEvent(new Event('neonwave:settings-changed'))
                                    setSaveSuccess(true)
                                    setTimeout(() => setSaveSuccess(false), 3000)
                                }}
                                style={{
                                    padding: '10px 24px',
                                    borderRadius: '10px',
                                    background: 'var(--accent, #8b5cf6)',
                                    color: '#000',
                                    border: 'none',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    boxShadow: '0 0 15px var(--accent-glow)'
                                }}
                                onMouseOver={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-1px)'
                                    e.currentTarget.style.filter = 'brightness(1.1)'
                                }}
                                onMouseOut={(e) => {
                                    e.currentTarget.style.transform = 'none'
                                    e.currentTarget.style.filter = 'none'
                                }}
                            >
                                儲存 AI 設定
                            </button>
                            {saveSuccess && (
                                <span style={{ color: '#4ade80', fontSize: '14px', fontWeight: 600 }}>
                                    ✓ 設定已成功儲存與套用！
                                </span>
                            )}
                        </div>
                    </div>
                </section>

                <section className={`settings-category settings-downloads ${activeCategory === 'downloads' ? '' : 'settings-category-hidden'}`}>
                    <h4 style={{ marginBottom: '16px', color: 'var(--text-main)' }}>下載設定</h4>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: 'var(--text-muted)' }}>並行下載數量 (請依據您的網路頻寬選擇)</span>
                            <select
                                className="settings-select"
                                defaultValue={localStorage.getItem('neonwave_download_concurrency') || '2'}
                                onChange={(e) => {
                                    localStorage.setItem('neonwave_download_concurrency', e.target.value);
                                    // 確保無單獨限速，自動發揮最大頻寬
                                    localStorage.removeItem('neonwave_download_speed');
                                }}
                            >
                                <option value="1">1 首 (背景下載 / 較省 CPU)</option>
                                <option value="3">3 首 (一般 Wi-Fi / 筆電建議)</option>
                                <option value="5">5 首 (100M 光世代建議)</option>
                                <option value="10">10 首 (300M 光世代建議)</option>
                                <option value="15">15 首 (500M 光世代建議)</option>
                                <option value="24">24 首 (1G 光世代火力全開！)</option>
                            </select>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '-8px' }}>
                            * 註：不提供人為限速，系統將直接根據您的網路頻寬發揮最大效益。請注意並行數量越高，越吃重電腦的 CPU 處理能力 (因需同步執行轉碼)。
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
                            <span style={{ color: 'var(--text-muted)' }}>預設下載格式</span>
                            <select
                                className="settings-select"
                                defaultValue={localStorage.getItem('neonwave_download_format') || 'm4a'}
                                onChange={(e) => {
                                    localStorage.setItem('neonwave_download_format', e.target.value);
                                }}
                            >
                                <option value="m4a">m4a (最高相容性與音質)</option>
                                <option value="mp4">mp4 (若無mp4則自動使用m4a)</option>
                            </select>
                        </div>
                    </div>
                </section>
            </div>
                </main>
            </div>

            <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
        @keyframes settings-in {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .settings-view {
            width: 100%;
            max-width: none !important;
            margin: 0 !important;
            padding: 34px 40px 140px !important;
        }
        .settings-page-header {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            max-width: 1180px;
            margin: 0 auto 28px;
        }
        .settings-page-header h2 {
            margin: 3px 0 2px;
            font-size: clamp(30px, 4vw, 42px);
            line-height: 1.1;
            letter-spacing: -0.04em;
        }
        .settings-page-header p,
        .settings-content-heading p {
            margin: 0;
            color: var(--text-muted);
            font-size: 13px;
        }
        .settings-eyebrow {
            color: var(--accent-primary);
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0.14em;
        }
        .settings-version-badge {
            padding: 7px 11px;
            border: 1px solid var(--glass-border);
            border-radius: 999px;
            background: rgba(255,255,255,0.045);
            color: var(--text-muted);
            font-size: 11px;
            font-variant-numeric: tabular-nums;
        }
        .settings-layout {
            display: grid;
            grid-template-columns: 226px minmax(0, 1fr);
            align-items: start;
            gap: 26px;
            max-width: 1180px;
            margin: 0 auto;
        }
        .settings-nav {
            position: sticky;
            top: 22px;
            display: flex;
            flex-direction: column;
            min-height: 520px;
            padding: 10px;
            border: 1px solid var(--glass-border);
            border-radius: 18px;
            background: color-mix(in srgb, var(--glass-bg) 82%, transparent);
            backdrop-filter: blur(18px);
            box-shadow: 0 18px 50px rgba(0,0,0,0.14);
        }
        .settings-nav button {
            display: flex;
            align-items: center;
            gap: 12px;
            width: 100%;
            padding: 11px 12px;
            border: 1px solid transparent;
            border-radius: 11px;
            color: var(--text-muted);
            text-align: left;
            transition: background .16s ease, color .16s ease, border-color .16s ease, transform .16s ease;
        }
        .settings-nav button:hover {
            color: var(--text-main);
            background: rgba(255,255,255,0.055);
            transform: translateX(2px);
        }
        .settings-nav button.active {
            color: var(--text-main);
            border-color: color-mix(in srgb, var(--accent-primary) 26%, transparent);
            background: color-mix(in srgb, var(--accent-primary) 13%, rgba(255,255,255,0.035));
            box-shadow: inset 3px 0 0 var(--accent-primary);
        }
        .settings-nav button > svg { flex: none; color: currentColor; }
        .settings-nav button.active > svg { color: var(--accent-primary); }
        .settings-nav button > span {
            display: flex;
            flex-direction: column;
            min-width: 0;
        }
        .settings-nav strong { font-size: 13px; font-weight: 680; }
        .settings-nav small { margin-top: 1px; color: var(--text-muted); font-size: 10px; }
        .settings-nav-spacer { flex: 1; min-height: 18px; }
        .settings-content { min-width: 0; }
        .settings-content-heading {
            display: flex;
            flex-direction: column;
            justify-content: center;
            min-height: 64px;
            margin-bottom: 14px;
            padding: 0 4px;
        }
        .settings-content-heading h3 {
            margin: 0 0 4px;
            font-size: 22px;
            letter-spacing: -0.025em;
        }
        .settings-panel {
            width: 100%;
            padding: 26px !important;
            border-radius: 20px !important;
            box-shadow: 0 22px 60px rgba(0,0,0,0.16);
        }
        .settings-panel-hidden,
        .settings-category-hidden { display: none !important; }
        .settings-category {
            min-width: 0;
            animation: settings-in .2s ease-out;
        }
        .settings-category > h3:first-child { display: none; }
        .settings-category > h4:first-child {
            margin: 0 0 18px !important;
            font-size: 12px;
            font-weight: 800;
            letter-spacing: .09em;
            text-transform: uppercase;
            color: var(--text-muted) !important;
        }
        .settings-community { animation: settings-in .2s ease-out; }
        .settings-community > * {
            border-radius: 20px;
            box-shadow: 0 22px 60px rgba(0,0,0,.16);
        }
        .settings-category > div[style*="border-top"] {
            border-top-color: var(--glass-border) !important;
        }
        .settings-about > div:first-of-type {
            padding: 20px;
            margin-bottom: 14px !important;
            border: 1px solid var(--glass-border);
            border-radius: 16px;
            background: linear-gradient(120deg, color-mix(in srgb, var(--accent-primary) 14%, transparent), rgba(255,255,255,.035));
        }
        .settings-about > div:last-of-type {
            padding: 20px !important;
            border: 1px solid var(--glass-border) !important;
            border-radius: 16px;
            background: rgba(255,255,255,.025);
        }
        .settings-appearance > div {
            padding: 18px !important;
            margin-top: 10px !important;
            border: 1px solid var(--glass-border) !important;
            border-radius: 15px;
            background: rgba(255,255,255,.026);
        }
        .settings-appearance > div:first-of-type { margin-top: 0 !important; }
        .settings-connections > div {
            padding: 17px;
            border: 1px solid var(--glass-border);
            border-radius: 14px;
            background: rgba(255,255,255,.025);
        }
        .settings-connections > h4:not(:first-child) {
            margin: 22px 2px 10px !important;
            color: var(--text-muted) !important;
            font-size: 11px;
            letter-spacing: .08em;
            text-transform: uppercase;
        }
        .settings-lyrics > div {
            gap: 10px !important;
        }
        .settings-lyrics > div > div,
        .settings-downloads > div > div {
            padding: 16px 17px !important;
            margin-top: 0 !important;
            border: 1px solid var(--glass-border) !important;
            border-radius: 14px;
            background: rgba(255,255,255,.025);
        }
        .settings-lyrics > div > div + div,
        .settings-downloads > div > div + div { margin-top: 10px !important; }
        .settings-lyrics > div > div[style*="margin-top: -8px"],
        .settings-downloads > div > div[style*="margin-top: -8px"] {
            padding: 0 4px !important;
            border: 0 !important;
            background: transparent;
        }
        .settings-category button:not(.theme-card):not(.settings-nav button) {
            min-height: 38px;
        }
        .settings-category input[type="text"],
        .settings-category input[type="password"],
        .settings-category input:not([type]) {
            min-height: 42px;
        }
        .settings-select {
            appearance: none;
            background-color: rgba(0, 0, 0, 0.4);
            color: #fff;
            border: 1px solid rgba(255, 255, 255, 0.15);
            padding: 10px 36px 10px 16px;
            border-radius: 10px;
            font-size: 14px;
            cursor: pointer;
            background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20width%3D'16'%20height%3D'16'%20viewBox%3D'0%200%2024%2024'%20fill%3D'none'%20stroke%3D'%23a1a1aa'%20stroke-width%3D'2'%20stroke-linecap%3D'round'%20stroke-linejoin%3D'round'%3E%3Cpolyline%20points%3D'6%209%2012%2015%2018%209'%2F%3E%3C%2Fsvg%3E");
            background-repeat: no-repeat;
            background-position: right 12px center;
            outline: none;
            transition: all 0.2s ease;
            box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
        }
        .settings-select:hover {
            border-color: rgba(255, 255, 255, 0.3);
            background-color: rgba(0, 0, 0, 0.6);
        }
        .settings-select:focus {
            border-color: #8b5cf6;
            box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.3);
            background-color: rgba(0, 0, 0, 0.8);
        }
        .settings-select option {
            background-color: #1a1b1e;
            color: #fff;
            font-size: 14px;
            padding: 12px;
        }

        .calibration-master {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
            padding: 18px;
            border: 1px solid var(--glass-border);
            border-radius: 16px;
            background: color-mix(in srgb, var(--accent-primary) 7%, rgba(255,255,255,.025));
        }
        .calibration-master > div { display: flex; flex-direction: column; }
        .calibration-master strong { font-size: 14px; }
        .calibration-master small { margin-top: 4px; color: var(--text-muted); font-size: 11px; line-height: 1.45; }
        .calibration-modes {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
            margin-top: 14px;
            transition: opacity .18s ease;
        }
        .calibration-modes.disabled { opacity: .42; }
        .calibration-card {
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            min-height: 154px !important;
            padding: 17px;
            border: 1px solid var(--glass-border);
            border-radius: 16px;
            background: rgba(255,255,255,.025);
            text-align: left;
            transition: transform .18s ease, border-color .18s ease, background .18s ease;
        }
        .calibration-card:not(:disabled):hover { transform: translateY(-2px); border-color: var(--accent-primary); }
        .calibration-card.selected {
            border-color: color-mix(in srgb, var(--accent-primary) 72%, transparent);
            background: color-mix(in srgb, var(--accent-primary) 10%, rgba(255,255,255,.025));
        }
        .calibration-card > svg { position: absolute; top: 16px; right: 16px; color: var(--accent-primary); }
        .calibration-badge {
            margin-bottom: 18px;
            padding: 4px 7px;
            border-radius: 6px;
            background: rgba(255,255,255,.07);
            color: var(--accent-primary);
            font-size: 9px;
            font-weight: 800;
            letter-spacing: .05em;
        }
        .calibration-card strong { font-size: 14px; color: var(--text-main); }
        .calibration-card small { margin-top: 7px; color: var(--text-muted); font-size: 11px; line-height: 1.48; }
        .calibration-info {
            margin-top: 14px;
            padding: 12px 14px;
            border-left: 3px solid var(--accent-primary);
            border-radius: 6px;
            background: rgba(255,255,255,.025);
            color: var(--text-muted);
            font-size: 11px;
            line-height: 1.5;
        }
        .calibration-workbench {
            margin-top: 16px;
            overflow: hidden;
            border: 1px solid var(--glass-border);
            border-radius: 18px;
            background: linear-gradient(145deg, rgba(255,255,255,.04), rgba(255,255,255,.018));
            transition: opacity .18s ease;
        }
        .gpu-hidden { display: none !important; }
        .gpu-calibration-panel {
            margin-top: 16px;
            overflow: hidden;
            border: 1px solid color-mix(in srgb, var(--accent-primary) 38%, var(--glass-border));
            border-radius: 18px;
            background:
                radial-gradient(circle at 8% 0%, color-mix(in srgb, var(--accent-primary) 13%, transparent), transparent 32%),
                rgba(255,255,255,.022);
        }
        .gpu-calibration-panel.disabled { opacity: .44; }
        .gpu-calibration-hero {
            display: grid;
            grid-template-columns: 42px minmax(0, 1fr) auto;
            align-items: center;
            gap: 13px;
            padding: 17px 18px;
            border-bottom: 1px solid var(--glass-border);
        }
        .gpu-orb {
            display: grid;
            place-items: center;
            width: 42px;
            height: 42px;
            border-radius: 13px;
            background: color-mix(in srgb, var(--accent-primary) 18%, rgba(255,255,255,.04));
            color: var(--accent-primary);
            box-shadow: 0 0 25px color-mix(in srgb, var(--accent-primary) 15%, transparent);
        }
        .gpu-calibration-hero > div:nth-child(2) { display: flex; flex-direction: column; min-width: 0; }
        .gpu-calibration-hero span { color: var(--accent-primary); font-size: 8px; font-weight: 850; letter-spacing: .14em; }
        .gpu-calibration-hero strong { margin-top: 3px; overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
        .gpu-calibration-hero small { margin-top: 3px; color: var(--text-muted); font-size: 9px; }
        .gpu-ready-pill {
            padding: 6px 9px;
            border: 1px solid var(--glass-border);
            border-radius: 999px;
            color: var(--text-muted);
            font-size: 9px;
        }
        .gpu-ready-pill.ready { border-color: rgba(34,197,94,.38); background: rgba(34,197,94,.08); color: #4ade80; }
        .compute-config-panel { padding: 16px 18px; border-bottom: 1px solid var(--glass-border); background: rgba(0,0,0,.09); }
        .compute-config-title { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
        .compute-config-title > div:first-child { display: flex; flex-direction: column; }
        .compute-config-title strong { font-size: 12px; }
        .compute-config-title small { margin-top: 3px; color: var(--text-muted); font-size: 9px; }
        .compute-backend-tabs { display: grid; grid-auto-flow: column; padding: 3px; border: 1px solid var(--glass-border); border-radius: 10px; background: rgba(0,0,0,.22); }
        .compute-backend-tabs button { min-height: 29px !important; padding: 0 10px; border: 0; border-radius: 7px; background: transparent; color: var(--text-muted); font-size: 9px; }
        .compute-backend-tabs button.active { background: color-mix(in srgb, var(--accent-primary) 19%, rgba(255,255,255,.04)); color: var(--text-main); }
        .compute-device-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 13px; }
        .compute-device-list > label { display: flex; align-items: center; gap: 10px; padding: 11px; border: 1px solid var(--glass-border); border-radius: 11px; background: rgba(255,255,255,.022); }
        .compute-device-list > label.selected { border-color: color-mix(in srgb, var(--accent-primary) 58%, transparent); background: color-mix(in srgb, var(--accent-primary) 8%, transparent); }
        .compute-device-list input { accent-color: var(--accent-primary); }
        .compute-device-list label > span { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 7px; min-width: 0; width: 100%; }
        .compute-device-list b { color: var(--accent-primary); font-size: 8px; }
        .compute-device-list strong { overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
        .compute-device-list small { color: var(--text-muted); font-size: 8px; }
        .compute-empty, .compute-warning { grid-column: 1 / -1; padding: 9px 11px; border-radius: 8px; background: rgba(245,158,11,.08); color: #fbbf24; font-size: 9px; }
        .compute-cpu-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin-top: 10px; }
        .compute-cpu-grid > label { display: flex; flex-direction: column; gap: 8px; padding: 11px; border: 1px solid var(--glass-border); border-radius: 11px; background: rgba(255,255,255,.018); }
        .compute-cpu-grid label > span { display: flex; justify-content: space-between; gap: 10px; }
        .compute-cpu-grid strong { font-size: 10px; }
        .compute-cpu-grid output { color: var(--accent-primary); font: 10px ui-monospace, monospace; }
        .compute-cpu-grid input { width: 100%; accent-color: var(--accent-primary); }
        .compute-cpu-grid small { overflow: hidden; color: var(--text-muted); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
        .compute-warning { margin-top: 10px; }
        .gpu-calibration-body {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 18px;
            padding: 18px;
        }
        .gpu-learning-copy { display: flex; flex-direction: column; }
        .gpu-learning-copy strong { font-size: 13px; }
        .gpu-learning-copy small { max-width: 520px; margin-top: 5px; color: var(--text-muted); font-size: 10px; line-height: 1.5; }
        .gpu-learning-copy span { margin-top: 10px; color: var(--accent-primary); font-size: 9px; }
        .gpu-run-button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 7px;
            min-width: 132px;
            min-height: 40px !important;
            padding: 0 14px;
            border: 1px solid color-mix(in srgb, var(--accent-primary) 60%, transparent);
            border-radius: 11px;
            background: color-mix(in srgb, var(--accent-primary) 15%, rgba(255,255,255,.03));
            color: var(--text-main);
            font-size: 11px;
            font-weight: 750;
        }
        .gpu-run-button:not(:disabled):hover { background: color-mix(in srgb, var(--accent-primary) 25%, rgba(255,255,255,.04)); }
        .gpu-spin { animation: gpu-spin .9s linear infinite; }
        @keyframes gpu-spin { to { transform: rotate(360deg); } }
        .gpu-progress-block { padding: 0 18px 16px; }
        .gpu-progress-block > div:first-child { display: flex; justify-content: space-between; gap: 10px; color: var(--text-muted); font-size: 9px; }
        .gpu-progress-block b { color: var(--accent-primary); font-variant-numeric: tabular-nums; }
        .gpu-progress-track { height: 4px; margin-top: 7px; overflow: hidden; border-radius: 999px; background: rgba(255,255,255,.08); }
        .gpu-progress-track i { display: block; height: 100%; border-radius: inherit; background: var(--accent-primary); transition: width .2s ease; }
        .gpu-result { margin: 0 18px 14px; padding: 9px 11px; border-radius: 8px; background: rgba(34,197,94,.08); color: #4ade80; font-size: 10px; }
        .gpu-result.error { background: rgba(239,68,68,.08); color: #f87171; }
        .gpu-save-note { padding: 11px 18px; border-top: 1px solid var(--glass-border); color: var(--text-muted); font-size: 9px; }
        .gpu-save-note code { color: var(--text-main); font-size: 9px; }
        .calibration-workbench.disabled { opacity: .44; }
        .calibration-workbench-head,
        .calibration-precision-row,
        .calibration-anchor-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
            padding: 16px 18px;
            border-bottom: 1px solid var(--glass-border);
        }
        .calibration-workbench-head {
            background: color-mix(in srgb, var(--accent-primary) 7%, transparent);
        }
        .calibration-workbench-head > div,
        .calibration-precision-row > div:first-child,
        .calibration-anchor-row > div:first-child { display: flex; flex-direction: column; min-width: 0; }
        .calibration-workbench-head span {
            color: var(--accent-primary);
            font-size: 8px;
            font-weight: 850;
            letter-spacing: .14em;
        }
        .calibration-workbench-head strong { margin-top: 4px; font-size: 15px; }
        .calibration-workbench-head small,
        .calibration-precision-row small,
        .calibration-anchor-row small { margin-top: 4px; color: var(--text-muted); font-size: 10px; }
        .calibration-reset {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            min-height: 34px !important;
            padding: 0 11px;
            border: 1px solid var(--glass-border);
            border-radius: 9px;
            background: rgba(255,255,255,.04);
            color: var(--text-main);
            font-size: 10px;
        }
        .calibration-segments {
            display: grid;
            grid-auto-flow: column;
            grid-auto-columns: minmax(64px, 1fr);
            padding: 3px;
            border: 1px solid var(--glass-border);
            border-radius: 10px;
            background: rgba(0,0,0,.2);
        }
        .calibration-segments button {
            min-height: 30px !important;
            padding: 0 10px;
            border: 0;
            border-radius: 7px;
            background: transparent;
            color: var(--text-muted);
            font-size: 10px;
        }
        .calibration-segments button.active {
            background: color-mix(in srgb, var(--accent-primary) 18%, rgba(255,255,255,.04));
            color: var(--text-main);
            box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-primary) 45%, transparent);
        }
        .calibration-fine-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 1px;
            background: var(--glass-border);
        }
        .calibration-control {
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 18px;
            background: var(--bg-secondary, #121418);
        }
        .calibration-control > span { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .calibration-control strong { font-size: 12px; }
        .calibration-number-wrap {
            display: flex;
            align-items: center;
            min-width: 92px;
            padding: 2px 7px;
            border-radius: 7px;
            background: rgba(0,0,0,.24);
            color: var(--accent-primary);
        }
        .calibration-number {
            width: 62px;
            padding: 3px 0;
            border: 0;
            outline: 0;
            background: transparent;
            color: var(--accent-primary);
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
            font-size: 10px;
            text-align: right;
        }
        .calibration-number-wrap em { margin-left: 4px; font-size: 9px; font-style: normal; opacity: .7; }
        .calibration-control input[type='range'] { width: 100%; accent-color: var(--accent-primary); }
        .calibration-control small { color: var(--text-muted); font-size: 9px; line-height: 1.5; }
        .calibration-anchor-row { border-bottom: 0; }

        .presentation-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
        }
        .presentation-card {
            display: grid;
            grid-template-columns: 48px minmax(0, 1fr) 20px;
            align-items: center;
            gap: 13px;
            min-height: 92px !important;
            padding: 16px;
            border: 1px solid var(--glass-border);
            border-radius: 16px;
            background: rgba(255,255,255,.026);
            text-align: left;
            transition: transform .18s ease, border-color .18s ease, background .18s ease;
        }
        .presentation-card:hover {
            transform: translateY(-2px);
            border-color: color-mix(in srgb, var(--accent-primary) 55%, transparent);
            background: rgba(255,255,255,.055);
        }
        .presentation-card.selected {
            border-color: var(--accent-primary);
            background: color-mix(in srgb, var(--accent-primary) 11%, rgba(255,255,255,.025));
            box-shadow: 0 14px 34px color-mix(in srgb, var(--accent-primary) 12%, transparent);
        }
        .presentation-icon {
            display: grid;
            place-items: center;
            width: 46px;
            height: 46px;
            border: 1px solid var(--glass-border);
            border-radius: 13px;
            background: rgba(0,0,0,.18);
            color: var(--accent-primary);
            font-size: 22px;
            font-weight: 750;
        }
        .presentation-copy { display: flex; flex-direction: column; min-width: 0; }
        .presentation-copy strong { color: var(--text-main); font-size: 14px; }
        .presentation-copy small { margin-top: 4px; color: var(--text-muted); font-size: 11px; line-height: 1.45; }
        .presentation-card > svg { color: var(--accent-primary); }
        .presentation-note {
            margin-top: 14px;
            padding: 12px 14px;
            border-left: 3px solid var(--accent-primary);
            border-radius: 6px;
            background: rgba(255,255,255,.025);
            color: var(--text-muted);
            font-size: 11px;
            line-height: 1.5;
        }

        .theme-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 12px;
        }
        .theme-card {
            position: relative;
            display: flex;
            align-items: center;
            gap: 12px;
            min-height: 68px;
            padding: 12px;
            text-align: left;
            border: 1px solid var(--glass-border);
            border-radius: 13px;
            background: rgba(255, 255, 255, 0.035);
            transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
        }
        .theme-card:hover {
            transform: translateY(-1px);
            border-color: var(--accent-primary);
            background: rgba(255, 255, 255, 0.07);
        }
        .theme-card-selected {
            border-color: var(--accent-primary);
            background: color-mix(in srgb, var(--accent-primary) 13%, transparent);
            box-shadow: 0 0 18px var(--accent-glow, rgba(0, 255, 242, 0.28));
        }
        .theme-swatches {
            display: flex;
            width: 54px;
            height: 40px;
            overflow: hidden;
            flex: none;
            border-radius: 9px;
            border: 1px solid rgba(255,255,255,0.12);
        }
        .theme-swatches span { flex: 1; }
        .theme-card-copy {
            display: flex;
            flex-direction: column;
            min-width: 0;
        }
        .theme-card-copy strong { color: var(--text-main); font-size: 13px; }
        .theme-card-copy small { color: var(--text-muted); font-size: 11px; line-height: 1.35; margin-top: 3px; }
        .theme-check { color: var(--accent-primary); flex: none; margin-left: auto; }
        @media (max-width: 700px) {
            .settings-view { padding: 24px 20px 130px !important; }
            .settings-page-header { margin-bottom: 18px; }
            .settings-layout { grid-template-columns: 1fr; gap: 14px; }
            .settings-nav {
                position: static;
                min-height: 0;
                flex-direction: row;
                overflow-x: auto;
                padding: 7px;
            }
            .settings-nav button { width: auto; min-width: max-content; }
            .settings-nav button span small, .settings-nav-spacer { display: none; }
            .settings-nav button.active { box-shadow: inset 0 -3px 0 var(--accent-primary); }
            .settings-content-heading { min-height: 54px; }
            .settings-panel { padding: 20px !important; }
            .theme-grid { grid-template-columns: 1fr; }
            .settings-appearance > div,
            .settings-lyrics > div > div,
            .settings-downloads > div > div {
                align-items: stretch !important;
                flex-direction: column !important;
                gap: 10px;
            }
            .settings-select { width: 100%; max-width: none; }
            .presentation-grid { grid-template-columns: 1fr; }
            .calibration-modes { grid-template-columns: 1fr; }
            .calibration-card { min-height: 126px !important; }
            .calibration-workbench-head,
            .calibration-precision-row,
            .calibration-anchor-row { align-items: stretch; flex-direction: column; }
            .calibration-fine-grid { grid-template-columns: 1fr; }
            .calibration-segments { width: 100%; }
            .gpu-calibration-hero { grid-template-columns: 42px minmax(0, 1fr); }
            .gpu-ready-pill { grid-column: 1 / -1; justify-self: start; }
            .gpu-calibration-body { align-items: stretch; flex-direction: column; }
            .gpu-run-button { width: 100%; }
            .compute-config-title { align-items: stretch; flex-direction: column; }
            .compute-backend-tabs { grid-auto-flow: row; grid-template-columns: repeat(2, 1fr); }
            .compute-device-list, .compute-cpu-grid { grid-template-columns: 1fr; }
        }
        @media (min-width: 701px) and (max-width: 1050px) {
            .settings-layout { grid-template-columns: 190px minmax(0, 1fr); gap: 18px; }
            .theme-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .calibration-modes { grid-template-columns: 1fr; }
            .calibration-card { min-height: 124px !important; }
            .calibration-fine-grid { grid-template-columns: 1fr; }
        }
        
        .switch {
            position: relative;
            display: inline-block;
            width: 50px;
            height: 26px;
        }
        .switch input { 
            opacity: 0;
            width: 0;
            height: 0;
        }
        .slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(255, 255, 255, 0.1);
            transition: .4s;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .slider:before {
            position: absolute;
            content: "";
            height: 18px;
            width: 18px;
            left: 3px;
            bottom: 3px;
            background-color: white;
            transition: .4s;
        }
        input:checked + .slider {
            background-color: var(--accent);
            border-color: var(--accent);
        }
        input:focus + .slider {
            box-shadow: 0 0 1px var(--accent);
        }
        input:checked + .slider:before {
            transform: translateX(24px);
        }
        .slider.round {
            border-radius: 34px;
        }
        .slider.round:before {
            border-radius: 50%;
        }
      `}</style>
        </div>
    )
}
