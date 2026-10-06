export const PARTS = ['L_LEG', 'R_LEG', 'L_ARM', 'R_ARM', 'TORSO'] as const;
export type BodyPart = (typeof PARTS)[number];
export type Role = BodyPart | 'BRAIN';
export const ROLES: Role[] = [...PARTS, 'BRAIN'];

// Active seats per role. Everyone beyond this watches from the queue.
// Empty seats are always filled by bots so the human never stands still.
export const SEATS: Record<Role, number> = {
  L_LEG: 8,
  R_LEG: 8,
  L_ARM: 5,
  R_ARM: 5,
  TORSO: 6,
  BRAIN: 2,
};

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
export const SNAPSHOT_EVERY = 3; // 20 Hz
export const META_EVERY = 30; // 2 Hz
export const SAVE_EVERY = 60 * 10; // every 10 s

export const ROTATE_MS = 60_000;
export const INPUT_STALE_MS = 500;
export const DEADZONE = 0.1;
export const MAX_MSGS_PER_SEC = 30;

export const START_X = 0;
export const CHAIR_X = 5;

export const BRAIN_COMMANDS = [
  'WALK_RIGHT',
  'WALK_LEFT',
  'STOP',
  'LEFT_LEG_NOW',
  'RIGHT_LEG_NOW',
  'LEAN_FORWARD',
  'LEAN_BACK',
  'GET_UP',
  'SIT',
] as const;
export type BrainCommand = (typeof BRAIN_COMMANDS)[number];

export const EMOTES = ['GO', 'STOP', 'LEFT', 'RIGHT', 'WAIT'] as const;
export type Emote = (typeof EMOTES)[number];
