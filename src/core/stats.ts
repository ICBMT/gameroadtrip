/**
 * Exploration tracking: distance, cities, biomes, and optional achievements.
 * Persisted to localStorage so progress survives reloads.
 */
import type { BiomeName } from '../biomes/biomes';

export interface StatsData {
  distanceM: number;
  cities: number[];
  biomes: BiomeName[];
  nightSeconds: number;
  unlocked: string[];
}

export interface Achievement {
  id: string;
  label: string;
  test: (s: StatsData) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-city', label: 'First City', test: (s) => s.cities.length >= 1 },
  { id: 'hundred-km', label: '100 km', test: (s) => s.distanceM >= 100_000 },
  { id: 'mountain-explorer', label: 'Mountain Explorer', test: (s) => s.biomes.includes('Mountain') },
  { id: 'coastal-drive', label: 'Coastal Drive', test: (s) => s.biomes.includes('Coast') },
  { id: 'night-driver', label: 'Night Driver', test: (s) => s.nightSeconds >= 300 },
  { id: 'long-haul', label: 'Long Haul', test: (s) => s.distanceM >= 500_000 },
];

const KEY = 'openroad.stats.v1';

const EMPTY: StatsData = { distanceM: 0, cities: [], biomes: [], nightSeconds: 0, unlocked: [] };

export class Stats {
  data: StatsData;
  /** Achievements unlocked during this check (for toasts). */
  private newlyUnlocked: string[] = [];

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      this.data = raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY };
    } catch {
      this.data = { ...EMPTY };
    }
  }

  addDistance(m: number) {
    this.data.distanceM += m;
  }

  addNight(seconds: number) {
    this.data.nightSeconds += seconds;
  }

  visitCity(id: number) {
    if (!this.data.cities.includes(id)) this.data.cities.push(id);
  }

  discoverBiome(b: BiomeName) {
    if (!this.data.biomes.includes(b)) this.data.biomes.push(b);
  }

  /** Returns achievements unlocked since the last call. */
  checkAchievements(): string[] {
    for (const a of ACHIEVEMENTS) {
      if (!this.data.unlocked.includes(a.id) && a.test(this.data)) {
        this.data.unlocked.push(a.id);
        this.newlyUnlocked.push(a.label);
      }
    }
    const out = this.newlyUnlocked;
    this.newlyUnlocked = [];
    return out;
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }

  summary(): string {
    const km = (this.data.distanceM / 1000).toFixed(1);
    return `Distance: ${km} km · Cities: ${this.data.cities.length} · Biomes: ${this.data.biomes.length} · Achievements: ${this.data.unlocked.length}/${ACHIEVEMENTS.length}`;
  }
}
