// HUD: mira dinámica, marcadores de impacto, indicadores de daño direccional,
// salud, munición, armas, recarga, oleada, puntuación, radar y mensajes.
import { WEAPONS } from '../weapons/WeaponData.js';
import { MAP_HALF } from '../world/Level.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = $('hud');
    this.cross = $('crosshair');
    this.crossLines = [...this.cross.querySelectorAll('.ch')];
    this.hit = $('hitmarker');
    this.healthFill = $('health-fill');
    this.healthNum = $('health-num');
    this.ammoMag = $('ammo-mag');
    this.ammoRes = $('ammo-res');
    this.weaponName = $('weapon-name');
    this.slots = [...document.querySelectorAll('#weapon-slots .slot')];
    this.reloadBox = $('reload');
    this.reloadFill = $('reload-fill');
    this.waveLabel = $('wave-label');
    this.waveSub = $('wave-sub');
    this.score = $('score');
    this.kills = $('kills');
    this.feed = $('killfeed');
    this.msg = $('center-msg');
    this.bannerEl = $('banner');
    this.vignette = $('vignette');
    this.dmgFlash = $('damage-flash');
    this.indicators = $('dmg-indicators');
    this.lowAmmo = $('low-ammo');
    this.fps = $('fps');
    this.popups = $('popups');
    this.radar = $('radar');
    this.rctx = this.radar.getContext('2d');
    this.hitT = 0; this.msgT = 0; this.bannerT = 0;
    this.dmgList = [];
    this.fpsAcc = 0; this.fpsFrames = 0;
    this.last = {};
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  reset() {
    this.feed.innerHTML = '';
    this.indicators.innerHTML = '';
    this.popups.innerHTML = '';
    this.dmgList = [];
    this.bannerEl.classList.remove('show');
    this.msg.classList.remove('show');
    this.last = {};
  }

  // Pre-renderiza el plano del mapa para el radar
  buildRadarMap(world) {
    const S = 6; // px por metro
    const size = Math.ceil(MAP_HALF * 2 * S) + 20;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(20,26,30,0.9)';
    ctx.fillRect(0, 0, size, size);
    const off = size / 2;
    const boxes = world.boxes.filter((b) => b.active && b.max.y > 0.6 && b.min.y < 2.5 && (b.max.x - b.min.x) < 60);
    boxes.sort((a, b) => a.max.y - b.max.y);
    for (const b of boxes) {
      const h = Math.min(1, b.max.y / 5);
      const l = 70 + h * 80;
      ctx.fillStyle = `rgb(${l * 0.8},${l * 0.9},${l})`;
      ctx.fillRect(off + b.min.x * S, off + b.min.z * S, Math.max(1, (b.max.x - b.min.x) * S), Math.max(1, (b.max.z - b.min.z) * S));
    }
    this.radarMap = c; this.radarScale = S; this.radarOff = off;
  }

  hitmarker(head, kill) {
    this.hit.className = 'show' + (head ? ' head' : '') + (kill ? ' kill' : '');
    this.hitT = kill ? 0.32 : 0.16;
  }

  flash(text, dur = 1.2) {
    this.msg.textContent = text;
    this.msg.classList.add('show');
    this.msgT = dur;
  }

  banner(title, sub = '') {
    this.bannerEl.querySelector('.b-title').textContent = title;
    this.bannerEl.querySelector('.b-sub').textContent = sub;
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
    this.bannerT = 3.2;
  }

  pickup(text, type) { this.popup(text, type === 'health' ? 'pop-health' : 'pop-ammo'); }

  popup(text, cls = '') {
    const d = document.createElement('div');
    d.className = 'popup ' + cls;
    d.textContent = text;
    this.popups.appendChild(d);
    setTimeout(() => d.remove(), 1400);
  }

  killfeed(name, head, points, how = '') {
    const d = document.createElement('div');
    d.className = 'kf' + (head ? ' head' : '');
    d.innerHTML = `<span class="kf-icon">${head ? '◎' : '✕'}</span><span>${name}</span>${how ? `<span class="kf-how">${how}</span>` : ''}<span class="kf-pts">+${points}</span>`;
    this.feed.prepend(d);
    while (this.feed.children.length > 5) this.feed.lastChild.remove();
    setTimeout(() => d.classList.add('fade'), 3500);
    setTimeout(() => d.remove(), 4200);
  }

  damage(fromPos) {
    this.dmgFlash.classList.remove('on'); void this.dmgFlash.offsetWidth; this.dmgFlash.classList.add('on');
    if (!fromPos) return;
    const el = document.createElement('div');
    el.className = 'dmg-ind';
    this.indicators.appendChild(el);
    this.dmgList.push({ el, x: fromPos.x, z: fromPos.z, t: 1.4 });
  }

  _set(key, el, val, prop = 'textContent') {
    if (this.last[key] === val) return;
    this.last[key] = val;
    el[prop] = val;
  }

  update(dt) {
    const g = this.game, p = g.player, w = g.weapons;
    const def = w.def, a = w.ammo;

    // Mira dinámica según la dispersión real
    const fovRad = g.camera.fov * Math.PI / 180;
    const pxPerRad = (window.innerHeight / 2) / Math.tan(fovRad / 2);
    const gap = Math.min(90, 5 + w.spread() * pxPerRad);
    const hideCross = w.adsT > 0.55 || p.sprinting || !p.alive;
    this.cross.style.opacity = hideCross ? 0 : 1;
    this.crossLines[0].style.transform = `translate(-50%, calc(-100% - ${gap}px))`;
    this.crossLines[1].style.transform = `translate(-50%, ${gap}px)`;
    this.crossLines[2].style.transform = `translate(calc(-100% - ${gap}px), -50%)`;
    this.crossLines[3].style.transform = `translate(${gap}px, -50%)`;
    this.cross.classList.toggle('shotgun', def.id === 'shotgun');

    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) this.hit.className = ''; }
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.msg.classList.remove('show'); }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.bannerEl.classList.remove('show'); }

    // Salud
    const hp = Math.ceil(p.health);
    this._set('hp', this.healthNum, String(hp));
    this.healthFill.style.width = `${p.health}%`;
    this.healthFill.classList.toggle('low', p.health < 35);
    const low = Math.max(0, 1 - p.health / 60);
    this.vignette.style.opacity = (low * 0.85).toFixed(3);

    // Munición y arma
    this._set('mag', this.ammoMag, String(a.mag));
    this._set('res', this.ammoRes, String(a.reserve));
    this.ammoMag.classList.toggle('empty', a.mag === 0);
    this.ammoMag.classList.toggle('low', a.mag > 0 && a.mag <= Math.ceil(def.mag * 0.25));
    this._set('wname', this.weaponName, def.name);
    const cur = w.switching === 1 ? w.pending : w.current;
    this.slots.forEach((s, i) => {
      s.classList.toggle('active', i === cur);
      const st = w.state[i];
      s.querySelector('.slot-ammo').textContent = `${st.mag}/${st.reserve}`;
    });
    const needReload = !w.reloading && a.mag <= Math.ceil(def.mag * 0.25);
    this.lowAmmo.textContent = a.mag === 0 && a.reserve === 0 ? 'SIN MUNICIÓN — CAMBIA DE ARMA' : 'PULSA [R] PARA RECARGAR';
    this.lowAmmo.classList.toggle('show', needReload && p.alive && (a.reserve > 0 || a.mag === 0));

    // Recarga
    this.reloadBox.classList.toggle('show', w.reloading);
    if (w.reloading) this.reloadFill.style.width = `${(w.reloadProgress() * 100).toFixed(1)}%`;

    // Oleada / marcador
    const wd = g.waves;
    if (wd.state === 'prep' || wd.state === 'intermission') {
      this._set('wl', this.waveLabel, wd.state === 'prep' ? 'PREPÁRATE' : `OLEADA ${wd.wave + 1} / ${wd.total}`);
      this._set('ws', this.waveSub, `Comienza en ${Math.ceil(wd.timer)}`);
    } else {
      this._set('wl', this.waveLabel, `OLEADA ${wd.wave} / ${wd.total}`);
      this._set('ws', this.waveSub, `Hostiles restantes: ${wd.remaining}`);
    }
    this._set('score', this.score, g.score.toLocaleString('es'));
    this._set('kills', this.kills, String(g.stats.kills));

    // Indicadores de daño
    for (let i = this.dmgList.length - 1; i >= 0; i--) {
      const d = this.dmgList[i];
      d.t -= dt;
      if (d.t <= 0) { d.el.remove(); this.dmgList.splice(i, 1); continue; }
      const dx = d.x - p.pos.x, dz = d.z - p.pos.z;
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      const ang = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
      d.el.style.transform = `translate(-50%,-50%) rotate(${ang}rad)`;
      d.el.style.opacity = Math.min(1, d.t * 1.5).toFixed(2);
    }

    // el radar se redibuja a ~20 Hz: suficiente y mucho más barato
    this.radarT = (this.radarT || 0) - dt;
    if (this.radarT <= 0) { this.radarT = 0.05; this.drawRadar(); }

    // FPS
    if (g.settings.get('showFps')) {
      this.fpsAcc += dt; this.fpsFrames++;
      if (this.fpsAcc > 0.5) {
        this.fps.textContent = `${Math.round(this.fpsFrames / this.fpsAcc)} FPS`;
        this.fpsAcc = 0; this.fpsFrames = 0;
      }
      this.fps.style.display = 'block';
    } else this.fps.style.display = 'none';
  }

  drawRadar() {
    const g = this.game, p = g.player;
    const ctx = this.rctx, R = this.radar.width / 2;
    const range = 32;
    const k = R / range; // px de radar por metro
    ctx.clearRect(0, 0, R * 2, R * 2);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(10,14,16,0.75)'; ctx.fillRect(0, 0, R * 2, R * 2);
    ctx.translate(R, R);
    ctx.rotate(p.yaw);
    const s = k / this.radarScale;
    if (this.radarMap) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(this.radarMap, -(this.radarOff + p.pos.x * this.radarScale) * s, -(this.radarOff + p.pos.z * this.radarScale) * s, this.radarMap.width * s, this.radarMap.height * s);
      ctx.globalAlpha = 1;
    }
    // suministros
    for (const it of g.pickups.items) {
      if (!it.active) continue;
      const x = (it.pos.x - p.pos.x) * k, z = (it.pos.z - p.pos.z) * k;
      if (x * x + z * z > R * R) continue;
      ctx.fillStyle = it.type === 'health' ? '#ff6060' : '#ffd040';
      ctx.fillRect(x - 2.5, z - 2.5, 5, 5);
    }
    // enemigos
    const t = performance.now() / 1000;
    for (const e of g.enemies.enemies) {
      if (!e.alive) continue;
      let x = (e.pos.x - p.pos.x) * k, z = (e.pos.z - p.pos.z) * k;
      const d = Math.hypot(x, z);
      const edge = d > R - 6;
      if (edge) { x *= (R - 6) / d; z *= (R - 6) / d; }
      ctx.fillStyle = e.canSee ? '#ff3b30' : 'rgba(255,90,70,0.7)';
      ctx.beginPath(); ctx.arc(x, z, edge ? 2.5 : (e.type === 'heavy' ? 4.5 : 3.5) + (e.canSee ? Math.sin(t * 10) * 0.8 : 0), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // jugador (flecha fija hacia arriba) + cono de visión
    ctx.save();
    ctx.translate(R, R);
    const half = (g.camera.fov * (this.radar.width / this.radar.height)) * Math.PI / 360;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, -Math.PI / 2 - half, -Math.PI / 2 + half); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.stroke();
  }
}

export { WEAPONS };
