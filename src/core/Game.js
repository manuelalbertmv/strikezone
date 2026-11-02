// Núcleo del juego: renderizador, bucle principal, estados (menú, partida,
// pausa, fin), conexión entre sistemas, daño, explosiones y puntuación.
import * as THREE from 'three';
import { DIFFICULTY, QUALITY } from '../config.js';
import { Settings } from './Settings.js';
import { Input } from './Input.js';
import { AudioEngine } from './Audio.js';
import { WaveDirector } from './WaveDirector.js';
import { CollisionWorld } from '../physics/Collision.js';
import { Level } from '../world/Level.js';
import { Pickups } from '../world/Pickups.js';
import { Effects } from '../fx/Effects.js';
import { Player } from '../player/Player.js';
import { WeaponSystem } from '../weapons/WeaponSystem.js';
import { EnemyManager } from '../enemies/EnemyManager.js';
import { Enemy } from '../enemies/Enemy.js';
import { HUD } from '../ui/HUD.js';
import { Menus } from '../ui/Menus.js';

const BARREL_RADIUS = 6.5;

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.settings = new Settings();
    const s = this.settings;
    if (!(s.get('quality') in QUALITY)) s.set('quality', 'medio');
    if (!(s.get('difficulty') in DIFFICULTY)) s.set('difficulty', 'normal');
    const q = QUALITY[s.get('quality')];

    this.audio = new AudioEngine();
    this.audio.volume = s.get('volume');
    this.audio.musicOn = s.get('music');

    // Renderizador
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(s.get('fov'), window.innerWidth / window.innerHeight, 0.05, 500);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 12, 2);
    this.muzzleLight.position.set(0.1, -0.05, -0.8);
    this.camera.add(this.muzzleLight);

    // Mundo y sistemas
    this.world = new CollisionWorld();
    this.level = new Level(this.scene, this.world, q);
    this.effects = new Effects(this.scene, q);
    this.player = new Player(this.camera, this.world, this.audio);
    this.player.sensitivity = s.get('sensitivity');
    this.input = new Input(canvas);
    this.hud = new HUD(this);
    this.weapons = new WeaponSystem(this);
    this.enemies = new EnemyManager(this);
    this.pickups = new Pickups(this);
    this.waves = new WaveDirector(this);
    this.diffKey = s.get('difficulty');
    this.diff = DIFFICULTY[this.diffKey];
    this.menus = new Menus(this);
    this.hud.buildRadarMap(this.world);
    this.pickups.reset();

    this.player.onDamage = (amt, from) => this.hud.damage(from);
    this.player.onDeath = () => this.onPlayerDeath();
    this.input.onLockChange = (locked, error) => this.onLockChange(locked, error);

    this.state = 'menu';
    this.time = 0;
    this.score = 0;
    this.stats = { kills: 0, heads: 0, time: 0 };
    this.lightT = 0;
    this.indoors = false;
    this.menuT = 0;

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('beforeunload', (e) => {
      if (this.state === 'playing' || this.state === 'paused') { e.preventDefault(); e.returnValue = ''; }
    });
    this.resize();
    this.warmup();
    this.menus.open('menu-main');
    this.hud.show(false);
    this.last = performance.now();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.weapons.camera.aspect = w / h; this.weapons.camera.updateProjectionMatrix();
  }

  // Precompila los shaders de todo lo que aparece más tarde (efectos ocultos,
  // los tres tipos de enemigo, arma) para evitar tirones en el primer disparo
  // o la primera aparición. No se tocan las luces: cambiar su número
  // invalidaría los programas compilados.
  warmup() {
    const mgr = this.enemies;
    const prevDiff = mgr.diff;
    const dummies = [];
    const hidden = [];
    try {
      mgr.diff = DIFFICULTY.normal;
      for (const t of ['grunt', 'rusher', 'heavy']) dummies.push(new Enemy(t, new THREE.Vector3(0, -60, 0), mgr));
      const reveal = (root) => root.traverse((o) => { if (!o.visible && !o.isLight) { hidden.push(o); o.visible = true; } });
      reveal(this.scene); reveal(this.weapons.scene);
      this.renderer.compile(this.scene, this.camera);
      this.renderer.compile(this.weapons.scene, this.weapons.camera);
    } catch (err) {
      console.warn('Precompilación de shaders omitida:', err);
    } finally {
      for (const o of hidden) o.visible = false;
      for (const d of dummies) d.dispose();
      mgr.diff = prevDiff;
    }
  }

  applyQuality() {
    const q = QUALITY[this.settings.get('quality')];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    const shadowsChanged = this.renderer.shadowMap.enabled !== q.shadows;
    this.renderer.shadowMap.enabled = q.shadows;
    this.level.applyQuality(q);
    this.effects.mul = q.particles;
    if (shadowsChanged) {
      this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
      this.warmup();
    }
    this.resize();
  }

  // ---------- Flujo de partida ----------
  startMatch() {
    this.audio.init();
    this.audio.setVolume(this.settings.get('volume'));
    this.audio.setMusic(this.settings.get('music'));
    this.diffKey = this.settings.get('difficulty');
    this.diff = DIFFICULTY[this.diffKey];
    this.enemies.clear();
    this.effects.reset();
    this.level.resetDynamic();
    this.pickups.reset();
    this.weapons.reset();
    this.player.reset(this.level.playerSpawn, 0);
    this.player.regenRate = this.diff.regen;
    this.player.sensitivity = this.settings.get('sensitivity');
    this.waves.reset();
    this.hud.reset();
    this.score = 0;
    this.stats = { kills: 0, heads: 0, time: 0 };
    this.streak = 0; this.lastKillT = -10;
    this.time = 0;
    this.menus.close();
    this.hud.show(true);
    this.hud.banner('PREPÁRATE', `Dificultad: ${this.diff.label} · Sobrevive a ${this.waves.total} oleadas`);
    this.state = 'playing';
    this.input.enabled = true;
    this.input.reset();
    this.input.requestLock();
    this.canvas.focus();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.reset();
    this.input.exitLock();
    this.audio.suspend(); // silencio y cero CPU de audio en pausa
    this.menus.showPause();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.menus.close();
    this.audio.resume();
    this.state = 'playing';
    this.input.enabled = true;
    this.input.reset();
    this.input.requestLock();
    this.last = performance.now();
  }

  toMenu() {
    this.audio.resume();
    this.state = 'menu';
    this.input.enabled = false;
    this.input.exitLock();
    this.enemies.clear();
    this.effects.reset();
    this.hud.show(false);
    this.menus.open('menu-main');
    this.menus.refreshBest();
  }

  onLockChange(locked, error) {
    // nunca dejar el cursor capturado (e invisible) sobre un menú
    if (locked && this.state !== 'playing') { this.input.exitLock(); return; }
    if (error && this.state === 'playing') {
      // el navegador rechazó la captura (p. ej. reintento demasiado rápido tras Esc)
      this.state = 'paused';
      this.input.enabled = false;
      this.menus.showPause(true);
      return;
    }
    if (!locked && this.state === 'playing' && !this.input.fallback) this.pause();
  }

  onPlayerDeath() {
    this.state = 'ending';
    this.endWin = false;
    this.endT = 2.6;
    this.hud.flash('HAS CAÍDO', 2.5);
  }

  victory() {
    this.state = 'ending';
    this.endWin = true;
    this.endT = 2.2;
  }

  finish() {
    this.state = 'over';
    this.input.enabled = false;
    this.input.exitLock();
    this.hud.show(false);
    const ws = this.weapons.stats;
    this.menus.showEnd(this.endWin, {
      score: this.score, kills: this.stats.kills, heads: this.stats.heads,
      shots: ws.shots, hits: ws.hits, time: this.stats.time,
      wave: Math.max(1, this.waves.wave), totalWaves: this.waves.total, diffKey: this.diffKey,
    });
  }

  addScore(n) { this.score += n; }

  // ---------- Combate ----------
  noise(pos, radius) { this.enemies.noise(pos, radius); }

  damageEnemy(enemy, dmg, head, point, dir) {
    this.effects.blood(point, dir, head ? 1.5 : 1);
    this.audio.impact('flesh', point.distanceTo(this.player.pos), 0);
    const killed = enemy.takeDamage(dmg, head, point, dir);
    if (killed) this.onEnemyKilled(enemy, head, '');
    return killed;
  }

  onEnemyKilled(e, head, how) {
    this.stats.kills++;
    if (head) this.stats.heads++;
    let pts = Math.round(e.cfg.score * this.diff.scoreMul * (head ? 1.5 : 1));
    if (this.time - this.lastKillT < 3) { this.streak++; pts += 50 * this.streak; } else this.streak = 0;
    this.lastKillT = this.time;
    this.addScore(pts);
    this.hud.killfeed(e.cfg.label, head, pts, how || (this.streak > 0 ? `RACHA x${this.streak + 1}` : ''));
    this.audio.kill();
    const dist = e.pos.distanceTo(this.player.pos);
    this.audio.enemyDeath(dist, e.pan());
    const c = new THREE.Color(e.cfg.visor);
    this.effects.deathBurst(e.pos, [c.r, c.g, c.b]);
    if (Math.random() < 0.32) this.pickups.drop(e.pos);
    this.waves.onKill();
  }

  damageBarrel(barrel, dmg) {
    if (!barrel.alive) return;
    barrel.hp -= dmg;
    if (barrel.hp <= 0 && barrel.fuse < 0) barrel.fuse = 0.1 + Math.random() * 0.12;
  }

  updateBarrels(dt) {
    for (const b of this.level.barrels) {
      if (!b.alive || b.fuse < 0) continue;
      b.fuse -= dt;
      // tiembla antes de estallar
      b.mesh.position.x = b.pos.x + (Math.random() - 0.5) * 0.04;
      if (b.fuse <= 0) this.explodeBarrel(b);
    }
  }

  explodeBarrel(b) {
    b.alive = false;
    this.level.root.remove(b.mesh);
    this.world.remove(b.box);
    this.level.nav.rebuildRegion(b.pos.x - 1, b.pos.z - 1, b.pos.x + 1, b.pos.z + 1);
    this.effects.explosion(new THREE.Vector3(b.pos.x, 0, b.pos.z));
    const p = this.player;
    const pd = b.pos.distanceTo(p.pos);
    const pan = (() => {
      const dx = b.pos.x - p.pos.x, dz = b.pos.z - p.pos.z;
      return (dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw)) / (Math.hypot(dx, dz) || 1);
    })();
    this.audio.explosion(pd, pan);
    p.addTrauma(Math.max(0, 1 - pd / 28));
    const origin = new THREE.Vector3(b.pos.x, 0.9, b.pos.z);
    const tmp = new THREE.Vector3();
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue;
      tmp.set(e.pos.x, e.pos.y + 1, e.pos.z);
      const d = tmp.distanceTo(origin);
      if (d > BARREL_RADIUS || !this.world.lineOfSight(origin, tmp)) continue;
      const dir = tmp.clone().sub(origin).normalize();
      const dmg = 240 * (1 - d / BARREL_RADIUS) + 25;
      if (e.takeDamage(dmg, false, tmp.clone(), dir)) this.onEnemyKilled(e, false, 'EXPLOSIÓN');
    }
    tmp.set(p.pos.x, p.pos.y + 1, p.pos.z);
    const dpl = tmp.distanceTo(origin);
    if (p.alive && dpl < BARREL_RADIUS && this.world.lineOfSight(origin, tmp)) {
      p.takeDamage(95 * (1 - dpl / BARREL_RADIUS) + 8, b.pos);
    }
    for (const o of this.level.barrels) {
      if (o.alive && o !== b && o.pos.distanceTo(b.pos) < 4.5) this.damageBarrel(o, 40);
    }
    this.noise(b.pos, 40);
  }

  // ---------- Bucle ----------
  frame(t) {
    // Subpasos de simulación: si el equipo va lento (FPS bajos) el juego no
    // entra en "cámara lenta"; cada subpaso dura como máximo 1/30 s.
    const total = Math.min(0.25, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    const steps = Math.max(1, Math.ceil(total / (1 / 30)));
    const dt = total / steps;
    for (let i = 0; i < steps; i++) {
      if (this.state === 'playing') this.update(dt);
      else if (this.state === 'ending') this.updateEnding(dt);
      else if (this.state === 'menu') this.updateMenu(dt);
      // las pulsaciones puntuales (saltar, recargar, disparo semiautomático)
      // solo cuentan en el primer subpaso
      if (i === 0) this.input.endFrame();
    }
    this.input.endFrame();
    // el HUD (DOM y radar) se actualiza una vez por fotograma, no por subpaso
    if (this.state === 'playing' || this.state === 'ending') this.hud.update(total);
    this.render();
  }

  update(dt) {
    const input = this.input;
    this.time += dt;
    this.stats.time += dt;
    const mouse = input.consumeMouse();
    if (input.wasPressed('KeyP') || (input.fallback && input.wasPressed('Escape'))) { this.pause(); return; }
    const locked = input.locked || input.fallback;
    this.player.update(dt, input, mouse, { ads: this.weapons.adsT > 0.5, firing: input.mouse.left, locked });
    this.camera.updateMatrixWorld();
    this.weapons.update(dt, input, mouse, locked);
    this.simulate(dt);
  }

  // Sistemas del mundo comunes a la partida y a la secuencia final
  simulate(dt) {
    this.enemies.update(dt);
    if (this.state === 'playing') this.waves.update(dt);
    this.pickups.update(dt, this.time);
    this.updateBarrels(dt);
    this.effects.update(dt);
    this.level.updateShadow(this.player.pos);
    this.lightT -= dt;
    if (this.lightT <= 0) { this.lightT = 0.25; this.indoors = this.level.isIndoors(this.player.pos); }
    this.weapons.lightLevel = THREE.MathUtils.damp(this.weapons.lightLevel, this.indoors ? 0.45 : 1, 4, dt);
  }

  updateEnding(dt) {
    this.time += dt;
    this.input.consumeMouse();
    this.player.update(dt, this.input, { dx: 0, dy: 0, wheel: 0 }, { locked: false });
    this.camera.updateMatrixWorld();
    if (this.player.alive) this.weapons.update(dt, this.input, { dx: 0, dy: 0, wheel: 0 }, false);
    this.simulate(dt);
    this.endT -= dt;
    if (this.endT <= 0) this.finish();
  }

  // Cámara cinemática del menú principal
  updateMenu(dt) {
    this.menuT += dt;
    const a = this.menuT * 0.05 + 0.6;
    this.camera.position.set(Math.cos(a) * 34, 13 + Math.sin(this.menuT * 0.2) * 1.5, Math.sin(a) * 34);
    this.camera.lookAt(0, 1.5, 0);
    this.camera.fov = 60; this.camera.updateProjectionMatrix();
    this.pickups.update(dt, this.menuT);
    this.effects.update(dt);
    this.level.updateShadow(new THREE.Vector3(Math.cos(a) * 12, 0, Math.sin(a) * 12));
  }

  render() {
    const r = this.renderer;
    r.autoClear = true;
    r.render(this.scene, this.camera);
    const showGun = (this.state === 'playing' || this.state === 'paused' || this.state === 'ending') && this.player.alive;
    if (showGun) {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.weapons.scene, this.weapons.camera);
      r.autoClear = true;
    }
  }
}
