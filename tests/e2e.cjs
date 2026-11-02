// Pruebas end-to-end con Playwright (40 comprobaciones).
// Uso: npm run build && npm run preview   (en otra terminal)
//      npm i -D playwright && npx playwright install chromium
//      node tests/e2e.cjs
// Las capturas se guardan en tests/output/.
const { chromium } = require('playwright');
const OUT = require('path').join(__dirname, 'output') + '/';
require('fs').mkdirSync(OUT, { recursive: true });
const URL = process.env.GAME_URL || 'http://localhost:4173/?debug';
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) errors.push('requestfailed: ' + r.url()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.addInitScript(() => { if (!localStorage.getItem('strikezone.settings.v1')) localStorage.setItem('strikezone.settings.v1', JSON.stringify({ quality: 'bajo' })); });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game, null, { timeout: 30000 });
  await sleep(1500);
  const G = (fn, arg) => page.evaluate(fn, arg);
  const frames = (n = 3) => page.evaluate((n) => new Promise((r) => { let i = 0; const f = () => { if (++i >= n) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
  const gwait = async (sec) => { const t0 = await G(() => __game.time); try { await page.waitForFunction((t) => __game.time >= t || __game.state !== 'playing', t0 + sec, { timeout: 180000, polling: 30 }); } catch (e) { throw new Error('gwait: ' + JSON.stringify(await G(() => ({ s: __game.state, t: __game.time, hp: __game.player.health })))); } };

  check('Juego creado y en menú', await G(() => __game.state === 'menu'));
  check('Menú principal visible', await page.isVisible('#menu-main'));
  await page.screenshot({ path: OUT + '01_menu.png' });

  // Opciones y controles
  await page.click('#btn-options');
  check('Panel de opciones abre', await page.isVisible('#menu-options'));
  await page.click('#quality-select button[data-q="alto"]');
  check('Calidad cambia a alta', await G(() => __game.settings.get('quality') === 'alto' && __game.renderer.shadowMap.enabled));
  await page.click('#quality-select button[data-q="bajo"]');
  check('Calidad baja desactiva sombras', await G(() => !__game.renderer.shadowMap.enabled && !__game.level.interiorLights[0].visible));
  await page.click('#quality-select button[data-q="bajo"]');
  await page.click('#btn-options-back');
  await page.click('#btn-controls');
  check('Panel de controles abre', await page.isVisible('#menu-controls'));
  await page.click('#menu-controls [data-back]');
  await page.click('#diff-select button[data-diff="normal"]');

  // Iniciar
  await page.click('#btn-play');
  await sleep(500);
  await G(() => { const a = __game.audio; a.ctx && a.ctx.suspend(); a.resume = () => {}; a.init = () => {}; });
  await G(() => { __game.player._td = __game.player.takeDamage; __game.player.takeDamage = () => {}; });
  const st = await G(() => ({ s: __game.state, fb: __game.input.fallback, locked: __game.input.locked }));
  check('Partida iniciada', st.s === 'playing', JSON.stringify(st));
  check('HUD visible', await page.isVisible('#hud'));

  // Movimiento W (posición y orientación conocidas en zona abierta)
  await G(() => { const g = __game, p = g.player; g.input.mouse.dx = g.input.mouse.dy = 0; p.pos.set(-8, 0, 20); p.vel.set(0, 0, 0); p.yaw = 0; p.pitch = 0; });
  const z0 = await G(() => __game.player.pos.z);
  await page.keyboard.down('KeyW'); await gwait(0.9); await page.keyboard.up('KeyW');
  const z1 = await G(() => __game.player.pos.z);
  check('Movimiento hacia delante (W)', z1 < z0 - 1.5, `z ${z0.toFixed(2)} -> ${z1.toFixed(2)}`);

  // Strafe D
  await G(() => { const g = __game, p = g.player; g.input.mouse.dx = g.input.mouse.dy = 0; p.pos.set(-11, 0, 18); p.vel.set(0, 0, 0); p.yaw = 0; p.pitch = 0; });
  const x0 = await G(() => __game.player.pos.x);
  await page.keyboard.down('KeyD'); await gwait(0.6); await page.keyboard.up('KeyD');
  const x1 = await G(() => __game.player.pos.x);
  check('Movimiento lateral (D)', x1 > x0 + 0.8, `x ${x0.toFixed(2)} -> ${x1.toFixed(2)}`);

  // Salto
  await page.keyboard.press('Space');
  const yJump = await G(() => new Promise((r) => { let m = 0; const t0 = __game.time; const f = () => { m = Math.max(m, __game.player.pos.y); if (__game.time - t0 > 0.5) r(m); else requestAnimationFrame(f); }; f(); }));
  await gwait(1.0);
  const yLand = await G(() => __game.player.pos.y);
  check('Salto (Space)', yJump > 0.3 && yLand < 0.05, `y en salto ${yJump.toFixed(2)}, al aterrizar ${yLand.toFixed(2)}`);

  // Agacharse
  await page.keyboard.down('KeyC'); await gwait(0.4);
  const crouch = await G(() => ({ c: __game.player.crouching, eye: __game.player.eyeHeight }));
  await page.keyboard.up('KeyC'); await gwait(0.4);
  const stand = await G(() => __game.player.eyeHeight);
  check('Agacharse (C) baja la cámara', crouch.c && crouch.eye < 1.2 && stand > 1.5, `eye ${crouch.eye.toFixed(2)} -> ${stand.toFixed(2)}`);
  await page.keyboard.down('ControlLeft'); await gwait(0.3);
  const ctrl = await G(() => __game.player.crouching);
  await page.keyboard.up('ControlLeft'); await gwait(0.3);
  check('Agacharse (Ctrl)', ctrl);

  // Sprint
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await gwait(0.7);
  const spr = await G(() => ({ s: __game.player.sprinting, v: __game.player.speedNow }));
  await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
  check('Correr (Shift)', spr.s && spr.v > 6, `velocidad ${spr.v.toFixed(2)}`);

  // Cámara con ratón
  const yaw0 = await G(() => __game.player.yaw);
  await page.mouse.move(640, 360); await frames(3);
  const yawStart = await G(() => __game.player.yaw);
  for (let i = 0; i < 10; i++) { await page.mouse.move(640 + i * 20, 360 + i * 4); }
  await frames(4);
  const camReal = await G(() => __game.player.yaw);
  console.log('yaw con ratón real de Playwright:', camReal.toFixed(3));
  await G(() => { for (let i = 0; i < 10; i++) window.dispatchEvent(new MouseEvent('mousemove', { movementX: 20, movementY: 4 })); });
  await frames(4);
  const cam1 = await G(() => ({ yaw: __game.player.yaw, pitch: __game.player.pitch }));
  check('Cámara responde al ratón', Math.abs(cam1.yaw - yawStart) > 0.05, `yaw ${yawStart.toFixed(2)} -> ${cam1.yaw.toFixed(2)}, pitch ${cam1.pitch.toFixed(2)}`);

  // Colisión con pared: plataforma central (x -5..5, z -5..5, alto 1.5)
  await G(() => { const p = __game.player; p.pos.set(9, 0, 0); p.vel.set(0, 0, 0); p.yaw = Math.PI / 2; p.pitch = 0; });
  await page.keyboard.down('KeyW'); await gwait(1.5); await page.keyboard.up('KeyW');
  const wx = await G(() => __game.player.pos.x);
  check('Colisión con muro (no atraviesa la plataforma)', wx > 5.2 && wx < 5.6, `x final ${wx.toFixed(3)} (muro en 5.0)`);
  // Escaleras: subir a la plataforma desde el sur
  await G(() => { const p = __game.player; p.pos.set(0, 0, 9); p.vel.set(0, 0, 0); p.yaw = 0; });
  await page.keyboard.down('KeyW'); await gwait(1.8); await page.keyboard.up('KeyW');
  const sy = await G(() => __game.player.pos.y);
  check('Sube escaleras hasta la plataforma', sy > 1.4, `y = ${sy.toFixed(2)}`);

  // Esperar oleada 1
  await page.waitForFunction(() => __game.waves.state === 'active' && __game.enemies.aliveCount > 0, null, { timeout: 15000 });
  check('Oleada 1 comienza y aparecen enemigos', true, `vivos: ${await G(() => __game.enemies.aliveCount)}`);
  // Volver jugador a la plataforma y comprobar que los enemigos se acercan (IA)
  await G(() => { const g = __game, p = g.player; let best = null, bd = -1; for (const c of [[0,1.5,0],[30,0,30],[-30,0,30],[30,0,-30],[-30,0,-30]]) { const m = Math.min(...g.enemies.enemies.filter(e=>e.alive).map(e => Math.hypot(e.pos.x - c[0], e.pos.z - c[2]))); if (m > bd) { bd = m; best = c; } } p.pos.set(...best); if (g.world.overlaps(p.pos, 0.34, 1.75).length) p.pos.set(0, 1.5, 0); p.vel.set(0, 0, 0); p.health = 100; });
  const d0 = await G(() => { const p = __game.player.pos; return __game.enemies.enemies.filter(e=>e.alive).map(e => Math.hypot(e.pos.x - p.x, e.pos.z - p.z)); });
  await gwait(4.0);
  const info = await G(() => { const p = __game.player.pos; return __game.enemies.enemies.filter(e=>e.alive).map(e => ({ d: Math.hypot(e.pos.x - p.x, e.pos.z - p.z), s: e.state, path: e.path ? e.path.length : 0 })); });
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  console.log('estado tras IA', await G(() => __game.state + ' hp ' + __game.player.health.toFixed(0)));
  const closer = info.filter((i, k) => i.d < (d0[k] ?? Infinity) - 2 || i.s === 'attack' || i.s === 'melee').length;
  check('IA: enemigos persiguen al jugador (pathfinding)', closer >= Math.ceil(info.length / 2), `dist media ${avg(d0).toFixed(1)} -> ${avg(info.map(i=>i.d)).toFixed(1)}, estados ${info.map(i=>i.s).join(',')}`);

  // Disparo a un enemigo: colocar al jugador frente a uno y apuntar
  const aimAt = async () => G(() => {
    const g = __game, p = g.player;
    const e = g.enemies.enemies.find((x) => x.alive);
    if (!e) return null;
    // colocar al jugador a 6 m del enemigo con línea de visión libre
    let ok = false;
    for (let k = 0; k < 16 && !ok; k++) {
      const a = k / 16 * Math.PI * 2;
      p.pos.set(e.pos.x + Math.cos(a) * 6, e.pos.y, e.pos.z + Math.sin(a) * 6);
      if (g.world.overlaps(p.pos, 0.34, 1.75).length) continue;
      ok = g.world.lineOfSight({ x: p.pos.x, y: p.pos.y + 1.62, z: p.pos.z }, { x: e.pos.x, y: e.pos.y + 1.3, z: e.pos.z });
    }
    p.vel.set(0,0,0);
    const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, dy = (e.pos.y + 1.3) - (p.pos.y + p.eyeHeight);
    p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    p.recoilPitch = 0; p.recoilYaw = 0;
    e.state = 'idle';
    return { hp: e.hp, id: g.enemies.enemies.indexOf(e) };
  });
  const before = await aimAt();
  const ammo0 = await G(() => __game.weapons.ammo.mag);
  await page.mouse.down(); await gwait(0.25); await page.mouse.up();
  for (let k = 0; k < 4 && (await G(() => __game.weapons.stats.hits)) === 0; k++) { await aimAt(); await page.mouse.down(); await gwait(0.25); await page.mouse.up(); }
  await gwait(0.2);
  const after = await G(() => ({ mag: __game.weapons.ammo.mag, shots: __game.weapons.stats.shots, hits: __game.weapons.stats.hits, hud: document.getElementById('ammo-mag').textContent }));
  check('El arma dispara (munición baja)', after.mag < ammo0 && after.shots > 0, `cargador ${ammo0} -> ${after.mag}, disparos ${after.shots}`);
  check('HUD de munición se actualiza', after.hud === String(after.mag), `HUD="${after.hud}"`);
  check('Los disparos impactan en el enemigo', after.hits > 0, `impactos ${after.hits}`);
  await page.screenshot({ path: OUT + '02_combat.png' });

  // Matar enemigos de la oleada para verificar daño/eliminación/puntos
  let kills = 0, feedMax = 0;
  await G(() => { const h = __game.hud, f = h.killfeed.bind(h); window.__kf = 0; h.killfeed = (...a) => { window.__kf++; f(...a); }; });
  for (let k = 0; k < 40; k++) {
    const t = await aimAt();
    if (!t) break;
    await page.mouse.down(); await gwait(0.4); await page.mouse.up(); await gwait(0.06);
    const m = await G(() => __game.weapons.ammo);
    if (m.mag < 5) { await G(() => { __game.weapons.state[0].mag = 30; __game.weapons.state[0].reserve = 150; }); }
    await G(() => { __game.player.health = 100; });
    kills = await G(() => __game.stats.kills);
    feedMax = Math.max(feedMax, await G(() => Math.max(window.__kf, document.querySelectorAll('.kf').length)));
    if (kills >= 2) break;
  }
  const sc = await G(() => ({ k: __game.stats.kills, s: __game.score, hudK: document.getElementById('kills').textContent, feed: document.querySelectorAll('.kf').length }));
  check('Enemigos reciben daño y mueren', sc.k >= 2, `bajas ${sc.k}`);
  check('Puntuación y contador de bajas en HUD', sc.s > 0 && sc.hudK === String(sc.k) && feedMax > 0, `puntos ${sc.s}, HUD bajas ${sc.hudK}, killfeed ${feedMax}`);

  // Recarga con R
  await G(() => { __game.weapons.state[0].mag = 10; });
  await page.keyboard.press('KeyR'); await gwait(0.1);
  const rl = await G(() => ({ r: __game.weapons.reloading, vis: document.getElementById('reload').classList.contains('show') }));
  await gwait(2.3);
  const rl2 = await G(() => ({ mag: __game.weapons.ammo.mag, res: __game.weapons.ammo.reserve }));
  check('Recarga (R) con indicador', rl.r && rl.vis && rl2.mag === 30, `mag ${rl2.mag}, reserva ${rl2.res}`);

  // Cambio de arma
  await page.keyboard.press('Digit3'); await gwait(0.6);
  const w3 = await G(() => ({ c: __game.weapons.current, n: document.getElementById('weapon-name').textContent }));
  check('Cambio a escopeta (3)', w3.c === 2 && w3.n.includes('ESCOPETA'), w3.n);
  // disparo de escopeta (perdigones)
  const shotsB = await G(() => __game.weapons.ammo.mag);
  await page.mouse.down(); await gwait(0.08); await page.mouse.up(); await gwait(0.3);
  check('Escopeta dispara', (await G(() => __game.weapons.ammo.mag)) === shotsB - 1);
  await page.keyboard.press('Digit2'); await gwait(0.6);
  const w2 = await G(() => __game.weapons.current);
  const pm = await G(() => __game.weapons.ammo.mag);
  await page.mouse.down(); await gwait(0.06); await page.mouse.up(); await gwait(0.2);
  await page.mouse.down(); await gwait(0.06); await page.mouse.up(); await gwait(0.2);
  check('Pistola (2) semiautomática dispara', w2 === 1 && (await G(() => __game.weapons.ammo.mag)) === pm - 2);
  await page.keyboard.press('Digit1'); await gwait(0.6);

  // ADS
  await page.mouse.down({ button: 'right' }); await gwait(0.5);
  const ads = await G(() => ({ a: __game.weapons.adsT, fov: __game.camera.fov }));
  await page.mouse.up({ button: 'right' }); await gwait(0.3);
  check('Apuntar con mira (clic derecho) reduce FOV', ads.a > 0.9 && ads.fov < 60, `adsT ${ads.a.toFixed(2)}, fov ${ads.fov.toFixed(1)}`);

  // Barril explosivo
  const br = await G(() => {
    const g = __game, p = g.player;
    for (const b of g.level.barrels.filter((x) => x.alive)) {
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * Math.PI * 2;
        p.pos.set(b.pos.x + Math.cos(a) * 8, 0, b.pos.z + Math.sin(a) * 8);
        if (g.world.overlaps(p.pos, 0.34, 1.75).length) continue;
        const eye = { x: p.pos.x, y: 1.62, z: p.pos.z }, tgt = { x: b.pos.x, y: 0.6, z: b.pos.z };
        const dx = tgt.x - eye.x, dy = tgt.y - eye.y, dz = tgt.z - eye.z, d = Math.hypot(dx, dy, dz);
        const hit = g.world.raycast(eye, { x: dx / d, y: dy / d, z: dz / d }, d + 1);
        if (!hit || hit.box !== b.box) continue;
        p.vel.set(0, 0, 0);
        p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        p.recoilPitch = 0; p.recoilYaw = 0;
        g.weapons.state[g.weapons.current].mag = 30;
        return g.level.barrels.filter((x) => x.alive).length;
      }
    }
    return -1;
  });
  await page.mouse.down(); await gwait(0.5); await page.mouse.up(); await gwait(0.5);
  const br2 = await G(() => __game.level.barrels.filter((x) => x.alive).length);
  check('Barril explota al recibir disparos', br2 < br, `barriles ${br} -> ${br2}`);

  await G(() => { __game.player.takeDamage = __game.player._td; });
  // Recibir daño: HUD de salud
  await G(() => __game.player.takeDamage(30, __game.player.pos.clone().add({ x: 5, y: 0, z: 0 })));
  await gwait(0.1);
  const hp = await G(() => ({ h: Math.ceil(__game.player.health), hud: document.getElementById('health-num').textContent, ind: document.querySelectorAll('.dmg-ind').length }));
  check('Daño al jugador actualiza salud e indicador direccional', hp.hud === String(hp.h) && hp.ind > 0, `salud ${hp.hud}, indicadores ${hp.ind}`);

  // Suministro de salud
  const pk = await G(() => {
    const g = __game, it = g.pickups.items.find((i) => i.type === 'health' && i.active && !i.temporary);
    g.player.health = 40; g.player.pos.set(it.pos.x, it.pos.y, it.pos.z); g.player.vel.set(0,0,0);
    return true;
  });
  await gwait(0.2);
  check('Recoger botiquín cura', pk && (await G(() => __game.player.health)) > 85);

  // Pausa (P) y reinicio
  await page.keyboard.press('KeyP'); await page.waitForFunction((st) => __game.state === st, 'paused', { timeout: 20000 }).catch(() => {});
  check('Pausa (P) muestra menú', (await G(() => __game.state)) === 'paused' && await page.isVisible('#menu-pause'));
  await page.screenshot({ path: OUT + '03_pause.png' });
  await page.click('#btn-resume'); await sleep(1500);
  const rl3 = await G(() => ({ s: __game.state, locked: __game.input.locked, menu: __game.menus.current }));
  console.log('tras continuar', JSON.stringify(rl3));
  check('Continuar reanuda (y el ratón queda capturado)', rl3.s === 'playing' && rl3.locked && rl3.menu === null, JSON.stringify(rl3));
  await page.keyboard.press('KeyP'); await page.waitForFunction((st) => __game.state === st, 'paused', { timeout: 20000 }).catch(() => {});
  await page.click('#btn-restart'); await sleep(500);
  const rs = await G(() => ({ s: __game.state, sc: __game.score, k: __game.stats.kills, w: __game.waves.wave, e: __game.enemies.enemies.length, hp: __game.player.health, b: __game.level.barrels.filter(x=>x.alive).length }));
  check('Reiniciar restablece la partida', rs.s === 'playing' && rs.sc === 0 && rs.k === 0 && rs.w === 0 && rs.e === 0 && rs.hp === 100 && rs.b === 13, JSON.stringify(rs));

  // Muerte → pantalla de derrota
  await page.waitForFunction(() => __game.waves.state === 'active', null, { timeout: 90000 });
  await G(() => __game.player.takeDamage(500, null));
  await page.waitForFunction(() => __game.state === 'over', null, { timeout: 60000 });
  check('Muerte muestra pantalla de derrota', await page.isVisible('#menu-end') && (await page.textContent('#end-title')) === 'HAS CAÍDO');
  await page.screenshot({ path: OUT + '04_defeat.png' });
  await page.click('#btn-again'); await sleep(400);
  check('Jugar de nuevo tras derrota', (await G(() => __game.state === 'playing' && __game.player.alive)));

  // Victoria: forzar última oleada vacía
  await G(() => { const w = __game.waves; w.wave = w.total - 1; w.state = 'intermission'; w.timer = 0.01; });
  await page.waitForFunction(() => __game.waves.state === 'active', null, { timeout: 20000 });
  await G(() => { const g = __game; g.waves.queue = []; for (const e of g.enemies.enemies) if (e.alive) e.takeDamage(9999, false, e.pos.clone(), null); });
  await page.waitForFunction(() => __game.state === 'over', null, { timeout: 60000 });
  check('Superar la última oleada muestra victoria', (await page.textContent('#end-title')) === 'VICTORIA');
  await page.screenshot({ path: OUT + '05_victory.png' });
  await page.click('#btn-end-menu'); await sleep(400);
  check('Volver al menú principal', (await G(() => __game.state)) === 'menu' && await page.isVisible('#menu-main'));

  // Rendimiento aproximado (swiftshader = CPU, solo orientativo)
  const perf = await G(() => __game.renderer.info.render);
  console.log('render info', JSON.stringify(perf));

  check('Sin errores de JavaScript', errors.length === 0, errors.slice(0, 5).join(' | '));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} pruebas superadas`);
  await browser.close();
})().catch((e) => { console.error('ERROR TEST', e); process.exit(1); });
