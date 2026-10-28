import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roadsInRect, getSegment, nodeXZ, findSpawn, nearestRoad } from '../src/roads/roadGraph';
import { WORLD } from '../src/world/config';

const SEED = 12345;

test('road segments are deterministic', () => {
  const a = roadsInRect(SEED, -500, -500, 500, 500).map((s) => [s.id, s.pts[0], s.pts[1], s.length]);
  const b = roadsInRect(SEED, -500, -500, 500, 500).map((s) => [s.id, s.pts[0], s.pts[1], s.length]);
  assert.deepEqual(a, b);
  assert.ok(a.length > 0);
});

test('segments that share a node meet exactly (no gaps, same elevation)', () => {
  let checked = 0;
  for (let i = -3; i <= 3; i++) {
    for (let j = -3; j <= 3; j++) {
      const east = getSegment(SEED, i, j, 0);
      const south = getSegment(SEED, i, j, 1);
      if (!east || !south) continue;
      // East and south of the same node share its start point.
      assert.equal(east.pts[0], south.pts[0]);
      assert.equal(east.pts[1], south.pts[1]);
      assert.ok(Math.abs(east.elev[0] - south.elev[0]) < 1e-9);
      checked++;
    }
  }
  assert.ok(checked > 0);
  // Edge endpoints meet the neighbouring node exactly.
  const e = getSegment(SEED, 0, 0, 0)!;
  const [nx, nz] = nodeXZ(SEED, 1, 0);
  const last = e.pts.length - 2;
  assert.equal(e.pts[last], nx);
  assert.equal(e.pts[last + 1], nz);
  const next = getSegment(SEED, 1, 0, 0);
  if (next) assert.ok(Math.abs(next.elev[0] - e.elev[e.elev.length - 1]) < 1e-9);
});

test('road sample spacing is bounded', () => {
  for (const s of roadsInRect(SEED, -2000, -2000, 2000, 2000)) {
    for (let k = 1; k < s.cum.length; k++) {
      const step = s.cum[k] - s.cum[k - 1];
      assert.ok(step <= WORLD.ROAD_STEP * 1.01 + 1e-6, `step ${step}`);
    }
  }
});

test('spawn point sits on a highway and nearestRoad finds it', () => {
  const sp = findSpawn(SEED);
  const segs = roadsInRect(SEED, sp.x - 50, sp.z - 50, sp.x + 50, sp.z + 50);
  const hit = nearestRoad(segs, sp.x, sp.z, 20);
  assert.ok(hit, 'spawn should be on a road');
  assert.equal(hit!.cls, 'highway');
  assert.ok(hit!.dist < 0.01);
});

test('road classes vary across the world', () => {
  const counts: Record<string, number> = {};
  for (const s of roadsInRect(SEED, -6000, -6000, 6000, 6000)) counts[s.cls] = (counts[s.cls] ?? 0) + 1;
  assert.ok(counts.highway > 0 && counts.rural > 0, JSON.stringify(counts));
});
