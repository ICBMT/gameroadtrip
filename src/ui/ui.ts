/** DOM-based menus and HUD. Pure presentation: game logic lives elsewhere. */

export interface HudData {
  speedKph: number;
  distanceKm: number;
  biome: string;
  time: string;
  weather: string;
}

export type MenuAction = 'play' | 'resume' | 'quit';

export class Ui {
  private el = {
    hud: document.getElementById('hud') as HTMLElement,
    hudSpeed: document.getElementById('hud-speed') as HTMLElement,
    hudDistance: document.getElementById('hud-distance') as HTMLElement,
    hudBiome: document.getElementById('hud-biome') as HTMLElement,
    hudTime: document.getElementById('hud-time') as HTMLElement,
    hudWeather: document.getElementById('hud-weather') as HTMLElement,
    toast: document.getElementById('hud-toast') as HTMLElement,
    menu: document.getElementById('menu') as HTMLElement,
    main: document.getElementById('menu-main') as HTMLElement,
    settings: document.getElementById('menu-settings') as HTMLElement,
    controls: document.getElementById('menu-controls') as HTMLElement,
    about: document.getElementById('menu-about') as HTMLElement,
    pause: document.getElementById('menu-pause') as HTMLElement,
    stats: document.getElementById('stats') as HTMLElement,
  };
  private toastTimer = 0;
  onMenu?: (a: MenuAction) => void;
  onSettingsOpen?: () => void;

  constructor() {
    this.wireButtons();
  }

  private wireButtons() {
    document.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = btn.dataset.action!;
        if (a === 'play') this.onMenu?.('play');
        else if (a === 'resume') this.onMenu?.('resume');
        else if (a === 'quit') this.onMenu?.('quit');
        else if (a === 'settings') {
          this.onSettingsOpen?.();
          this.show('settings');
        } else if (a === 'controls') this.show('controls');
        else if (a === 'about') this.show('about');
        else if (a === 'back') this.show(this.lastMenu());
      });
    });
  }

  private menuStack: string[] = ['main'];
  private lastMenu(): string {
    this.menuStack.pop();
    return this.menuStack.pop() ?? 'main';
  }

  /** Show one panel: 'main' | 'settings' | 'controls' | 'about' | 'pause'. */
  show(panel: string) {
    this.menuStack.push(panel);
    const map: Record<string, HTMLElement> = {
      main: this.el.main,
      settings: this.el.settings,
      controls: this.el.controls,
      about: this.el.about,
      pause: this.el.pause,
    };
    for (const el of Object.values(map)) el.classList.add('hidden');
    map[panel].classList.remove('hidden');
    this.el.menu.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
  }

  /** Show the pause menu with stats. */
  showPause(stats: string) {
    this.el.stats.textContent = stats;
    this.menuStack = ['pause'];
    this.show('pause');
  }

  /** Hide all menus and show the HUD. */
  playing() {
    this.el.menu.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    this.menuStack = ['main'];
  }

  setHudVisible(v: boolean) {
    document.querySelectorAll<HTMLElement>('.hud-row, .hud-speed, .hint').forEach((e) => {
      e.style.display = v ? '' : 'none';
    });
  }

  updateHud(d: HudData) {
    this.el.hudSpeed.textContent = String(Math.round(d.speedKph));
    this.el.hudDistance.textContent = `${d.distanceKm.toFixed(1)} km`;
    this.el.hudBiome.textContent = d.biome;
    this.el.hudTime.textContent = d.time;
    this.el.hudWeather.textContent = d.weather;
  }

  toast(text: string, ms = 2600) {
    this.el.toast.textContent = text;
    this.el.toast.classList.remove('hidden');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.el.toast.classList.add('hidden'), ms);
  }
}
