/**
 * Time of day: sun position, sky and fog colour, lighting intensities.
 * The hour is either real local time or a fixed hour set by the player.
 */
import * as THREE from 'three';

export type TimeMode = 'auto' | 'fixed';

/** Sky colour keyframes over the day (hour, colour). */
const SKY_KEYS: [number, number][] = [
  [0, 0x05070f],
  [4.5, 0x111b35],
  [5.6, 0xe9885e],
  [7, 0x7fb6e8],
  [12, 0x8ccaf5],
  [17, 0x8bc3ef],
  [18.4, 0xf2894d],
  [19.6, 0x2a2e4e],
  [21, 0x070a18],
  [24, 0x05070f],
];
const SUN_WARM = new THREE.Color(0xffb878);
const SUN_DAY = new THREE.Color(0xfff4e0);
const GREY = new THREE.Color(0x9aa3ad);

export class TimeOfDay {
  mode: TimeMode = 'auto';
  fixedHour = 10;
  /** Current hour in [0, 24). */
  hour = 10;

  update(nowHourLocal: number) {
    this.hour = this.mode === 'auto' ? nowHourLocal : this.fixedHour;
  }

  /** Sun elevation in [-1, 1] (sin of altitude). */
  get sunElevation(): number {
    const a = ((this.hour - 6) / 12) * Math.PI;
    return Math.sin(a);
  }

  /** Unit vector pointing from the scene towards the sun. */
  sunDirection(out = new THREE.Vector3()): THREE.Vector3 {
    const a = ((this.hour - 6) / 12) * Math.PI;
    return out.set(Math.cos(a) * 0.7, Math.sin(a), 0.35).normalize();
  }

  /** Night factor 0 (day) .. 1 (deep night), smooth around dusk and dawn. */
  get nightFactor(): number {
    return THREE.MathUtils.smoothstep(-this.sunElevation, -0.05, 0.25);
  }

  skyColour(out = new THREE.Color()): THREE.Color {
    const h = this.hour;
    for (let i = 0; i < SKY_KEYS.length - 1; i++) {
      const [h0, c0] = SKY_KEYS[i];
      const [h1, c1] = SKY_KEYS[i + 1];
      if (h >= h0 && h <= h1) {
        const t = (h - h0) / (h1 - h0 || 1);
        return out.setHex(c0).lerp(new THREE.Color(c1), t);
      }
    }
    return out.setHex(0x05070f);
  }

  /** Warm near the horizon at dawn/dusk, white-ish at midday. */
  sunColour(out = new THREE.Color()): THREE.Color {
    const warm = 1 - THREE.MathUtils.smoothstep(this.sunElevation, 0.05, 0.45);
    return out.copy(SUN_DAY).lerp(SUN_WARM, warm);
  }

  /** Formatted local time, e.g. "07:45". */
  formatted(): string {
    const hh = Math.floor(this.hour) % 24;
    const mm = Math.floor((this.hour - Math.floor(this.hour)) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
}

/** Blend a sky colour towards a grey for cloudy or foggy weather. */
export function greyed(c: THREE.Color, amount: number, out = new THREE.Color()): THREE.Color {
  return out.copy(c).lerp(GREY, amount);
}
