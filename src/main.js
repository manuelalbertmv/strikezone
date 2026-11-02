// Punto de entrada: comprueba WebGL, muestra la carga y crea el juego.
import { Game } from './core/Game.js';

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

const loading = document.getElementById('loading');

if (!webglAvailable()) {
  loading.classList.add('hidden');
  document.getElementById('webgl-error').classList.remove('hidden');
} else {
  // dejar que se pinte la pantalla de carga antes de generar texturas y mapa
  requestAnimationFrame(() => setTimeout(() => {
    try {
      const game = new Game(document.getElementById('game'));
      // el audio solo puede arrancar tras un gesto del usuario
      const unlock = () => { game.audio.init(); window.removeEventListener('pointerdown', unlock); };
      window.addEventListener('pointerdown', unlock);
      if (import.meta.env.DEV || location.search.includes('debug')) window.__game = game;
      loading.classList.add('fade');
      setTimeout(() => loading.classList.add('hidden'), 600);
    } catch (err) {
      console.error(err);
      document.getElementById('load-text').textContent = 'Error al iniciar: ' + err.message;
    }
  }, 30));
}
