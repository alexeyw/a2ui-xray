#!/usr/bin/env node
/* Records docs/demo.gif and docs/demo.mp4: the booking demo played through, then a typo in the editor
   caught by the schema check and fixed. Chrome is driven over the DevTools protocol; its screencast
   hands over each painted frame with a timestamp, and ffmpeg turns them into steady 15 fps (GIF) and 30 fps (MP4).
   Usage: node tools/record_demo.mjs [page url]   (default http://localhost:8791/; needs Chrome and ffmpeg)
   Node 22+ (built-in WebSocket). */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8791/';
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const W = 1240, H = 720, PORT = 9333;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui-xray-rec-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${work}/profile`,
  `--window-size=${W},${H}`, '--hide-scrollbars', '--force-device-scale-factor=1', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let targets = [];
for (let i = 0; i < 50 && !targets.length; i++) { try { targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(t => t.type === 'page'); } catch (e) {} await sleep(200); }
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let seq = 0; const pending = new Map(), listeners = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else listeners.forEach(f => f(m)); };
const send = (method, params = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(expr + ': ' + r.result.exceptionDetails.text); return r.result?.result?.value; };
const type = async (text, gap = 140) => { for (const ch of text) { await send('Input.insertText', { text: ch }); await sleep(gap); } };

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: BASE + '?demo=0&step=-1&theme=dark' });
await sleep(1500);

const frames = [];
listeners.push(m => {
  if (m.method !== 'Page.screencastFrame') return;
  const { data, metadata, sessionId } = m.params;
  const file = `f${String(frames.length).padStart(5, '0')}.png`;
  fs.writeFileSync(path.join(work, file), Buffer.from(data, 'base64'));
  frames.push({ file, t: metadata.timestamp });
  send('Page.screencastFrameAck', { sessionId });
});
await send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: W, maxHeight: H });
await sleep(900);

/* 1. the booking stream plays through: progressive rendering, the user types, presses Book, the agent answers */
await ev('play()');
for (;;) { await sleep(200); const s = await ev('({idx,n:steps.length,playing})'); if (!s.playing && s.idx === s.n - 1) break; }
await sleep(2400);

/* 2. the editor at message 5: a typo in a component name is caught, then fixed */
await ev('setEditing(true,4)');
await sleep(1600);
const sel = (needle, from) => ev(`(()=>{const i=ed.value.indexOf(${JSON.stringify(needle)});const p=i+${from};ed.focus();ed.setSelectionRange(p,p+4);return i})()`);
if (await sel('"id":"name","component":"TextField"', '"id":"name","component":"TextF'.length) < 0) throw new Error('TextField line not found');
await sleep(700);
await type('eild');
await sleep(3600);
await sel('"component":"TextFeild"', '"component":"TextF'.length);
await sleep(600);
await type('ield');
await sleep(2600);
await send('Page.stopScreencast');
await sleep(300);
chrome.kill();

/* frames come only when something repaints: each lasts until the next one */
const list = frames.map((f, i) => `file '${path.join(work, f.file)}'\nduration ${Math.max(0.001, ((frames[i + 1]?.t ?? (frames[i].t + 1.5)) - f.t)).toFixed(4)}`);
list.push(`file '${path.join(work, frames[frames.length - 1].file)}'`);
fs.writeFileSync(path.join(work, 'list.txt'), 'ffconcat version 1.0\n' + list.join('\n') + '\n');
const span = frames[frames.length - 1].t - frames[0].t;
console.log(`${frames.length} frames over ${span.toFixed(1)} s (${(frames.length / span).toFixed(1)} per second on average)`);

const ff = args => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
const docs = path.join(ROOT, 'docs');
ff(['-f', 'concat', '-safe', '0', '-i', path.join(work, 'list.txt'), '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', path.join(docs, 'demo.mp4')]);
ff(['-f', 'concat', '-safe', '0', '-i', path.join(work, 'list.txt'), '-vf', 'fps=15,palettegen=stats_mode=diff:max_colors=200', path.join(work, 'palette.png')]);
ff(['-f', 'concat', '-safe', '0', '-i', path.join(work, 'list.txt'), '-i', path.join(work, 'palette.png'), '-lavfi', 'fps=15[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle', path.join(docs, 'demo.gif')]);
for (const f of ['demo.gif', 'demo.mp4']) console.log(f, (fs.statSync(path.join(docs, f)).size / 1048576).toFixed(2), 'MB');
console.log('frames kept in', work);
process.exit(0);
