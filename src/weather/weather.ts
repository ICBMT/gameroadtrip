/**
 * Weather state machine and rain rendering.
 * Weather changes atmosphere (fog, colour desaturation, rain) and optionally grip.
 */
import * as THREE from 'three';
import { Rng } from '../utils/random';

export type WeatherType = 'clear' | 'cloudy' | 'rain' | 'fog';
export const WEATHER_LABEL: Record<WeatherType, string> = {
  clear: 'Clear',
  cloudy: 'Cloudy',
  rain: 'Rain',
  fog: 'Fog',
};

/** Target atmosphere values per weather type. */
const PROFILE: Record<WeatherType, { fogMul: number; grey: number; rain: number; grip: number }> = {
  clear: { fogMul: 1, grey: 0, rain: 0, grip: 1 },
  cloudy: { fogMul: 0.85, grey: 0.45, rain: 0, grip: 1 },
  rain: { fogMul: 0.6, grey: 0.6, rain: 1, grip: 0.82 },
  fog: { fogMul: 0.22, grey: 0.7, rain: 0, grip: 0.95 },
};

export interface Atmosphere {
  fogMul: number;
  grey: number;
  rain: number;
  grip: number;
}

export class Weather {
  current: WeatherType = 'clear';
  private blend: Atmosphere = { ...PROFILE.clear };
  private timer = 0;
  private rng: Rng;
  /** 'auto' cycles through weather; otherwise pinned. */
  mode: WeatherType | 'auto' = 'auto';

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x5eed);
    this.timer = this.rng.range(120, 240);
  }

  get atmosphere(): Atmosphere {
    return this.blend;
  }

  /** Advance state and blend atmosphere towards the target profile. */
  update(dt: number) {
    if (this.mode === 'auto') {
      this.timer -= dt;
      if (this.timer <= 0) {
        const roll = this.rng.next();
        this.current = roll < 0.45 ? 'clear' : roll < 0.7 ? 'cloudy' : roll < 0.9 ? 'rain' : 'fog';
        this.timer = this.rng.range(150, 360);
      }
    } else {
      this.current = this.mode;
    }
    const target = PROFILE[this.current];
    const k = 1 - Math.exp(-dt * 0.4);
    this.blend.fogMul += (target.fogMul - this.blend.fogMul) * k;
    this.blend.grey += (target.grey - this.blend.grey) * k;
    this.blend.rain += (target.rain - this.blend.rain) * k;
    this.blend.grip += (target.grip - this.blend.grip) * k;
  }

  cycleMode(): WeatherType | 'auto' {
    const order: (WeatherType | 'auto')[] = ['auto', 'clear', 'cloudy', 'rain', 'fog'];
    this.mode = order[(order.indexOf(this.mode) + 1) % order.length];
    return this.mode;
  }
}

/** Rain streaks around the car, in render coordinates (player at origin). */
export class Rain {
  readonly object: THREE.LineSegments;
  private positions: Float32Array;
  private count: number;
  private rng = new Rng(4242);
  private readonly SPAN = 40;
  private readonly HEIGHT = 30;

  constructor(count = 1400) {
    this.count = count;
    this.positions = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) this.respawn(i, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xbfd6e8, transparent: true, opacity: 0, depthWrite: false });
    this.object = new THREE.LineSegments(geo, mat);
    this.object.frustumCulled = false;
  }

  private respawn(i: number, initial: boolean) {
    const x = (this.rng.next() - 0.5) * 2 * this.SPAN;
    const z = (this.rng.next() - 0.5) * 2 * this.SPAN;
    // Local y: streaks start at the top of the volume and fall through it.
    const y = initial ? this.rng.next() * this.HEIGHT - 8 : this.HEIGHT - 8;
    const o = i * 6;
    this.positions[o] = x;
    this.positions[o + 1] = y;
    this.positions[o + 2] = z;
    this.positions[o + 3] = x;
    this.positions[o + 4] = y + 0.9;
    this.positions[o + 5] = z;
  }

  /**
   * Move the streaks. Positions are local to the object, which sits at the car
   * so rain always surrounds the player (floating-origin friendly).
   * @param carY car height above sea level
   * @param intensity 0..1 rain amount
   */
  update(dt: number, carY: number, intensity: number) {
    const mat = this.object.material as THREE.LineBasicMaterial;
    mat.opacity = Math.min(0.55, intensity * 0.55);
    this.object.visible = intensity > 0.02;
    this.object.position.set(0, carY, 0);
    if (!this.object.visible) return;
    const fall = 22 * dt;
    for (let i = 0; i < this.count; i++) {
      const o = i * 6;
      this.positions[o + 1] -= fall;
      this.positions[o + 4] -= fall;
      if (this.positions[o + 1] < -2) this.respawn(i, false);
    }
    (this.object.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
