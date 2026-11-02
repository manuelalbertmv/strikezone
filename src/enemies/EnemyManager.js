// Gestor de enemigos: aparición en puntos seguros, actualización de la IA,
// sonidos posicionales (pasos, alertas), lista de mallas impactables y ruido.
import * as THREE from 'three';
import { Enemy } from './Enemy.js';

export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.world = game.world;
    this.nav = game.level.nav;
    this.player = game.player;
    this.audio = game.audio;
    this.effects = game.effects;
    this.diff = null;
    this.time = 0;
    this.enemies = [];
    this.hitMeshes = [];
    this.gunMat = new THREE.MeshStandardMaterial({ color: 0x1e2022, roughness: 0.5, metalness: 0.7 });
    this.bladeMat = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, roughness: 0.25, metalness: 1, emissive: 0x331100, emissiveIntensity: 0.4 });
    this._tmp = new THREE.Vector3();
  }

  get aliveCount() { let n = 0; for (const e of this.enemies) if (e.alive) n++; return n; }

  clear() {
    for (const e of this.enemies) e.dispose();
    this.enemies = [];
    this.hitMeshes = [];
  }

  rebuildHitList() {
    this.hitMeshes = [];
    for (const e of this.enemies) if (e.alive) for (const m of e.hitMeshes) this.hitMeshes.push(m);
  }

  // Elige un punto de aparición lejano y, si es posible, fuera de la vista del jugador
  pickSpawn() {
    const pts = this.game.level.spawnPoints;
    const p = this.player.pos;
    const eye = this.player.eyePosition();
    const scored = pts.map((sp) => {
      const d = Math.hypot(sp.x - p.x, sp.z - p.z);
      let s = d < 20 ? -1000 : Math.min(d, 55);
      const top = this._tmp.set(sp.x, 1.5, sp.z);
      if (this.world.lineOfSight(eye, top)) s -= 40;
      // evitar amontonar enemigos en el mismo punto
      for (const e of this.enemies) if (e.alive && Math.hypot(e.pos.x - sp.x, e.pos.z - sp.z) < 3) s -= 25;
      return { sp, s: s + Math.random() * 15 };
    }).sort((a, b) => b.s - a.s);
    const best = scored[0].sp;
    const cell = this.nav.nearest(best.x, best.z, 10);
    if (!cell) return best.clone();
    const [x, z] = this.nav.cellCenter(cell[0], cell[1]);
    return new THREE.Vector3(x, this.nav.height[this.nav.idx(cell[0], cell[1])] + 0.02, z);
  }

  spawn(type) {
    const pos = this.pickSpawn();
    const e = new Enemy(type, pos, this);
    e.seenOnce = false;
    e.stepPhase = 0;
    this.enemies.push(e);
    this.rebuildHitList();
    this.effects.flash(new THREE.Vector3(pos.x, pos.y + 1, pos.z), 1.6, 0.25);
    return e;
  }

  // Sonido del jugador (disparos) que atrae a enemigos cercanos
  noise(pos, radius) {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(pos);
      if (d < radius) {
        e.lastKnown.copy(pos);
        e.lastSeen = Math.max(e.lastSeen, this.time - 1.5);
        if (e.state === 'idle') e.state = 'chase';
      }
    }
  }

  update(dt) {
    this.time += dt;
    // como mucho 2 búsquedas A* por paso de simulación; el resto espera turno
    this.pathBudget = 2;
    let removed = false;
    const p = this.player;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const wasAlive = e.alive;
      const done = e.update(dt);
      if (wasAlive && !e.alive) removed = true;
      if (!e.alive && done) {
        e.dispose();
        this.enemies.splice(i, 1);
        continue;
      }
      if (!e.alive) continue;
      const dist = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      // alerta al detectar al jugador por primera vez
      if (e.canSee && !e.seenOnce) {
        e.seenOnce = true;
        this.audio.enemyAlert(dist, e.pan());
      }
      // pasos enemigos audibles
      const ph = Math.floor(e.walkPhase / Math.PI);
      if (ph !== e.stepPhase) {
        e.stepPhase = ph;
        if (dist < 20 && Math.hypot(e.vel.x, e.vel.z) > 1) {
          this.audio.footstep('concrete', (e.type === 'heavy' ? 0.35 : 0.2) * (1 - dist / 20), e.pan());
        }
      }
    }
    if (removed) this.rebuildHitList();
  }
}
