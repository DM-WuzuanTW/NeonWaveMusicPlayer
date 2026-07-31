import { Client, GatewayIntentBits, ChannelType, ActivityType, PermissionFlagsBits } from 'discord.js';
import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    StreamType,
    AudioResource,
    AudioPlayerStatus,
    entersState,
    VoiceConnectionStatus,
    type DiscordGatewayAdapterCreator,
    type VoiceConnection,
    type VoiceConnectionState
} from '@discordjs/voice';
import type { RateLimitData } from '@discordjs/rest';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

const LOGIN_TIMEOUT_MS = 20_000;
const LOGIN_COOLDOWN_MS = 15_000;
const VOICE_JOIN_COOLDOWN_MS = 5_000;
const RATE_LIMIT_BUFFER_MS = 1_000;

export class DiscordBotManager {
    private client: Client | null = null;
    private player = createAudioPlayer();
    private currentResource: AudioResource | null = null;
    private currentConnection: VoiceConnection | null = null;
    private streamInput: PassThrough | null = null;
    private currentProcess: ChildProcess | null = null;
    private currentToken: string | null = null;
    private loginPromise: Promise<{ username: string, avatar: string | null }> | null = null;
    private nextLoginAllowedAt = 0;
    private nextVoiceJoinAllowedAt = 0;
    // Volume survives track switches — every new resource re-applies it.
    private lastVolume = 1.0;
    private nowPlaying: { title: string; artist: string } | null = null;
    private lastPresenceKey = '';
    private lastPresenceAt = 0;
    public isConnected = false;
    public currentGuildId: string | null = null;
    public currentChannelId: string | null = null;

    constructor() {
        this.player.on('error', error => {
            console.error('[DiscordBot] Audio Player Error:', error.message);
        });
        this.player.on(AudioPlayerStatus.Playing, () => {
            console.log('[DiscordBot] Voice stream is playing');
        });
        this.player.on(AudioPlayerStatus.Idle, () => {
            console.log('[DiscordBot] Voice stream is idle');
        });
    }

    async login(token: string): Promise<{ username: string, avatar: string | null }> {
        const normalizedToken = token.trim();
        if (!normalizedToken) throw new Error('Discord bot token is required');

        if (this.client?.user && this.isConnected && this.currentToken === normalizedToken) {
            return {
                username: this.client.user.tag,
                avatar: this.client.user.avatarURL()
            };
        }

        if (this.loginPromise) return this.loginPromise;

        const now = Date.now();
        if (now < this.nextLoginAllowedAt) {
            const seconds = Math.ceil((this.nextLoginAllowedAt - now) / 1000);
            throw new Error(`Discord is rate limiting bot login. Please wait ${seconds}s before trying again.`);
        }

        this.loginPromise = this.performLogin(normalizedToken).finally(() => {
            this.loginPromise = null;
        });

        return this.loginPromise;
    }

