// Modelos de armas en primera persona construidos con primitivas
// (receptor, cañón, cargador, mira, manos...). Las piezas móviles se exponen
// para animar recargas, corredera y bombeo.
import * as THREE from 'three';
import { getTextures } from '../world/Textures.js';

let mats = null;
function materials() {
  if (mats) return mats;
  mats = {
    metal: new THREE.MeshStandardMaterial({ color: 0x2b2e32, roughness: 0.38, metalness: 0.85 }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.72, metalness: 0.1 }),
    tan: new THREE.MeshStandardMaterial({ color: 0x7d6e52, roughness: 0.8, metalness: 0.05 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.6, metalness: 0.05 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.9 }),
    sleeve: new THREE.MeshStandardMaterial({ color: 0x4b533e, roughness: 0.95 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xb98a6a, roughness: 0.8 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.55 }),
    dot: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9a040, roughness: 0.3, metalness: 1 }),
    red: new THREE.MeshStandardMaterial({ color: 0x8a2a1a, roughness: 0.6 }),
    flash: new THREE.MeshBasicMaterial({ map: getTextures().flare, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  };
  return mats;
}

function box(parent, mat, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}
// Antebrazo cuyo extremo delantero coincide con la mano (hand) y que se
// orienta según rot hacia el codo (fuera de pantalla, abajo y atrás).
const _fe = new THREE.Euler(), _fv = new THREE.Vector3();
function forearm(parent, mat, hand, rot, len = 0.46) {
  const m = box(parent, mat, 0.085, 0.085, len, 0, 0, 0, ...rot);
  _fv.set(0, 0, -len / 2).applyEuler(_fe.set(rot[0], rot[1], rot[2]));
  m.position.set(hand[0] - _fv.x, hand[1] - 0.02 - _fv.y, hand[2] + 0.03 - _fv.z);
  return m;
}
function cyl(parent, mat, r, len, x, y, z, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.rotation.x = Math.PI / 2; m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function muzzleFlash(parent, x, y, z, scale = 1) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const M = materials();
  const q1 = new THREE.Mesh(new THREE.PlaneGeometry(0.16 * scale, 0.16 * scale), M.flash);
  const q2 = new THREE.Mesh(new THREE.PlaneGeometry(0.07 * scale, 0.3 * scale), M.flash);
  q2.rotation.y = Math.PI / 2; q2.position.z = -0.1 * scale;
  const q3 = q2.clone(); q3.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  g.add(q1, q2, q3);
  g.visible = false;
  parent.add(g);
  return g;
}

function arms(parent, leftHandPos, rightHandPos, leftArmRot, rightArmRot) {
  const M = materials();
  // mano derecha
  box(parent, M.glove, 0.055, 0.075, 0.09, rightHandPos[0], rightHandPos[1], rightHandPos[2], 0.25, 0, 0);
  forearm(parent, M.sleeve, rightHandPos, rightArmRot, 0.42);
  // mano izquierda
  box(parent, M.glove, 0.06, 0.05, 0.1, leftHandPos[0], leftHandPos[1], leftHandPos[2], 0, 0, 0.3);
  forearm(parent, M.sleeve, leftHandPos, leftArmRot, 0.46);
}

