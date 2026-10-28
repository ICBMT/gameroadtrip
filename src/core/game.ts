/**
 * Game orchestration: owns the renderer, world streaming, car, camera, audio,
 * weather, time, input, UI and exploration stats, and runs the main loop.
 */
import * as THREE from 'three';
import { WORLD, DEFAULT_SEED } from '../world/config';
import { ChunkStreamer } from '../world/chunkStreamer';
import { GroundQuery } from '../world/ground';
import { createSharedAssets, type SharedAssets } from '../rendering/chunkMeshes';
import { TimeOfDay, greyed } from '../rendering/sky';
import { Weather, Rain, type WeatherType } from '../weather/weather';
import { createCar, stepCar, forwardSpeed, speedMs, CAR, type CarState } from '../vehicles/carPhysics';
import { createCarVisual, type CarVisual } from '../vehicles/carMesh';
import { ChaseCamera } from '../camera/chaseCamera';
import { Input } from '../input/input';
import { AudioEngine } from '../audio/audioEngine';
import { Ui } from '../ui/ui';
import { Stats } from './stats';
import { loadSettings, saveSettings, type Settings } from './settings';
import { findSpawn, nearestRoad, roadsInRect } from '../roads/roadGraph';
import { biomeAt, BIOME_LABEL, type BiomeName } from '../biomes/biomes';
import { urbanAt } from '../biomes/urban';
import { baseHeight } from '../terrain/heightfield';
import { ROAD_LIFT } from '../world/chunkGenerator';

