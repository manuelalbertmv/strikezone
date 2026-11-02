// Director de oleadas: composición, cola de aparición, límite de enemigos
// simultáneos, pausas entre oleadas y progresión de dificultad.
import { WAVES, MAX_ALIVE, INTERMISSION } from '../config.js';

export class WaveDirector {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  get total() { return WAVES.length; }

  reset() {
    this.wave = 0;           // 1..N mientras se juega
    this.state = 'prep';     // prep | active | intermission | done
    this.timer = 4;          // cuenta atrás inicial
    this.queue = [];
    this.spawnT = 0;
    this.waveKills = 0;
    this.waveSize = 0;
  }

  // Dificultad escalada por oleada
  diffFor(wave) {
    const d = this.game.diff;
    const k = wave - 1;
    return {
      ...d,
      enemyHp: d.enemyHp * (1 + 0.07 * k),
      enemyDmg: d.enemyDmg * (1 + 0.05 * k),
      accuracy: Math.min(0.93, d.accuracy + 0.025 * k),
      reaction: d.reaction * Math.pow(0.95, k),
      speedMul: d.speedMul * (1 + 0.02 * k),
    };
  }

  startWave() {
    this.wave++;
    const comp = WAVES[this.wave - 1];
    const mul = this.game.diff.countMul;
    const q = [];
    const n = (x) => Math.max(x > 0 ? 1 : 0, Math.round(x * mul));
    for (let i = 0; i < n(comp.g); i++) q.push('grunt');
    for (let i = 0; i < n(comp.r); i++) q.push('rusher');
    for (let i = 0; i < n(comp.h); i++) q.push('heavy');
    // mezclar sin dejar los pesados al principio
    for (let i = q.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [q[i], q[j]] = [q[j], q[i]]; }
    this.queue = q;
    this.waveSize = q.length;
    this.waveKills = 0;
    this.spawnT = 0.5;
    this.state = 'active';
    this.game.enemies.diff = this.diffFor(this.wave);
    this.game.audio.wave(true);
    this.game.hud.banner(`OLEADA ${this.wave}`, `${this.waveSize} hostiles detectados`);
  }

  get remaining() { return this.queue.length + this.game.enemies.aliveCount; }

  onKill() { this.waveKills++; }

  update(dt) {
    const g = this.game;
    if (this.state === 'prep' || this.state === 'intermission') {
      this.timer -= dt;
      if (this.timer <= 0) this.startWave();
      return;
    }
    if (this.state !== 'active') return;
    // aparición escalonada
    this.spawnT -= dt;
    const maxAlive = Math.round(MAX_ALIVE * (g.diff.countMul > 1 ? 1.15 : 1));
    if (this.queue.length && this.spawnT <= 0 && g.enemies.aliveCount < maxAlive) {
      g.enemies.spawn(this.queue.shift());
      this.spawnT = Math.max(0.6, 1.6 - this.wave * 0.15);
    }
    if (this.queue.length === 0 && g.enemies.aliveCount === 0) {
      // oleada completada
      const bonus = Math.round(500 * this.wave * g.diff.scoreMul);
      g.addScore(bonus);
      g.audio.wave(false);
      if (this.wave >= this.total) {
        this.state = 'done';
        g.victory();
        return;
      }
      g.weapons.addAmmo(0.4);
      g.player.heal(35);
      g.hud.banner(`OLEADA ${this.wave} SUPERADA`, `+${bonus} puntos · munición y salud repuestas`);
      this.state = 'intermission';
      this.timer = INTERMISSION;
    }
  }
}