export function buildRifle() {
  const M = materials();
  const root = new THREE.Group();
  const g = new THREE.Group(); root.add(g);
  box(g, M.metal, 0.058, 0.075, 0.34, 0, 0, -0.02);              // receptor
  box(g, M.metal, 0.036, 0.014, 0.36, 0, 0.044, -0.03);           // riel
  for (let i = 0; i < 9; i++) box(g, M.polymer, 0.04, 0.006, 0.012, 0, 0.054, -0.18 + i * 0.035);
  box(g, M.tan, 0.068, 0.072, 0.27, 0, 0.002, -0.32);             // guardamanos
  for (let i = 0; i < 5; i++) box(g, M.polymer, 0.072, 0.01, 0.025, 0, -0.03, -0.42 + i * 0.05);
  cyl(g, M.metal, 0.011, 0.2, 0, 0.004, -0.55);                   // cañón
  cyl(g, M.polymer, 0.018, 0.06, 0, 0.004, -0.66, 8);             // bocacha
  box(g, M.metal, 0.012, 0.05, 0.012, 0, 0.045, -0.45);           // mira delantera
  // mira de punto rojo
  box(g, M.polymer, 0.04, 0.012, 0.08, 0, 0.056, 0.02);
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.07, 16, 1, true), M.polymer);
  housing.rotation.x = Math.PI / 2; housing.position.set(0, 0.0855, 0.02); g.add(housing);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.022, 16), M.lens);
  lens.position.set(0, 0.0855, -0.005); g.add(lens);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0016, 8), M.dot);
  dot.position.set(0, 0.0855, -0.006); g.add(dot);
  box(g, M.polymer, 0.05, 0.068, 0.2, 0, -0.012, 0.25);           // culata
  box(g, M.polymer, 0.054, 0.09, 0.03, 0, -0.016, 0.36);
  box(g, M.polymer, 0.034, 0.09, 0.045, 0, -0.075, 0.07, 0.35);   // empuñadura
  box(g, M.metal, 0.03, 0.01, 0.06, 0, -0.045, 0.02);             // guardamonte
  const mag = new THREE.Group(); mag.position.set(0, -0.06, -0.09); g.add(mag);
  box(mag, M.metal, 0.032, 0.13, 0.06, 0, -0.055, -0.01, -0.22);
  const bolt = box(g, M.metal, 0.02, 0.02, 0.05, 0.03, 0.015, 0.02);
  arms(g, [0, -0.05, -0.34], [0.0, -0.09, 0.08], [0.4, -0.75, 0], [0.45, 0.3, 0]);
  const flash = muzzleFlash(g, 0, 0.004, -0.72, 1.1);
  return { root, gun: g, mag, magHome: mag.position.clone(), bolt, boltHome: bolt.position.clone(), flash, muzzle: new THREE.Vector3(0, 0.004, -0.72), eject: new THREE.Vector3(0.035, 0.02, 0.0) };
}

export function buildPistol() {
  const M = materials();
  const root = new THREE.Group();
  const g = new THREE.Group(); root.add(g);
  const slide = new THREE.Group(); g.add(slide);
  box(slide, M.metal, 0.03, 0.034, 0.19, 0, 0.022, -0.05);
  for (let i = 0; i < 5; i++) box(slide, M.polymer, 0.032, 0.025, 0.004, 0, 0.022, 0.02 + i * 0.008);
  box(slide, M.polymer, 0.012, 0.012, 0.01, 0, 0.044, -0.135);   // mira delantera
  const fdot = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 0.002), new THREE.MeshBasicMaterial({ color: 0x66ff66 }));
  fdot.position.set(0, 0.046, -0.141); slide.add(fdot);
  box(slide, M.polymer, 0.028, 0.012, 0.01, -0.0105 + 0.0105, 0.044, 0.03);
  box(slide, M.polymer, 0.009, 0.014, 0.01, -0.01, 0.046, 0.03);
  box(slide, M.polymer, 0.009, 0.014, 0.01, 0.01, 0.046, 0.03);
  box(g, M.polymer, 0.028, 0.024, 0.17, 0, -0.005, -0.045);      // armazón
  box(g, M.polymer, 0.032, 0.105, 0.052, 0, -0.065, 0.03, 0.22); // empuñadura
  box(g, M.polymer, 0.02, 0.008, 0.045, 0, -0.03, -0.035);       // guardamonte
  const mag = new THREE.Group(); mag.position.set(0, -0.06, 0.03); g.add(mag);
  box(mag, M.metal, 0.024, 0.11, 0.04, 0, -0.01, 0, 0.22);
  // ambas manos en la empuñadura
  const MM = materials();
  box(g, MM.glove, 0.06, 0.08, 0.07, 0.005, -0.07, 0.045, 0.22);
  box(g, MM.glove, 0.045, 0.07, 0.07, -0.03, -0.075, 0.035, 0.22, 0, 0.3);
  box(g, MM.sleeve, 0.085, 0.085, 0.42, 0.06, -0.12, 0.26, 0.25, -0.2, 0);
  box(g, MM.sleeve, 0.085, 0.085, 0.42, -0.1, -0.13, 0.25, 0.25, 0.35, 0);
  const flash = muzzleFlash(g, 0, 0.022, -0.16, 0.8);
  return { root, gun: g, mag, magHome: mag.position.clone(), slide, flash, muzzle: new THREE.Vector3(0, 0.022, -0.16), eject: new THREE.Vector3(0.02, 0.03, -0.03) };
}

