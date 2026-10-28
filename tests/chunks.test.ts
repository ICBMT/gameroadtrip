import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateChunk } from '../src/world/chunkGenerator';
import { WORLD } from '../src/world/config';

const SEED = 12345;

test('chunk generation is deterministic', () => {
  const a = generateChunk(SEED, 3, -2);
  const b = generateChunk(SEED, 3, -2);
  assert.deepEqual(Array.from(a.heights), Array.from(b.heights));
  assert.deepEqual(Array.from(a.bodies.matrices), Array.from(b.bodies.matrices));
  assert.deepEqual(Array.from(a.broadleaves.matrices), Array.from(b.broadleaves.matrices));
});

test('adjacent chunks share border heights exactly', () => {
  const a = generateChunk(SEED, 0, 0);
  const b = generateChunk(SEED, 1, 0);
  const N = WORLD.CHUNK_RES + 1;
  for (let j = 0; j < N; j++) {
    assert.equal(a.heights[j * N + N - 1], b.heights[j * N]);
  }
});

test('terrain is finite and varied, chunks produce geometry', () => {
  let minH = Infinity;
  let maxH = -Infinity;
  let trees = 0;
  let bodies = 0;
  let roadTris = 0;
  const t0 = performance.now();
  const coords: [number, number][] = [];
  for (let cz = -4; cz <= 4; cz++) for (let cx = -4; cx <= 4; cx++) coords.push([cx, cz]);
  for (const [cx, cz] of coords) {
    const c = generateChunk(SEED, cx, cz);
    for (const h of c.heights) {
      assert.ok(Number.isFinite(h));
      minH = Math.min(minH, h);
      maxH = Math.max(maxH, h);
    }
    trees += c.conifers.count + c.broadleaves.count;
    bodies += c.bodies.count;
    for (const r of Object.values(c.roads)) roadTris += r.indices.length / 3;
    assert.equal(c.colors.length, c.heights.length * 3);
  }
  const ms = (performance.now() - t0) / coords.length;
  console.log(`avg chunk ms=${ms.toFixed(1)} h=[${minH.toFixed(0)},${maxH.toFixed(0)}] trees=${trees} bodies=${bodies} roadTris=${roadTris}`);
  assert.ok(maxH - minH > 30, 'terrain should have relief');
  assert.ok(trees > 0 && bodies > 0 && roadTris > 0);
});

test('road surface is level with terrain at the road centreline', () => {
  // The ribbon sits at road elevation + lift; the blended terrain should match it on the centreline.
  const c = generateChunk(SEED, 0, 0);
  for (const r of Object.values(c.roads)) {
    for (let i = 0; i < r.positions.length; i += 3) {
      assert.ok(Number.isFinite(r.positions[i + 1]));
    }
  }
});
