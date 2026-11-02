// Motor de audio sintetizado con Web Audio API (sin archivos externos).
// Disparos, recargas, pasos, impactos, explosiones, IA y música ambiental.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.musicOn = true;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.musicGain = c.createGain(); this.musicGain.gain.value = 0; this.musicGain.connect(this.master);
    // buffers de ruido
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.brown = c.createBuffer(1, len, c.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    // reverb corta (impulso sintético)
    this.reverb = c.createConvolver();
    const ir = c.createBuffer(2, Math.round(c.sampleRate * 0.9), c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
    }
    this.reverb.buffer = ir;
    this.revGain = c.createGain(); this.revGain.gain.value = 0.22;
    this.reverb.connect(this.revGain).connect(this.master);
    this.startMusic();
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  setMusic(on) {
    this.musicOn = on;
    if (!this.musicGain) return;
    const t = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(t);
    this.musicGain.gain.setTargetAtTime(on ? 0.16 : 0, t, 0.5);
    clearTimeout(this._musicStop);
    if (on) this._startPad();
    // con la música apagada se detienen los osciladores (no consumen CPU)
    else this._musicStop = setTimeout(() => this._stopPad(), 2500);
  }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  // Nodo de salida con paneo y atenuación por distancia
  _out(gain = 1, pan = 0, rev = 0.3) {
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = gain;
    const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p); p.connect(this.sfx);
    if (rev > 0) { const r = c.createGain(); r.gain.value = rev; p.connect(r); r.connect(this.reverb); }
    return g;
  }

  _noise(dest, t, dur, type, freq, q = 1, vol = 1, attack = 0.001, buffer = null) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = buffer || this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    return f;
  }

  _tone(dest, t, dur, type, f0, f1, vol = 1) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // dist en metros, pan -1..1
  shot(kind, dist = 0, pan = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const att = 1 / (1 + dist * 0.09);
    const far = dist > 20;
    const out = this._out(att, pan, 0.25 + Math.min(0.5, dist * 0.01));
    if (kind === 'rifle' || kind === 'enemy' || kind === 'heavy') {
      this._noise(out, t, 0.16, 'lowpass', far ? 1800 : 5200, 0.7, 0.9);
      this._noise(out, t, 0.05, 'highpass', 2500, 0.5, far ? 0.15 : 0.5);
      this._tone(out, t, 0.12, 'sine', 160, 45, 0.9);
      this._noise(out, t + 0.02, 0.35, 'lowpass', 600, 0.5, 0.25, 0.01, this.brown);
    } else if (kind === 'pistol') {
      this._noise(out, t, 0.13, 'lowpass', 4200, 0.8, 0.8);
      this._noise(out, t, 0.04, 'highpass', 3200, 0.5, 0.45);
      this._tone(out, t, 0.09, 'sine', 220, 60, 0.7);
    } else if (kind === 'shotgun') {
      this._noise(out, t, 0.32, 'lowpass', 3000, 0.6, 1.0);
      this._noise(out, t, 0.06, 'highpass', 2000, 0.5, 0.6);
      this._tone(out, t, 0.22, 'sine', 120, 35, 1.0);
      this._noise(out, t + 0.03, 0.6, 'lowpass', 420, 0.5, 0.45, 0.01, this.brown);
    }
  }

  // Acción mecánica (recarga, bombeo, cambio de arma)
  mech(kind = 'click', pitch = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.5, 0, 0.05);
    if (kind === 'magout') { this._noise(out, t, 0.06, 'bandpass', 1800 * pitch, 3, 0.6); this._tone(out, t, 0.05, 'square', 600, 300, 0.08); }
    else if (kind === 'magin') { this._noise(out, t, 0.05, 'bandpass', 2600 * pitch, 4, 0.8); this._noise(out, t + 0.04, 0.04, 'bandpass', 3800, 5, 0.5); }
    else if (kind === 'bolt') { this._noise(out, t, 0.04, 'bandpass', 3000 * pitch, 4, 0.7); this._noise(out, t + 0.09, 0.05, 'bandpass', 2200 * pitch, 4, 0.8); }
    else if (kind === 'shell') { this._noise(out, t, 0.05, 'bandpass', 1500, 3, 0.6); this._tone(out, t + 0.02, 0.04, 'triangle', 900, 700, 0.12); }
    else if (kind === 'pump') { this._noise(out, t, 0.07, 'bandpass', 1200, 2, 0.8); this._noise(out, t + 0.14, 0.07, 'bandpass', 1600, 2, 0.9); }
    else if (kind === 'empty') { this._noise(out, t, 0.03, 'bandpass', 4000, 6, 0.5); }
    else if (kind === 'switch') { this._noise(out, t, 0.08, 'bandpass', 900, 1.5, 0.35); }
    else { this._noise(out, t, 0.03, 'bandpass', 3500 * pitch, 5, 0.5); }
  }

  footstep(surface = 'concrete', vol = 0.3, pan = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(vol, pan, 0.05);
    const f = surface === 'metal' ? 900 : surface === 'wood' ? 500 : 380;
    this._noise(out, t, 0.09, 'lowpass', f * (0.9 + Math.random() * 0.2), 1, 0.6, 0.004, this.brown);
    this._noise(out, t, 0.04, 'bandpass', 2400, 2, surface === 'metal' ? 0.35 : 0.12);
    if (surface === 'metal') this._tone(out, t, 0.08, 'triangle', 340, 300, 0.05);
  }

  impact(surface = 'concrete', dist = 5, pan = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.5 / (1 + dist * 0.15), pan, 0.1);
    if (surface === 'metal') { this._tone(out, t, 0.15, 'triangle', 1800 + Math.random() * 900, 1200, 0.25); this._noise(out, t, 0.05, 'highpass', 3000, 1, 0.5); }
    else if (surface === 'wood') this._noise(out, t, 0.07, 'bandpass', 700, 2, 0.8);
    else if (surface === 'flesh') { this._noise(out, t, 0.08, 'lowpass', 900, 1, 0.9, 0.002, this.brown); }
    else this._noise(out, t, 0.06, 'bandpass', 1500, 1.5, 0.7);
  }

  hitmarker(head = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.35, 0, 0);
    this._tone(out, t, 0.05, 'square', head ? 2400 : 1600, head ? 2200 : 1400, 0.12);
    if (head) this._tone(out, t + 0.03, 0.08, 'sine', 3200, 3000, 0.15);
  }

  kill() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.4, 0, 0.1);
    this._tone(out, t, 0.09, 'triangle', 880, 860, 0.25);
    this._tone(out, t + 0.07, 0.16, 'triangle', 1320, 1300, 0.22);
  }

  hurt() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.6, 0, 0);
    this._noise(out, t, 0.18, 'lowpass', 500, 1, 0.9, 0.003, this.brown);
    this._tone(out, t, 0.15, 'sawtooth', 120, 70, 0.12);
  }

  explosion(dist = 5, pan = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(1.4 / (1 + dist * 0.06), pan, 0.6);
    this._noise(out, t, 1.6, 'lowpass', 900, 0.7, 1.0, 0.005, this.brown);
    this._noise(out, t, 0.5, 'lowpass', 3000, 0.5, 0.8);
    this._tone(out, t, 0.9, 'sine', 90, 25, 1.2);
  }

  enemyMelee(dist, pan) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.6 / (1 + dist * 0.1), pan, 0.1);
    this._noise(out, t, 0.12, 'bandpass', 800, 1.5, 0.7);
    this._tone(out, t, 0.1, 'sine', 140, 60, 0.5);
  }

  enemyAlert(dist, pan) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.35 / (1 + dist * 0.05), pan, 0.3);
    this._tone(out, t, 0.12, 'square', 520, 500, 0.08);
    this._tone(out, t + 0.13, 0.12, 'square', 760, 740, 0.08);
  }

  enemyDeath(dist, pan) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.5 / (1 + dist * 0.06), pan, 0.3);
    this._tone(out, t, 0.5, 'sawtooth', 300, 40, 0.12);
    this._noise(out, t, 0.3, 'bandpass', 1200, 2, 0.4);
  }

  pickup(type) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.4, 0, 0.1);
    const base = type === 'health' ? 660 : 520;
    [0, 0.07, 0.14].forEach((d, i) => this._tone(out, t + d, 0.12, 'triangle', base * (1 + i * 0.25), base * (1 + i * 0.25), 0.2));
  }

  wave(start = true) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.5, 0, 0.5);
    const notes = start ? [220, 277, 330, 440] : [440, 554, 659, 880];
    notes.forEach((f, i) => this._tone(out, t + i * 0.12, 0.5, 'sawtooth', f, f, 0.07));
  }

  ui() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(0.25, 0, 0);
    this._tone(out, t, 0.05, 'sine', 1200, 1000, 0.2);
  }

  // Música ambiental: pad oscuro con LFO y pulso grave
  startMusic() {
    const c = this.ctx;
    this.musicFilter = c.createBiquadFilter();
    this.musicFilter.type = 'lowpass'; this.musicFilter.frequency.value = 600; this.musicFilter.Q.value = 2;
    this.musicFilter.connect(this.musicGain);
    this.padNodes = null;
    // pulso
    const pulse = () => {
      if (!this.ctx) return;
      const t = c.currentTime;
      if (this.musicOn && c.state === 'running') {
        const g = c.createGain(); g.connect(this.musicGain);
        this._tone(g, t, 0.35, 'sine', 55, 40, 0.9);
        this._tone(g, t + 0.5, 0.35, 'sine', 55, 40, 0.6);
      }
      this._pulseTimer = setTimeout(pulse, 2000);
    };
    pulse();
    this.setMusic(this.musicOn);
  }

  _startPad() {
    if (this.padNodes || !this.ctx) return;
    const c = this.ctx, nodes = [];
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = c.createGain(); lfoG.gain.value = 380;
    lfo.connect(lfoG).connect(this.musicFilter.frequency); lfo.start();
    nodes.push(lfo);
    const freqs = [55, 82.4, 110.0, 130.8];
    freqs.forEach((f, i) => {
      for (const det of [-6, 6]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det + i;
        const g = c.createGain(); g.gain.value = 0.12 / (i + 1);
        o.connect(g).connect(this.musicFilter); o.start();
        nodes.push(o);
      }
    });
    this.padNodes = nodes;
  }

  _stopPad() {
    if (!this.padNodes) return;
    for (const o of this.padNodes) { try { o.stop(); o.disconnect(); } catch { /* ya detenido */ } }
    this.padNodes = null;
  }
}
