// Sistema de armas: estado de munición, disparo hitscan con dispersión y caída
// de daño, recarga, cambio de arma, apuntado (ADS) y animación procedimental
// del arma en primera persona (retroceso, balanceo, inercia, recarga).
import * as THREE from 'three';
import { WEAPONS } from './WeaponData.js';
import { buildRifle, buildPistol, buildShotgun, buildCasingPool } from './Viewmodels.js';

const damp = THREE.MathUtils.damp;

export class WeaponSystem {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(54, 1, 0.01, 10);
    this.scene.add(this.camera);
    this.hemi = new THREE.HemisphereLight(0xc8d8ff, 0x403528, 1.4);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffe0b8, 2.2);
    this.key.position.set(-1, 2, 1);
    this.scene.add(this.key);
    this.fill = new THREE.PointLight(0xffc070, 0, 2, 2); // destello de disparo
    this.fill.position.set(0.1, 0, -0.6);
    this.camera.add(this.fill);
    this.lightLevel = 1;

    this.models = [buildRifle(), buildPistol(), buildShotgun()];
    for (const m of this.models) { m.root.visible = false; this.camera.add(m.root); }
    this.casings = buildCasingPool(this.camera);
    this.casingIdx = 0;
    this.raycaster = new THREE.Raycaster();
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._dir = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.state = WEAPONS.map((w) => ({ mag: w.mag, reserve: w.reserve }));
    this.current = 0;
    this.pending = -1;
    this.cooldown = 0;
    this.reloading = false;
    this.reloadT = 0;
    this.reloadDur = 0;
    this.shellPhase = 0;
    this.switchT = 0;   // 0..1 bajando/subiendo
    this.switching = 0; // 1 bajando, -1 subiendo
    this.adsT = 0;
    this.bloom = 0;
    this.kickZ = 0; this.kickRot = 0; this.kickSide = 0;
    this.swayX = 0; this.swayY = 0;
    this.sprintT = 0;
    this.flashT = 0;
    this.pumpT = 1;
    this.slideKick = 0;
    this.triggerHeld = false;
    this.stats = { shots: 0, hits: 0, heads: 0 };
    this.lastHitHead = false;
    this.models.forEach((m, i) => { m.root.visible = i === 0; });
    this.raiseT = 1; // animación inicial de sacar arma
    for (const c of this.casings.list) c.visible = false;
  }

  get def() { return WEAPONS[this.current]; }
  get ammo() { return this.state[this.current]; }
  get isADS() { return this.adsT > 0.6; }

  // Dispersión actual (radianes) para el HUD y el disparo
  spread() {
    const w = this.def, p = this.game.player;
    let s = THREE.MathUtils.lerp(w.spreadHip, w.spreadAds, this.adsT);
    s += w.spreadMove * Math.min(1, p.speedNow / 5) * (1 - this.adsT * 0.7);
    if (!p.grounded) s += w.spreadAir;
    if (p.crouching) s *= 0.75;
    return s + this.bloom;
  }

  addAmmo(fraction) {
    WEAPONS.forEach((w, i) => {
      this.state[i].reserve = Math.min(w.reserve * 1.6, this.state[i].reserve + Math.ceil(w.reserve * fraction));
    });
  }

  select(i) {
    if (i === this.current && this.switching === 0) return;
    if (i < 0 || i >= WEAPONS.length) return;
    if (this.switching !== 0 && this.pending === i) return;
    this.pending = i;
    this.switching = 1;
    this.cancelReload();
    this.game.audio.mech('switch');
  }

  cancelReload() { this.reloading = false; this.reloadT = 0; }

  startReload() {
    const w = this.def, a = this.ammo;
    if (this.reloading || this.switching !== 0 || a.mag >= w.mag || a.reserve <= 0) return false;
    this.reloading = true;
    this.reloadT = 0;
    if (w.perShell) {
      this.reloadDur = w.reloadStart;
      this.shellPhase = 0; // fase de entrada
    } else {
      this.reloadDur = a.mag === 0 ? w.reloadEmpty : w.reloadTime;
      this.reloadEmpty = a.mag === 0;
      this.reloadSounds = { out: false, in: false, bolt: false };
    }
    return true;
  }

  update(dt, input, mouse, canAct) {
    const p = this.game.player;
    const w = this.def;
    this.cooldown -= dt;

    if (canAct && p.alive) {
      // selección
      if (input.wasPressed('Digit1')) this.select(0);
      if (input.wasPressed('Digit2')) this.select(1);
      if (input.wasPressed('Digit3')) this.select(2);
      if (input.wasPressed('KeyQ')) this.select(this.lastWeapon ?? 1);
      if (mouse.wheel) this.select((this.current + (mouse.wheel > 0 ? 1 : -1) + WEAPONS.length) % WEAPONS.length);
      if (input.wasPressed('KeyR')) this.startReload();
    }

    // cambio de arma
    if (this.switching === 1) {
      this.switchT = Math.min(1, this.switchT + dt / 0.2);
      if (this.switchT >= 1) {
        this.models[this.current].root.visible = false;
        this.lastWeapon = this.current;
        this.current = this.pending;
        this.pending = -1;
        this.models[this.current].root.visible = true;
        this.switching = -1;
      }
    } else if (this.switching === -1) {
      this.switchT = Math.max(0, this.switchT - dt / 0.25);
      if (this.switchT <= 0) this.switching = 0;
    }
    this.raiseT = Math.max(0, this.raiseT - dt * 2.5);

    // ADS
    const wantADS = canAct && p.alive && input.mouse.right && this.switching === 0 && !(this.reloading && !w.perShell);
    this.adsT = damp(this.adsT, wantADS ? 1 : 0, 1 / (w.adsTime * 0.35), dt);
    if (this.adsT < 0.002) this.adsT = 0;

    // Disparo
    // leftPressed captura clics muy rápidos (pulsar y soltar dentro del mismo frame)
    const trigger = canAct && p.alive && (input.mouse.left || input.mouse.leftPressed);
    const fresh = trigger && !this.triggerHeld;
    this.triggerHeld = trigger;
    if (trigger && this.switching === 0) {
      if (this.reloading && w.perShell && this.ammo.mag > 0) this.cancelReload();
      if (!this.reloading && this.cooldown <= 0 && (w.auto || fresh) && this.pumpT >= 1) {
        if (this.ammo.mag > 0) this.fire();
        else if (fresh) {
          this.game.audio.mech('empty');
          this.cooldown = 0.2;
          if (!this.startReload()) this.game.hud.flash('SIN MUNICIÓN');
        }
      }
    }
    // recarga automática al vaciar el cargador
    if (!this.reloading && this.ammo.mag === 0 && this.ammo.reserve > 0 && this.cooldown < -0.15 && this.switching === 0) this.startReload();

    this.updateReload(dt);

    // bloom
    this.bloom = Math.max(0, this.bloom - dt * (w.bloomMax * 4 + 0.02));
    this.animate(dt, mouse);
    this.updateCasings(dt);
  }

  updateReload(dt) {
    if (!this.reloading) return;
    const w = this.def, a = this.ammo, au = this.game.audio;
    this.reloadT += dt;
    if (w.perShell) {
      if (this.reloadT >= this.reloadDur) {
        if (this.shellPhase === 0) { this.shellPhase = 1; }
        else {
          a.mag++; a.reserve--;
          au.mech('shell');
        }
        this.reloadT = 0;
        this.reloadDur = w.reloadTime;
        if (a.mag >= w.mag || a.reserve <= 0) {
          this.reloading = false;
          this.pumpT = 0; au.mech('pump');
        }
      }
      return;
    }
    const t = this.reloadT / this.reloadDur;
    if (t > 0.18 && !this.reloadSounds.out) { this.reloadSounds.out = true; au.mech('magout'); }
    if (t > 0.6 && !this.reloadSounds.in) { this.reloadSounds.in = true; au.mech('magin'); }
    if (this.reloadEmpty && t > 0.82 && !this.reloadSounds.bolt) { this.reloadSounds.bolt = true; au.mech('bolt'); }
    if (t >= 1) {
      const need = w.mag - a.mag;
      const take = Math.min(need, a.reserve);
      a.mag += take; a.reserve -= take;
      this.reloading = false;
    }
  }

  reloadProgress() {
    if (!this.reloading) return 0;
    const w = this.def;
    if (w.perShell) return Math.min(1, (this.ammo.mag + (this.shellPhase ? this.reloadT / this.reloadDur : 0)) / w.mag);
    return Math.min(1, this.reloadT / this.reloadDur);
  }

  fire() {
    const w = this.def, g = this.game, p = g.player;
    this.ammo.mag--;
    this.cooldown = w.interval;
    this.stats.shots++;
    g.audio.shot(w.sound);
    g.noise(p.pos, 45);

    // retroceso
    const adsMul = 1 - this.adsT * 0.35;
    const crouchMul = p.crouching ? 0.8 : 1;
    p.addRecoil(w.recoilUp * adsMul * crouchMul * (0.85 + Math.random() * 0.3), (Math.random() - 0.5) * 2 * w.recoilSide * adsMul);
    this.kickZ += w.kick * (1 - this.adsT * 0.5);
    this.kickRot += w.kickRot * (1 - this.adsT * 0.6);
    this.kickSide += (Math.random() - 0.5) * 0.04;
    this.flashT = 0.05;
    this.flashRot = Math.random() * Math.PI;
    if (w.id === 'pistol') this.slideKick = 1;
    if (w.id === 'shotgun') { this.pumpT = 0; setTimeout(() => g.audio.mech('pump'), 260); }
    this.ejectCasing(w.id === 'shotgun');
    p.addTrauma(w.id === 'shotgun' ? 0.22 : 0.05);

    // hitscan
    const spread = this.spread();
    const cam = g.camera;
    const origin = cam.getWorldPosition(this._v);
    const fwd = cam.getWorldDirection(this._v2);
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const muzzleWorld = origin.clone().addScaledVector(fwd, 0.7).addScaledVector(right, 0.14 * (1 - this.adsT)).addScaledVector(up, -0.1 * (1 - this.adsT) - 0.03);

    let anyHit = false, anyHead = false, killed = false;
    const enemyDamage = new Map();
    for (let i = 0; i < w.pellets; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      const dir = this._dir.copy(fwd).addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      const res = this.trace(origin, dir, w);
      if (res.enemy) {
        anyHit = true;
        const prev = enemyDamage.get(res.enemy) || { dmg: 0, head: false, point: res.point, dir: dir.clone() };
        prev.dmg += res.damage; prev.head = prev.head || res.head;
        enemyDamage.set(res.enemy, prev);
        if (res.head) anyHead = true;
      }
      if (Math.random() < w.tracer || i === 0) g.effects.tracer(muzzleWorld, res.point, 0xffe0a0, w.pellets > 1 ? 0.6 : 1);
    }
    for (const [enemy, d] of enemyDamage) {
      if (g.damageEnemy(enemy, d.dmg, d.head, d.point, d.dir)) killed = true;
    }
    if (anyHit) {
      this.stats.hits++;
      if (anyHead) this.stats.heads++;
      g.hud.hitmarker(anyHead, killed);
      g.audio.hitmarker(anyHead);
    }
    this.bloom = Math.min(w.bloomMax, this.bloom + w.bloom);
  }

  // Traza un rayo contra el mundo y los enemigos
  trace(origin, dir, w) {
    const g = this.game;
    const wh = g.world.raycast(origin, dir, w.range);
    const worldT = wh ? wh.t : w.range;
    this.raycaster.set(origin, dir);
    this.raycaster.far = worldT;
    this.raycaster.near = 0;
    const hits = this.raycaster.intersectObjects(g.enemies.hitMeshes, false);
    for (const h of hits) {
      const e = h.object.userData.enemy;
      if (!e || !e.alive) continue;
      const head = h.object.userData.part === 'head';
      const dist = h.distance;
      const fall = dist <= w.falloffStart ? 1 : THREE.MathUtils.lerp(1, w.minDmg, Math.min(1, (dist - w.falloffStart) / (w.range - w.falloffStart)));
      const damage = w.damage * fall * (head ? w.headMul : 1);
      return { enemy: e, head, point: h.point.clone(), damage };
    }
    const point = origin.clone().addScaledVector(dir, worldT);
    if (wh) {
      g.effects.impact(point, wh.normal, wh.box.material || 'concrete');
      const surf = wh.box.material || 'concrete';
      const s = surf.startsWith('container') || surf === 'metal' || surf === 'darkMetal' ? 'metal' : (surf === 'wood' || surf === 'crate') ? 'wood' : 'concrete';
      if (Math.random() < 0.5) g.audio.impact(s, worldT, 0);
      if (wh.box.barrel) g.damageBarrel(wh.box.barrel, w.damage);
    }
    return { enemy: null, point };
  }

  ejectCasing(shell) {
    const m = this.models[this.current];
    const c = this.casings.list[this.casingIdx];
    this.casingIdx = (this.casingIdx + 1) % this.casings.list.length;
    if (!m.gun.parent) return;
    c.geometry = shell ? this.casings.shellGeo : this.casings.geo;
    c.material = shell ? this.casings.red : this.casings.brass;
    m.gun.updateWorldMatrix(true, false);
    const p = m.eject.clone().applyMatrix4(m.gun.matrix).applyMatrix4(m.root.matrix);
    c.position.copy(p);
    c.userData.vel.set(0.9 + Math.random() * 0.5, 0.9 + Math.random() * 0.5, 0.2 + Math.random() * 0.3);
    c.userData.spin.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
    c.userData.life = shell ? 0 : 0.6; // la vaina de escopeta sale al bombear
    if (shell) { c.userData.delay = 0.32; c.visible = false; } else { c.userData.delay = 0; c.visible = true; }
    c.userData.active = true;
    c.userData.isShell = shell;
  }

  updateCasings(dt) {
    for (const c of this.casings.list) {
      const u = c.userData;
      if (!u.active) continue;
      if (u.delay > 0) {
        u.delay -= dt;
        if (u.delay <= 0) {
          const m = this.models[this.current];
          c.position.copy(m.eject.clone().applyMatrix4(m.gun.matrix).applyMatrix4(m.root.matrix));
          c.visible = true; u.life = 0.7;
        }
        continue;
      }
      u.life -= dt;
      u.vel.y -= 6 * dt;
      c.position.addScaledVector(u.vel, dt);
      c.rotation.x += u.spin.x * dt; c.rotation.y += u.spin.y * dt; c.rotation.z += u.spin.z * dt;
      if (u.life <= 0) { c.visible = false; u.active = false; }
    }
  }

  animate(dt, mouse) {
    const p = this.game.player;
    const w = this.def;
    const m = this.models[this.current];
    const ads = this.adsT;

    // inercia del ratón
    this.swayX = damp(this.swayX, THREE.MathUtils.clamp(-mouse.dx * 0.0009, -0.06, 0.06), 10, dt);
    this.swayY = damp(this.swayY, THREE.MathUtils.clamp(mouse.dy * 0.0009, -0.06, 0.06), 10, dt);
    this.sprintT = damp(this.sprintT, p.sprinting ? 1 : 0, 10, dt);

    // retroceso con muelle
    this.kickZ = damp(this.kickZ, 0, 16, dt);
    this.kickRot = damp(this.kickRot, 0, 13, dt);
    this.kickSide = damp(this.kickSide, 0, 12, dt);
    this.slideKick = damp(this.slideKick, 0, 22, dt);
    if (this.pumpT < 1) this.pumpT = Math.min(1, this.pumpT + dt / (w.interval * 0.85));

    const hip = w.hipPos, adp = w.adsPos;
    const bobAmt = p.moveFrac * (1 - ads * 0.85) * (p.sprinting ? 1.6 : 1);
    const bx = Math.cos(p.bobPhase) * 0.012 * bobAmt;
    const by = -Math.abs(Math.sin(p.bobPhase)) * 0.014 * bobAmt;
    const breathe = Math.sin(p.time * 1.6) * 0.0025 * (1 - ads);
    const swayMul = 1 - ads * 0.8;

    let x = THREE.MathUtils.lerp(hip[0], adp[0], ads) + bx + this.swayX * swayMul;
    let y = THREE.MathUtils.lerp(hip[1], adp[1], ads) + by + breathe + this.swayY * swayMul - p.landKick * 0.25;
    let z = THREE.MathUtils.lerp(hip[2], adp[2], ads) + this.kickZ;
    let rx = this.kickRot + this.swayY * 0.8 * swayMul;
    let ry = this.swayX * 1.2 * swayMul + this.kickSide;
    let rz = this.swayX * 0.6 * swayMul + (p.crouching ? 0.04 : 0) * (1 - ads);

    // sprint
    const s = this.sprintT;
    x += s * -0.04; y += s * -0.05; z += s * 0.02;
    rx += s * -0.25; ry += s * 0.75; rz += s * 0.25;

    // cambio de arma / sacar
    const sw = Math.max(this.switchT, this.raiseT);
    const se = sw * sw * (3 - 2 * sw);
    y -= se * 0.32; rx -= se * 0.8;

    // recarga
    if (this.reloading && !w.perShell) {
      const t = this.reloadT / this.reloadDur;
      const env = Math.sin(Math.min(1, t) * Math.PI);
      rz += env * 0.55; rx += env * 0.22; y -= env * 0.04; x -= env * 0.03;
      if (m.mag) {
        let off = 0;
        if (t > 0.15 && t < 0.35) off = (t - 0.15) / 0.2;
        else if (t >= 0.35 && t < 0.5) off = 3;
        else if (t >= 0.5 && t < 0.68) off = 1 - (t - 0.5) / 0.18;
        m.mag.position.copy(m.magHome);
        m.mag.position.y -= Math.min(off, 1) * 0.16;
        m.mag.visible = off < 2;
      }
      if (this.reloadEmpty && m.bolt && t > 0.82) m.bolt.position.z = m.boltHome.z + Math.sin((t - 0.82) / 0.18 * Math.PI) * 0.06;
    } else {
      if (m.mag) { m.mag.position.copy(m.magHome); m.mag.visible = true; }
      if (m.bolt) m.bolt.position.copy(m.boltHome);
    }
    if (w.perShell && this.reloading) {
      rz += 0.35; rx += 0.18; y -= 0.03;
      const k = this.shellPhase ? Math.sin(Math.min(1, this.reloadT / this.reloadDur) * Math.PI) : 0;
      if (m.shell) { m.shell.visible = this.shellPhase === 1; m.shell.position.set(0.0, -0.06 - (1 - k) * 0.05, -0.02 + k * 0.01); }
      rx -= k * 0.05;
    } else if (m.shell) m.shell.visible = false;

    // corredera de pistola
    if (m.slide) {
      const empty = this.ammo.mag === 0 && w.id === 'pistol';
      m.slide.position.z = Math.max(this.slideKick, empty ? 1 : 0) * 0.035;
    }
    // bombeo de escopeta
    if (m.pump) {
      const t = this.pumpT;
      const pk = t < 1 ? Math.sin(Math.min(1, Math.max(0, (t - 0.2) / 0.7)) * Math.PI) : 0;
      m.pump.position.copy(m.pumpHome); m.pump.position.z += pk * 0.09;
      rx += pk * 0.06;
    }

    m.root.position.set(x, y, z);
    m.root.rotation.set(rx, ry, rz);

    // fogonazo
    this.flashT -= dt;
    const fl = this.flashT > 0;
    m.flash.visible = fl;
    if (fl) { m.flash.rotation.z = this.flashRot; const sc = 0.8 + Math.random() * 0.5; m.flash.scale.set(sc, sc, sc); }
    this.fill.intensity = fl ? 6 : 0;
    this.game.muzzleLight.intensity = fl ? 14 : 0;

    // iluminación del arma según interior/exterior
    this.key.intensity = 2.2 * this.lightLevel;
    this.hemi.intensity = 0.5 + 0.9 * this.lightLevel;

    // FOV
    const base = this.game.settings.get('fov');
    const fov = THREE.MathUtils.lerp(base, w.adsFov, ads) + this.sprintT * 4;
    if (Math.abs(this.game.camera.fov - fov) > 0.01) { this.game.camera.fov = fov; this.game.camera.updateProjectionMatrix(); }
    const vfov = THREE.MathUtils.lerp(54, 40, ads);
    if (Math.abs(this.camera.fov - vfov) > 0.01) { this.camera.fov = vfov; this.camera.updateProjectionMatrix(); }
  }
}
