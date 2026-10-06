import {
  BRAIN_COMMANDS, CHAIR_X, DEADZONE, DT, EMOTES, INPUT_STALE_MS, META_EVERY, PARTS, ROTATE_MS,
  SAVE_EVERY, SEATS, SNAPSHOT_EVERY, START_X,
  type BodyPart, type BrainCommand, type Emote,
} from './config.js';
import { Ragdoll } from './ragdoll.js';
import { Seats, type Seat, type Send, type Spectator } from './seats.js';

export type LifeRecord = { life: number; startedAt: number; endedAt: number; cause: string; sits: number };
export type SavedState = { life: number; bestSitMs: number | null; lives: LifeRecord[] };

/** Where lives and records are kept: a JSON file on Node, Durable Object storage on Cloudflare. */
export interface Store {
  save(state: SavedState): void;
}

export class Game {
  ragdoll = new Ragdoll();
  seats = new Seats();
  tick = 0;
  now = 0; // simulation clock in ms

  life = 1;
  lifeStartedAt = Date.now();
  sitsThisLife = 0;
  health = 100;
  bestSitMs: number | null = null;
  lives: LifeRecord[] = [];
  objectiveStart = 0;

  fallen = false;
  private fallTimer = 0;
  getUp = 0; // 0..1 shared progress bar
  private sitTimer = 0;
  private headSpeedPrev = 0;
  pausedUntil = 0; // after death or success, the body goes limp for a moment
  private afterPause: (() => void) | null = null;

  brainCmd: BrainCommand | null = null;
  brainVotes = { votes: 0, of: 0 };
  private nextBrainTally = 0;
  private lastRotate = 0;
  private emoteLog: { e: Emote; at: number }[] = [];

  agg: Record<BodyPart, number> = { L_LEG: 0, R_LEG: 0, L_ARM: 0, R_ARM: 0, TORSO: 0 };
  agreement: Record<BodyPart, number> = { L_LEG: 1, R_LEG: 1, L_ARM: 1, R_ARM: 1, TORSO: 1 };
  viewers = 0; // connected but not playing yet, set by the server

  private lastRosterKey = '';

  constructor(private broadcast: (msg: object) => void = () => {}, private store: Store | null = null) {}

  /** Continue from saved lives and records. */
  restore(s: SavedState | null) {
    if (!s) return;
    this.life = s.life;
    this.bestSitMs = s.bestSitMs;
    this.lives = s.lives ?? [];
  }

  // ---------- players ----------

  join(send: Send) {
    const who = this.seats.join(send, this.now);
    if ('role' in who) {
      send({ t: 'welcome', id: who.id, name: who.name, role: who.role, chairX: CHAIR_X });
    } else {
      send({ t: 'welcome', id: who.id, name: who.name, role: null, queue: this.seats.queuePosition(who.id), chairX: CHAIR_X });
    }
    return who.id;
  }

  leave(id: number) {
    const promoted = this.seats.leave(id, this.now);
    if (promoted) promoted.send?.({ t: 'role', role: promoted.role });
  }

  input(id: number, axis: number, up: boolean) {
    const seat = this.seats.seats.get(id);
    if (!seat) return;
    seat.axis = Number.isFinite(axis) ? Math.max(-1, Math.min(1, axis)) : 0;
    seat.up = !!up;
    seat.lastSeen = this.now;
  }

  brain(id: number, cmd: string) {
    const seat = this.seats.seats.get(id);
    if (!seat || seat.role !== 'BRAIN') return;
    if (!(BRAIN_COMMANDS as readonly string[]).includes(cmd)) return;
    seat.brainCmd = cmd as BrainCommand;
    seat.lastSeen = this.now;
  }

  emote(id: number, e: string) {
    if (!this.seats.seats.has(id) && !this.seats.spectators.has(id)) return;
    if (!(EMOTES as readonly string[]).includes(e)) return;
    this.emoteLog.push({ e: e as Emote, at: this.now });
  }

  // ---------- tick ----------

