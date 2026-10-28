/**
 * Arcade car model. Relaxed, forgiving handling rather than a simulator:
 *  - Kinematic bicycle steering that scales with speed.
 *  - Lateral grip that bleeds off sideways velocity, so the car stays on
 *    course normally but slides when the handbrake is pulled or grip is low.
 *  - Gravity along the terrain slope, rolling and air drag, and real airtime
 *    when the ground falls away faster than the car (e.g. crests at speed).
 *
 * Pure: takes the current state, an input snapshot, a time step and an
 * environment (ground height + grip), and returns the next state.
 */

export const CAR = {
  WHEELBASE: 2.6,
  MAX_SPEED: 42, // m/s (~150 km/h)
  REVERSE_MAX: 12, // m/s
  ENGINE_ACCEL: 7.5, // m/s^2 at standstill
  BRAKE_DECEL: 16,
  REVERSE_ACCEL: 4.5,
  ROLLING_RESIST: 0.35,
  AIR_DRAG: 0.0004,
  GRIP: 18, // lateral grip, 1/s (higher = less sliding)
  HANDBRAKE_GRIP: 2.5,
  MAX_STEER_LOW: 0.62, // rad at low speed
  MAX_STEER_HIGH: 0.22, // rad at top speed
  STEER_RATE: 4.5, // how fast the wheel turns, rad/s equiv.
  GRAVITY: 9.81,
  CLEARANCE: 0.32,
} as const;

export interface CarState {
  x: number;
  y: number;
  z: number;
  /** Heading in radians: forward = (sin h, cos h) in the x/z plane. */
  heading: number;
  vx: number;
  vy: number;
  vz: number;
  steerAngle: number;
  yawRate: number;
  airborne: boolean;
  /** Visual suspension angles (radians). */
  pitch: number;
  roll: number;
  pitchVel: number;
  rollVel: number;
}

export interface CarInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
  handbrake: boolean;
}

export interface CarEnv {
  /** Road/terrain surface height at (x, z). */
  groundHeight(x: number, z: number): number;
  /** Multiplier on grip: 1 = dry road, <1 = wet or loose surface. */
  gripMul: number;
  /** True while the car is on a road, used for off-road drag. */
  onRoad: boolean;
}

export function createCar(x: number, z: number, heading: number, groundY: number): CarState {
  return {
    x,
    y: groundY + CAR.CLEARANCE,
    z,
    heading,
    vx: 0,
    vy: 0,
    vz: 0,
    steerAngle: 0,
    yawRate: 0,
    airborne: false,
    pitch: 0,
    roll: 0,
    pitchVel: 0,
    rollVel: 0,
  };
}

export function speedMs(s: CarState): number {
  return Math.hypot(s.vx, s.vz);
}

/** Signed forward speed (negative when reversing). */
export function forwardSpeed(s: CarState): number {
  return s.vx * Math.sin(s.heading) + s.vz * Math.cos(s.heading);
}

