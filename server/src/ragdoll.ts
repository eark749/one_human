import RAPIER from '@dimforge/rapier2d-compat';
import { CHAIR_X, DT } from './config.js';

// 2D side-view ragdoll. Units are meters, y points up, +x is "right".
// Joint angle = rotation of body B relative to body A. Positive = counter-clockwise.

export const BODY_NAMES = [
  'head', 'torso', 'pelvis',
  'uArmL', 'lArmL', 'uArmR', 'lArmR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
] as const;
type BodyName = (typeof BODY_NAMES)[number];

type BodySpec = { x: number; y: number; hx?: number; hy?: number; r?: number; friction?: number };

const SPECS: Record<BodyName, BodySpec> = {
  head: { x: 0, y: 1.76, r: 0.12 },
  torso: { x: 0, y: 1.35, hx: 0.13, hy: 0.27 },
  pelvis: { x: 0, y: 1.0, hx: 0.15, hy: 0.08 },
  uArmL: { x: 0, y: 1.45, hx: 0.04, hy: 0.15 },
  lArmL: { x: 0, y: 1.15, hx: 0.035, hy: 0.14 },
  uArmR: { x: 0, y: 1.45, hx: 0.04, hy: 0.15 },
  lArmR: { x: 0, y: 1.15, hx: 0.035, hy: 0.14 },
  thighL: { x: 0, y: 0.75, hx: 0.06, hy: 0.2 },
  shinL: { x: 0, y: 0.35, hx: 0.05, hy: 0.2 },
  footL: { x: 0.06, y: 0.05, hx: 0.1, hy: 0.04, friction: 2.5 },
  thighR: { x: 0, y: 0.75, hx: 0.06, hy: 0.2 },
  shinR: { x: 0, y: 0.35, hx: 0.05, hy: 0.2 },
  footR: { x: 0.06, y: 0.05, hx: 0.1, hy: 0.04, friction: 2.5 },
};

type JointName =
  | 'spine' | 'neck' | 'hipL' | 'hipR' | 'kneeL' | 'kneeR' | 'ankleL' | 'ankleR'
  | 'shoulderL' | 'shoulderR' | 'elbowL' | 'elbowR';

type JointSpec = { a: BodyName; b: BodyName; ax: number; ay: number; bx: number; by: number; min: number; max: number };

const JOINTS: Record<JointName, JointSpec> = {
  spine: { a: 'pelvis', b: 'torso', ax: 0, ay: 0.08, bx: 0, by: -0.27, min: -0.5, max: 0.5 },
  neck: { a: 'torso', b: 'head', ax: 0, ay: 0.28, bx: 0, by: -0.13, min: -0.5, max: 0.5 },
  hipL: { a: 'pelvis', b: 'thighL', ax: 0, ay: -0.05, bx: 0, by: 0.2, min: -0.8, max: 1.7 },
  hipR: { a: 'pelvis', b: 'thighR', ax: 0, ay: -0.05, bx: 0, by: 0.2, min: -0.8, max: 1.7 },
  kneeL: { a: 'thighL', b: 'shinL', ax: 0, ay: -0.2, bx: 0, by: 0.2, min: -2.3, max: 0 },
  kneeR: { a: 'thighR', b: 'shinR', ax: 0, ay: -0.2, bx: 0, by: 0.2, min: -2.3, max: 0 },
  ankleL: { a: 'shinL', b: 'footL', ax: 0, ay: -0.2, bx: -0.06, by: 0.1, min: -0.4, max: 0.4 },
  ankleR: { a: 'shinR', b: 'footR', ax: 0, ay: -0.2, bx: -0.06, by: 0.1, min: -0.4, max: 0.4 },
  shoulderL: { a: 'torso', b: 'uArmL', ax: 0, ay: 0.24, bx: 0, by: 0.14, min: -3.1, max: 3.1 },
  shoulderR: { a: 'torso', b: 'uArmR', ax: 0, ay: 0.24, bx: 0, by: 0.14, min: -3.1, max: 3.1 },
  elbowL: { a: 'uArmL', b: 'lArmL', ax: 0, ay: -0.15, bx: 0, by: 0.15, min: 0, max: 2.4 },
  elbowR: { a: 'uArmR', b: 'lArmR', ax: 0, ay: -0.15, bx: 0, by: 0.15, min: 0, max: 2.4 },
};