  step() {
    this.now += DT * 1000;
    this.tick++;

    if (this.now - this.lastRotate >= ROTATE_MS) {
      this.lastRotate = this.now;
      for (const s of this.seats.rotate(this.now)) s.send?.({ t: 'role', role: s.role });
      this.broadcast({ t: 'event', kind: 'rotate' });
    }

    if (this.now >= this.nextBrainTally) {
      this.nextBrainTally = this.now + 2000;
      this.tallyBrain();
    }
    this.aggregate();

    const paused = this.now < this.pausedUntil;
    if (paused || this.fallen) {
      this.ragdoll.drive({ lLeg: 0, rLeg: 0, lArm: 0, rArm: 0, torso: 0 }, false);
    } else {
      this.ragdoll.drive(
        { lLeg: this.agg.L_LEG, rLeg: this.agg.R_LEG, lArm: this.agg.L_ARM, rArm: this.agg.R_ARM, torso: this.agg.TORSO },
        true,
      );
    }
    this.ragdoll.step();

    if (paused) {
      // nothing to judge while the death or success screen is up
    } else if (this.afterPause) {
      const fn = this.afterPause;
      this.afterPause = null;
      fn();
    } else {
      this.updateVitals();
      this.updateObjective();
    }

    if (this.tick % SNAPSHOT_EVERY === 0) this.broadcast(this.snapshot());
    if (this.tick % META_EVERY === 0) this.broadcast(this.meta());
    if (this.tick % SAVE_EVERY === 0) this.save();
  }

  private aggregate() {
    for (const part of PARTS) {
      const active = this.seats
        .inRole(part)
        .filter((s) => this.now - s.lastSeen < INPUT_STALE_MS);
      const n = active.length;
      const mean = n ? active.reduce((sum, s) => sum + s.axis, 0) / n : 0;
      const sd = n ? Math.sqrt(active.reduce((sum, s) => sum + (s.axis - mean) ** 2, 0) / n) : 0;
      this.agg[part] = Math.abs(mean) < DEADZONE ? 0 : mean;
      this.agreement[part] = Math.max(0, 1 - sd);
    }
  }

  /** Each brain seat is one vote. No active brain means no order on screen. */
  private tallyBrain() {
    const brains = this.seats.inRole('BRAIN').filter((s) => s.brainCmd && this.now - s.lastSeen < 10_000);
    if (!brains.length) {
      this.brainCmd = null;
      this.brainVotes = { votes: 0, of: 0 };
      return;
    }
    const tally = new Map<BrainCommand, number>();
    for (const s of brains) tally.set(s.brainCmd!, (tally.get(s.brainCmd!) ?? 0) + 1);
    let best: BrainCommand | null = null;
    let bestVotes = -1;
    for (const [cmd, v] of tally) {
      if (v > bestVotes) {
        best = cmd;
        bestVotes = v;
      }
    }
    this.brainCmd = best;
    this.brainVotes = { votes: brains.filter((s) => s.brainCmd === best).length, of: brains.length };
  }

  private updateVitals() {
    const r = this.ragdoll;
    const tilted = Math.abs(r.torsoAngle) > 1.2;

    if (!this.fallen) {
      this.fallTimer = tilted ? this.fallTimer + DT : 0;
      if (this.fallTimer > 1.5) {
        this.fallen = true;
        this.getUp = 0;
        this.broadcast({ t: 'event', kind: 'fall' });
      }
    } else {
      const seated = this.seats.all.filter((s) => s.role !== 'BRAIN' && this.now - s.lastSeen < INPUT_STALE_MS);
      const share = seated.length ? seated.filter((s) => s.up).length / seated.length : 0;
      this.getUp = Math.max(0, Math.min(1, this.getUp + (share - 0.3) * DT * 1.2));
      if (this.getUp >= 1) {
        this.fallen = false;
        this.fallTimer = 0;
        this.getUp = 0;
        r.reset(r.pelvis.x);
        this.broadcast({ t: 'event', kind: 'getup' });
      }
    }

    const head = r.bodies.head;
    const v = head.linvel();
    const speed = Math.hypot(v.x, v.y);
    if (head.translation().y < 0.17 && this.headSpeedPrev > 3) {
      this.health -= (this.headSpeedPrev - 3) * 25;
      this.broadcast({ t: 'event', kind: 'hit', health: Math.max(0, Math.round(this.health)) });
    }
    this.headSpeedPrev = speed;

    if (this.health <= 0) this.die('hit its head too hard');
    else if (r.pelvis.y < -2) this.die('fell out of the world');
  }