    private async performLogin(token: string): Promise<{ username: string, avatar: string | null }> {
        if (this.client) {
            await this.disconnect();
        }

        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildVoiceStates
            ],
            rest: {
                globalRequestsPerSecond: 10,
                offset: 250,
                retries: 5,
                timeout: 20_000,
                invalidRequestWarningInterval: 50
            }
        });

        this.client.rest.on('rateLimited', (info: RateLimitData) => {
            const retryAfter = Number(info?.retryAfter || info?.timeToReset || 0);
            if (retryAfter > 0) {
                const retryAt = Date.now() + retryAfter + RATE_LIMIT_BUFFER_MS;
                this.nextLoginAllowedAt = Math.max(this.nextLoginAllowedAt, retryAt);
                this.nextVoiceJoinAllowedAt = Math.max(this.nextVoiceJoinAllowedAt, retryAt);
            }
            console.warn('[DiscordBot] REST rate limited:', {
                route: info?.route,
                method: info?.method,
                retryAfter,
                global: info?.global,
                scope: info?.scope
            });
        });

        this.client.on('error', (error) => {
            console.error('[DiscordBot] Client Error:', error.message);
        });

        try {
            const result = await new Promise<{ username: string, avatar: string | null }>((resolve, reject) => {
                if (!this.client) return reject("Client init failed");

                let settled = false;
                const finish = (callback: () => void) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    callback();
                };

                const timeout = setTimeout(() => {
                    finish(() => reject(new Error("Login timed out")));
                }, LOGIN_TIMEOUT_MS);

                this.client.once('ready', async (c) => {
                    finish(() => {
                        this.isConnected = true;
                        this.currentToken = token;
                        this.nextLoginAllowedAt = Date.now() + LOGIN_COOLDOWN_MS;
                        resolve({
                            username: c.user.tag,
                            avatar: c.user.avatarURL()
                        });
                    });
                });

                this.client.login(token).catch((e) => {
                    finish(() => reject(e));
                });
            });

            return result;
        } catch (e: unknown) {
            this.applyRateLimitBackoff(e);
            await this.destroyClientOnly();
            throw e;
        }
    }

    getGuilds() {
        if (!this.client || !this.isConnected) throw new Error("Bot not connected");
        return this.client.guilds.cache.map(g => ({
            id: g.id,
            name: g.name,
            icon: g.iconURL(),
            memberCount: g.memberCount
        })).sort((a, b) => a.name.localeCompare(b.name));
    }

    getChannels(guildId: string) {
        if (!this.client || !this.isConnected) throw new Error("Bot not connected");
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) throw new Error("Guild not found");

        const channels = guild.channels.cache
            .filter(c => c.type === ChannelType.GuildVoice)
            .map(c => ({
                id: c.id,
                name: c.name,
                userLimit: c.userLimit,
                members: c.members.map(m => m.user.tag)
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        return channels;
    }

    async joinChannel(guildId: string, channelId: string) {
        if (!this.client || !this.isConnected) throw new Error("Bot not connected");
        if (
            this.currentConnection &&
            this.currentGuildId === guildId &&
            this.currentChannelId === channelId &&
            this.currentConnection.state.status !== 'destroyed' &&
            this.currentConnection.state.status !== 'disconnected'
        ) {
            return true;
        }

        const now = Date.now();
        if (now < this.nextVoiceJoinAllowedAt) {
            const seconds = Math.ceil((this.nextVoiceJoinAllowedAt - now) / 1000);
            throw new Error(`Discord voice join is cooling down. Please wait ${seconds}s before trying again.`);
        }

        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) throw new Error("Guild not found");

        const channel = guild.channels.cache.get(channelId);
        if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error("Invalid channel");
        const botMember = guild.members.me;
        const permissions = botMember ? channel.permissionsFor(botMember) : null;
        const missingPermissions = [
            !permissions?.has(PermissionFlagsBits.ViewChannel) ? 'View Channel' : null,
            !permissions?.has(PermissionFlagsBits.Connect) ? 'Connect' : null,
            !permissions?.has(PermissionFlagsBits.Speak) ? 'Speak' : null
        ].filter((permission): permission is string => !!permission);
        if (missingPermissions.length > 0) {
            throw new Error(`Bot is missing voice permission(s): ${missingPermissions.join(', ')}`);
        }

        try {
            if (this.currentConnection) {
                this.stop();
                try { this.currentConnection.destroy(); } catch {
                    // Already disconnected.
                }
                this.currentConnection = null;
            }

            const connection = joinVoiceChannel({
                channelId: channelId,
                guildId: guildId,
                adapterCreator: guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
                selfDeaf: true,
                selfMute: false
            });

            this.currentConnection = connection;
            this.nextVoiceJoinAllowedAt = Date.now() + VOICE_JOIN_COOLDOWN_MS;
            
            connection.on('stateChange', async (_oldState: VoiceConnectionState, newState: VoiceConnectionState) => {
                const status = newState.status;
                if (status === 'disconnected') {
                    try {
                        await Promise.race([
                            entersState(connection, VoiceConnectionStatus.Signalling, 5000),
                            entersState(connection, VoiceConnectionStatus.Connecting, 5000)
                        ]);
                        
                    } catch (error) {
                        
                        if (this.currentConnection === connection) {
                            try { connection.destroy(); } catch {
                                // Already disconnected.
                            }
                            this.currentConnection = null;
                            this.currentChannelId = null;
                            this.currentGuildId = null;
                        }
                    }
                } else if (status === 'destroyed') {
                    if (this.currentConnection === connection) {
                        this.currentConnection = null;
                        this.currentChannelId = null;
                        this.currentGuildId = null;
                        this.stop();
                    }
                }
            });

            connection.subscribe(this.player);
            await entersState(connection, VoiceConnectionStatus.Ready, 15000);

            this.currentGuildId = guildId;
            this.currentChannelId = channelId;
            const voiceState = guild.members.me?.voice;
            if (voiceState?.serverMute) {
                await this.leaveChannel();
                throw new Error('Bot is server-muted in this voice channel.');
            }

            return true;
        } catch (e) {
            this.applyRateLimitBackoff(e);
            throw e;
        }
    }

    async leaveChannel() {
        this.stop();
        this.clearBotPresence();
        if (this.currentConnection) {
            this.currentConnection.destroy();
            this.currentConnection = null;
            this.currentGuildId = null;
            this.currentChannelId = null;
            return true;
        }
        return false;
    }

    async disconnect() {
        this.stop();
        await this.leaveChannel();
        if (this.client) {
            await this.destroyClientOnly();
        }
    }

    getStatus() {
        return {
            isConnected: this.isConnected,
            username: this.client?.user?.tag || null,
            avatar: this.client?.user?.avatarURL() || null,
            currentGuildId: this.currentGuildId,
            currentChannelId: this.currentChannelId,
            currentGuildName: this.client?.guilds.cache.get(this.currentGuildId!)?.name || null,
            currentChannelName: this.client?.guilds.cache.get(this.currentGuildId!)?.channels.cache.get(this.currentChannelId!)?.name || null,
            isPlaying: this.player.state.status === AudioPlayerStatus.Playing,
            nowPlaying: this.nowPlaying
        };
    }

    // Mirror the app's current track onto the bot's Discord presence
    // ("Listening to <song>"). Throttled: only when the shown text changes,
    // at most once every 5s (gateway presence updates are rate limited).
    updateNowPlaying(title: string, artist: string, isPlaying: boolean) {
        this.nowPlaying = title ? { title, artist } : null;

        if (!this.client?.user || !this.isConnected || !this.currentChannelId) return;

        const name = title
            ? (isPlaying ? `${title}${artist ? ` - ${artist}` : ''}` : `⏸ ${title}`)
            : '';
        const key = name;
        const now = Date.now();
        if (key === this.lastPresenceKey) return;
        if (now - this.lastPresenceAt < 5000) return; // retried by the next sync tick

        this.lastPresenceKey = key;
        this.lastPresenceAt = now;
        try {
            if (name) {
                this.client.user.setActivity({ name, type: ActivityType.Listening });
            } else {
                this.client.user.setPresence({ activities: [] });
            }
        } catch (e) {
            console.warn('[DiscordBot] Failed to update presence:', e);
        }
    }

    private clearBotPresence() {
        this.nowPlaying = null;
        this.lastPresenceKey = '';
        try {
            this.client?.user?.setPresence({ activities: [] });
        } catch {
            // Client may already be destroyed.
        }
    }

    private killCurrentProcess() {
        if (this.currentProcess) {
            console.log('[DiscordBot] Killing active FFmpeg process');
            try {
                this.currentProcess.kill();
            } catch (e) {
                // Process may already have exited.
            }
            this.currentProcess = null;
        }
    }

    private async destroyClientOnly() {
        if (!this.client) return;

        try {
            await this.client.destroy();
        } catch (e) {
            console.warn('[DiscordBot] Client destroy failed:', e);
        }

        this.client = null;
        this.isConnected = false;
        this.currentToken = null;
    }

    private applyRateLimitBackoff(error: unknown) {
        const errorLike = error as {
            retry_after?: number | string;
            retryAfter?: number | string;
            status?: number;
            code?: number;
            message?: string;
        };
        const retryAfterSeconds = Number(errorLike.retry_after ?? errorLike.retryAfter ?? 0);
        const retryAfterMs = retryAfterSeconds > 0 && retryAfterSeconds < 1000
            ? retryAfterSeconds * 1000
            : retryAfterSeconds;
        const is429 = errorLike.status === 429 || errorLike.code === 429 || String(errorLike.message || '').includes('429');

        if (!is429 && retryAfterMs <= 0) return;

        const delay = Math.max(retryAfterMs, LOGIN_COOLDOWN_MS) + RATE_LIMIT_BUFFER_MS;
        const retryAt = Date.now() + delay;
        this.nextLoginAllowedAt = Math.max(this.nextLoginAllowedAt, retryAt);
        this.nextVoiceJoinAllowedAt = Math.max(this.nextVoiceJoinAllowedAt, retryAt);
    }

    async playFile(filePath: string, ffmpegPath?: string, startTime = 0) {
        if (!this.currentConnection) {
            throw new Error('No active voice connection. Please join a channel first.');
        }

        const connState = this.currentConnection.state.status;

        if (connState === 'destroyed' || connState === 'disconnected') {
            throw new Error(`Voice connection is ${connState}. Cannot play audio.`);
        }

        await entersState(this.currentConnection, VoiceConnectionStatus.Ready, 15_000);
        this.stop();

        if (!ffmpegPath) {
            const resource = createAudioResource(filePath, {
                metadata: { title: filePath },
                inlineVolume: true
            });
            this.currentResource = resource;
            resource.volume?.setVolume(this.lastVolume);
            this.player.play(resource);
            return;
        }

        const { spawn } = await import('node:child_process');

        const args = [
            '-nostdin',
            '-hide_banner',
            '-analyzeduration', '0',
            '-loglevel', 'error',
            ...(Number.isFinite(startTime) && startTime > 0 ? ['-ss', String(startTime)] : []),
            '-i', filePath,
            '-vn',
            '-acodec', 'pcm_s16le',
            '-f', 's16le',
            '-ar', '48000',
            '-ac', '2',
            'pipe:1'
        ];

        const ffmpegProcess = spawn(ffmpegPath, args);
        this.currentProcess = ffmpegProcess;

        let stderr = '';

        ffmpegProcess.on('error', (err) => {
            console.error('[DiscordBot] FFmpeg Spawn Error:', err);
        });

        ffmpegProcess.stderr?.on('data', chunk => {
            stderr = (stderr + chunk.toString()).slice(-4_000);
        });

        ffmpegProcess.on('close', code => {
            if (this.currentProcess === ffmpegProcess) {
                this.currentProcess = null;
            }
            if (code && code !== 0) {
                console.error(`[DiscordBot] FFmpeg exited with code ${code}: ${stderr || 'unknown error'}`);
            }
        });

        const resource = createAudioResource(ffmpegProcess.stdout, {
            inputType: StreamType.Raw,
            metadata: {
                title: filePath
            },
            inlineVolume: true
        });
        this.currentResource = resource;
        resource.volume?.setVolume(this.lastVolume);

        this.player.play(resource);
        try {
            await entersState(this.player, AudioPlayerStatus.Playing, 15_000);
        } catch {
            this.stop();
            const detail = stderr.trim();
            throw new Error(`Discord audio failed to start${detail ? `: ${detail}` : ''}`);
        }
    }

    pause() {
        this.player.pause();
    }

    resume() {
        this.player.unpause();
    }

    stop() {
        this.player.stop();
        this.killCurrentProcess();
        if (this.streamInput && !this.streamInput.destroyed) {
            try { this.streamInput.destroy(); } catch {
                // Stream is already closing.
            }
        }
        this.streamInput = null;
    }

    setVolume(volume: number) {
        const normalized = Math.max(0, Math.min(100, volume)) / 100;
        this.lastVolume = normalized;

        if (this.currentResource && this.currentResource.volume) {
            this.currentResource.volume.setVolume(normalized);
            return true;
        }
        return false;
    }

    async playReceiverStream() {
        if (!this.currentConnection) throw new Error("Not connected");
        await entersState(this.currentConnection, VoiceConnectionStatus.Ready, 15000);

        this.killCurrentProcess(); 
        if (this.streamInput && !this.streamInput.destroyed) {
            try { this.streamInput.destroy(); } catch {
                // Stream is already closing.
            }
        }

        const streamInput = new PassThrough();
        this.streamInput = streamInput;
        streamInput.on('error', error => {
            console.error('[DiscordBot] Voice input stream error:', error);
        });

        const resource = createAudioResource(streamInput, {
            inputType: StreamType.Raw,
            inlineVolume: true
        });

        this.currentResource = resource;
        resource.volume?.setVolume(this.lastVolume);
        this.player.play(resource);

        return true;
    }

    writeAudioChunk(buffer: Uint8Array) {
        if (this.streamInput && !this.streamInput.destroyed) {
            try {
                this.streamInput.write(buffer);
            } catch (e) {
                // Stream teardown can race with disconnect.
            }
        }
    }
}
