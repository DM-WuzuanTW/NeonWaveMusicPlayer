// E2E playback smoke test over Chrome DevTools Protocol.
// Prereq: NW_REMOTE_DEBUG=9223 npm run dev   (dev app running)
// Verifies: media://local playback advances with webSecurity enabled.
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const WebSocket = require('ws');

const PORT = process.env.CDP_PORT || '9223';
const MEDIA_DIR = path.join(os.tmpdir(), 'neonwave-e2e');
const TONE = path.join(MEDIA_DIR, 'e2e-tone.m4a');

function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

function ensureTone() {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    if (fs.existsSync(TONE)) return;
    const ffmpeg = require('ffmpeg-static');
    execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-c:a', 'aac', TONE], { stdio: 'ignore' });
}

class CDP {
    constructor(ws) {
        this.ws = ws; this.id = 0; this.pend = new Map();
        ws.on('message', m => {
            const msg = JSON.parse(m);
            if (msg.id && this.pend.has(msg.id)) {
                const { res, rej } = this.pend.get(msg.id);
                this.pend.delete(msg.id);
                msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
            }
        });
    }
    send(method, params = {}) {
        return new Promise((res, rej) => {
            const id = ++this.id;
            this.pend.set(id, { res, rej });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }
    async eval(expression, awaitPromise = false) {
        const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
        if (r.exceptionDetails) throw new Error('page threw: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)));
        return r.result.value;
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    ensureTone();

    let page = null;
    for (let i = 0; i < 60 && !page; i++) {
        try {
            const targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
            page = targets.find(t =>
                t.type === 'page' &&
                !t.url.includes('mini=true') &&
                (t.url.includes('localhost:5173') || t.url.startsWith('file:'))
            ) || null;
        } catch { /* app still booting */ }
        if (!page) await sleep(1000);
    }
    if (!page) throw new Error('CDP page target not found — is NW_REMOTE_DEBUG dev app running?');

    const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    const cdp = new CDP(ws);
    await cdp.send('Runtime.enable');

    // Point the (dev-profile) library at the test folder, remember the original
    const dirJson = JSON.stringify([{ path: MEDIA_DIR, name: 'E2E' }]);
    const original = await cdp.eval(`localStorage.getItem('neonwave_folders_v2')`);
    await cdp.eval(`localStorage.setItem('neonwave_folders_v2', ${JSON.stringify(dirJson)}); location.reload(); true`);
    await sleep(6000);

    const clicked = await cdp.eval(`(() => { const el = document.querySelector('[class*="trackItem"]'); if (!el) return false; el.click(); return true })()`);
    if (!clicked) throw new Error('no trackItem found after reload');
    await sleep(2500);

    const s1 = await cdp.eval(`(() => {
        const a = window.__nwAudio;
        if (a) return { src: a.currentSrc.slice(0, 80), t: a.currentTime, paused: a.paused, err: a.error ? a.error.code : null, ready: a.readyState };
        const slider = document.querySelector('input[class*="timeSlider"]');
        return slider ? { src: 'ui', t: Number(slider.value), paused: false, err: null, ready: slider.disabled ? 0 : 4 } : null;
    })()`);
    await sleep(2000);
    const s2 = await cdp.eval(`(() => {
        const a = window.__nwAudio;
        if (a) return { t: a.currentTime, paused: a.paused, err: a.error ? a.error.code : null };
        const slider = document.querySelector('input[class*="timeSlider"]');
        return slider ? { t: Number(slider.value), paused: false, err: null } : null;
    })()`);

    const seekTarget = await cdp.eval(`(() => {
        const slider = document.querySelector('input[class*="timeSlider"]');
        if (!slider) return null;
        const rect = slider.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    const seekRequested = !!seekTarget;
    if (seekTarget) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: seekTarget.x, y: seekTarget.y, button: 'left', clickCount: 1 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: seekTarget.x, y: seekTarget.y, button: 'left', clickCount: 1 });
    }
    await sleep(750);
    const afterSeek = await cdp.eval(`(() => {
        const a = window.__nwAudio;
        if (a) return { t: a.currentTime, paused: a.paused, seeking: a.seeking, err: a.error ? a.error.code : null };
        const slider = document.querySelector('input[class*="timeSlider"]');
        return slider ? { t: Number(slider.value), paused: false, seeking: false, err: null } : null;
    })()`);

    // Restore the dev profile's library setting
    if (original === null) await cdp.eval(`localStorage.removeItem('neonwave_folders_v2'); true`);
    else await cdp.eval(`localStorage.setItem('neonwave_folders_v2', ${JSON.stringify(original)}); true`);

    console.log('sample1:', JSON.stringify(s1));
    console.log('sample2:', JSON.stringify(s2));
    console.log('afterSeek:', JSON.stringify(afterSeek));
    const pass = !!(
        s1 && s2 && afterSeek && seekRequested &&
        !s1.err && !s2.err && !afterSeek.err &&
        s2.t > s1.t && afterSeek.t >= 4 &&
        (s1.src.startsWith('media://') || s1.src === 'ui')
    );
    console.log(pass ? 'E2E PASS: media:// playback advances and seeks with webSecurity ON' : 'E2E FAIL');
    ws.close();
    process.exit(pass ? 0 : 1);
})().catch(e => { console.error('E2E ERROR:', e.message); process.exit(1); });
