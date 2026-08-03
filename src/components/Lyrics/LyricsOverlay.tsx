import React, { useEffect, useState, useCallback, useRef } from 'react'
import { parseLrc, LyricLine, getCurrentLineIndex } from '../../utils/lrcParser'
import {
    getCalibrationComputeConfig, getCalibrationPrecision, getTrackCalibration, isTrackCalibrationChanged,
    type CalibrationPrecision, type TrackCalibration
} from '../../lyricsCalibration'

interface LyricsOverlayProps {
    visible: boolean
    onClose: () => void
    trackTitle: string
    trackArtist: string
    trackPath?: string
    trackArtwork?: string
    trackDuration?: number
    currentTime: number
}

// Pure CSS danmaku styles injected once
const DANMAKU_STYLES = `
@keyframes danmaku-scroll {
    from { transform: translateX(100vw); }
    to   { transform: translateX(-100%); }
}

@keyframes lyrics-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
}

@keyframes lyrics-fade-out {
    from { opacity: 1; }
    to   { opacity: 0; }
}

@keyframes status-slide-in {
    from { transform: translateX(-50%) translateY(-50px); opacity: 0; }
    to   { transform: translateX(-50%) translateY(0); opacity: 1; }
}

@keyframes status-slide-out {
    from { transform: translateX(-50%) translateY(0); opacity: 1; }
    to   { transform: translateX(-50%) translateY(-50px); opacity: 0; }
}

@keyframes spin-loader {
    to { transform: rotate(360deg); }
}

.danmaku-item {
    position: absolute;
    white-space: nowrap;
    will-change: transform;
    animation: danmaku-scroll var(--danmaku-duration) linear forwards;
    pointer-events: none;
    contain: layout style paint;
}

.danmaku-item.style-neon {
    font-weight: 900;
    -webkit-text-stroke: 1px rgba(0,0,0,0.5);
}

.danmaku-item.style-minimal {
    font-weight: 700;
    color: #ffffff !important;
    text-shadow:
        1.5px 1.5px 0 #000, -1.5px -1.5px 0 #000,
        1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000,
        2px 2px 4px rgba(0,0,0,0.8);
}

.danmaku-item.style-cyberpunk {
    font-weight: 900;
    letter-spacing: 0.15em;
    text-shadow:
        3px 3px 0px #ff0055,
        -1px -1px 0px #000,
        1px -1px 0px #000,
        -1px 1px 0px #000,
        1px 1px 0px #000;
    -webkit-text-stroke: 1px #000;
}

.danmaku-item.style-glass {
    font-weight: 600;
    color: #ffffff !important;
    background: rgba(255, 255, 255, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 24px;
    padding: 8px 20px;
    box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
}

.lyrics-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    pointer-events: none;
    overflow: hidden;
    background: transparent;
    font-family: "Outfit", sans-serif;
    animation: lyrics-fade-in 0.3s ease forwards;
}

.lyrics-overlay.closing {
    animation: lyrics-fade-out 0.3s ease forwards;
}

.lyrics-overlay.panel-active {
    pointer-events: auto;
    background: #080a0f;
}

.lyrics-stage-backdrop {
    position: absolute;
    inset: -40px;
    background-position: center;
    background-size: cover;
    filter: blur(46px) saturate(1.35);
    opacity: .28;
    transform: scale(1.08);
}

.lyrics-stage-backdrop::after {
    content: '';
    position: absolute;
    inset: 0;
    background:
        radial-gradient(circle at 24% 42%, rgba(255,255,255,.08), transparent 38%),
        linear-gradient(110deg, rgba(4,6,10,.68), rgba(4,6,10,.9));
}

.lyrics-stage {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: grid;
    grid-template-rows: 72px minmax(0, 1fr);
    overflow: hidden;
    background: linear-gradient(110deg, rgba(6,8,12,.52), rgba(6,8,12,.84));
}

.lyrics-stage-header {
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 0 clamp(28px, 4vw, 70px);
    border-bottom: 1px solid rgba(255,255,255,.08);
}
.lyrics-stage-mark {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: var(--accent-primary, #00fff2);
    color: #050608;
    font-size: 16px;
    font-weight: 900;
}
.lyrics-stage-heading { display: flex; flex-direction: column; min-width: 0; }
.lyrics-stage-heading strong { font-size: 13px; }
.lyrics-stage-heading small { color: rgba(255,255,255,.46); font-size: 10px; }

.lyrics-stage-body {
    display: grid;
    grid-template-columns: minmax(360px, 1.08fr) minmax(380px, .92fr);
    align-items: stretch;
    gap: clamp(30px, 4vw, 70px);
    width: min(1480px, 93vw);
    min-height: 0;
    margin: 0 auto;
    padding: clamp(24px, 4vh, 48px) 0 38px;
}
.lyrics-stage-nowplaying {
    min-width: 0;
    max-width: 470px;
    justify-self: center;
}
.lyrics-stage-art {
    width: min(29vw, 350px);
    aspect-ratio: 1;
    overflow: hidden;
    display: grid;
    place-items: center;
    border: 1px solid rgba(255,255,255,.13);
    border-radius: 28px;
    background:
        radial-gradient(circle at 28% 22%, rgba(255,255,255,.24), transparent 24%),
        linear-gradient(145deg, var(--accent-primary, #00fff2), var(--accent-secondary, #8b5cf6));
    box-shadow: 0 34px 80px rgba(0,0,0,.52), 0 0 0 8px rgba(255,255,255,.025);
    color: rgba(0,0,0,.78);
    font-size: 72px;
}
.lyrics-stage-art img { width: 100%; height: 100%; display: block; object-fit: cover; }
.lyrics-stage-track { margin-top: 22px; }
.lyrics-stage-track strong {
    display: block;
    overflow: hidden;
    color: #fff;
    font-size: clamp(22px, 2.5vw, 34px);
    line-height: 1.15;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.lyrics-stage-track span {
    display: block;
    margin-top: 7px;
    overflow: hidden;
    color: rgba(255,255,255,.55);
    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.lyrics-stage-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 18px;
}
.lyrics-stage-meta span {
    padding: 6px 9px;
    border: 1px solid rgba(255,255,255,.1);
    border-radius: 999px;
    background: rgba(255,255,255,.045);
    color: rgba(255,255,255,.5);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .06em;
}

.lyrics-phone {
    position: relative;
    width: min(390px, 31vw);
    height: min(700px, calc(100vh - 124px));
    min-height: 520px;
    justify-self: end;
    overflow: hidden;
    padding: 9px;
    border: 1px solid rgba(255,255,255,.26);
    border-radius: 46px;
    background: linear-gradient(145deg, #303239, #090a0d 32%, #16181d);
    box-shadow:
        0 42px 100px rgba(0,0,0,.62),
        inset 0 0 0 1px rgba(255,255,255,.12),
        inset 0 0 0 4px rgba(0,0,0,.72);
}
.lyrics-phone-screen {
    position: relative;
    display: grid;
    grid-template-rows: 82px minmax(0, 1fr) 60px;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: 38px;
    background:
        radial-gradient(circle at 50% 12%, color-mix(in srgb, var(--accent-primary) 14%, transparent), transparent 34%),
        linear-gradient(180deg, rgba(19,21,27,.98), rgba(7,8,11,.99));
}
.lyrics-phone-island {
    position: absolute;
    top: 16px;
    left: 50%;
    z-index: 4;
    width: 94px;
    height: 25px;
    transform: translateX(-50%);
    border-radius: 999px;
    background: #000;
    box-shadow: inset -14px 0 18px rgba(255,255,255,.025);
}
.lyrics-phone-header {
    align-self: end;
    padding: 0 26px 12px;
}
.lyrics-phone-header span {
    color: var(--accent-primary, #00fff2);
    font-size: 9px;
    font-weight: 850;
    letter-spacing: .13em;
}
.lyrics-phone-header strong {
    display: block;
    margin-top: 4px;
    color: #fff;
    font-size: 17px;
    letter-spacing: -.02em;
}
.lyrics-stage-lyrics {
    min-width: 0;
    overflow: hidden;
    padding: 16px 28px;
    mask-image: linear-gradient(to bottom, transparent, #000 12%, #000 88%, transparent);
}

.lyrics-status {
    position: absolute;
    top: 5%;
    left: 50%;
    transform: translateX(-50%);
    color: #fff;
    background: rgba(0,0,0,0.6);
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 600;
    backdrop-filter: blur(4px);
    border: 1px solid rgba(255,255,255,0.1);
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 100;
    animation: status-slide-in 0.3s ease forwards;
}

.lyrics-status.hiding {
    animation: status-slide-out 0.3s ease forwards;
}

.lyrics-status .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin-loader 0.6s linear infinite;
}

.lyrics-error {
    position: absolute;
    bottom: 10%;
    width: 100%;
    text-align: center;
    opacity: 0.7;
    color: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
}

.lyrics-presentation {
    position: absolute;
    pointer-events: none;
    color: #fff;
    text-align: center;
}

.lyrics-presentation .current-line {
    font-weight: 850;
    line-height: 1.3;
    text-wrap: balance;
    text-shadow: 0 3px 14px rgba(0,0,0,.95), 0 0 28px rgba(0,0,0,.65);
}

.lyrics-presentation.mode-focus {
    top: 48%;
    left: 50%;
    width: min(80vw, 900px);
    transform: translate(-50%, -50%);
}
.lyrics-presentation.mode-focus .current-line { font-size: clamp(30px, 4.2vw, 58px); }
.lyrics-presentation .next-line {
    margin-top: 15px;
    color: rgba(255,255,255,.42);
    font-size: clamp(16px, 2vw, 24px);
    font-weight: 600;
}

.lyrics-presentation.mode-subtitle {
    left: 50%;
    bottom: 9%;
    width: min(86vw, 980px);
    transform: translateX(-50%);
}
.lyrics-presentation.mode-subtitle .current-line {
    display: inline-block;
    padding: 10px 20px;
    border-radius: 9px;
    background: rgba(0,0,0,.72);
    box-decoration-break: clone;
    font-size: clamp(20px, 2.5vw, 34px);
    -webkit-text-stroke: .5px rgba(0,0,0,.6);
}

.lyrics-presentation.mode-kinetic {
    top: 50%;
    left: 50%;
    width: min(88vw, 1180px);
    transform: translate(-50%, -50%);
    perspective: 900px;
}
.kinetic-kicker {
    margin-bottom: 18px;
    color: var(--accent-primary, #00fff2);
    font-size: 10px;
    font-weight: 850;
    letter-spacing: .28em;
    text-transform: uppercase;
    animation: kinetic-kicker-in .5s ease both;
}
.mode-kinetic .current-line {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    font-size: clamp(36px, 6.4vw, 94px);
    font-weight: 950;
    letter-spacing: -.055em;
    line-height: 1.04;
    text-transform: none;
}
.kinetic-char {
    display: inline-block;
    min-width: .26em;
    opacity: 0;
    filter: blur(12px);
    transform: translate3d(var(--kinetic-x, 0), 46px, -110px) rotate(var(--kinetic-r, 0));
    animation: kinetic-char-in .72s cubic-bezier(.16,.86,.25,1) forwards;
    animation-delay: calc(var(--char-index) * 28ms);
    text-shadow: 0 12px 36px rgba(0,0,0,.78), 0 0 42px color-mix(in srgb, var(--accent-primary) 20%, transparent);
}
.kinetic-char:nth-child(3n + 1) { --kinetic-x: -22px; --kinetic-r: -4deg; }
.kinetic-char:nth-child(3n + 2) { --kinetic-x: 18px; --kinetic-r: 3deg; }
.kinetic-ghost {
    position: absolute;
    inset: 52% 0 auto;
    z-index: -1;
    overflow: hidden;
    color: transparent;
    font-size: clamp(58px, 9vw, 140px);
    font-weight: 950;
    line-height: .82;
    opacity: .13;
    transform: translateY(-50%) scaleX(1.12);
    -webkit-text-stroke: 1px var(--accent-primary, #00fff2);
    white-space: nowrap;
    mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent);
    animation: kinetic-ghost-drift 6s ease-in-out infinite alternate;
}

.lyrics-presentation.mode-rhythm-cut {
    inset: 0;
    display: grid;
    place-items: center;
    width: auto;
    overflow: hidden;
}
.rhythm-vignette {
    position: absolute;
    inset: 0;
    background:
        linear-gradient(110deg, transparent 0 42%, color-mix(in srgb, var(--accent-primary) 12%, transparent) 42% 58%, transparent 58%),
        radial-gradient(circle at 50% 50%, transparent 12%, rgba(0,0,0,.62) 100%);
    animation: rhythm-flash .42s cubic-bezier(.2,.8,.2,1) both;
}
.rhythm-slice {
    position: absolute;
    top: 14%;
    bottom: 14%;
    left: 50%;
    width: 2px;
    background: linear-gradient(transparent, var(--accent-primary, #00fff2), transparent);
    opacity: .48;
    transform: skewX(-14deg) scaleY(0);
    box-shadow: 0 0 28px var(--accent-primary, #00fff2);
    animation: rhythm-slice .55s ease-out both;
}
.mode-rhythm-cut .rhythm-copy {
    position: relative;
    width: min(86vw, 1120px);
    transform: rotate(-1.2deg);
    animation: rhythm-copy-in .48s cubic-bezier(.12,.78,.18,1) both;
}
.mode-rhythm-cut .current-line {
    font-size: clamp(38px, 6.8vw, 102px);
    font-weight: 950;
    letter-spacing: -.055em;
    line-height: 1.02;
    text-shadow: 8px 8px 0 rgba(0,0,0,.55), 0 0 34px color-mix(in srgb, var(--accent-primary) 22%, transparent);
}
.rhythm-index {
    display: block;
    margin-bottom: 9px;
    color: var(--accent-primary, #00fff2);
    font: 800 10px ui-monospace, monospace;
    letter-spacing: .2em;
}
.rhythm-next {
    margin-top: 20px;
    color: rgba(255,255,255,.28);
    font-size: clamp(13px, 1.5vw, 20px);
    font-weight: 700;
    letter-spacing: .06em;
}
@keyframes kinetic-char-in {
    0% { opacity: 0; filter: blur(12px); transform: translate3d(var(--kinetic-x), 46px, -110px) rotate(var(--kinetic-r)) scale(.76); }
    62% { opacity: 1; filter: blur(0); transform: translate3d(0, -4px, 12px) rotate(0) scale(1.035); }
    100% { opacity: 1; filter: blur(0); transform: translate3d(0, 0, 0) rotate(0) scale(1); }
}
@keyframes kinetic-kicker-in { from { opacity: 0; letter-spacing: .7em; } to { opacity: 1; letter-spacing: .28em; } }
@keyframes kinetic-ghost-drift { from { transform: translate(-3%, -50%) scaleX(1.12); } to { transform: translate(3%, -50%) scaleX(1.18); } }
@keyframes rhythm-flash { 0% { opacity: .95; transform: scale(1.08); } 35% { opacity: .24; } 100% { opacity: .08; transform: scale(1); } }
@keyframes rhythm-slice { 0% { opacity: .9; transform: translateX(-180px) skewX(-14deg) scaleY(0); } 45% { transform: translateX(0) skewX(-14deg) scaleY(1); } 100% { opacity: .15; transform: translateX(150px) skewX(-14deg) scaleY(.45); } }
@keyframes rhythm-copy-in { 0% { opacity: 0; filter: blur(8px); transform: translate3d(8vw, 18px, 0) rotate(2.5deg) scale(1.13); } 70% { opacity: 1; filter: blur(0); transform: translate3d(-8px, 0, 0) rotate(-1.5deg) scale(.99); } 100% { opacity: 1; transform: rotate(-1.2deg) scale(1); } }

@media (prefers-reduced-motion: reduce) {
    .kinetic-char, .kinetic-kicker, .kinetic-ghost, .rhythm-vignette, .rhythm-slice, .mode-rhythm-cut .rhythm-copy { animation: none !important; opacity: 1; filter: none; transform: none; }
}

.lyrics-presentation.mode-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: clamp(17px, 2.7vh, 27px);
    width: 100%;
    min-height: 100%;
    text-align: left;
}
.lyrics-panel-line {
    color: rgba(255,255,255,.26);
    font-size: clamp(14px, 1.15vw, 18px);
    font-weight: 600;
    line-height: 1.35;
    transition: color .25s ease, font-size .25s ease, opacity .25s ease;
}
.lyrics-panel-line.active {
    color: #fff;
    font-size: clamp(22px, 1.85vw, 29px);
    font-weight: 850;
    letter-spacing: -.025em;
    text-shadow: 0 3px 18px rgba(0,0,0,.85), 0 0 24px color-mix(in srgb, var(--accent-primary) 18%, transparent);
}

.lyrics-phone-footer {
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr) 48px;
    align-items: center;
    gap: 12px;
    padding: 0 24px 9px;
    border-top: 1px solid rgba(255,255,255,.08);
    color: rgba(255,255,255,.45);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
}
.lyrics-phone-progress {
    height: 3px;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(255,255,255,.12);
}
.lyrics-phone-progress span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent-primary, #00fff2);
}

.lyrics-media-panel {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    justify-content: center;
}
.lyrics-media-frame {
    display: grid;
    place-items: center;
    width: min(100%, calc(100vh - 280px));
    max-width: 680px;
    aspect-ratio: 1;
    align-self: center;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,.13);
    border-radius: 17px;
    background:
        radial-gradient(circle at 25% 20%, rgba(255,255,255,.22), transparent 25%),
        linear-gradient(145deg, var(--accent-primary, #00fff2), var(--accent-secondary, #8b5cf6));
    box-shadow: 0 30px 72px rgba(0,0,0,.48);
    color: rgba(0,0,0,.72);
    font-size: 76px;
}
.lyrics-media-frame img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
    -webkit-user-drag: none;
}
.lyrics-media-caption {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    width: min(100%, calc(100vh - 280px));
    max-width: 680px;
    align-self: center;
}
.lyrics-media-caption .lyrics-stage-track { min-width: 0; }
.lyrics-media-caption .lyrics-stage-meta { flex: none; }
.lyrics-media-progress {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) 42px;
    align-items: center;
    gap: 9px;
    width: min(100%, calc(100vh - 280px));
    max-width: 680px;
    align-self: center;
    margin-top: 15px;
    color: rgba(255,255,255,.42);
    font-size: 9px;
    font-variant-numeric: tabular-nums;
}
.lyrics-media-progress > span:last-child { text-align: right; }
.lyrics-media-progress > div { height: 3px; overflow: hidden; border-radius: 99px; background: rgba(255,255,255,.12); }
.lyrics-media-progress i { display: block; height: 100%; border-radius: inherit; background: var(--accent-primary, #00fff2); }

.lyrics-list-panel {
    display: grid;
    grid-template-rows: 58px minmax(0, 1fr) 42px;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,.1);
    border-radius: 17px;
    background: rgba(5,6,9,.42);
    box-shadow: 0 30px 72px rgba(0,0,0,.32);
    backdrop-filter: blur(16px);
}
.lyrics-list-tabs {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 24px;
    border-bottom: 1px solid rgba(255,255,255,.1);
}
.lyrics-list-tabs strong {
    position: relative;
    display: flex;
    height: 100%;
    align-items: center;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
}
.lyrics-list-tabs strong::after {
    content: '';
    position: absolute;
    right: 0;
    bottom: -1px;
    left: 0;
    height: 2px;
    border-radius: 99px 99px 0 0;
    background: var(--accent-primary, #00fff2);
}
.lyrics-list-scroll {
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 42% clamp(24px, 3vw, 52px);
    scroll-behavior: smooth;
    scrollbar-color: rgba(255,255,255,.28) transparent;
    scrollbar-width: thin;
    mask-image: linear-gradient(to bottom, transparent 0, #000 11%, #000 89%, transparent 100%);
}
.lyrics-list-scroll .lyrics-panel-line {
    margin: 0 0 clamp(19px, 2.6vh, 29px);
    color: rgba(255,255,255,.36);
    font-size: clamp(15px, 1.14vw, 19px);
    font-weight: 620;
    line-height: 1.52;
    transition: color .24s ease, opacity .24s ease, transform .24s ease, font-size .24s ease;
}
.lyrics-list-scroll .lyrics-panel-line.active {
    color: #fff;
    font-size: clamp(20px, 1.55vw, 27px);
    font-weight: 850;
    transform: translateX(8px);
    text-shadow: 0 5px 22px rgba(0,0,0,.72);
}
.lyrics-list-scroll .lyrics-panel-line.passed { color: rgba(255,255,255,.19); }
.lyrics-list-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 22px;
    border-top: 1px solid rgba(255,255,255,.08);
    color: rgba(255,255,255,.34);
    font-size: 8px;
    font-weight: 800;
    letter-spacing: .11em;
}

@media (max-width: 760px) {
    .lyrics-stage-header { height: 64px; }
    .lyrics-stage-body { grid-template-columns: 1fr; width: 100%; gap: 18px; padding: 18px 20px 26px; }
    .lyrics-stage-nowplaying { display: flex; align-items: center; gap: 14px; justify-self: stretch; }
    .lyrics-stage-art { width: 78px; flex: none; border-radius: 16px; font-size: 30px; }
    .lyrics-stage-track { margin-top: 0; min-width: 0; }
    .lyrics-stage-meta { display: none; }
    .lyrics-phone { width: min(390px, 92vw); height: min(610px, 68vh); min-height: 430px; justify-self: center; border-radius: 38px; }
    .lyrics-phone-screen { border-radius: 30px; }
    .lyrics-presentation.mode-panel { text-align: left; }
    .lyrics-stage-body { display: flex; flex-direction: column; overflow-y: auto; }
    .lyrics-media-panel { flex: none; }
    .lyrics-media-frame { width: min(72vw, 330px); }
    .lyrics-media-caption, .lyrics-media-progress { width: min(72vw, 330px); }
    .lyrics-list-panel { width: 100%; min-height: 58vh; flex: none; }
}
`

