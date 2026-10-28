import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCar, stepCar, forwardSpeed, speedMs, CAR, type CarEnv, type CarInput } from '../src/vehicles/carPhysics';

const flat: CarEnv = { groundHeight: () => 0, gripMul: 1, onRoad: true };
const noInput: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const dt = 1 / 120;

function run(s: ReturnType<typeof createCar>, input: CarInput, env: CarEnv, seconds: number) {
  let st = s;
  for (let i = 0; i < seconds / dt; i++) st = stepCar(st, input, dt, env);
  return st;
}

test('accelerates and reaches a capped top speed', () => {
  let s = createCar(0, 0, 0, 0);
  s = run(s, { ...noInput, throttle: 1 }, flat, 40);
  const v = forwardSpeed(s);
  assert.ok(v > CAR.MAX_SPEED * 0.9 && v <= CAR.MAX_SPEED * 1.05 + 1e-6, `v=${v}`);
  assert.ok(s.z > 500, 'moves forward along +z when heading 0');
});

test('brakes to a stop', () => {
  let s = createCar(0, 0, 0, 0);
  s = run(s, { ...noInput, throttle: 1 }, flat, 10);
  let t = 0;
  while (forwardSpeed(s) > 0.5 && t < 10) {
    s = stepCar(s, { ...noInput, brake: 1 }, dt, flat);
    t += dt;
  }
  assert.ok(t < 4, `braked to a stop in ${t}s`);
  s = run(s, noInput, flat, 3);
  assert.ok(Math.abs(forwardSpeed(s)) < 0.5);
});

test('reverses when braking from standstill', () => {
  const s = run(createCar(0, 0, 0, 0), { ...noInput, brake: 1 }, flat, 3);
  assert.ok(forwardSpeed(s) < -1 && forwardSpeed(s) >= -CAR.REVERSE_MAX - 1e-6);
});

test('steering right turns the nose right (heading increases)', () => {
  let s = createCar(0, 0, 0, 0);
  s = run(s, { ...noInput, throttle: 0.6 }, flat, 3);
  const h0 = s.heading;
  s = run(s, { ...noInput, throttle: 0.6, steer: 1 }, flat, 1.5);
  assert.ok(s.heading > h0 + 0.3, `heading ${h0} -> ${s.heading}`);
  assert.ok(s.x > 1, 'car moved to the right (+x) of its heading');
});

test('handbrake makes the car slide (lateral speed survives)', () => {
  let s = createCar(0, 0, 0, 0);
  s = run(s, { ...noInput, throttle: 1 }, flat, 4);
  s = run(s, { ...noInput, throttle: 1, steer: 1, handbrake: true }, flat, 0.6);
  const slide = Math.abs(s.vx * Math.cos(s.heading) - s.vz * Math.sin(s.heading));
  assert.ok(slide > 1, `lateral slip ${slide}`);
  // Normal steering at speed should only produce a small slip angle.
  let g = createCar(0, 0, 0, 0);
  g = run(g, { ...noInput, throttle: 1 }, flat, 4);
  g = run(g, { ...noInput, throttle: 1, steer: 0.3 }, flat, 1.5);
  const grip = Math.abs(g.vx * Math.cos(g.heading) - g.vz * Math.sin(g.heading));
  assert.ok(grip < slide / 2, `normal grip slip ${grip} vs handbrake ${slide}`);
});

test('gravity pulls the car downhill and it gains speed', () => {
  const ramp: CarEnv = { groundHeight: (_x: number, z: number) => -0.2 * z, gripMul: 1, onRoad: true };
  const s = run(createCar(0, 0, 0, 0), noInput, ramp, 4);
  assert.ok(speedMs(s) > 4, `downhill speed ${speedMs(s)}`);
});

test('car stays on the ground over gentle hills and goes airborne off a sharp drop', () => {
  const hills: CarEnv = { groundHeight: (_x: number, z: number) => 2 * Math.sin(z / 50), gripMul: 1, onRoad: true };
  let s = createCar(0, 0, 0, 2 * Math.sin(0));
  s = run(s, { ...noInput, throttle: 0.5 }, hills, 5);
  assert.ok(Math.abs(s.y - (hills.groundHeight(s.x, s.z) + CAR.CLEARANCE)) < 0.5);

  const drop: CarEnv = { groundHeight: (_x: number, z: number) => (z > 40 ? -10 : 0), gripMul: 1, onRoad: true };
  let t = createCar(0, 0, 0, 0);
  let sawAir = false;
  for (let i = 0; i < 4 / dt; i++) {
    t = stepCar(t, { ...noInput, throttle: 1 }, dt, drop);
    if (t.airborne) sawAir = true;
  }
  assert.ok(sawAir, 'should become airborne over the drop');
  assert.ok(t.y < 0, 'should eventually fall to the lower ground');
});

test('reset-free loop: heading and position stay finite over a long drive', () => {
  let s = createCar(0, 0, 0, 0);
  for (let i = 0; i < 120 * 600; i++) {
    const steer = Math.sin(i / 300);
    s = stepCar(s, { throttle: 1, brake: 0, steer, handbrake: false }, dt, flat);
  }
  assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z) && Number.isFinite(s.heading));
});