type State = 'menu' | 'playing' | 'paused';
const PHYSICS_DT = 1 / 120;
const S = WORLD.CHUNK_SIZE;

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: ChaseCamera;
  private assets: SharedAssets;
  private streamer: ChunkStreamer;
  private ground: GroundQuery;
  private car: CarState;
  private carVisual: CarVisual;
  private input: Input;
  private audio = new AudioEngine();
  private ui = new Ui();
  private stats = new Stats();
  private time = new TimeOfDay();
  private weather: Weather;
  private rain = new Rain();
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private settings: Settings;
  private state: State = 'menu';
  private accumulator = 0;
  private lastFrame = 0;
  private hudTimer = 0;
  private exploreTimer = 0;
  private statsSaveTimer = 0;
  private lastBiome: BiomeName | null = null;
  private lastPos = { x: 0, z: 0 };
  private hudOn = true;
  private actions: string[] = [];
  private fog = new THREE.Fog(0x8ccaf5, 200, 800);

  constructor(canvas: HTMLCanvasElement, private seed: number = DEFAULT_SEED) {
    this.settings = loadSettings();
    this.weather = new Weather(seed);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);

    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(0x8ccaf5);
    this.hemi = new THREE.HemisphereLight(0xdfeeff, 0x3a3328, 0.8);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.scene.add(this.rain.object);

    this.camera = new ChaseCamera(window.innerWidth / window.innerHeight);
    this.assets = createSharedAssets();
    const workers = Math.max(1, Math.min(3, (navigator.hardwareConcurrency ?? 4) - 1));
    this.streamer = new ChunkStreamer(this.scene, seed, this.assets, workers);
    this.streamer.setRadius(this.settings.viewChunks);
    this.streamer.setVegetationDistance(2);
    this.ground = new GroundQuery(seed);

    // Water plane at sea level (visible wherever the terrain dips below it).
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(8000, 8000),
      new THREE.MeshLambertMaterial({ color: 0x1d5a6e, transparent: true, opacity: 0.9 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = WORLD.SEA_LEVEL;
    this.scene.add(water);

    const spawn = findSpawn(seed);
    this.car = createCar(spawn.x, spawn.z, spawn.heading, this.ground.height(spawn.x, spawn.z));
    this.lastPos = { x: this.car.x, z: this.car.z };
    this.carVisual = createCarVisual();
    this.scene.add(this.carVisual.group);

    this.input = new Input(window);
    this.input.onAction = (a) => this.actions.push(a);
    this.bindSettings();
    this.bindUi();
    window.addEventListener('resize', () => this.resize());
    this.time.mode = this.settings.timeMode;
    this.time.fixedHour = this.settings.fixedHour;
    this.weather.mode = this.settings.weather;
    this.setHudVisible(this.settings.showHud);
  }

  // ---------- setup ----------

  private bindSettings() {
    const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
    const timeSel = $<HTMLSelectElement>('set-time');
    const slider = $<HTMLInputElement>('set-time-slider');
    const weatherSel = $<HTMLSelectElement>('set-weather');
    const viewSel = $<HTMLSelectElement>('set-view');
    const vol = $<HTMLInputElement>('set-volume');
    const hud = $<HTMLInputElement>('set-hud');

    const sync = () => {
      timeSel.value = this.settings.timeMode;
      slider.value = String(this.settings.fixedHour);
      weatherSel.value = this.settings.weather;
      viewSel.value = String(this.settings.viewChunks);
      vol.value = String(this.settings.volume);
      hud.checked = this.settings.showHud;
    };
    sync();
    this.syncSettingsUi = sync;

    const commit = () => {
      saveSettings(this.settings);
      this.time.mode = this.settings.timeMode;
      this.time.fixedHour = this.settings.fixedHour;
      this.weather.mode = this.settings.weather;
      this.streamer.setRadius(this.settings.viewChunks);
      this.setHudVisible(this.settings.showHud);
    };
    timeSel.addEventListener('change', () => {
      this.settings.timeMode = timeSel.value as Settings['timeMode'];
      commit();
    });
    slider.addEventListener('input', () => {
      this.settings.fixedHour = Number(slider.value);
      this.settings.timeMode = 'fixed';
      sync();
      commit();
    });
    weatherSel.addEventListener('change', () => {
      this.settings.weather = weatherSel.value as Settings['weather'];
      commit();
    });
    viewSel.addEventListener('change', () => {
      this.settings.viewChunks = Number(viewSel.value);
      commit();
    });
    vol.addEventListener('input', () => {
      this.settings.volume = Number(vol.value);
      commit();
    });
    hud.addEventListener('change', () => {
      this.settings.showHud = hud.checked;
      commit();
    });
  }

  private syncSettingsUi: () => void = () => {};

  private bindUi() {
    this.ui.onMenu = (a) => {
      if (a === 'play') this.beginDrive();
      else if (a === 'resume') this.resume();
      else if (a === 'quit') this.quitToMenu();
    };
    this.ui.onSettingsOpen = () => this.syncSettingsUi();
    this.ui.show('main');
  }

  boot() {
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.setAspect(w / h);
  }

  private setHudVisible(v: boolean) {
    this.hudOn = v;
    this.ui.setHudVisible(v);
  }

  // ---------- state ----------

  private beginDrive() {
    this.audio.start();
    this.state = 'playing';
    this.ui.playing();
    this.ui.toast('Drive anywhere. The road never ends.');
  }

  private pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.stats.save();
    this.ui.showPause(this.stats.summary() + `\nSeed: ${this.seed}`);
  }

  private resume() {
    this.state = 'playing';
    this.ui.playing();
  }

  private quitToMenu() {
    this.stats.save();
    this.state = 'menu';
    this.ui.show('main');
  }

  private handleActions() {
    this.input.pollGamepadEdges();
    while (this.actions.length) {
      const a = this.actions.shift()!;
      switch (a) {
        case 'pause':
          if (this.state === 'playing') this.pause();
          else if (this.state === 'paused') this.resume();
          break;
        case 'reset':
          if (this.state === 'playing') this.resetToRoad('Back on the road');
          break;
        case 'camera':
          if (this.state === 'playing') this.ui.toast(`Camera: ${this.camera.cycleMode()}`);
          break;
        case 'time': {
          this.settings.timeMode = this.time.mode === 'auto' ? 'fixed' : 'auto';
          this.settings.fixedHour = this.time.hour;
          this.syncSettingsUi();
          saveSettings(this.settings);
          this.time.mode = this.settings.timeMode;
          this.time.fixedHour = this.settings.fixedHour;
          this.ui.toast(this.time.mode === 'auto' ? 'Time: real time' : `Time: fixed at ${this.time.formatted()}`);
          break;
        }
        case 'weather': {
          const m = this.weather.cycleMode();
          this.settings.weather = m;
          this.syncSettingsUi();
          saveSettings(this.settings);
          this.ui.toast(m === 'auto' ? 'Weather: changing' : `Weather: ${m}`);
          break;
        }
        case 'hud':
          this.settings.showHud = !this.settings.showHud;
          this.setHudVisible(this.settings.showHud);
          saveSettings(this.settings);
          break;
      }
    }
  }

  /** Put the car back on the nearest road, facing along it. */
  private resetToRoad(message: string) {
    const r = 200;
    const segs = roadsInRect(this.seed, this.car.x - r, this.car.z - r, this.car.x + r, this.car.z + r);
    const hit = nearestRoad(segs, this.car.x, this.car.z, r);
    if (hit) {
      const heading = Math.atan2(hit.dirX, hit.dirZ);
      this.car = createCar(hit.x, hit.z, heading, this.ground.height(hit.x, hit.z));
    } else {
      const sp = findSpawn(this.seed);
      this.car = createCar(sp.x, sp.z, sp.heading, this.ground.height(sp.x, sp.z));
    }
    this.lastPos = { x: this.car.x, z: this.car.z };
    this.ui.toast(message);
  }

  // ---------- frame ----------

  private frame(now: number) {
    const dt = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.handleActions();

    const input = this.input.snapshot();
    if (this.state === 'playing') {
      this.accumulator += dt;
      const env = {
        groundHeight: (x: number, z: number) => this.ground.height(x, z),
        gripMul: this.weather.atmosphere.grip,
        onRoad: this.ground.onRoad(this.car.x, this.car.z),
      };
      let steps = 0;
      while (this.accumulator >= PHYSICS_DT && steps < 12) {
        this.car = stepCar(this.car, input, PHYSICS_DT, env);
        this.accumulator -= PHYSICS_DT;
        steps++;
      }
      if (steps >= 12) this.accumulator = 0;
      // Drove into the sea: rescue back to the nearest road.
      if (this.car.y - CAR.CLEARANCE < WORLD.SEA_LEVEL - 1.5) this.resetToRoad('Kept to dry land');
      this.updateExploration(dt);
    } else {
      this.accumulator = 0;
    }

    // Time, weather, sky.
    const nowLocal = new Date();
    this.time.update(nowLocal.getHours() + nowLocal.getMinutes() / 60 + nowLocal.getSeconds() / 3600);
    this.weather.update(dt);
    this.updateAtmosphere();

    // Floating origin: the car is always at the render origin, world streams around it.
    this.streamer.update(this.car.x, this.car.z, Math.sin(this.car.heading), Math.cos(this.car.heading), 3);

    // Car visual and camera
    const v = this.carVisual;
    // Physics keeps the chassis CLEARANCE above the surface; the wheels touch the road
    // surface, which sits 0.12 m above the terrain height (see roadGraph/chunkMeshes).
    v.group.position.set(0, this.car.y - CAR.CLEARANCE + ROAD_LIFT, 0);
    v.group.rotation.order = 'YXZ';
    v.group.rotation.set(this.car.pitch, this.car.heading, this.car.roll);
    const spin = forwardSpeed(this.car) * dt / 0.36;
    for (let i = 0; i < v.wheels.length; i++) {
      v.wheels[i].rotation.x -= spin;
      if (i < 2) v.wheels[i].rotation.y = this.car.steerAngle * 0.9;
    }
    v.group.visible = this.camera.showCar();
    const spd = speedMs(this.car);
    this.camera.update(
      { pos: new THREE.Vector3(0, this.car.y, 0), heading: this.car.heading, speed: spd, steer: input.steer },
      dt,
      (rx, rz) => this.ground.height(this.car.x + rx, this.car.z + rz),
    );
    this.sun.position.copy(this.sunDir).multiplyScalar(700);
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();

    this.rain.update(dt, this.car.y, this.weather.atmosphere.rain);
    this.renderer.render(this.scene, this.camera.camera);

    // Audio
    if (this.audio.ready) {
      const biome = this.lastBiome;
      const urban = biome ? URBAN_BIOMES.has(biome) : false;
      this.audio.update(
        {
          speedMs: spd,
          throttle: input.throttle,
          slip: Math.abs(this.car.vx * Math.cos(this.car.heading) - this.car.vz * Math.sin(this.car.heading)),
          rain: this.weather.atmosphere.rain,
          urban: urban ? 0.8 : 0,
          rural: biome === 'Forest' || biome === 'Countryside' || biome === 'Village' ? 1 : 0,
          coast: biome === 'Coast' || biome === 'Ocean' ? 1 : 0,
          daylight: 1 - this.time.nightFactor,
          volume: this.settings.volume,
        },
        now / 1000,
      );
    }

    // HUD
    this.hudTimer -= dt;
    if (this.hudTimer <= 0 && this.hudOn) {
      this.hudTimer = 0.15;
      this.ui.updateHud({
        speedKph: spd * 3.6,
        distanceKm: this.stats.data.distanceM / 1000,
        biome: this.lastBiome ? BIOME_LABEL[this.lastBiome] : '—',
        time: this.time.formatted(),
        weather: `${weatherLabel(this.weather.current)}`,
      });
    }
    this.statsSaveTimer += dt;
    if (this.statsSaveTimer > 10) {
      this.statsSaveTimer = 0;
      this.stats.save();
    }
  }

  private sunDir = new THREE.Vector3();

  private updateAtmosphere() {
    const a = this.weather.atmosphere;
    const sky = this.time.skyColour();
    const colour = greyed(sky, Math.min(0.85, a.grey * 0.7 + (a.rain * 0.1)));
    (this.scene.background as THREE.Color).copy(colour);
    this.fog.color.copy(colour);
    const far = this.settings.viewChunks * S * 1.15 * a.fogMul + 80;
    this.fog.far = far;
    this.fog.near = far * 0.18;

    const night = this.time.nightFactor;
    this.time.sunDirection(this.sunDir);
    const elev = this.time.sunElevation;
    this.sun.intensity = Math.max(0, Math.min(1, elev * 3)) * 1.6 * (1 - a.grey * 0.5);
    this.sun.color.copy(this.time.sunColour());
    this.hemi.intensity = 0.2 + 0.7 * (1 - night) * (1 - a.grey * 0.3);
    this.hemi.color.setHex(night > 0.5 ? 0x5b6e95 : 0xdfeeff);
    this.carVisual.headlights.intensity = night * 260;
  }

  private updateExploration(dt: number) {
    const dx = this.car.x - this.lastPos.x;
    const dz = this.car.z - this.lastPos.z;
    this.lastPos = { x: this.car.x, z: this.car.z };
    const moved = Math.hypot(dx, dz);
    if (moved < 50) this.stats.addDistance(moved);
    if (this.time.nightFactor > 0.6 && speedMs(this.car) > 2) this.stats.addNight(dt);

    this.exploreTimer -= dt;
    if (this.exploreTimer <= 0) {
      this.exploreTimer = 0.5;
      const h = baseHeight(this.seed, this.car.x, this.car.z);
      const biome = biomeAt(this.seed, this.car.x, this.car.z, h);
      if (biome !== this.lastBiome) {
        if (this.lastBiome !== null) this.ui.toast(`Entering ${BIOME_LABEL[biome]}`, 2000);
        this.lastBiome = biome;
      }
      if (!this.stats.data.biomes.includes(biome)) {
        this.stats.discoverBiome(biome);
      }
      const u = urbanAt(this.seed, this.car.x, this.car.z);
      if (u.city && u.density > 0.35 && !this.stats.data.cities.includes(u.city.id)) {
        this.stats.visitCity(u.city.id);
        this.ui.toast(`Arrived in a new city — ${this.stats.data.cities.length} visited`);
      }
      for (const label of this.stats.checkAchievements()) this.ui.toast(`Achievement: ${label}`, 3500);
    }
  }

  /** Exposed for debugging and tests (read-only snapshot). */
  debugState() {
    return {
      seed: this.seed,
      state: this.state,
      car: { x: this.car.x, y: this.car.y, z: this.car.z, heading: this.car.heading, speed: speedMs(this.car) },
      chunks: this.streamer.loadedCount,
      pending: this.streamer.pendingCount,
      weather: this.weather.current as WeatherType,
      biome: this.lastBiome,
    };
  }
}

const URBAN_BIOMES = new Set<BiomeName>(['Town', 'Suburban', 'City', 'Downtown']);

function weatherLabel(w: WeatherType): string {
  return { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', fog: 'Fog' }[w];
}