// Inject styles once
let stylesInjected = false
function injectStyles() {
    if (stylesInjected) return
    const style = document.createElement('style')
    style.textContent = DANMAKU_STYLES
    document.head.appendChild(style)
    stylesInjected = true
}

const NEON_COLORS = ['#ffffff', '#00fff2', '#ff00ff', '#f8fafc']
const CYBERPUNK_MAP: Record<string, string> = {
    '#ffffff': '#ffe600', '#f8fafc': '#ffe600', '#00fff2': '#ffe600'
}
const MAX_CONCURRENT = 6
const lyricsCache = new Map<string, LyricLine[]>()

function buildLyricsCacheKey(trackTitle: string, trackArtist: string, trackPath?: string, trackDuration?: number) {
    const calibration = localStorage.getItem('neonwave_lyrics_calibration_enabled') === 'true'
        ? [
            localStorage.getItem('neonwave_lyrics_calibration_mode') || 'adaptive',
            getCalibrationPrecision(),
            JSON.stringify(getCalibrationComputeConfig()),
            JSON.stringify(getTrackCalibration(trackPath))
        ].join(':')
        : 'off'
    return [trackPath || '', trackTitle || '', trackArtist || '', trackDuration ?? '', calibration].join('|')
}

function toArrayBuffer(value: unknown): ArrayBuffer | null {
    if (value instanceof ArrayBuffer) return value.slice(0)
    if (ArrayBuffer.isView(value)) {
        const view = value as ArrayBufferView
        const copy = new Uint8Array(view.byteLength)
        copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
        return copy.buffer
    }
    if (value && typeof value === 'object' && 'data' in value && Array.isArray((value as { data?: unknown }).data)) {
        return Uint8Array.from((value as { data: number[] }).data).buffer
    }
    if (value && typeof value === 'object') {
        const numericEntries = Object.entries(value as Record<string, unknown>)
            .filter(([key, item]) => /^\d+$/.test(key) && typeof item === 'number')
            .sort(([left], [right]) => Number(left) - Number(right))
        if (numericEntries.length > 0) {
            return Uint8Array.from(numericEntries.map(([, item]) => item as number)).buffer
        }
    }
    return null
}

