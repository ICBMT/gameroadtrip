import { Game } from './core/game';
import { DEFAULT_SEED } from './world/config';

/** Accepts ?seed=<number or text>. Text seeds are hashed to a number. */
function seedFromUrl(): number {
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (!raw) return DEFAULT_SEED;
  const n = Number(raw);
  if (Number.isInteger(n)) return n >>> 0;
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) h = Math.imul(h ^ raw.charCodeAt(i), 16777619);
  return h >>> 0;
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas, seedFromUrl());
game.boot();
(window as unknown as { openRoad: unknown }).openRoad = game;
