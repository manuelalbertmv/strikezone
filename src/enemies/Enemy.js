// Enemigo con IA: percepción (vista con cono y línea de visión, oído), máquina de
// estados (patrulla, persecución, ataque, búsqueda), pathfinding A*, combate a
// distancia o cuerpo a cuerpo, animación procedimental y muerte.
import * as THREE from 'three';

export const ENEMY_TYPES = {
  grunt: {
    label: 'Soldado', hp: 100, speed: 3.6, radius: 0.36, height: 1.8, scale: 1,
    ranged: true, damage: 8, burst: 3, shotGap: 0.12, burstCooldown: [0.9, 1.6], range: 34, preferDist: 14,
    body: 0x4a4f44, armor: 0x2f3530, visor: 0xff3a2a, score: 100,
  },
  rusher: {
    label: 'Asaltante', hp: 70, speed: 6.4, radius: 0.33, height: 1.75, scale: 0.95,
    ranged: false, damage: 20, meleeRange: 1.9, meleeWindup: 0.32, meleeCooldown: 0.9,
    body: 0x5a3a2a, armor: 0x2c2220, visor: 0xffa020, score: 120,
  },
  heavy: {
    label: 'Pesado', hp: 320, speed: 2.5, radius: 0.48, height: 2.1, scale: 1.22,
    ranged: true, damage: 6, burst: 9, shotGap: 0.085, burstCooldown: [1.4, 2.2], range: 30, preferDist: 10,
    body: 0x2c2f38, armor: 0x1a1c22, visor: 0x40c0ff, score: 300,
  },
};