// Tuning. These decide whether the game is fun.
export const TUNING = {
  density: 130, // about 69 kg total
  hipRange: 1.0, // full input swings the hip this far (rad)
  shoulderRange: 2.5,
  hipSpeed: 6.0, // max rad/s the hip target can move, so legs never snap
  shoulderSpeed: 8.0,
  legStiffness: 8000,
  legDamping: 400,
  legMaxForce: 4000,
  balanceK: 1000, // balance assist: the main "difficulty" setting. Below ~700 the body cannot stand.
  balanceD: 150,
  leanTorque: 250,
  kneeLift: 0.9,
};

// Collision groups: the body never collides with itself, only with the world.
const GROUP_WORLD = 0x0001;
const GROUP_BODY = 0x0002;
const groups = (member: number, filter: number) => (member << 16) | filter;

export type Drive = { lLeg: number; rLeg: number; lArm: number; rArm: number; torso: number };

export class Ragdoll {
  world: RAPIER.World;
  bodies = {} as Record<BodyName, RAPIER.RigidBody>;
  joints = {} as Record<JointName, RAPIER.RevoluteImpulseJoint>;
  // Servo targets: the group average sets where the limb should point, the motor moves it there.
  // Zero input means straight legs, so random noise averages out to standing still.
  hipTarget = { L: 0, R: 0 };
  kneeTarget = { L: -0.05, R: -0.05 };
  shoulderTarget = { L: 0, R: 0 };

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81 });
    this.world.timestep = DT;
    this.buildWorld();
    this.buildBody(0);
  }

  private buildWorld() {
    const fixed = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const add = (desc: RAPIER.ColliderDesc) =>
      this.world.createCollider(desc.setCollisionGroups(groups(GROUP_WORLD, GROUP_BODY)), fixed);
    add(RAPIER.ColliderDesc.cuboid(200, 0.5).setTranslation(0, -0.5).setFriction(1.2));
    // Chair: seat top at y = 0.5, back on the far side.
    add(RAPIER.ColliderDesc.cuboid(0.25, 0.04).setTranslation(CHAIR_X, 0.46).setFriction(1.5));
    add(RAPIER.ColliderDesc.cuboid(0.03, 0.4).setTranslation(CHAIR_X + 0.25, 0.9));
    add(RAPIER.ColliderDesc.cuboid(0.02, 0.21).setTranslation(CHAIR_X - 0.22, 0.21));
    add(RAPIER.ColliderDesc.cuboid(0.02, 0.21).setTranslation(CHAIR_X + 0.22, 0.21));
  }

  private buildBody(x: number) {
    for (const name of BODY_NAMES) {
      const s = SPECS[name];
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(x + s.x, s.y).setLinearDamping(0.05).setAngularDamping(0.5),
      );
      const shape = s.r ? RAPIER.ColliderDesc.ball(s.r) : RAPIER.ColliderDesc.cuboid(s.hx!, s.hy!);
      this.world.createCollider(
        shape.setDensity(TUNING.density).setFriction(s.friction ?? 0.6).setCollisionGroups(groups(GROUP_BODY, GROUP_WORLD)),
        body,
      );
      this.bodies[name] = body;
    }
    for (const [name, j] of Object.entries(JOINTS) as [JointName, JointSpec][]) {
      const data = RAPIER.JointData.revolute({ x: j.ax, y: j.ay }, { x: j.bx, y: j.by });
      const joint = this.world.createImpulseJoint(data, this.bodies[j.a], this.bodies[j.b], true) as RAPIER.RevoluteImpulseJoint;
      joint.setLimits(j.min, j.max);
      joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
      this.joints[name] = joint;
    }
  }

  /** Put the body back in the standing pose at horizontal position x. */
  reset(x: number) {
    for (const name of BODY_NAMES) {
      const s = SPECS[name];
      const b = this.bodies[name];
      b.setTranslation({ x: x + s.x, y: s.y }, true);
      b.setRotation(0, true);
      b.setLinvel({ x: 0, y: 0 }, true);
      b.setAngvel(0, true);
    }
    this.hipTarget = { L: 0, R: 0 };
    this.kneeTarget = { L: -0.05, R: -0.05 };
    this.shoulderTarget = { L: 0, R: 0 };
  }

  private angleOf(j: JointName) {
    const s = JOINTS[j];
    return this.bodies[s.b].rotation() - this.bodies[s.a].rotation();
  }

  /** Turn the group averages into motor targets, then add balance assist. */
  drive(d: Drive, assist: boolean) {
    const clampTo = (v: number, j: JointName) => Math.max(JOINTS[j].min, Math.min(JOINTS[j].max, v));

    const prevHip = { ...this.hipTarget };
    const approach = (cur: number, goal: number, speed: number) =>
      cur + Math.max(-speed * DT, Math.min(speed * DT, goal - cur));
    this.hipTarget.L = clampTo(approach(this.hipTarget.L, d.lLeg * TUNING.hipRange, TUNING.hipSpeed), 'hipL');
    this.hipTarget.R = clampTo(approach(this.hipTarget.R, d.rLeg * TUNING.hipRange, TUNING.hipSpeed), 'hipR');
    this.shoulderTarget.L = clampTo(approach(this.shoulderTarget.L, d.lArm * TUNING.shoulderRange, TUNING.shoulderSpeed), 'shoulderL');
    this.shoulderTarget.R = clampTo(approach(this.shoulderTarget.R, d.rArm * TUNING.shoulderRange, TUNING.shoulderSpeed), 'shoulderR');

    const servo = (j: JointName, target: number, k: number, c: number, maxF: number) => {
      const joint = this.joints[j];
      joint.configureMotorPosition(target, k, c);
      joint.setMotorMaxForce(maxF);
    };
    const { legStiffness: k, legDamping: c, legMaxForce: f } = TUNING;
    servo('hipL', this.hipTarget.L, k, c, f);
    servo('hipR', this.hipTarget.R, k, c, f);
    // Knees follow the hips automatically: lift the foot while the leg swings forward,
    // straighten while it pushes back. Players control one thing per leg.
    for (const side of ['L', 'R'] as const) {
      const swinging = this.hipTarget[side] - prevHip[side] > 0.0005;
      const goal = swinging ? -TUNING.kneeLift : -0.05;
      this.kneeTarget[side] += (goal - this.kneeTarget[side]) * 0.25;
    }
    servo('kneeL', this.kneeTarget.L, k, c, f);
    servo('kneeR', this.kneeTarget.R, k, c, f);
    servo('ankleL', 0, 1500, 80, 1500);
    servo('ankleR', 0, 1500, 80, 1500);
    servo('shoulderL', this.shoulderTarget.L, 300, 20, 300);
    servo('shoulderR', this.shoulderTarget.R, 300, 20, 300);
    servo('elbowL', 0.4, 100, 8, 100);
    servo('elbowR', 0.4, 100, 8, 100);
    servo('neck', 0, 300, 20, 300);
    // Positive torso input leans the torso toward +x (clockwise).
    servo('spine', 0, 4000, 250, 4000);

    const torso = this.bodies.torso;
    torso.applyTorqueImpulse(-d.torso * TUNING.leanTorque * DT, true);
    if (assist) {
      // Hidden "training wheels": push torso and pelvis back toward upright.
      const upright = (b: RAPIER.RigidBody, share: number) => {
        const torque = -normalize(b.rotation()) * TUNING.balanceK - b.angvel() * TUNING.balanceD;
        b.applyTorqueImpulse(torque * DT * share, true);
      };
      upright(torso, 0.6);
      upright(this.bodies.pelvis, 0.6);
    }
  }

  step() {
    this.world.step();
  }

  get torsoAngle() {
    return normalize(this.bodies.torso.rotation());
  }

  get pelvis() {
    return this.bodies.pelvis.translation();
  }

  /** x, y, angle for every body, in BODY_NAMES order. */
  snapshot(): number[] {
    const out: number[] = [];
    for (const name of BODY_NAMES) {
      const b = this.bodies[name];
      const t = b.translation();
      out.push(round(t.x), round(t.y), round(b.rotation()));
    }
    return out;
  }

  hipAngles() {
    return { L: this.angleOf('hipL'), R: this.angleOf('hipR') };
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const normalize = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export async function initPhysics() {
  await RAPIER.init();
}
