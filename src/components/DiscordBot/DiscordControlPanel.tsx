
import React, { useState, useEffect, useRef } from 'react'
import { Disc, Server, Volume2, LogOut, Power, Radio, Plus, Trash2, User, ChevronDown, Check } from 'lucide-react'
import styles from './DiscordControlPanel.module.css'
import { ConfirmationModal } from '../UI/ConfirmationModal'

interface DiscordGuild {
    id: string
    name: string
    icon: string | null
    memberCount: number
}

interface DiscordChannel {
    id: string
    name: string
    userLimit: number
    members: string[]
}

interface SavedBot {
    token: string
    username: string
    avatar: string | null
}

interface BotPlayback {
    isPlaying: boolean
    playbackStatus: string
    title: string
    artist: string
    streamInputBytes: number
    streamDecodedBytes: number
    streamError: string | null
}

const getPlaybackMessage = (playback: BotPlayback) => {
    if (playback.streamError) return playback.streamError
    switch (playback.playbackStatus) {
        case 'playing': return playback.artist || '正在串流到語音頻道'
        case 'buffering': return '正在緩衝 Discord 音訊…'
        case 'paused': return '已暫停'
        case 'autopaused': return '語音訂閱暫停，正在等待重新連線…'
        case 'idle':
            return playback.streamInputBytes > 0
                ? '已收到音訊，等待 Discord 播放器啟動…'
                : '等待本機播放器送出音訊…'
        default: return `Discord 狀態：${playback.playbackStatus || '未知'}`
    }
}

const getErrorMessage = (error: unknown, fallback: string) => {
    return error instanceof Error ? error.message : fallback
}

const notifyDiscordBotStateChanged = () => {
    window.dispatchEvent(new Event('neonwave:discord-bot-state-changed'))
}

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error(`${label}逾時，請稍後再試。`))
                }, timeoutMs)
            })
        ])
    } finally {
        if (timeoutId) clearTimeout(timeoutId)
    }
}

