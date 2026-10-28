import type { TimeMode } from '../rendering/sky';
import type { WeatherType } from '../weather/weather';

export interface Settings {
  timeMode: TimeMode;
  fixedHour: number;
  weather: WeatherType | 'auto';
  viewChunks: number; // streaming radius in chunks
  volume: number;
  showHud: boolean;
}

const KEY = 'openroad.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  timeMode: 'auto',
  fixedHour: 10,
  weather: 'auto',
  viewChunks: 3,
  volume: 0.6,
  showHud: true,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings simply won't persist */
  }
}
