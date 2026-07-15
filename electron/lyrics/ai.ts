// Single entry point for every AI provider the lyrics engine can call.
// Replaces four near-identical fetch blocks that used to live in main.ts.

export interface AiConfig {
    provider: string
    apiKey?: string
    endpoint?: string
    model?: string
    mode?: string
    reasoning?: string
    lang?: string
}

export function isAiEnabled(cfg?: AiConfig | null): cfg is AiConfig {
    return !!cfg && !!cfg.provider && cfg.provider !== 'default'
}

interface CallOptions {
    system: string
    user: string
    timeoutMs?: number
    maxTokens?: number
    // OpenAI-compatible reasoning effort; omitted unless explicitly set
    reasoning?: string
}

export async function callAI(cfg: AiConfig, opts: CallOptions): Promise<string | null> {
    const timeoutMs = opts.timeoutMs ?? 60000
    const provider = cfg.provider
    const apiKey = cfg.apiKey || ''
    const endpoint = cfg.endpoint || ''
    const model = cfg.model || ''

    if (provider === 'gemini') {
        const finalModel = model || 'gemini-2.0-flash'
        const url = endpoint || `https://generativelanguage.googleapis.com/v1beta/models/${finalModel}:generateContent`
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { 'x-goog-api-key': apiKey } : {})
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `${opts.system}\n\n${opts.user}` }] }]
            }),
            signal: AbortSignal.timeout(timeoutMs)
        })
        if (!res.ok) {
            throw new Error(`Gemini API error: ${res.status} - ${(await res.text()).slice(0, 300)}`)
        }
        const json: any = await res.json()
        return json.candidates?.[0]?.content?.parts?.[0]?.text || null
    }

    if (provider === 'claude') {
        const finalModel = model || 'claude-sonnet-4-5'
        const url = endpoint || 'https://api.anthropic.com/v1/messages'
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model: finalModel,
                max_tokens: opts.maxTokens ?? 4096,
                system: opts.system,
                messages: [{ role: 'user', content: opts.user }]
            }),
            signal: AbortSignal.timeout(timeoutMs)
        })
        if (!res.ok) {
            throw new Error(`Claude API error: ${res.status} - ${(await res.text()).slice(0, 300)}`)
        }
        const json: any = await res.json()
        return json.content?.[0]?.text || null
    }

    // OpenAI-compatible providers (openai / openrouter / ollama / open-webui / custom)
    let finalEndpoint = endpoint
    if (!finalEndpoint) {
        if (provider === 'openai' || provider === 'chatgpt') finalEndpoint = 'https://api.openai.com/v1/chat/completions'
        else if (provider === 'openrouter') finalEndpoint = 'https://openrouter.ai/api/v1/chat/completions'
        else if (provider === 'ollama') finalEndpoint = 'http://localhost:11434/v1/chat/completions'
        else if (provider === 'opwebui') finalEndpoint = 'http://localhost:3000/api/v1/chat/completions'
        else throw new Error(`Unknown AI provider: ${provider}`)
    } else if (!finalEndpoint.endsWith('/chat/completions')) {
        finalEndpoint = finalEndpoint.endsWith('/')
            ? finalEndpoint + 'chat/completions'
            : finalEndpoint + '/chat/completions'
    }

    const finalModel = model || (
        provider === 'openai' || provider === 'chatgpt' ? 'gpt-4o-mini' :
        provider === 'openrouter' ? 'meta-llama/llama-3-8b-instruct:free' :
        'llama3'
    )

    const body: any = {
        model: finalModel,
        messages: [
            { role: 'system', content: opts.system },
            { role: 'user', content: opts.user }
        ]
    }
    if (opts.reasoning && opts.reasoning !== 'default') {
        body.reasoning_effort = opts.reasoning
    }

    const res = await fetch(finalEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) {
        throw new Error(`AI API error (${provider}): ${res.status} - ${(await res.text()).slice(0, 300)}`)
    }
    const json: any = await res.json()
    return json.choices?.[0]?.message?.content || null
}