const geoCache = {};
function geo(key, fn) { return geoCache[key] || (geoCache[key] = fn()); }
const visorMats = {};

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Enemy {
  constructor(type, pos, mgr) {
    this.type = type;
    this.cfg = ENEMY_TYPES[type];
    this.mgr = mgr;
    const d = mgr.diff;
    this.maxHp = this.cfg.hp * d.enemyHp;
    this.hp = this.maxHp;
    this.alive = true;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.state = 'chase';
    this.grounded = true;
    this.path = null; this.pathIdx = 0; this.repathT = Math.random() * 0.5;
    this.perceiveT = Math.random() * 0.15;
    this.canSee = false;
    this.lastSeen = -100;
    this.lastKnown = mgr.player.pos.clone();
    this.alertT = 0; this.alerted = true;
    this.burstLeft = 0; this.shotT = 0; this.aimT = 0;
    this.cooldownT = 1 + Math.random();
    this.meleeT = 0; this.winding = false;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeT = 0;
    this.walkPhase = 0;
    this.flashT = 0;
    this.flinch = 0;
    this.deathT = 0;
    this.lastHitTime = -10;
    this.speedMul = d.speedMul * (0.92 + Math.random() * 0.16);
    this.buildModel();
    mgr.scene.add(this.root);
  }

  buildModel() {
    const c = this.cfg;
    const s = c.scale;
    const root = new THREE.Group();
    root.position.copy(this.pos);
    this.root = root;
    const body = new THREE.MeshStandardMaterial({ color: c.body, roughness: 0.85, metalness: 0.05 });
    const armor = new THREE.MeshStandardMaterial({ color: c.armor, roughness: 0.5, metalness: 0.4 });
    if (!visorMats[this.type]) visorMats[this.type] = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c.visor, emissiveIntensity: 3 });
    this.mats = [body, armor];
    const visor = visorMats[this.type];
    this.hitMeshes = [];
    const mk = (g, m, part, parent, x, y, z) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.userData.enemy = this; mesh.userData.part = part;
      parent.add(mesh);
      if (part) this.hitMeshes.push(mesh);
      return mesh;
    };
    const B = (k, x, y, z) => geo(k, () => new THREE.BoxGeometry(x, y, z));
    const scaleG = new THREE.Group(); scaleG.scale.setScalar(s); root.add(scaleG);
    this.model = scaleG;

    // piernas
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(side * 0.12, 0.92, 0); scaleG.add(hip);
      mk(B('thigh', 0.17, 0.48, 0.19), body, 'body', hip, 0, -0.24, 0);
      const knee = new THREE.Group(); knee.position.set(0, -0.48, 0); hip.add(knee);
      mk(B('shin', 0.15, 0.42, 0.16), body, 'body', knee, 0, -0.21, 0);
      mk(B('boot', 0.16, 0.1, 0.27), armor, null, knee, 0, -0.39, -0.04);
      mk(B('knee', 0.17, 0.12, 0.06), armor, null, knee, 0, -0.02, -0.1);
      this.legs.push({ hip, knee });
    }
    // torso
    const torso = new THREE.Group(); torso.position.set(0, 0.95, 0); scaleG.add(torso);
    this.torso = torso;
    mk(B('pelvis', 0.4, 0.18, 0.24), body, 'body', torso, 0, 0.05, 0);
    mk(B('chest', 0.46, 0.5, 0.27), body, 'body', torso, 0, 0.4, 0);
    mk(B('vest', 0.5, 0.4, 0.32), armor, null, torso, 0, 0.42, 0);
    mk(B('pack', 0.34, 0.36, 0.14), armor, null, torso, 0, 0.42, 0.22);
    for (const x of [-0.13, 0, 0.13]) mk(B('pouch', 0.1, 0.12, 0.05), body, null, torso, x, 0.3, -0.18);
    // cabeza
    const neck = new THREE.Group(); neck.position.set(0, 0.68, 0); torso.add(neck);
    this.neck = neck;
    mk(B('head', 0.24, 0.26, 0.25), body, 'head', neck, 0, 0.16, 0);
    const helmet = mk(geo('helmet', () => new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), armor, 'head', neck, 0, 0.22, 0.01);
    helmet.scale.set(1, 0.9, 1.08);
    mk(B('visor', 0.22, 0.06, 0.04), visor, null, neck, 0, 0.18, -0.13);
    // brazos
    const armL = new THREE.Group(); armL.position.set(-0.29, 0.6, 0); torso.add(armL);
    const armR = new THREE.Group(); armR.position.set(0.29, 0.6, 0); torso.add(armR);
    mk(B('arm', 0.13, 0.5, 0.14), body, 'body', armL, 0, -0.24, 0);
    mk(B('arm', 0.13, 0.5, 0.14), body, 'body', armR, 0, -0.24, 0);
    mk(B('hand', 0.1, 0.1, 0.11), armor, null, armL, 0, -0.52, 0);
    mk(B('hand', 0.1, 0.1, 0.11), armor, null, armR, 0, -0.52, 0);
    this.armL = armL; this.armR = armR;
    // arma
    this.muzzle = new THREE.Object3D();
    if (this.cfg.ranged) {
      const gun = new THREE.Group();
      gun.position.set(0.12, 0.38, -0.32); torso.add(gun);
      const gm = this.mgr.gunMat;
      if (this.type === 'heavy') {
        mk(B('hgun', 0.16, 0.18, 0.62), gm, null, gun, 0, 0, -0.05);
        for (let i = 0; i < 3; i++) mk(geo('barrelH', () => new THREE.CylinderGeometry(0.025, 0.025, 0.4, 6).rotateX(Math.PI / 2)), gm, null, gun, -0.04 + i * 0.04, 0.02, -0.5);
        mk(B('ammoBox', 0.14, 0.16, 0.18), armor, null, gun, -0.12, -0.08, 0.1);
        this.muzzle.position.set(0, 0.02, -0.72);
      } else {
        mk(B('gun', 0.07, 0.11, 0.6), gm, null, gun, 0, 0, -0.08);
        mk(B('gmag', 0.05, 0.16, 0.07), gm, null, gun, 0, -0.12, -0.08);
        this.muzzle.position.set(0, 0.01, -0.42);
      }
      gun.add(this.muzzle);
      this.gun = gun;
      // brazos en posición de apuntar
      armR.rotation.x = -1.25; armL.rotation.x = -1.35; armL.rotation.z = 0.5;
    } else {
      // garras / cuchillas de asaltante
      const blade = geo('blade', () => new THREE.BoxGeometry(0.03, 0.05, 0.38));
      mk(blade, this.mgr.bladeMat, null, armR, 0, -0.55, -0.15);
      mk(blade, this.mgr.bladeMat, null, armL, 0, -0.55, -0.15);
      torso.add(this.muzzle);
    }
  }

  get eye() { return _v.set(this.pos.x, this.pos.y + this.cfg.height * 0.9, this.pos.z); }

  takeDamage(dmg, head, point, dir) {
    if (!this.alive) return false;
    this.hp -= dmg;
    this.flashT = 0.12;
    this.flinch = Math.min(1, this.flinch + (head ? 0.9 : 0.45));
    this.lastHitTime = this.mgr.time;
    // al recibir daño sabe dónde estás
    this.lastKnown.copy(this.mgr.player.pos);
    this.lastSeen = this.mgr.time;
    if (this.state !== 'attack') { this.state = 'chase'; this.repathT = 0; }
    if (dir) { this.vel.x += dir.x * 1.2; this.vel.z += dir.z * 1.2; }
    if (this.hp <= 0) { this.die(dir); return true; }
    return false;
  }

  die(dir) {
    this.alive = false;
    this.state = 'dead';
    this.deathT = 0;
    this.deathDir = dir ? Math.atan2(dir.x, dir.z) : this.yaw;
    for (const m of this.mats) m.emissive.setHex(0x000000);
  }

  // Ángulo pan para audio posicional
  pan() {
    const p = this.mgr.player;
    const dx = this.pos.x - p.pos.x, dz = this.pos.z - p.pos.z;
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const d = Math.hypot(dx, dz) || 1;
    return (dx * rx + dz * rz) / d;
  }

  update(dt) {
    const m = this.mgr;
    if (!this.alive) return this.updateDeath(dt);
    const p = m.player;
    const c = this.cfg;
    const toP = _v2.set(p.pos.x - this.pos.x, 0, p.pos.z - this.pos.z);
    const dist = toP.length();

    // --- Percepción ---
    this.perceiveT -= dt;
    if (this.perceiveT <= 0) {
      this.perceiveT = 0.15;
      const eye = this.eye.clone();
      const pe = p.eyePosition();
      let see = false;
      if (p.alive && dist < 55) {
        const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
        const dot = (toP.x * fwdX + toP.z * fwdZ) / (dist || 1);
        const inCone = dot > 0.25 || dist < 7 || m.time - this.lastHitTime < 2;
        if (inCone && m.world.lineOfSight(eye, pe)) see = true;
        // también ver el torso del jugador si la cabeza está tapada
        else if (inCone && m.world.lineOfSight(eye, pe.setY(p.pos.y + 0.9))) see = true;
      }
      if (see && !this.canSee) this.reactT = m.diff.reaction * (0.7 + Math.random() * 0.6);
      this.canSee = see;
      if (see) { this.lastKnown.copy(p.pos); this.lastSeen = m.time; }
    }
    if (this.reactT > 0) this.reactT -= dt;
    const timeSinceSeen = m.time - this.lastSeen;

    // --- Máquina de estados ---
    let moveTarget = null;
    let faceTarget = null;
    let wantSpeed = c.speed * this.speedMul;

    if (!p.alive) { this.state = 'idle'; }

    if (this.state === 'chase') {
      moveTarget = this.followPath(dt, this.canSee && dist < 6 ? p.pos : this.lastKnown);
      if (c.ranged && this.canSee && dist < c.range && this.reactT <= 0) { this.state = 'attack'; this.aimT = 0.25; }
      if (!c.ranged && dist < c.meleeRange && this.canSee) this.state = 'melee';
      if (!this.canSee && timeSinceSeen > 4) {
        // modo cacería: las oleadas siempre convergen hacia el jugador
        this.lastKnown.copy(p.pos); this.lastSeen = m.time - 2;
      }
      if (this.canSee) faceTarget = p.pos;
    } else if (this.state === 'attack') {
      faceTarget = p.pos;
      // mantener distancia preferida y moverse lateralmente
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = 0.8 + Math.random() * 1.4; this.strafeDir = Math.random() < 0.5 ? -1 : 1; if (Math.random() < 0.25) this.strafeDir = 0; }
      const nx = toP.x / (dist || 1), nz = toP.z / (dist || 1);
      let mx = -nz * this.strafeDir, mz = nx * this.strafeDir;
      if (dist > c.preferDist + 4) { mx += nx; mz += nz; }
      else if (dist < c.preferDist * 0.5) { mx -= nx * 0.8; mz -= nz * 0.8; }
      moveTarget = _v.set(this.pos.x + mx * 2, this.pos.y, this.pos.z + mz * 2).clone();
      wantSpeed *= 0.45;
      this.updateShooting(dt, dist);
      if (!this.canSee && timeSinceSeen > 1.0) { this.state = 'chase'; this.repathT = 0; this.burstLeft = 0; }
      if (dist > c.range * 1.15) { this.state = 'chase'; this.repathT = 0; }
    } else if (this.state === 'melee') {
      faceTarget = p.pos;
      this.meleeT -= dt;
      if (!this.winding && this.meleeT <= 0) { this.winding = true; this.windT = c.meleeWindup; }
      if (this.winding) {
        this.windT -= dt;
        if (this.windT <= 0) {
          this.winding = false;
          this.meleeT = c.meleeCooldown;
          m.audio.enemyMelee(dist, this.pan());
          if (dist < c.meleeRange + 0.5 && p.alive) p.takeDamage(c.damage * m.diff.enemyDmg, this.pos);
        }
      }
      if (dist > c.meleeRange + 0.3) { moveTarget = p.pos; }
      if (dist > c.meleeRange * 2.5 || !this.canSee) { this.state = 'chase'; this.winding = false; this.repathT = 0; }
    } else if (this.state === 'idle') {
      wantSpeed = 0;
    }

    // --- Movimiento ---
    let dx = 0, dz = 0;
    if (moveTarget) {
      dx = moveTarget.x - this.pos.x; dz = moveTarget.z - this.pos.z;
      const l = Math.hypot(dx, dz);
      if (l > 0.05) { dx /= l; dz /= l; } else { dx = dz = 0; }
    }
    // separación con otros enemigos
    for (const o of m.enemies) {
      if (o === this || !o.alive) continue;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
      const d2 = ox * ox + oz * oz;
      const rr = (this.cfg.radius + o.cfg.radius) * 1.6;
      if (d2 < rr * rr && d2 > 0.0001) { const d = Math.sqrt(d2); dx += (ox / d) * (1 - d / rr) * 1.5; dz += (oz / d) * (1 - d / rr) * 1.5; }
    }
    // no atravesar al jugador
    if (dist < c.radius + 0.5 && dist > 0.001) { dx -= toP.x / dist; dz -= toP.z / dist; }

    const accel = 1 - Math.exp(-8 * dt);
    const flinchSlow = 1 - this.flinch * 0.6;
    this.vel.x += (dx * wantSpeed * flinchSlow - this.vel.x) * accel;
    this.vel.z += (dz * wantSpeed * flinchSlow - this.vel.z) * accel;
    this.vel.y -= 20 * dt;
    const res = m.world.move(this.pos, c.radius, c.height, { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt }, this.grounded, 0.45);
    this.grounded = res.grounded;
    if (res.grounded && this.vel.y < 0) this.vel.y = 0;
    if (res.hitWall && this.state === 'chase') this.repathT = Math.min(this.repathT, 0.1);

    // --- Orientación ---
    let targetYaw = this.yaw;
    if (faceTarget) targetYaw = Math.atan2(-(faceTarget.x - this.pos.x), -(faceTarget.z - this.pos.z));
    else if (Math.hypot(this.vel.x, this.vel.z) > 0.3) targetYaw = Math.atan2(-this.vel.x, -this.vel.z);
    let dy = targetYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 9);

    this.animate(dt, faceTarget ? p : null);
  }

  followPath(dt, target) {
    const m = this.mgr;
    this.repathT -= dt;
    const tgtMoved = !this.pathTarget || this.pathTarget.distanceToSquared(target) > 9;
    if ((this.repathT <= 0 || (tgtMoved && this.repathT < 0.6)) && m.pathBudget > 0) {
      m.pathBudget--;
      this.repathT = 0.9 + Math.random() * 0.6;
      this.path = m.nav.findPath(this.pos.x, this.pos.z, target.x, target.z);
      this.pathIdx = 0;
      this.pathTarget = target.clone();
    }
    if (!this.path || this.pathIdx >= this.path.length) return target;
    const wp = this.path[this.pathIdx];
    const d = Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z);
    if (d < 0.6) this.pathIdx++;
    return this.path[Math.min(this.pathIdx, this.path.length - 1)];
  }

  updateShooting(dt, dist) {
    const m = this.mgr, c = this.cfg, p = m.player;
    if (this.burstLeft <= 0) {
      this.cooldownT -= dt;
      if (this.cooldownT <= 0 && this.canSee && this.reactT <= 0) {
        this.burstLeft = c.burst + ((Math.random() * 2) | 0);
        this.aimT = 0.3; // telegrafía (visor brilla)
        this.shotT = 0;
      }
      return;
    }
    if (this.aimT > 0) { this.aimT -= dt; return; }
    this.shotT -= dt;
    if (this.shotT > 0) return;
    this.shotT = c.shotGap;
    this.burstLeft--;
    if (this.burstLeft <= 0) this.cooldownT = c.burstCooldown[0] + Math.random() * (c.burstCooldown[1] - c.burstCooldown[0]);

    // disparo
    const muzzle = this.muzzle.getWorldPosition(new THREE.Vector3());
    m.effects.flash(muzzle, this.type === 'heavy' ? 0.9 : 0.6, 0.05);
    m.audio.shot('enemy', dist, this.pan());
    this.recoil = 1;
    let acc = m.diff.accuracy * (1 - Math.min(0.6, dist / c.range * 0.55));
    if (p.speedNow > 3.5) acc *= 0.72;
    if (p.crouching) acc *= 0.85;
    if (!p.grounded) acc *= 0.8;
    if (!this.canSee) acc = 0;
    const pe = p.eyePosition();
    pe.y -= 0.35;
    if (Math.random() < acc) {
      p.takeDamage(c.damage * m.diff.enemyDmg, this.pos);
      m.effects.tracer(muzzle, pe, 0xff9070, 1.3);
    } else {
      // fallo: la bala pasa cerca e impacta detrás
      const miss = pe.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2.2, (Math.random() - 0.3) * 1.4, (Math.random() - 0.5) * 2.2));
      const dir = miss.clone().sub(muzzle).normalize();
      const hit = m.world.raycast(muzzle, dir, 80);
      const end = muzzle.clone().addScaledVector(dir, hit ? hit.t : 80);
      m.effects.tracer(muzzle, end, 0xff9070, 1.3);
      if (hit) {
        m.effects.impact(end, hit.normal, hit.box.material || 'concrete');
        if (end.distanceTo(p.pos) < 4) m.audio.impact('concrete', end.distanceTo(p.pos), 0);
      }
    }
  }

  animate(dt, aimAt) {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.walkPhase += dt * sp * 2.4;
    const swing = Math.min(1, sp / 3) * 0.65;
    const s = Math.sin(this.walkPhase);
    this.legs[0].hip.rotation.x = s * swing;
    this.legs[1].hip.rotation.x = -s * swing;
    this.legs[0].knee.rotation.x = Math.max(0, -s) * swing * 1.2;
    this.legs[1].knee.rotation.x = Math.max(0, s) * swing * 1.2;
    this.root.position.set(this.pos.x, this.pos.y + Math.abs(Math.cos(this.walkPhase)) * 0.04 * swing, this.pos.z);
    this.root.rotation.y = this.yaw;
    this.flinch = Math.max(0, this.flinch - dt * 4);
    this.torso.rotation.x = this.flinch * 0.35 + (this.type === 'rusher' ? 0.25 * Math.min(1, sp / 4) : 0);

    // apuntar con el torso/cabeza en vertical
    if (aimAt) {
      const dy = (aimAt.pos.y + 1.2) - (this.pos.y + 1.4);
      const dh = Math.hypot(aimAt.pos.x - this.pos.x, aimAt.pos.z - this.pos.z);
      this.torso.rotation.x += -Math.atan2(dy, dh) * 0.8;
    }

    if (this.cfg.ranged) {
      this.recoil = Math.max(0, (this.recoil || 0) - dt * 10);
      this.gun.position.z = -0.32 + this.recoil * 0.06;
      this.armR.rotation.x = -1.25 + this.recoil * 0.15;
    } else {
      // brazos: carrera o golpe
      const atk = this.winding ? 1 - this.windT / this.cfg.meleeWindup : 0;
      this.armR.rotation.x = this.winding ? -2.6 * atk : -s * swing * 0.9 - 0.2;
      this.armL.rotation.x = this.winding ? -2.2 * atk : s * swing * 0.9 - 0.2;
    }

    // destello de impacto
    if (this.flashT > 0) {
      this.flashT -= dt;
      const k = Math.max(0, this.flashT / 0.12);
      for (const mt of this.mats) mt.emissive.setRGB(k * 0.9, k * 0.15, k * 0.1);
    }
    // telegrafía del disparo
    const vm = visorMats[this.type];
    void vm;
  }

  updateDeath(dt) {
    this.deathT += dt;
    const t = Math.min(1, this.deathT / 0.55);
    const e = 1 - Math.pow(1 - t, 3);
    // caída en la dirección del impacto
    const fallYaw = this.deathDir - this.yaw;
    this.model.rotation.set(Math.cos(fallYaw) * e * 1.5, 0, -Math.sin(fallYaw) * e * 1.5);
    this.model.position.y = -e * 0.1;
    this.legs[0].hip.rotation.x = e * 0.3; this.legs[1].hip.rotation.x = -e * 0.2;
    this.armL.rotation.x = -0.5 * e; this.armR.rotation.x = -0.3 * e;
    if (this.deathT > 3) this.root.position.y -= dt * 0.5;
    return this.deathT > 4.5;
  }

  dispose() {
    this.mgr.scene.remove(this.root);
    for (const m of this.mats) m.dispose();
  }
}
