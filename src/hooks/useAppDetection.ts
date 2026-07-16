import { useState, useEffect, useRef } from 'react'

const IDE_APPS = ['code', 'visual studio', 'intellij', 'webstorm', 'atom', 'sublime_text']
const WORK_APPS = ['word', 'excel', 'powerpoint', 'notion', 'slack', 'teams']
const GAME_APPS = ['league of legends', 'valorant', 'minecraft', 'csgo', 'apex', 'overwatch', 'genshinimpact']

export function useAppDetection() {
    const [currentApp, setCurrentApp] = useState<string>('')
    const [contextMode, setContextMode] = useState<'normal' | 'work' | 'game'>('normal')
    const currentAppRef = useRef(currentApp)
    currentAppRef.current = currentApp

    useEffect(() => {
        // Foreground-app detection is Windows-only (PowerShell monitor);
        // elsewhere the IPC always returns "unknown", so skip the polling.
        if (navigator.userAgent.indexOf('Windows') === -1) return

        const checkApp = async () => {
            try {
                const appName = await window.ipcRenderer.invoke('app:active-window')
                const lowerName = appName.toLowerCase()

                if (lowerName !== currentAppRef.current) {
                    setCurrentApp(lowerName)

                    if (IDE_APPS.some(a => lowerName.includes(a)) || WORK_APPS.some(a => lowerName.includes(a))) {
                        setContextMode('work')
                    } else if (GAME_APPS.some(a => lowerName.includes(a))) {
                        setContextMode('game')
                    } else {
                        setContextMode('normal')
                    }
                }
            } catch (e) {
                console.warn(e)
            }
        }

        const interval = setInterval(checkApp, 2000)

        return () => clearInterval(interval)
    }, []) // Mount once — use ref for latest value

    return {
        currentApp,
        contextMode
    }
}
