// Suministros de salud y munición: fijos en el mapa (reaparecen) y soltados
// por los enemigos (temporales).
import * as THREE from 'three';

const RESPAWN = 25;
const DROP_LIFE = 20;

export class Pickups {
  constructor(game) {
    this.game = game;
    this.root = new THREE.Group();
    game.scene.add(this.root);
    this.items = [];
    const crossMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff2a2a, emissiveIntensity: 1.6 });
    this.mats = {
      health: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4, emissive: 0x331111, emissiveIntensity: 0.6 }),
      cross: crossMat,
      ammo: new THREE.MeshStandardMaterial({ color: 0x4d5a32, roughness: 0.6, metalness: 0.3, emissive: 0x111a05 }),
      stripe: new THREE.MeshStandardMaterial({ color: 0xe0b020, emissive: 0xffc020, emissiveIntensity: 1.2 }),
      ring: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }),
    };
    this.geo = {
      box: new THREE.BoxGeometry(0.5, 0.32, 0.36),
      crossA: new THREE.BoxGeometry(0.06, 0.2, 0.2),
      crossB: new THREE.BoxGeometry(0.06, 0.06, 0.2),
      ammo: new THREE.BoxGeometry(0.55, 0.3, 0.3),
      stripe: new THREE.BoxGeometry(0.56, 0.05, 0.31),
      ring: new THREE.RingGeometry(0.42, 0.5, 24),
    };
  }

  makeMesh(type) {
    const g = new THREE.Group();
    const inner = new THREE.Group(); g.add(inner);
    if (type === 'health') {
      inner.add(new THREE.Mesh(this.geo.box, this.mats.health));
      for (const sx of [-1, 1]) {
        const a = new THREE.Mesh(this.geo.crossA, this.mats.cross); a.position.x = sx * 0.23; a.rotation.y = 0; inner.add(a);
        const b = new THREE.Mesh(this.geo.crossA, this.mats.cross); b.position.x = sx * 0.23; b.rotation.x = Math.PI / 2; inner.add(b);
      }
    } else {
      inner.add(new THREE.Mesh(this.geo.ammo, this.mats.ammo));
      const s = new THREE.Mesh(this.geo.stripe, this.mats.stripe); s.position.y = 0.06; inner.add(s);
    }
    inner.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const ring = new THREE.Mesh(this.geo.ring, this.mats.ring.clone());
    ring.material.color.setHex(type === 'health' ? 0xff5050 : 0xffd040);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
    g.add(ring);
    g.userData.inner = inner;
    g.userData.ring = ring;
    return g;
  }

  reset() {
    for (const it of this.items) this.root.remove(it.mesh);
    this.items = [];
    for (const s of this.game.level.pickupSpots) this.add(s.type, new THREE.Vector3(...s.p), false);
  }

  add(type, pos, temporary) {
    const mesh = this.makeMesh(type);
    mesh.position.copy(pos);
    this.root.add(mesh);
    const it = { type, pos: pos.clone(), mesh, active: true, timer: 0, temporary, life: DROP_LIFE, phase: Math.random() * 6 };
    this.items.push(it);
    return it;
  }

  drop(pos) {
    const r = Math.random();
    const p = this.game.player;
    // más probable salud si el jugador va herido
    const healthChance = p.health < 50 ? 0.55 : 0.25;
    if (r < healthChance) this.add('health', new THREE.Vector3(pos.x, 0, pos.z), true);
    else if (r < 0.6) this.add('ammo', new THREE.Vector3(pos.x, 0, pos.z), true);
  }

  update(dt, time) {
    const g = this.game, p = g.player;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (!it.active) {
        it.timer -= dt;
        if (it.timer <= 0) { it.active = true; it.mesh.visible = true; }
        continue;
      }
      if (it.temporary) {
        it.life -= dt;
        it.mesh.visible = it.life > 4 || Math.sin(it.life * 14) > 0; // parpadea antes de desaparecer
        if (it.life <= 0) { this.root.remove(it.mesh); this.items.splice(i, 1); continue; }
      }
      const inner = it.mesh.userData.inner;
      inner.position.y = 0.45 + Math.sin(time * 2.4 + it.phase) * 0.08;
      inner.rotation.y += dt * 1.6;
      const ring = it.mesh.userData.ring;
      ring.material.opacity = 0.25 + Math.sin(time * 4 + it.phase) * 0.12;

      if (!p.alive) continue;
      const dx = p.pos.x - it.pos.x, dz = p.pos.z - it.pos.z, dy = p.pos.y - it.pos.y;
      if (dx * dx + dz * dz < 1.3 * 1.3 && Math.abs(dy) < 1.4) {
        let used = false;
        if (it.type === 'health') {
          if (p.health < 100) { p.heal(50); used = true; g.hud.pickup('+50 SALUD', 'health'); }
        } else {
          g.weapons.addAmmo(0.45); used = true; g.hud.pickup('+MUNICIÓN', 'ammo');
        }
        if (used) {
          g.audio.pickup(it.type);
          if (it.temporary) { this.root.remove(it.mesh); this.items.splice(i, 1); }
          else { it.active = false; it.mesh.visible = false; it.timer = RESPAWN; }
        }
      }
    }
  }
}