export const DiscordControlPanel: React.FC = () => {
    const [token, setToken] = useState('')
    const [step, setStep] = useState(1) 
    const [loading, setLoading] = useState(false)
    const [loadingText, setLoadingText] = useState('處理中...')
    const [error, setError] = useState<string | null>(null)
    const operationSeqRef = useRef(0)
    const activeOperationRef = useRef<number | null>(null)

    const [userInfo, setUserInfo] = useState<{ username: string, avatar: string | null } | null>(null)
    const [guilds, setGuilds] = useState<DiscordGuild[]>([])
    const [channels, setChannels] = useState<DiscordChannel[]>([])

    const [selectedGuild, setSelectedGuild] = useState<DiscordGuild | null>(null)
    const [activeChannel, setActiveChannel] = useState<DiscordChannel | null>(null)


    const [savedBots, setSavedBots] = useState<SavedBot[]>([])
    const [isAddingNew, setIsAddingNew] = useState(false)

    // Live playback state of the bot, polled while on the connected screen
    const [botPlayback, setBotPlayback] = useState<BotPlayback | null>(null)

    
    const [modal, setModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        action: () => { },
        isDanger: false,
        confirmText: 'Confirm'
    })

    const openModal = (title: string, message: string, action: () => void, isDanger = false, confirmText = 'Confirm') => {
        setModal({ isOpen: true, title, message, action, isDanger, confirmText })
    }

    const closeModal = () => {
        setModal(prev => ({ ...prev, isOpen: false }))
    }

    
    const [showUserMenu, setShowUserMenu] = useState(false)

    const runOperation = async (label: string, task: () => Promise<void>, fallback: string) => {
        if (activeOperationRef.current !== null) return

        const operationId = ++operationSeqRef.current
        activeOperationRef.current = operationId
        setLoadingText(label)
        setLoading(true)
        setError(null)

        try {
            await task()
        } catch (e: unknown) {
            setError(getErrorMessage(e, fallback))
        } finally {
            if (activeOperationRef.current === operationId) {
                activeOperationRef.current = null
                setLoading(false)
                setLoadingText('處理中...')
            }
        }
    }

    
    useEffect(() => {
        const handleClickOutside = () => setShowUserMenu(false)
        if (showUserMenu) {
            document.addEventListener('click', handleClickOutside)
        }
        return () => document.removeEventListener('click', handleClickOutside)
    }, [showUserMenu])

    const UserMenu = () => {
        if (!userInfo) return null

        return (
            <div className={styles.userMenuContainer} onClick={e => e.stopPropagation()}>
                <div
                    className={`${styles.userInfo} ${showUserMenu ? styles.userInfoActive : ''}`}
                    onClick={() => setShowUserMenu(!showUserMenu)}
                >
                    {userInfo.avatar ? (
                        <img src={userInfo.avatar} className={styles.userAvatar} />
                    ) : (
                        <div className={styles.userAvatar} style={{ background: '#6d28d9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <User size={14} />
                        </div>
                    )}
                    <span className={styles.userName}>{userInfo.username}</span>
                    <ChevronDown size={14} color="#9ca3af" style={{ transform: showUserMenu ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
                </div>

                {showUserMenu && (
                    <div className={styles.userDropdown}>
                        <div className={styles.dropdownHeader}>切換機器人</div>

                        {savedBots.map((bot, idx) => {
                            const isActive = bot.token === localStorage.getItem('discord_bot_token')
                            return (
                                <button
                                    key={idx}
                                    className={`${styles.dropdownItem} ${isActive ? styles.active : ''}`}
                                    onClick={() => {
                                        if (!isActive) handleLogin(bot.token)
                                        setShowUserMenu(false)
                                    }}
                                >
                                    {bot.avatar ? (
                                        <img src={bot.avatar} className={styles.dropdownAvatar} />
                                    ) : (
                                        <div className={styles.dropdownIcon}><User size={16} /></div>
                                    )}
                                    <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {bot.username}
                                    </div>
                                    {isActive && <Check size={16} />}
                                </button>
                            )
                        })}

                        <div className={styles.dropdownDivider} />

                        <button
                            className={styles.dropdownItem}
                            onClick={() => {
                                handleSwitchAccount() 
                                setShowUserMenu(false)
                            }}
                        >
                            <div className={styles.dropdownIcon}><Plus size={16} /></div>
                            <span>新增機器人</span>
                        </button>

                        <div className={styles.dropdownDivider} />

                        <button
                            className={styles.dropdownItem}
                            style={{ color: '#ef4444' }}
                            onClick={() => {
                                handleDisconnect()
                                setShowUserMenu(false)
                            }}
                        >
                            <div className={styles.dropdownIcon} style={{ color: '#ef4444' }}><Power size={16} /></div>
                            <span>斷開連線</span>
                        </button>
                    </div>
                )}
            </div>
        )
    }

    // -- Actions --

    const handleLogin = async (loginToken: string = token) => {
        if (!loginToken || loading) return
        await runOperation('正在連線機器人...', async () => {
            const data = await withTimeout(
                window.ipcRenderer.invoke('discord:login', loginToken),
                30000,
                '連線機器人'
            )
            setUserInfo({ username: data.username, avatar: data.avatar })
            const guildList = await withTimeout(
                window.ipcRenderer.invoke('discord:getGuilds'),
                10000,
                '讀取伺服器'
            )
            setGuilds(guildList)
            setStep(2)

            saveBotAccount(loginToken, data.username, data.avatar)
        }, 'Login failed')
    }

    const saveBotAccount = (botToken: string, username: string, avatar: string | null) => {
        setSavedBots(prev => {
            // Check if exists
            const exists = prev.some(b => b.token === botToken)
            if (exists) {
                // Update info potentially
                const updated = prev.map(b => b.token === botToken ? { token: botToken, username, avatar } : b)
                localStorage.setItem('discord_saved_bots', JSON.stringify(updated))
                return updated
            }
            const newList = [...prev, { token: botToken, username, avatar }]
            localStorage.setItem('discord_saved_bots', JSON.stringify(newList))
            return newList
        })
        // Also keep current token
        localStorage.setItem('discord_bot_token', botToken)
    }

    const removeBotAccount = (botToken: string) => {
        openModal(
            '移除帳號',
            '確定要從列表中移除此機器人帳號嗎？',
            () => {
                setSavedBots(prev => {
                    const newList = prev.filter(b => b.token !== botToken)
                    localStorage.setItem('discord_saved_bots', JSON.stringify(newList))
                    return newList
                })
                closeModal()
            },
            true,
            '移除'
        )
    }

    const handleSelectGuild = async (guild: DiscordGuild) => {
        await runOperation('正在讀取語音頻道...', async () => {
            const channelList = await withTimeout(
                window.ipcRenderer.invoke('discord:getChannels', guild.id),
                10000,
                '讀取語音頻道'
            )
            setChannels(channelList)
            setSelectedGuild(guild)
            setStep(3)
        }, 'Failed to fetch channels')
    }

    const handleJoinChannel = async (channel: DiscordChannel) => {
        if (!selectedGuild) return
        await runOperation('正在加入語音頻道...', async () => {
            await withTimeout(
                window.ipcRenderer.invoke('discord:join', selectedGuild.id, channel.id),
                15000,
                '加入語音頻道'
            )
            setActiveChannel(channel)
            setStep(4)
            notifyDiscordBotStateChanged()
        }, 'Failed to join channel')
    }

    const handleDisconnect = async () => {
        openModal(
            '斷開連線',
            '確定要完全斷開機器人連線嗎？',
            async () => {
                await runOperation('正在斷開連線...', async () => {
                    await withTimeout(
                        window.ipcRenderer.invoke('discord:disconnect'),
                        15000,
                        '斷開連線'
                    )
                    setStep(1)
                    setUserInfo(null)
                    setSelectedGuild(null)
                    setActiveChannel(null)
                    setChannels([])
                    setGuilds([])
                    setToken('')
                    closeModal()
                    notifyDiscordBotStateChanged()
                }, 'Disconnect failed')
            },
            true,
            '斷開連線'
        )
    }

    const handleSwitchAccount = async () => {
        openModal(
            '切換帳號',
            '確定要切換帳號嗎？目前的機器人將會斷線。',
            async () => {
                await runOperation('正在準備切換帳號...', async () => {
                    await withTimeout(
                        window.ipcRenderer.invoke('discord:disconnect'),
                        15000,
                        '切換帳號'
                    )
                    setStep(1)
                    setUserInfo(null)
                    setSelectedGuild(null)
                    setActiveChannel(null)
                    setChannels([])
                    setGuilds([])
                    setIsAddingNew(false)
                    closeModal()
                    notifyDiscordBotStateChanged()
                }, 'Switch account failed')
            },
            false,
            '切換'
        )
    }

    const handleLeaveChannel = async () => {
        await runOperation('正在離開語音頻道...', async () => {
            await withTimeout(
                window.ipcRenderer.invoke('discord:leave'),
                15000,
                '離開語音頻道'
            )
            setActiveChannel(null)
            setStep(3)
            notifyDiscordBotStateChanged()
        }, 'Leave channel failed')
    }

    useEffect(() => {
        const checkStatus = async (showLoading = false) => {
            if (activeOperationRef.current !== null) return
            if (showLoading) setLoading(true)
            // Load saved bots
            try {
                const saved = localStorage.getItem('discord_saved_bots')
                if (saved) {
                    setSavedBots(JSON.parse(saved))
                }
            } catch (e) {
                console.error("Failed to parse saved bots", e)
            }

            const savedToken = localStorage.getItem('discord_bot_token')
            if (savedToken) setToken(savedToken)

            try {
                const status = await withTimeout(
                    window.ipcRenderer.invoke('discord:status'),
                    5000,
                    '讀取 Discord 狀態'
                )
                if (activeOperationRef.current !== null) return
                if (status.isConnected) {
                    setUserInfo({
                        username: status.username || 'Bot',
                        avatar: status.avatar
                    })

                    // We need to reconstruct minimal guild/channel objects to satisfy the UI state
                    if (status.currentGuildId) {
                        setSelectedGuild({
                            id: status.currentGuildId,
                            name: status.currentGuildName || 'Unknown Server',
                            icon: null, 
                            memberCount: 0
                        })
                    }

                    if (status.currentChannelId) {
                        setActiveChannel({
                            id: status.currentChannelId,
                            name: status.currentChannelName || 'Unknown Channel',
                            userLimit: 0,
                            members: []
                        })
                        
                        setStep(4)
                    } else {
                        
                        
                        const guildList = await withTimeout(
                            window.ipcRenderer.invoke('discord:getGuilds'),
                            10000,
                            '讀取伺服器'
                        )
                        if (activeOperationRef.current !== null) return
                        setGuilds(guildList)
                        setStep(2)
                    }
                } else if (showLoading) {
                    setStep(1)
                    setUserInfo(null)
                    setSelectedGuild(null)
                    setActiveChannel(null)
                }
            } catch (e) {
                console.error("Failed to check discord status", e)
            } finally {
                if (showLoading) setLoading(false)
            }
        }
        checkStatus(true)

        const interval = setInterval(() => checkStatus(false), 15000)
        return () => clearInterval(interval)
    }, [])

    // Poll bot playback state (drives the equalizer animation) — connected screen only
    useEffect(() => {
        if (step !== 4) {
            setBotPlayback(null)
            return
        }
        let stopped = false
        const tick = async () => {
            try {
                const status = await window.ipcRenderer.invoke('discord:status')
                if (stopped) return
                setBotPlayback({
                    isPlaying: !!status.isPlaying,
                    playbackStatus: status.playbackStatus || 'idle',
                    title: status.nowPlaying?.title || '',
                    artist: status.nowPlaying?.artist || '',
                    streamInputBytes: Number(status.streamInputBytes || 0),
                    streamDecodedBytes: Number(status.streamDecodedBytes || 0),
                    streamError: status.streamError || null
                })
            } catch {
                // Keep the last known state on transient IPC failures.
            }
        }
        tick()
        const interval = setInterval(tick, 2000)
        return () => {
            stopped = true
            clearInterval(interval)
        }
    }, [step])

    

    const renderStep1 = () => {
        if (savedBots.length > 0 && !isAddingNew) {
            return (
                <div className={styles.content}>
                    <div className={styles.card}>
                        <div className={styles.header}>
                            <Disc size={48} className={styles.iconSpin} />
                            <h2 className={styles.title}>選擇機器人</h2>
                            <p className={styles.subtitle}>選擇已儲存的機器人帳號或新增。</p>
                        </div>

                        <div className={styles.accountList}>
                            {savedBots.map((bot, index) => (
                                <div key={index} className={styles.accountItem}>
                                    <div className={styles.accountInfo} onClick={() => handleLogin(bot.token)}>
                                        {bot.avatar ? (
                                            <img src={bot.avatar} className={styles.accountAvatar} alt="avatar" />
                                        ) : (
                                            <div className={styles.accountAvatarPlaceholder}>
                                                <User size={20} />
                                            </div>
                                        )}
                                        <span className={styles.accountName}>{bot.username}</span>
                                    </div>
                                    <button
                                        className={styles.deleteBtn}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            removeBotAccount(bot.token)
                                        }}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>

                        <button
                            className={styles.btnAddAccount}
                            onClick={() => {
                                setToken('')
                                setIsAddingNew(true)
                            }}
                        >
                            <Plus size={18} /> 新增機器人
                        </button>
                    </div>
                </div>
            )
        }

        return (
            <div className={styles.content}>
                <div className={styles.card}>
                    <div className={styles.header}>
                        <Disc size={48} className={styles.iconSpin} />
                        <h2 className={styles.title}>
                            Discord 機器人連線
                        </h2>
                        <p className={styles.subtitle}>直接在您的 Discord 伺服器中控制音樂播放。</p>
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.label}>機器人 Token</label>
                        <input
                            type="password"
                            value={token}
                            onChange={e => setToken(e.target.value)}
                            className={styles.input}
                            placeholder="請輸入 Discord Bot Token..."
                            disabled={loading}
                        />
                    </div>

                    {error && <div className={styles.error}>{error}</div>}

                    <div style={{ display: 'flex', gap: '10px' }}>
                        {savedBots.length > 0 && (
                            <button
                                onClick={() => setIsAddingNew(false)}
                                className={styles.btnSecondary}
                                style={{ flex: 1 }}
                            >
                                返回列表
                            </button>
                        )}
                        <button
                            onClick={() => handleLogin(token)}
                            disabled={loading || !token}
                            className={styles.button}
                            style={{ flex: 2 }}
                        >
                            {loading ? '連線中...' : '連線機器人'}
                        </button>
                    </div>

                    <p className={styles.footerText}>
                        還沒有機器人？前往 <a href="#" onClick={() => window.open('https://discord.com/developers/applications')} className={styles.link}>Discord Developer Portal</a> 建立一個。
                    </p>
                </div>
            </div>
        )
    }

    const renderStep2 = () => (
        <div className={styles.fullPageContainer}>
            <div className={styles.navHeader}>
                <h2 className={styles.navTitle}>
                    <Server color="#a855f7" /> 選擇伺服器
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <UserMenu />
                    <button onClick={() => setStep(1)} className={styles.backBtn}>返回</button>
                </div>
            </div>

            <div className={styles.grid}>
                {guilds.map(guild => (
                    <button
                        key={guild.id}
                        onClick={() => handleSelectGuild(guild)}
                        className={styles.cardItem}
                    >
                        {guild.icon ? (
                            <img src={guild.icon} alt={guild.name} className={styles.guildIcon} />
                        ) : (
                            <div className={styles.guildPlaceholder}>
                                {guild.name.substring(0, 2)}
                            </div>
                        )}
                        <div style={{ minWidth: 0, width: '100%' }}>
                            <div className={styles.itemName}>{guild.name}</div>
                            <div className={styles.itemSub}>{guild.memberCount} 位成員</div>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    )

    const renderStep3 = () => (
        <div className={styles.fullPageContainer}>
            <div className={styles.navHeader}>
                <h2 className={styles.navTitle}>
                    <span onClick={() => setStep(2)} style={{ cursor: 'pointer', opacity: 0.7 }}>{selectedGuild?.name}</span>
                    <span style={{ margin: '0 8px', opacity: 0.4 }}>/</span>
                    <Volume2 color="#f472b6" /> 選擇語音頻道
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <UserMenu />
                    <button onClick={() => setStep(2)} className={styles.backBtn}>返回</button>
                </div>
            </div>

            <div className={styles.grid} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                {channels.map(channel => (
                    <button
                        key={channel.id}
                        onClick={() => handleJoinChannel(channel)}
                        disabled={loading}
                        className={styles.channelItem}
                    >
                        <div className={styles.channelItemLeft}>
                            <Volume2 size={20} color="#9ca3af" />
                            <div style={{ textAlign: 'left' }}>
                                <div style={{ color: '#e5e7eb', fontWeight: 500 }}>{channel.name}</div>
                                <div style={{ fontSize: '11px', color: '#6b7280' }}>{channel.members.length} 人在線</div>
                            </div>
                        </div>
                        <div className={styles.joinBadge}>
                            加入
                        </div>
                    </button>
                ))}
                {channels.length === 0 && (
                    <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#6b7280', padding: '40px' }}>
                        此伺服器中沒有發現語音頻道。
                    </div>
                )}
            </div>
        </div>
    )

    const renderStep4 = () => (
        <div className={styles.connectedContainer}>
            {/* Status Icon */}
            <div className={styles.statusIconWrapper}>
                <div className={styles.glow}></div>
                <Radio size={60} color="#a855f7" style={{ position: 'relative', zIndex: 10 }} />
                <div className={styles.onlineBadge}></div>
            </div>

            {/* Title */}
            <div>
                <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px' }}>已連線到 Discord</h2>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#9ca3af', fontSize: '14px' }}>
                    <Server size={14} /> {selectedGuild?.name}
                    <span>•</span>
                    <Volume2 size={14} /> {activeChannel?.name}
                </div>
            </div>

            {/* Now Playing visualizer */}
            <div className={`${styles.nowPlayingBox} ${botPlayback?.isPlaying ? styles.isPlaying : ''}`}>
                <Disc
                    size={28}
                    className={`${styles.nowPlayingDisc} ${botPlayback?.isPlaying ? styles.spinning : ''}`}
                />
                <div className={styles.nowPlayingText}>
                    {botPlayback?.title ? (
                        <>
                            <div className={styles.nowPlayingTitle}>{botPlayback.title}</div>
                            <div className={styles.nowPlayingSub}>
                                {getPlaybackMessage(botPlayback)}
                            </div>
                        </>
                    ) : (
                        <>
                            <div className={styles.nowPlayingTitle}>等待播放中</div>
                            <div className={styles.nowPlayingSub}>在主播放器點播歌曲，機器人就會開始串流</div>
                        </>
                    )}
                </div>
                <div className={`${styles.equalizer} ${botPlayback?.isPlaying ? styles.playing : ''}`}>
                    <span /><span /><span /><span /><span />
                </div>
            </div>

            {/* Info Box */}
            <div className={styles.infoBox}>
                <h3 className={styles.infoTitle}>💡 使用提示</h3>
                <p className={styles.infoDesc}>
                    • 在主播放器中播放歌曲，機器人會自動同步<br />
                    • 本地播放器會自動靜音，音樂轉給機器人播放<br />
                    • 所有播放控制、音量調整皆同步主播放器
                </p>
            </div>

            { }
            <div className={styles.actions}>
                <button
                    onClick={handleSwitchAccount}
                    className={styles.btnSecondary}
                >
                    <User size={18} /> 切換帳號
                </button>
                <button
                    onClick={handleLeaveChannel}
                    className={styles.btnSecondary}
                >
                    <LogOut size={18} /> 離開頻道
                </button>

                <button
                    onClick={handleDisconnect}
                    className={styles.btnDanger}
                >
                    <Power size={18} /> 斷開連線
                </button>
            </div>
        </div>
    )

    return (
        <div className={styles.container}>
            <div className={styles.backgroundGradient} />
            {step === 1 && renderStep1()}
            {step === 2 && renderStep2()}
            {step === 3 && renderStep3()}
            {step === 4 && renderStep4()}

            {loading && (
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    backgroundColor: 'rgba(0,0,0,0.7)',
                    backdropFilter: 'blur(4px)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 100
                }}>
                    <Disc size={48} className={styles.iconSpin} />
                    <div style={{ marginTop: '16px', color: '#fff', fontWeight: 500 }}>
                        {loadingText}
                    </div>
                </div>
            )}

            <ConfirmationModal
                isOpen={modal.isOpen}
                title={modal.title}
                message={modal.message}
                onConfirm={modal.action}
                onCancel={closeModal}
                isDanger={modal.isDanger}
                confirmText={modal.confirmText}
            />
        </div>
    )
}