export function stepCar(prev: CarState, input: CarInput, dt: number, env: CarEnv): CarState {
  const s: CarState = { ...prev };
  const h0 = s.heading;
  const fx0 = Math.sin(h0);
  const fz0 = Math.cos(h0);
  let v = s.vx * fx0 + s.vz * fz0; // forward speed
  const lat = s.vx * fz0 - s.vz * fx0; // lateral speed (positive = car's right)
  const absV = Math.abs(v);

  // --- Longitudinal ---
  const throttle = Math.max(0, Math.min(1, input.throttle));
  const brake = Math.max(0, Math.min(1, input.brake));
  let accel = 0;
  if (throttle > 0 && v > -1) {
    const frac = Math.min(1, Math.max(0, v) / CAR.MAX_SPEED);
    accel += CAR.ENGINE_ACCEL * throttle * (1 - frac * frac);
  }
  if (brake > 0) {
    if (v > 0.5) accel -= CAR.BRAKE_DECEL * brake;
    else if (v > -CAR.REVERSE_MAX) accel -= CAR.REVERSE_ACCEL * brake;
  }
  // Rolling resistance and air drag always act against motion.
  if (absV > 0.01) {
    const resist = CAR.ROLLING_RESIST + (env.onRoad ? 0 : 1.2) + CAR.AIR_DRAG * absV * absV;
    accel -= Math.sign(v) * resist;
  }

  // Gravity along the slope in the car's forward direction.
  const probe = 2;
  const gFront = env.groundHeight(s.x + fx0 * probe, s.z + fz0 * probe);
  const gBack = env.groundHeight(s.x - fx0 * probe, s.z - fz0 * probe);
  const slope = (gFront - gBack) / (2 * probe);
  accel -= CAR.GRAVITY * slope;

  v += accel * dt;
  // Snap to rest only when nothing is pushing the car (no pedal, no slope).
  if (Math.abs(v) < 0.02 && throttle === 0 && brake === 0 && Math.abs(slope) < 0.005) v = 0;
  v = Math.max(-CAR.REVERSE_MAX, Math.min(CAR.MAX_SPEED * 1.05, v));

  // --- Steering ---
  const speedFrac = Math.min(1, absV / CAR.MAX_SPEED);
  const maxSteer = CAR.MAX_STEER_LOW + (CAR.MAX_STEER_HIGH - CAR.MAX_STEER_LOW) * speedFrac;
  const targetSteer = Math.max(-1, Math.min(1, input.steer)) * maxSteer;
  const maxDelta = CAR.STEER_RATE * dt;
  s.steerAngle += Math.max(-maxDelta, Math.min(maxDelta, targetSteer - s.steerAngle));
  // Kinematic bicycle model. Positive steer = turn right = increasing heading.
  s.yawRate = (v * Math.tan(s.steerAngle)) / CAR.WHEELBASE;
  const h1 = h0 + s.yawRate * dt;
  s.heading = h1;

  // --- Lateral grip (drift when handbrake or low grip) ---
  let grip = CAR.GRIP * env.gripMul;
  if (input.handbrake) grip = CAR.HANDBRAKE_GRIP;
  // Less grip at high speed so fast corners feel loose.
  grip *= 1 - 0.25 * speedFrac;
  const latKeep = Math.exp(-grip * dt);

  // Centrifugal effect: turning pushes the car sideways (body frame), then grip pulls it back.
  // This is what produces slip angles, drift under the handbrake, and understeer in corners.
  const latNew = (lat - v * s.yawRate * dt) * latKeep;

  // Rebuild world velocity from forward and lateral components with the new heading.
  const fx = Math.sin(h1);
  const fz = Math.cos(h1);
  const rx = fz; // car's right vector
  const rz = -fx;
  s.vx = fx * v + rx * latNew;
  s.vz = fz * v + rz * latNew;

  // --- Integrate position ---
  s.x += s.vx * dt;
  s.z += s.vz * dt;

  // --- Vertical: follow the ground, with airtime if it drops away ---
  const ground = env.groundHeight(s.x, s.z) + CAR.CLEARANCE;
  if (s.y > ground + 0.05) {
    s.airborne = true;
    s.vy -= CAR.GRAVITY * dt;
    s.y += s.vy * dt;
    if (s.y <= ground) {
      s.y = ground;
      s.vy = 0;
      s.airborne = false;
    }
  } else {
    s.airborne = false;
    s.vy = 0;
    s.y = ground;
  }

  // --- Suspension visuals: spring-damper towards the terrain attitude ---
  const fwdSlope = slope;
  const latSlope = (env.groundHeight(s.x + rx * probe, s.z + rz * probe) - env.groundHeight(s.x - rx * probe, s.z - rz * probe)) / (2 * probe);
  const targetPitch = Math.atan(fwdSlope) * -1 + (s.airborne ? 0.04 : 0);
  const targetRoll = Math.atan(latSlope) * -1 + (-s.steerAngle * speedFrac * 0.05) + (latNew * 0.01 * -1);
  const k = 60;
  const c = 9;
  s.pitchVel += (k * (targetPitch - s.pitch) - c * s.pitchVel) * dt;
  s.pitch += s.pitchVel * dt;
  s.rollVel += (k * (targetRoll - s.roll) - c * s.rollVel) * dt;
  s.roll += s.rollVel * dt;

  return s;
}
