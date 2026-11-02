// Gestión de entrada: teclado, ratón, Pointer Lock (con modo alternativo si el
// navegador o un iframe lo bloquean).

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();      // pulsadas este frame
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, wheel: 0 };
    this.locked = false;
    this.fallback = false;          // sin pointer lock: se usa el movimiento del ratón sobre el canvas
    this.enabled = false;
    this.onLockChange = null;

    const prevent = new Set(['Space', 'ControlLeft', 'ControlRight', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyC']);
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (prevent.has(e.code) || (e.ctrlKey && e.code !== 'F5')) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });

    window.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked && !this.fallback) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    window.addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked || this.fallback) {
        // descartar picos anómalos de algunos navegadores
        if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
        this.mouse.dx += e.movementX;
        this.mouse.dy += e.movementY;
      }
    });
    window.addEventListener('wheel', (e) => { if (this.enabled) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });

    this.everLocked = false;
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) { this.everLocked = true; this.fallback = false; }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    // Firefox/Safari avisan mediante evento; Chrome además rechaza la promesa
    document.addEventListener('pointerlockerror', () => { if (!this._requesting) this._lockFailed(); });
    this._requesting = false;
    this._lastFail = 0;
  }

  // Si el navegador nunca ha concedido el bloqueo (iframe sin permiso, etc.)
  // se usa el modo alternativo; si ya funcionó antes, el fallo es temporal
  // (Chrome exige ~1 s entre salir con Esc y volver a capturar).
  _lockFailed() {
    if (document.pointerLockElement === this.canvas) return; // un reintento ya lo consiguió
    const now = performance.now();
    if (now - this._lastFail < 300) return;
    this._lastFail = now;
    if (!this.everLocked) { this.fallback = true; return; }
    if (this.onLockChange) this.onLockChange(false, true);
  }

  // Pide la captura del ratón. Primero con unadjustedMovement (entrada en bruto,
  // sin aceleración del sistema) y, si no está soportado, sin él. Mientras dura
  // la secuencia se ignoran los eventos 'pointerlockerror' intermedios: solo el
  // resultado final decide si la captura ha fallado.
  requestLock() {
    const c = this.canvas;
    if (!c.requestPointerLock) { this.fallback = true; return Promise.resolve(false); }
    const attempt = (opts) => {
      try {
        const p = opts ? c.requestPointerLock(opts) : c.requestPointerLock();
        return p && p.then ? p.then(() => true, () => false) : null;
      } catch { return Promise.resolve(false); }
    };
    this._requesting = true;
    const done = (ok) => {
      this._requesting = false;
      if (!ok) this._lockFailed();
      return ok;
    };
    const first = attempt({ unadjustedMovement: true });
    // API antigua sin promesa: el resultado llega por eventos
    if (!first) { this._requesting = false; return Promise.resolve(true); }
    return first.then((ok) => (ok ? done(true) : (attempt() || Promise.resolve(true)).then(done)));
  }

  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }

  consumeMouse() {
    const d = { dx: this.mouse.dx, dy: this.mouse.dy, wheel: this.mouse.wheel };
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    return d;
  }

  endFrame() { this.pressed.clear(); this.mouse.leftPressed = false; }

  reset() { this.keys.clear(); this.pressed.clear(); this.mouse.left = this.mouse.right = false; this.consumeMouse(); }
}
