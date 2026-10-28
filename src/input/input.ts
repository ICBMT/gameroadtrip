/** Keyboard and gamepad input, collected into a single snapshot each frame. */

export interface InputSnapshot {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
}

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  /** Edge-triggered actions (consumed by takePressed). */
  onAction?: (action: string) => void;

  constructor(win: Window) {
    win.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      const action = ACTION_KEYS[e.code];
      if (action) this.onAction?.(action);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    win.addEventListener('keyup', (e) => this.keys.delete(e.code));
    win.addEventListener('blur', () => this.keys.clear());
  }

  /** Current input, combining keyboard and first connected gamepad. */
  snapshot(): InputSnapshot {
    const k = this.keys;
    let throttle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    let brake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    let steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let handbrake = k.has('Space');

    const pad = this.gamepad();
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const stick = Math.abs(ax) > 0.12 ? (Math.sign(ax) * (Math.abs(ax) - 0.12)) / 0.88 : 0;
      if (steer === 0) steer = stick;
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      throttle = Math.max(throttle, rt);
      brake = Math.max(brake, lt);
      if (pad.buttons[0]?.pressed) handbrake = true;
    }
    steer = Math.max(-1, Math.min(1, steer));
    return { throttle, brake, steer, handbrake };
  }

  /** Whether an edge-triggered key was pressed since the last call. */
  wasPressed(code: string): boolean {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  private padPressedPrev = new Map<number, boolean>();

  /** Gamepad button edge detection for menu/actions; call once per frame. */
  pollGamepadEdges() {
    const pad = this.gamepad();
    if (!pad) return;
    // Start = pause, Y = camera, X = reset, B = time of day
    const map: Record<number, string> = { 9: 'pause', 3: 'camera', 2: 'reset', 1: 'time' };
    for (const [btn, action] of Object.entries(map)) {
      const i = Number(btn);
      const now = !!pad.buttons[i]?.pressed;
      const prev = this.padPressedPrev.get(i) ?? false;
      if (now && !prev) this.onAction?.(action);
      this.padPressedPrev.set(i, now);
    }
  }

  private gamepad(): Gamepad | null {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const g of list) if (g && g.connected) return g;
    return null;
  }
}

export const ACTION_KEYS: Record<string, string> = {
  KeyR: 'reset',
  KeyC: 'camera',
  KeyT: 'time',
  KeyV: 'weather',
  KeyH: 'hud',
  Escape: 'pause',
  KeyP: 'pause',
};
