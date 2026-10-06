import { DurableObject } from 'cloudflare:workers';
import rapierWasm from './vendor/rapier.wasm';
import { initPhysics } from '../server/src/ragdoll.js';
import { Game, type SavedState } from '../server/src/game.js';
import { CHAIR_X, MAX_MSGS_PER_SEC, TICK_HZ } from '../server/src/config.js';

// Rapier reads its precompiled module from here (see scripts/build-rapier-worker.mjs).
(globalThis as any).__RAPIER_WASM__ = rapierWasm;

export interface Env {
  HUMAN: DurableObjectNamespace<HumanRoom>;
  ASSETS: Fetcher;
}

/** The Worker serves the page (from public/) and sends every game connection to the one human. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      // One fixed name means one object worldwide: everyone controls the same human.
      return env.HUMAN.get(env.HUMAN.idFromName('one-human')).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

type Conn = { id: number | null; windowStart: number; count: number };

/** The one human. Cloudflare runs at most one copy of this object, which is the game server. */
export class HumanRoom extends DurableObject<Env> {
  private game!: Game;
  private conns = new Map<WebSocket, Conn>();
  private loop: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private acc = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      await initPhysics();
      this.game = new Game((msg) => this.broadcast(msg), {
        save: (state) => void this.ctx.storage.put('state', state),
      });
      this.game.restore((await ctx.storage.get<SavedState>('state')) ?? null);
    });
  }

  async fetch(): Promise<Response> {
    const { 0: client, 1: ws } = new WebSocketPair();
    ws.accept();
    const conn: Conn = { id: null, windowStart: Date.now(), count: 0 };
    this.conns.set(ws, conn);
    this.countViewers();
    this.send(ws, { t: 'hello', chairX: CHAIR_X });
    this.send(ws, this.game.meta(true));

    ws.addEventListener('message', (ev) => this.onMessage(ws, conn, ev.data));
    const close = () => {
      if (!this.conns.delete(ws)) return;
      if (conn.id !== null) this.game.leave(conn.id);
      this.countViewers();
      if (this.conns.size === 0) this.stopLoop();
    };
    ws.addEventListener('close', close);
    ws.addEventListener('error', close);

    this.startLoop();
    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(ws: WebSocket, conn: Conn, raw: unknown) {
    const t = Date.now();
    if (t - conn.windowStart > 1000) {
      conn.windowStart = t;
      conn.count = 0;
    }
    if (++conn.count > MAX_MSGS_PER_SEC) return;

    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg?.t === 'join' && conn.id === null) {
      conn.id = this.game.join((m) => this.send(ws, m));
      this.countViewers();
      return;
    }
    if (conn.id === null) return;
    if (msg?.t === 'in') this.game.input(conn.id, Number(msg.axis), !!msg.up);
    else if (msg?.t === 'brain') this.game.brain(conn.id, String(msg.cmd));
    else if (msg?.t === 'emote') this.game.emote(conn.id, String(msg.e));
  }

  // The loop only runs while someone is connected, so an empty room costs nothing.
  private startLoop() {
    if (this.loop) return;
    this.last = Date.now();
    this.acc = 0;
    const stepMs = 1000 / TICK_HZ;
    this.loop = setInterval(() => {
      const now = Date.now();
      this.acc += now - this.last;
      this.last = now;
      let steps = 0;
      while (this.acc >= stepMs && steps < 5) {
        this.game.step();
        this.acc -= stepMs;
        steps++;
      }
      if (steps === 5) this.acc = 0;
    }, stepMs / 2);
  }

  private stopLoop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  private countViewers() {
    let viewers = 0;
    for (const c of this.conns.values()) if (c.id === null) viewers++;
    this.game.viewers = viewers;
  }

  private broadcast(msg: object) {
    const data = JSON.stringify(msg);
    for (const ws of this.conns.keys()) {
      try {
        ws.send(data);
      } catch {
        // closed socket; the close handler cleans it up
      }
    }
  }

  private send(ws: WebSocket, msg: object) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // closed socket
    }
  }
}