function readSourceDuration(rawLrc: string): number | null {
    const nwMatch = rawLrc.match(/\[nw-source-duration:([\d.]+)\]/i)
    if (nwMatch) return Number(nwMatch[1]) || null

    const lengthMatch = rawLrc.match(/\[length:(?:(\d+):)?([\d.]+)\]/i)
    if (!lengthMatch) return null
    const minutes = Number(lengthMatch[1] || 0)
    const seconds = Number(lengthMatch[2] || 0)
    const duration = minutes * 60 + seconds
    return duration > 0 ? duration : null
}

function calibrateLyricsWithAudio(
    lines: LyricLine[],
    audioBuffer: AudioBuffer,
    targetDuration: number,
    sourceDuration: number | null,
    mode: string,
    precision: CalibrationPrecision
): { lines: LyricLine[]; confidence: number; stretched: boolean; offset: number; changed: boolean } {
    const channel = audioBuffer.getChannelData(0)
    const sampleRate = audioBuffer.sampleRate
    const hopSeconds = 0.05
    const hopSamples = Math.max(1, Math.floor(sampleRate * hopSeconds))
    const energies: number[] = []

    for (let start = 0; start < channel.length; start += hopSamples) {
        const end = Math.min(channel.length, start + hopSamples)
        let sum = 0
        let count = 0
        // Sampling every fourth value keeps full-song analysis inexpensive.
        for (let index = start; index < end; index += 4) {
            const value = channel[index]
            sum += value * value
            count++
        }
        energies.push(Math.sqrt(sum / Math.max(1, count)))
    }

    const sortedEnergy = [...energies].sort((a, b) => a - b)
    const peak = sortedEnergy[Math.floor(sortedEnergy.length * 0.98)] || 0.001
    const validSourceDuration = sourceDuration && sourceDuration > 30 ? sourceDuration : null
    const rawRatio = validSourceDuration && targetDuration > 0 ? targetDuration / validSourceDuration : 1
    const safeRatio = Math.min(1.25, Math.max(0.8, rawRatio))
    const stretched = mode === 'stretch'
        ? validSourceDuration !== null
        : mode === 'adaptive' && validSourceDuration !== null && Math.abs(safeRatio - 1) >= 0.015

    const baseLines = lines.map(line => ({ ...line, time: Math.max(0, line.time * (stretched ? safeRatio : 1)) }))
    const precisionProfile = {
        conservative: { score: 0.145, usable: 0.24, mad: 0.3, maxOffset: 0.9 },
        balanced: { score: 0.11, usable: 0.18, mad: 0.42, maxOffset: 1.5 },
        aggressive: { score: 0.075, usable: 0.12, mad: 0.62, maxOffset: 2.4 }
    }[precision]

    // A mixed song waveform cannot reliably identify individual words. Instead
    // of moving every line independently (which made the old calibration drift),
    // collect nearby onset candidates and only apply one robust global offset.
    const corrections: number[] = []
    for (const line of baseLines) {
        if (!line.text.trim()) continue
        const centerFrame = Math.round(line.time / hopSeconds)
        const radius = Math.round((mode === 'quick' ? 2.4 : 1.35) / hopSeconds)
        const from = Math.max(2, centerFrame - radius)
        const to = Math.min(energies.length - 1, centerFrame + radius)
        let bestFrame = centerFrame
        let bestScore = 0

        for (let frame = from; frame <= to; frame++) {
            const rise = Math.max(0, energies[frame] - energies[frame - 2])
            const normalizedRise = rise / Math.max(peak, 0.001)
            const distancePenalty = Math.abs(frame - centerFrame) / Math.max(1, radius) * 0.24
            const score = normalizedRise - distancePenalty
            if (score > bestScore) {
                bestScore = score
                bestFrame = frame
            }
        }

        if (bestScore >= precisionProfile.score) corrections.push(bestFrame * hopSeconds - line.time)
    }

    corrections.sort((a, b) => a - b)
    const median = corrections.length ? corrections[Math.floor(corrections.length / 2)] : 0
    const deviations = corrections.map(value => Math.abs(value - median)).sort((a, b) => a - b)
    const mad = deviations.length ? deviations[Math.floor(deviations.length / 2)] : Number.POSITIVE_INFINITY
    const usableRatio = corrections.length / Math.max(1, baseLines.filter(line => line.text.trim()).length)
    const stableOffset = corrections.length >= 4 && usableRatio >= precisionProfile.usable && mad <= precisionProfile.mad
        ? Math.max(-precisionProfile.maxOffset, Math.min(precisionProfile.maxOffset, median))
        : 0
    const confidence = Math.min(0.94,
        (validSourceDuration ? 0.58 : 0.28)
        + Math.min(0.24, usableRatio * 0.35)
        + (stableOffset ? Math.max(0, 0.14 - mad * 0.18) : 0)
    )
    const changed = stretched || Math.abs(stableOffset) >= 0.12

    return {
        lines: baseLines.map(line => ({ ...line, time: Math.max(0, line.time + stableOffset) })),
        confidence,
        stretched,
        offset: stableOffset,
        changed
    }
}