export function buildShotgun() {
  const M = materials();
  const root = new THREE.Group();
  const g = new THREE.Group(); root.add(g);
  box(g, M.metal, 0.054, 0.075, 0.24, 0, 0, 0);                   // receptor
  cyl(g, M.metal, 0.014, 0.52, 0, 0.018, -0.38);                  // cañón
  cyl(g, M.metal, 0.013, 0.42, 0, -0.016, -0.33);                 // tubo cargador
  box(g, M.metal, 0.008, 0.008, 0.008, 0, 0.036, -0.63);          // punto de mira
  box(g, M.polymer, 0.03, 0.008, 0.2, 0, 0.04, -0.02);            // riel ventilado
  const pump = new THREE.Group(); pump.position.set(0, -0.018, -0.3); g.add(pump);
  box(pump, M.wood, 0.058, 0.052, 0.17, 0, 0, 0);
  for (let i = 0; i < 6; i++) box(pump, M.polymer, 0.062, 0.004, 0.006, 0, -0.01, -0.06 + i * 0.024);
  box(g, M.wood, 0.046, 0.08, 0.3, 0, -0.03, 0.26, -0.12);        // culata
  box(g, M.polymer, 0.05, 0.1, 0.02, 0, -0.05, 0.41, -0.12);
  box(g, M.wood, 0.034, 0.08, 0.04, 0, -0.07, 0.11, 0.4);         // empuñadura
  box(g, M.metal, 0.02, 0.01, 0.05, 0, -0.045, 0.06);
  // cartuchos en el lateral
  for (let i = 0; i < 4; i++) {
    const s = cyl(g, M.red, 0.009, 0.05, -0.034, -0.01, -0.05 + i * 0.024, 8);
    s.rotation.set(0, 0, 0);
  }
  // brazos (izquierda en el guardamanos)
  const lh = box(pump, M.glove, 0.065, 0.05, 0.11, 0, -0.03, 0, 0, 0, 0.3);
  forearm(pump, M.sleeve, [0, -0.03, 0], [0.4, -0.75, 0], 0.46);
  void lh;
  box(g, M.glove, 0.055, 0.075, 0.09, 0, -0.085, 0.12, 0.3);
  forearm(g, M.sleeve, [0, -0.085, 0.12], [0.45, 0.3, 0], 0.42);
  const shell = cyl(g, M.red, 0.01, 0.055, 0.0, -0.06, -0.02, 8);
  shell.visible = false;
  const flash = muzzleFlash(g, 0, 0.018, -0.66, 1.5);
  return { root, gun: g, pump, pumpHome: pump.position.clone(), shell, flash, muzzle: new THREE.Vector3(0, 0.018, -0.66), eject: new THREE.Vector3(0.035, 0.02, -0.02) };
}

export function buildCasingPool(scene, n = 14) {
  const M = materials();
  const geo = new THREE.CylinderGeometry(0.004, 0.004, 0.022, 6);
  const shellGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.05, 8);
  const list = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, M.brass);
    m.visible = false; m.userData = { vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 };
    scene.add(m); list.push(m);
  }
  return { list, geo, shellGeo, brass: M.brass, red: M.red };
}
