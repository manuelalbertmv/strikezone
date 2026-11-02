// Ajustes persistentes del jugador (localStorage con tolerancia a fallos).
const KEY = 'strikezone.settings.v1';

const DEFAULTS = {
  difficulty: 'normal',
  quality: 'medio',
  sensitivity: 1.0,
  volume: 0.8,
  music: true,
  fov: 75,
  showFps: false,
};

export class Settings {
  constructor() {
    this.data = { ...DEFAULTS };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch { /* almacenamiento no disponible */ }
  }
  get(k) { return this.data[k]; }
  set(k, v) {
    this.data[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignorar */ }
  }
}
