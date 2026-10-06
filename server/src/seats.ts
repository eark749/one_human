import { ROLES, SEATS, type BrainCommand, type Role } from './config.js';
import { makeName } from './names.js';

export type Send = (msg: object) => void;

// Walking needs both legs and the torso; the brain is next most useful.
const FIRST_FILL: Role[] = ['L_LEG', 'R_LEG', 'TORSO', 'BRAIN', 'L_ARM', 'R_ARM'];

export type Seat = {
  id: number;
  name: string;
  role: Role;
  axis: number;
  up: boolean;
  lastSeen: number;
  brainCmd: BrainCommand | null;
  send: Send;
};

export type Spectator = { id: number; name: string; send: Send; joinedAt: number };

/**
 * Every role has a fixed number of seats, filled only by people.
 * An empty role has no input, so that limb hangs loose.
 * When every seat is taken, new players wait in line and watch.
 */
export class Seats {
  seats = new Map<number, Seat>();
  spectators = new Map<number, Spectator>();
  private names = new Set<string>();
  private nextId = 1;

  inRole(role: Role) {
    return [...this.seats.values()].filter((s) => s.role === role);
  }

  get all() {
    return [...this.seats.values()];
  }

  /** A person clicks "Take control". Returns their seat, or their place in line if all seats are taken. */
  join(send: Send, now: number): Seat | Spectator {
    const id = this.nextId++;
    const name = makeName(this.names);
    this.names.add(name);
    const role = this.pickRole();
    if (!role) {
      const spec: Spectator = { id, name, send, joinedAt: now };
      this.spectators.set(id, spec);
      return spec;
    }
    return this.seat(id, name, send, role, now);
  }

  /** A person leaves. Their seat goes to the first person in line, if any. */
  leave(id: number, now: number): Seat | null {
    const spec = this.spectators.get(id);
    if (spec) {
      this.spectators.delete(id);
      this.names.delete(spec.name);
      return null;
    }
    const seat = this.seats.get(id);
    if (!seat) return null;
    this.seats.delete(id);
    this.names.delete(seat.name);

    const next = this.spectators.values().next().value as Spectator | undefined;
    if (!next) return null;
    this.spectators.delete(next.id);
    return this.seat(next.id, next.name, next.send, seat.role, now);
  }

  /** Every ROTATE_MS: everyone gets a new role at random, spread evenly across the body. */
  rotate(now: number): Seat[] {
    const people = shuffle(this.all);
    this.seats.clear();
    for (const p of people) {
      this.seats.set(p.id, { ...p, role: this.pickRole()!, axis: 0, up: false, brainCmd: null, lastSeen: now });
    }
    return this.all;
  }

  queuePosition(id: number) {
    return [...this.spectators.keys()].indexOf(id) + 1;
  }

  private seat(id: number, name: string, send: Send, role: Role, now: number): Seat {
    const seat: Seat = { id, name, role, axis: 0, up: false, lastSeen: now, brainCmd: null, send };
    this.seats.set(id, seat);
    return seat;
  }

  /**
   * First make sure every role has someone, in FIRST_FILL order, so a small group
   * gets the legs before the arms. After that: the open role with the fewest people,
   * counted against its seat count. Ties are random.
   */
  private pickRole(): Role | null {
    const empty = FIRST_FILL.find((role) => this.inRole(role).length === 0);
    if (empty) return empty;
    let best: Role[] = [];
    let bestRatio = Infinity;
    for (const role of ROLES) {
      const n = this.inRole(role).length;
      if (n >= SEATS[role]) continue;
      const ratio = n / SEATS[role];
      if (ratio < bestRatio) {
        bestRatio = ratio;
        best = [role];
      } else if (ratio === bestRatio) {
        best.push(role);
      }
    }
    return best.length ? best[Math.floor(Math.random() * best.length)] : null;
  }
}

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