  private updateObjective() {
    const r = this.ragdoll;
    const p = r.pelvis;
    const onSeat = Math.abs(p.x - CHAIR_X) < 0.3 && p.y > 0.45 && p.y < 0.85 && Math.abs(r.torsoAngle) < 0.45;
    this.sitTimer = onSeat ? this.sitTimer + DT : 0;
    if (this.sitTimer >= 2) {
      const ms = Math.round(this.now - this.objectiveStart);
      const record = this.bestSitMs === null || ms < this.bestSitMs;
      if (record) this.bestSitMs = ms;
      this.sitsThisLife++;
      this.broadcast({ t: 'event', kind: 'sit', ms, record, players: this.seats.seats.size });
      this.sitTimer = 0;
      this.pausedUntil = this.now + 3000;
      this.afterPause = () => {
        r.reset(START_X);
        this.objectiveStart = this.now;
      };
    }
  }

  private die(cause: string) {
    const ended = Date.now();
    this.lives.push({ life: this.life, startedAt: this.lifeStartedAt, endedAt: ended, cause, sits: this.sitsThisLife });
    this.lives = this.lives.slice(-50);
    this.broadcast({ t: 'event', kind: 'death', life: this.life, cause, ms: ended - this.lifeStartedAt });
    this.pausedUntil = this.now + 5000;
    this.afterPause = () => {
      this.life++;
      this.health = 100;
      this.sitsThisLife = 0;
      this.lifeStartedAt = Date.now();
      this.fallen = false;
      this.fallTimer = 0;
      this.getUp = 0;
      this.ragdoll.reset(START_X);
      this.objectiveStart = this.now;
      this.broadcast({ t: 'event', kind: 'newlife', life: this.life });
    };
    this.health = 1; // stop repeat deaths during the pause
    this.save();
  }

  // ---------- messages ----------

  snapshot() {
    return {
      t: 'snap',
      tick: this.tick,
      b: this.ragdoll.snapshot(),
      agg: PARTS.map((p) => Math.round(this.agg[p] * 100) / 100),
      up: Math.round(this.getUp * 100) / 100,
      f: this.fallen ? 1 : 0,
    };
  }

  /** Game info. The player list is only included when it changed, or when `full` is set (new connection). */
  meta(full = false) {
    const cutoff = this.now - 5000;
    this.emoteLog = this.emoteLog.filter((e) => e.at > cutoff);
    const emotes: Record<string, number> = {};
    for (const e of this.emoteLog) emotes[e.e] = (emotes[e.e] ?? 0) + 1;
    const people = this.seats.all;
    const rosterKey = people.map((s) => `${s.id}:${s.role}`).join(',');
    const rosterChanged = rosterKey !== this.lastRosterKey;
    if (!full) this.lastRosterKey = rosterKey;
    const roster = full || rosterChanged ? people.map((s: Seat) => ({ id: s.id, name: s.name, role: s.role })) : undefined;
    const idle = people.filter((s) => this.now - s.lastSeen >= 2000).map((s) => s.id);
    return {
      t: 'meta',
      players: this.seats.seats.size,
      queue: this.seats.spectators.size,
      watching: this.viewers,
      seats: SEATS,
      roster,
      idle,
      brain: { cmd: this.brainCmd, ...this.brainVotes },
      emotes,
      agreement: this.agreement,
      life: this.life,
      health: Math.max(0, Math.round(this.health)),
      objective: { name: 'REACH THE SEAT', ms: Math.round(this.now - this.objectiveStart) },
      best: this.bestSitMs,
      nextRotateMs: Math.max(0, Math.round(ROTATE_MS - (this.now - this.lastRotate))),
    };
  }

  spectatorQueue(): Spectator[] {
    return [...this.seats.spectators.values()];
  }

  private save() {
    this.store?.save({ life: this.life, bestSitMs: this.bestSitMs, lives: this.lives });
  }
}