function applyTrackFineTuning(lines: LyricLine[], duration: number, calibration: TrackCalibration): LyricLine[] {
    const anchor = calibration.anchor === 'middle'
        ? duration / 2
        : calibration.anchor === 'end' ? duration : 0
    const ratio = calibration.ratePercent / 100
    const offset = calibration.offsetMs / 1000
    return lines.map(line => ({
        ...line,
        time: Math.max(0, anchor + (line.time - anchor) * ratio + offset)
    }))
}

const LyricsOverlayView: React.FC<LyricsOverlayProps> = ({
    visible, onClose, trackTitle, trackArtist, trackPath, trackArtwork, trackDuration, currentTime
}) => {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(false)
    const [lyrics, setLyrics] = useState<LyricLine[]>([])
    const [activeIndex, setActiveIndex] = useState(-1)
    const [statusMsg, setStatusMsg] = useState<string | null>(null)
    const [statusVisible, setStatusVisible] = useState(false)
    const [presentation, setPresentation] = useState<string>(() => localStorage.getItem('neonwave_lyrics_presentation') || 'danmaku')
    const subStyle: string = 'neon'
    const [fetchTrigger, setFetchTrigger] = useState(0)

    const containerRef = useRef<HTMLDivElement>(null)
    const panelLyricsRef = useRef<HTMLDivElement>(null)
    const activeCountRef = useRef(0)
    const statusTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const statusClearTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const fetchSeqRef = useRef(0)

    useEffect(() => {
        injectStyles()
    }, [])

    useEffect(() => {
        const handleSettingsChange = () => {
            setPresentation(localStorage.getItem('neonwave_lyrics_presentation') || 'danmaku')
            setFetchTrigger(trigger => trigger + 1)
        }
        window.addEventListener('neonwave:settings-changed', handleSettingsChange)
        return () => window.removeEventListener('neonwave:settings-changed', handleSettingsChange)
    }, [])

    const showStatus = useCallback((msg: string) => {
        if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
        if (statusClearTimerRef.current) clearTimeout(statusClearTimerRef.current)
        setStatusMsg(msg)
        setStatusVisible(true)
        statusTimerRef.current = setTimeout(() => {
            setStatusVisible(false)
            statusClearTimerRef.current = setTimeout(() => setStatusMsg(null), 300) // Wait for fade-out animation
        }, 3000)
    }, [])

    useEffect(() => {
        return window.ipcRenderer.onGpuLyricsProgress(progress => {
            showStatus(progress.message)
        })
    }, [showStatus])

    useEffect(() => {
        return () => {
            fetchSeqRef.current += 1
            if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
            if (statusClearTimerRef.current) clearTimeout(statusClearTimerRef.current)
        }
    }, [])

    useEffect(() => {
        if (visible) {
            showStatus("歌詞模式：開啟")
        }
    }, [visible, showStatus])

    useEffect(() => {
        if (lyrics.length === 0) {
            setActiveIndex(-1)
            return
        }
        const idx = getCurrentLineIndex(lyrics, currentTime)
        if (idx !== activeIndex) {
            setActiveIndex(idx)
        }
    }, [currentTime, lyrics, activeIndex])

    useEffect(() => {
        if (!visible || presentation !== 'panel' || activeIndex < 0) return
        const activeLine = panelLyricsRef.current?.querySelector<HTMLElement>(`[data-line-index="${activeIndex}"]`)
        activeLine?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, [activeIndex, presentation, visible])

    // Lyrics fetching
    const fetchLyrics = useCallback(async (title: string, artist: string, path: string = '', duration: number = 0) => {
        const requestId = ++fetchSeqRef.current
        const isStale = () => requestId !== fetchSeqRef.current
        const cacheKey = buildLyricsCacheKey(title, artist, path, duration)

        const applyLyrics = (lines: LyricLine[]) => {
            const cloned = lines.map(line => ({ ...line }))
            lyricsCache.set(cacheKey, cloned)
            setLyrics(cloned)
            setError(false)
            setActiveIndex(-1)
        }

        const cached = lyricsCache.get(cacheKey)
        if (cached && cached.length > 0) {
            applyLyrics(cached)
            showStatus("已載入同步歌詞")
            return
        }

        setLoading(true)
        setError(false)
        setLyrics([])
        setActiveIndex(-1)
        showStatus(`搜尋中: ${title}...`)
        try {
            const aiConfig = {
                provider: localStorage.getItem('neonwave_lyrics_ai_provider') || 'default',
                apiKey: localStorage.getItem('neonwave_lyrics_ai_key') || '',
                endpoint: localStorage.getItem('neonwave_lyrics_ai_endpoint') || '',
                model: localStorage.getItem('neonwave_lyrics_ai_model') || '',
                mode: localStorage.getItem('neonwave_lyrics_ai_mode') || 'filename',
                reasoning: localStorage.getItem('neonwave_lyrics_ai_reasoning') || 'none',
                lang: localStorage.getItem('neonwave_lyrics_lang') || 'cn'
            }
            const rawLrc = await window.ipcRenderer.getLyrics(title, artist, path, duration, aiConfig)
            if (isStale()) return

            if (rawLrc) {
                let parsed = parseLrc(rawLrc)
                let calibrationStatus: string | null = null

                const isLocalCalEnabled = localStorage.getItem('neonwave_lyrics_calibration_enabled') === 'true'
                const calibrationMode = localStorage.getItem('neonwave_lyrics_calibration_mode') || 'adaptive'
                const calibrationPrecision = getCalibrationPrecision()
                if (isLocalCalEnabled && path && parsed.length > 0) {
                    let calCtx: AudioContext | null = null
                    try {
                        if (calibrationMode.startsWith('gpu-')) {
                            const gpuResult = await window.ipcRenderer.calibrateLyricsGpu(
                                path, rawLrc, calibrationMode, false, getCalibrationComputeConfig()
                            )
                            if (isStale()) return
                            if (!gpuResult.ok || !gpuResult.lyrics) {
                                throw new Error(gpuResult.error || 'GPU 校正沒有回傳歌詞')
                            }
                            const gpuParsed = parseLrc(gpuResult.lyrics)
                            if (gpuParsed.length < 3) throw new Error('GPU 校正版內容不完整')
                            parsed = gpuParsed
                            calibrationStatus = gpuResult.cached
                                ? `已載入 GPU 校正版 · ${Math.round((gpuResult.confidence || 0) * 100)}%`
                                : `GPU 校正完成 · ${Math.round((gpuResult.confidence || 0) * 100)}% · 第 ${gpuResult.runs || 1} 次學習`
                        } else if (calibrationMode === 'manual') {
                            calibrationStatus = '手動精修模式'
                        } else {
                            console.log(`[Lyrics Local Calibration] Reading complete track: ${path}`)
                            const fileValue = await window.ipcRenderer.readFileBuffer(path, 128 * 1024 * 1024)
                            if (isStale()) return
                            const fileBuffer = toArrayBuffer(fileValue)
                            if (!fileBuffer) throw new TypeError('IPC did not return audio bytes as an ArrayBuffer-compatible value')

                            calCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
                            const audioBuf = await calCtx.decodeAudioData(fileBuffer)
                            if (isStale()) return

                            const sourceDuration = readSourceDuration(rawLrc)
                            const result = calibrateLyricsWithAudio(
                                parsed,
                                audioBuf,
                                duration > 0 ? duration : audioBuf.duration,
                                sourceDuration,
                                calibrationMode,
                                calibrationPrecision
                            )
                            console.log('[Lyrics Local Calibration] Analysis complete', {
                                mode: calibrationMode,
                                sourceDuration,
                                targetDuration: duration > 0 ? duration : audioBuf.duration,
                                confidence: Number(result.confidence.toFixed(3)),
                                stretched: result.stretched,
                                offset: Number(result.offset.toFixed(3))
                            })

                            const minimumConfidence = calibrationPrecision === 'conservative'
                                ? 0.68
                                : calibrationPrecision === 'aggressive' ? 0.5 : 0.58
                            if (result.changed && result.confidence >= minimumConfidence) {
                                parsed = result.lines
                                calibrationStatus = result.stretched
                                    ? '已套用翻唱時間軸校正'
                                    : '已套用穩定起點校正'
                            } else {
                                calibrationStatus = '校正可信度不足，已保留原始時間'
                            }
                        }
                    } catch (calErr) {
                        console.error(`[Lyrics Calibration:${calibrationMode}] Failed:`, calErr)
                        const detail = calErr instanceof Error ? calErr.message : String(calErr)
                        calibrationStatus = calibrationMode.startsWith('gpu-')
                            ? `GPU 校正未完成：${detail}`
                            : `CPU 音訊分析失敗：${detail}`
                    } finally {
                        if (calCtx) void calCtx.close()
                    }

                    const fineTuning = getTrackCalibration(path)
                    if (isTrackCalibrationChanged(fineTuning)) {
                        parsed = applyTrackFineTuning(parsed, duration, fineTuning)
                        calibrationStatus = calibrationMode === 'manual'
                            ? '已套用這首歌曲的手動精修'
                            : `${calibrationStatus || '已完成自動校正'} · 已套用單曲精修`
                    } else if (calibrationMode === 'manual') {
                        calibrationStatus = '手動精修尚未調整，已保留原始時間'
                    }
                }

                if (isStale()) return

                if (parsed.length > 0) {
                    applyLyrics(parsed)
                    showStatus(calibrationStatus || "已載入同步歌詞")
                } else {
                    setError(true)
                    showStatus("未找到同步歌詞")
                }
            } else {
                setError(true)
                showStatus("未找到同步歌詞")
            }
        } catch (e) {
            if (isStale()) return
            console.error(e)
            setError(true)
            showStatus("載入歌詞時發生錯誤")
        } finally {
            if (!isStale()) {
                setLoading(false)
            }
        }
    }, [showStatus])

    useEffect(() => {
        if (!visible || !trackTitle) return
        fetchLyrics(trackTitle, trackArtist, trackPath, trackDuration)
        return () => {
            fetchSeqRef.current += 1
        }
    }, [trackTitle, trackArtist, trackPath, visible, trackDuration, fetchTrigger, fetchLyrics])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && visible) {
                onClose()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [visible, onClose])

    // Clear danmaku on track change
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.replaceChildren()
            activeCountRef.current = 0
        }
    }, [trackTitle, visible, lyrics, presentation])

    // Spawn danmaku items via direct DOM manipulation — zero React re-renders
    useEffect(() => {
        if (!visible || presentation !== 'danmaku' || activeIndex === -1 || !lyrics[activeIndex] || !containerRef.current) return

        // Cap concurrent items
        if (activeCountRef.current >= MAX_CONCURRENT) {
            const oldest = containerRef.current.querySelector('.danmaku-item')
            if (oldest) {
                oldest.remove()
                activeCountRef.current--
            }
        }

        const currentLine = lyrics[activeIndex]
        const color = NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)]
        const top = Math.floor(Math.random() * 75) + 10
        const duration = Math.random() * 5 + 8
        const size = Math.random() * 1.5 + 2

        const el = document.createElement('div')
        el.className = `danmaku-item style-${subStyle}`
        el.textContent = currentLine.text
        el.style.top = `${top}%`
        el.style.setProperty('--danmaku-duration', `${duration}s`)

        // Style-specific inline properties
        switch (subStyle) {
            case 'neon':
                el.style.fontSize = `${size}rem`
                el.style.color = color
                el.style.textShadow = `2px 2px 0 #000, -1px -1px 0 #000, 0 0 10px ${color}`
                break
            case 'minimal':
                el.style.fontSize = `${size * 0.9}rem`
                break
            case 'cyberpunk': {
                const cyberpunkColor = CYBERPUNK_MAP[color] || '#00ffff'
                el.style.fontSize = `${size * 1.1}rem`
                el.style.color = cyberpunkColor
                break
            }
            case 'glass':
                el.style.fontSize = `${size * 0.85}rem`
                break
        }

        // Self-cleanup on animation end — no React involvement
        activeCountRef.current++
        el.addEventListener('animationend', () => {
            el.remove()
            activeCountRef.current--
        }, { once: true })

        containerRef.current.appendChild(el)

    }, [activeIndex, lyrics, visible, presentation, subStyle])

    if (!visible) return null

    const durationValue = trackDuration || 0
    const progressPercent = durationValue > 0 ? Math.min(100, Math.max(0, (currentTime / durationValue) * 100)) : 0
    const activeLineStart = activeIndex >= 0 ? lyrics[activeIndex]?.time || 0 : 0
    const activeLineEnd = activeIndex >= 0 ? lyrics[activeIndex + 1]?.time || Math.max(activeLineStart + 2.4, durationValue) : 0
    const activeLineDuration = Math.max(.8, activeLineEnd - activeLineStart)
    const activeLineProgress = Math.min(1, Math.max(0, (currentTime - activeLineStart) / activeLineDuration))
    const rhythmSegment = Math.min(3, Math.floor(activeLineProgress * 4))
    const formatClock = (value: number) => {
        const minutes = Math.floor(value / 60)
        const seconds = Math.floor(value % 60)
        return `${minutes}:${seconds.toString().padStart(2, '0')}`
    }

    return (
        <div
            className={`lyrics-overlay${presentation === 'panel' ? ' panel-active' : ''}`}
            style={{ pointerEvents: presentation === 'panel' ? 'auto' : 'none' }}
        >
            {presentation === 'panel' && (
                <>
                    <div
                        className="lyrics-stage-backdrop"
                        style={trackArtwork ? { backgroundImage: `url(${trackArtwork})` } : undefined}
                    />
                    <div className="lyrics-stage">
                        <header className="lyrics-stage-header">
                            <div className="lyrics-stage-mark">♫</div>
                            <div className="lyrics-stage-heading">
                                <strong>沉浸歌詞</strong>
                                <small>NEONWAVE NOW PLAYING</small>
                            </div>
                        </header>
                        <div className="lyrics-stage-body">
                            <section className="lyrics-media-panel">
                                <div className="lyrics-media-frame">
                                    {trackArtwork ? <img src={trackArtwork} alt="" draggable={false} /> : <span>♫</span>}
                                </div>
                                <div className="lyrics-media-caption">
                                    <div className="lyrics-stage-track">
                                        <strong>{trackTitle || '尚未播放'}</strong>
                                        <span>{trackArtist || '未知演出者'}</span>
                                    </div>
                                    <div className="lyrics-stage-meta">
                                        <span>同步歌詞</span>
                                        <span>{lyrics.length} 行</span>
                                    </div>
                                </div>
                                <div className="lyrics-media-progress">
                                    <span>{formatClock(currentTime)}</span>
                                    <div><i style={{ width: `${progressPercent}%` }} /></div>
                                    <span>{formatClock(durationValue)}</span>
                                </div>
                            </section>
                            <section className="lyrics-list-panel">
                                <header className="lyrics-list-tabs">
                                    <strong>歌詞</strong>
                                </header>
                                <div className="lyrics-list-scroll" ref={panelLyricsRef}>
                                    {lyrics.length ? lyrics.map((line, index) => (
                                        <div
                                            key={`${line.time}-${index}`}
                                            data-line-index={index}
                                            aria-current={index === activeIndex ? 'true' : undefined}
                                            className={`lyrics-panel-line${index === activeIndex ? ' active' : ''}${index < activeIndex ? ' passed' : ''}`}
                                        >
                                            {line.text}
                                        </div>
                                    )) : !loading && !error ? (
                                        <div className="lyrics-panel-line active">準備顯示同步歌詞</div>
                                    ) : null}
                                </div>
                                <footer className="lyrics-list-footer">
                                    <span>LIVE LYRICS</span>
                                    <span>{activeIndex >= 0 ? `${activeIndex + 1} / ${lyrics.length}` : `${lyrics.length} 行`}</span>
                                </footer>
                            </section>
                        </div>
                    </div>
                </>
            )}
            {/* Close button */}
            <div
                style={{
                    position: 'absolute', top: '5%', right: '2%',
                    pointerEvents: 'auto', cursor: 'pointer',
                    color: 'rgba(255,255,255,0.5)', fontSize: '12px',
                    background: 'rgba(0,0,0,0.4)', borderRadius: '20px',
                    padding: '6px 14px', border: '1px solid rgba(255,255,255,0.1)',
                    backdropFilter: 'blur(4px)',
                    transition: 'all 0.2s',
                    userSelect: 'none',
                    zIndex: 100
                }}
                onClick={onClose}
                onMouseOver={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(0,0,0,0.7)' }}
                onMouseOut={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; e.currentTarget.style.background = 'rgba(0,0,0,0.4)' }}
            >
                ✕ 關閉 (ESC)
            </div>

            {/* Status bar */}
            {(statusMsg || loading) && (
                <div className={`lyrics-status ${!statusVisible ? 'hiding' : ''}`}>
                    {loading && <div className="spinner" />}
                    {loading ? '搜尋中...' : statusMsg}
                </div>
            )}

            {/* Danmaku container — items added/removed via direct DOM */}
            <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />

            {presentation !== 'danmaku' && presentation !== 'panel' && activeIndex >= 0 && lyrics[activeIndex] && (
                presentation === 'kinetic' ? (
                    <div key={`kinetic-${activeIndex}`} className="lyrics-presentation mode-kinetic">
                        <div className="kinetic-kicker">現在播放 · {trackArtist || 'NEONWAVE'}</div>
                        <div className="kinetic-ghost" aria-hidden="true">{lyrics[activeIndex].text}</div>
                        <div className="current-line" aria-label={lyrics[activeIndex].text}>
                            {Array.from(lyrics[activeIndex].text).map((character, index) => (
                                <span
                                    key={`${character}-${index}`}
                                    className="kinetic-char"
                                    aria-hidden="true"
                                    style={{ '--char-index': index } as React.CSSProperties}
                                >
                                    {character === ' ' ? '\u00a0' : character}
                                </span>
                            ))}
                        </div>
                    </div>
                ) : presentation === 'rhythm-cut' ? (
                    <div key={`rhythm-${activeIndex}-${rhythmSegment}`} className="lyrics-presentation mode-rhythm-cut">
                        <div className="rhythm-vignette" />
                        <div className="rhythm-slice" />
                        <div className="rhythm-copy">
                            <span className="rhythm-index">CUT {String(activeIndex + 1).padStart(2, '0')} · {Math.round(activeLineProgress * 100)}%</span>
                            <div className="current-line">{lyrics[activeIndex].text}</div>
                            {lyrics[activeIndex + 1] && <div className="rhythm-next">NEXT · {lyrics[activeIndex + 1].text}</div>}
                        </div>
                    </div>
                ) : (
                    <div className={`lyrics-presentation mode-${presentation}`}>
                        <div className="current-line">{lyrics[activeIndex].text}</div>
                        {presentation === 'focus' && lyrics[activeIndex + 1] && (
                            <div className="next-line">{lyrics[activeIndex + 1].text}</div>
                        )}
                    </div>
                )
            )}

            {/* Error fallback with retry */}
            {error && (
                <div className="lyrics-error" style={{ pointerEvents: 'auto' }}>
                    <div>未找到歌詞</div>
                    <button
                        onClick={() => setFetchTrigger(t => t + 1)}
                        style={{
                            marginTop: '12px',
                            padding: '8px 20px',
                            borderRadius: '20px',
                            background: 'rgba(255,255,255,0.1)',
                            border: '1px solid rgba(255,255,255,0.2)',
                            color: '#fff',
                            cursor: 'pointer',
                            fontSize: '14px',
                            transition: 'all 0.2s'
                        }}
                        onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.2)' }}
                        onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
                    >
                        🔄 重新搜尋
                    </button>
                </div>
            )}

            {/* Manual refresh when lyrics loaded — show refresh hint */}
            {!loading && !error && lyrics.length > 0 && (
                <div
                    style={{
                        position: 'absolute', bottom: '3%', right: '2%',
                        pointerEvents: 'auto', cursor: 'pointer',
                        color: 'rgba(255,255,255,0.2)', fontSize: '11px',
                        transition: 'all 0.2s',
                        userSelect: 'none'
                    }}
                    onClick={() => setFetchTrigger(t => t + 1)}
                    onMouseOver={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)' }}
                    onMouseOut={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.2)' }}
                >
                    🔄 重新搜尋歌詞
                </div>
            )}
        </div>
    )
}

export const LyricsOverlay = React.memo(LyricsOverlayView, (prev, next) => {
    if (prev.visible !== next.visible) return false
    if (!prev.visible && !next.visible) {
        return prev.trackTitle === next.trackTitle
            && prev.trackArtist === next.trackArtist
            && prev.trackPath === next.trackPath
            && prev.trackDuration === next.trackDuration
    }

    return prev.trackTitle === next.trackTitle
        && prev.trackArtist === next.trackArtist
        && prev.trackPath === next.trackPath
        && prev.trackDuration === next.trackDuration
        && prev.currentTime === next.currentTime
        && prev.trackArtwork === next.trackArtwork
})
