import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { initPhysics } from './ragdoll.js';
import { Game } from './game.js';
import { FileStore } from './fileStore.js';
import { CHAIR_X, MAX_MSGS_PER_SEC, TICK_HZ } from './config.js';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = path.resolve('public');
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

await initPhysics();

const sockets = new Set<WebSocket>();
const playing = new Set<WebSocket>();
const store = new FileStore();
const game = new Game((msg) => {
  const data = JSON.stringify(msg);
  for (const ws of sockets) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}, store);
game.restore(store.load());

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const file = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(body);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
// Visitors watch first. They only take a seat after they click "Take control".
wss.on('connection', (ws) => {
  sockets.add(ws);
  let id: number | null = null;
  const reply = (msg: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
  const countViewers = () => (game.viewers = [...sockets].filter((s) => !playing.has(s)).length);
  countViewers();
  reply({ t: 'hello', chairX: CHAIR_X });
  reply(game.meta(true));

  let windowStart = Date.now();
  let count = 0;
  ws.on('message', (raw) => {
    const t = Date.now();
    if (t - windowStart > 1000) {
      windowStart = t;
      count = 0;
    }
    if (++count > MAX_MSGS_PER_SEC) return;

    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg?.t === 'join' && id === null) {
      id = game.join(reply);
      playing.add(ws);
      countViewers();
      return;
    }
    if (id === null) return;
    if (msg?.t === 'in') game.input(id, Number(msg.axis), !!msg.up, Number.isInteger(msg.life) ? msg.life : undefined);
    else if (msg?.t === 'brain') game.brain(id, String(msg.cmd));
    else if (msg?.t === 'emote') game.emote(id, String(msg.e));
  });
  ws.on('close', () => {
    sockets.delete(ws);
    playing.delete(ws);
    if (id !== null) game.leave(id);
    countViewers();
  });
});

// Fixed-step loop. Catch up if the timer fires late, but never run more than 5 steps at once.
let last = performance.now();
let acc = 0;
const stepMs = 1000 / TICK_HZ;
setInterval(() => {
  const now = performance.now();
  acc += now - last;
  last = now;
  let steps = 0;
  while (acc >= stepMs && steps < 5) {
    game.step();
    acc -= stepMs;
    steps++;
  }
  if (steps === 5) acc = 0;
}, stepMs / 2);

server.listen(PORT, () => console.log(`One Human running on http://localhost:${PORT}`));
