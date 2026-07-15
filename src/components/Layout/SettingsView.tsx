import { useState, useEffect } from 'react'
import { RefreshCw, Download, CheckCircle, AlertCircle, Globe } from 'lucide-react'
import { ListeningPartyPanel } from '../Party/ListeningPartyPanel'

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

export function SettingsView() {
    const { status, progress, version, error, checkForUpdates, installUpdate } = useUpdater()

    const [lyricsProvider, setLyricsProvider] = useState(() => localStorage.getItem('neonwave_lyrics_ai_provider') || 'default')
    const [lyricsKey, setLyricsKey] = useState(() => localStorage.getItem('neonwave_lyrics_ai_key') || '')
    const [lyricsEndpoint, setLyricsEndpoint] = useState(() => localStorage.getItem('neonwave_lyrics_ai_endpoint') || '')
    const [lyricsModel, setLyricsModel] = useState(() => localStorage.getItem('neonwave_lyrics_ai_model') || '')
    const [lyricsMode, setLyricsMode] = useState(() => localStorage.getItem('neonwave_lyrics_ai_mode') || 'filename')
    const [lyricsReasoning, setLyricsReasoning] = useState(() => localStorage.getItem('neonwave_lyrics_ai_reasoning') || 'none')
    const [localCal, setLocalCal] = useState(() => localStorage.getItem('neonwave_local_audio_calibration') !== 'false')
    const [saveSuccess, setSaveSuccess] = useState(false)

    return (
        <div style={{ padding: '40px', maxWidth: '800px' }}>
            <h2 style={{ fontSize: '28px', marginBottom: '32px', fontWeight: 700 }}>設定</h2>

            <div style={{ marginBottom: '24px' }}>
                <ListeningPartyPanel />
            </div>

            <div className="glass" style={{ padding: '32px', borderRadius: '24px' }}>
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

                    <div style={{ marginTop: '24px', borderTop: '1px solid var(--glass-border)', paddingTop: '24px' }}>
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
                    </div>

                    <div style={{ marginTop: '24px', borderTop: '1px solid var(--glass-border)', paddingTop: '24px' }}>
                        <h4 style={{ marginBottom: '16px', color: 'var(--text-main)' }}>介面設定</h4>
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

                        {/* Subtitle Style Option */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', borderTop: '1px dashed rgba(255,255,255,0.08)', paddingTop: '16px' }}>
                            <div>
                                <div style={{ color: 'var(--text-main)' }}>歌詞字幕/彈幕樣式</div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', maxWidth: '480px', marginTop: '4px', lineHeight: '1.5' }}>
                                    自訂懸浮歌詞/彈幕的視覺外觀樣式。
                                </div>
                            </div>
                            <select
                                className="settings-select"
                                defaultValue={localStorage.getItem('neonwave_subtitle_style') || 'neon'}
                                onChange={(e) => {
                                    localStorage.setItem('neonwave_subtitle_style', e.target.value);
                                    window.dispatchEvent(new Event('neonwave:settings-changed'));
                                }}
                            >
                                <option value="neon">🌟 經典霓虹 (Classic Neon)</option>
                                <option value="minimal">📝 極簡黑白 (Minimalist)</option>
                                <option value="cyberpunk">🤖 賽博龐克 (Cyberpunk)</option>
                                <option value="glass">🫧 毛玻璃膠囊 (Glass Capsule)</option>
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
                    </div>
                </div>

                <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '24px', marginTop: '24px' }}>
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

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                            <div>
                                <span style={{ color: 'var(--text-muted)' }}>本地音訊起點偵測校準</span>
                                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>自動分析本地音檔前奏靜音長度，精準對齊歌詞起點（省去手動調整）</div>
                            </div>
                            <label className="switch">
                                <input
                                    type="checkbox"
                                    checked={localCal}
                                    onChange={(e) => setLocalCal(e.target.checked)}
                                />
                                <span className="slider round"></span>
                            </label>
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
                                    localStorage.setItem('neonwave_local_audio_calibration', String(localCal))
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
                </div>

                <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '24px', marginTop: '24px' }}>
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
                </div>
            </div>

            <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
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
