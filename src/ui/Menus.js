// Menús: principal, dificultad, opciones, controles, pausa y fin de partida.
import { DIFFICULTY, QUALITY } from '../config.js';

const $ = (id) => document.getElementById(id);
const BEST_KEY = 'strikezone.best.v1';

export class Menus {
  constructor(game) {
    this.game = game;
    this.screens = ['menu-main', 'menu-options', 'menu-controls', 'menu-pause', 'menu-end'];
    this.current = null;
    this.optionsReturn = 'menu-main';
    this.bindMain();
    this.bindOptions();
    this.bindPause();
    this.bindEnd();
    document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { this.click(); this.open(b.dataset.back); }));
    this.refreshBest();
  }

  click() { this.game.audio.ui(); }

  open(id) {
    for (const s of this.screens) $(s).classList.toggle('hidden', s !== id);
    $('overlay').classList.toggle('hidden', !id);
    this.current = id;
  }

  close() { this.open(null); }

  bindMain() {
    const s = this.game.settings;
    const diffBtns = [...document.querySelectorAll('#diff-select button')];
    const setDiff = (k) => {
      s.set('difficulty', k);
      diffBtns.forEach((b) => b.classList.toggle('active', b.dataset.diff === k));
      $('diff-desc').textContent = {
        facil: 'Enemigos menos precisos y resistentes. Regeneración rápida.',
        normal: 'Experiencia equilibrada. La recomendada.',
        dificil: 'Enemigos letales, reacciones rápidas y más hostiles por oleada.',
      }[k];
      this.refreshBest();
    };
    diffBtns.forEach((b) => b.addEventListener('click', () => { this.click(); setDiff(b.dataset.diff); }));
    setDiff(s.get('difficulty') in DIFFICULTY ? s.get('difficulty') : 'normal');
    $('btn-play').addEventListener('click', () => { this.click(); this.game.startMatch(); });
    $('btn-options').addEventListener('click', () => { this.click(); this.optionsReturn = 'menu-main'; this.open('menu-options'); });
    $('btn-controls').addEventListener('click', () => { this.click(); this.open('menu-controls'); });
  }

  bindOptions() {
    const g = this.game, s = g.settings;
    const qBtns = [...document.querySelectorAll('#quality-select button')];
    const setQ = (k) => {
      s.set('quality', k);
      qBtns.forEach((b) => b.classList.toggle('active', b.dataset.q === k));
      g.applyQuality();
    };
    qBtns.forEach((b) => b.addEventListener('click', () => { this.click(); setQ(b.dataset.q); }));
    qBtns.forEach((b) => b.classList.toggle('active', b.dataset.q === s.get('quality')));
    if (!(s.get('quality') in QUALITY)) s.set('quality', 'medio');

    const slider = (id, key, fmt, apply) => {
      const el = $(id), out = $(id + '-val');
      el.value = s.get(key);
      out.textContent = fmt(+el.value);
      el.addEventListener('input', () => { s.set(key, +el.value); out.textContent = fmt(+el.value); apply(+el.value); });
    };
    slider('opt-sens', 'sensitivity', (v) => v.toFixed(2), (v) => { g.player.sensitivity = v; });
    slider('opt-fov', 'fov', (v) => `${v}°`, () => {});
    slider('opt-vol', 'volume', (v) => `${Math.round(v * 100)}%`, (v) => g.audio.setVolume(v));

    const toggle = (id, key, apply) => {
      const el = $(id);
      el.checked = !!s.get(key);
      el.addEventListener('change', () => { s.set(key, el.checked); apply(el.checked); this.click(); });
    };
    toggle('opt-music', 'music', (v) => g.audio.setMusic(v));
    toggle('opt-fps', 'showFps', () => {});
    $('btn-options-back').addEventListener('click', () => { this.click(); this.open(this.optionsReturn); });
  }

  bindPause() {
    $('btn-resume').addEventListener('click', () => { this.click(); this.game.resume(); });
    $('btn-pause-options').addEventListener('click', () => { this.click(); this.optionsReturn = 'menu-pause'; this.open('menu-options'); });
    $('btn-restart').addEventListener('click', () => { this.click(); this.game.startMatch(); });
    $('btn-quit').addEventListener('click', () => { this.click(); this.game.toMenu(); });
  }

  bindEnd() {
    $('btn-again').addEventListener('click', () => { this.click(); this.game.startMatch(); });
    $('btn-end-menu').addEventListener('click', () => { this.click(); this.game.toMenu(); });
  }

  loadBest() {
    try { return JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch { return {}; }
  }

  saveBest(diff, score) {
    const b = this.loadBest();
    const isNew = !b[diff] || score > b[diff];
    if (isNew) { b[diff] = score; try { localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch { /* ignorar */ } }
    this.refreshBest();
    return isNew;
  }

  refreshBest() {
    const b = this.loadBest();
    const d = this.game.settings.get('difficulty');
    $('best-score').textContent = b[d] ? `Récord (${DIFFICULTY[d].label}): ${b[d].toLocaleString('es')}` : 'Sin récord en esta dificultad';
  }

  showPause(lockFailed = false) {
    $('pause-hint').textContent = lockFailed ? 'Haz clic en CONTINUAR de nuevo para capturar el ratón.' : '';
    this.open('menu-pause');
  }

  showEnd(win, st) {
    $('end-title').textContent = win ? 'VICTORIA' : 'HAS CAÍDO';
    $('end-title').className = win ? 'win' : 'lose';
    $('end-sub').textContent = win ? `Has sobrevivido a las ${st.totalWaves} oleadas` : `Eliminado en la oleada ${st.wave} de ${st.totalWaves}`;
    const isNew = this.saveBest(st.diffKey, st.score);
    const acc = st.shots ? Math.round((st.hits / st.shots) * 100) : 0;
    const mins = Math.floor(st.time / 60), secs = Math.floor(st.time % 60);
    $('end-stats').innerHTML = [
      ['Puntuación', st.score.toLocaleString('es') + (isNew ? ' <em>¡NUEVO RÉCORD!</em>' : '')],
      ['Bajas', st.kills],
      ['Disparos a la cabeza', st.heads],
      ['Precisión', `${acc}%`],
      ['Oleada alcanzada', `${st.wave} / ${st.totalWaves}`],
      ['Dificultad', DIFFICULTY[st.diffKey].label],
      ['Tiempo', `${mins}:${String(secs).padStart(2, '0')}`],
    ].map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');
    this.open('menu-end');
  }
}
