// Efectos visuales: partículas (chispas, sangre, polvo, fuego, humo), marcas de bala,
// trazadoras, destellos de disparo enemigos y luz de explosiones. Todo con pools.
import * as THREE from 'three';
import { getTextures } from '../world/Textures.js';

const P_VERT = `
attribute float size; attribute float alpha; attribute vec3 pcolor;
varying float vAlpha; varying vec3 vColor;
void main(){
  vAlpha = alpha; vColor = pcolor;
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_PointSize = size * (420.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const P_FRAG = `
varying float vAlpha; varying vec3 vColor; uniform float soft;
void main(){
  vec2 c = gl_PointCoord - 0.5; float d = length(c);
  if (d > 0.5) discard;
  float a = vAlpha * smoothstep(0.5, soft, d);
  gl_FragColor = vec4(vColor, a);
}`;

class ParticleSystem {
  constructor(scene, max, additive) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('pcolor', this.colAttr);
    geo.setAttribute('size', this.sizeAttr);
    geo.setAttribute('alpha', this.alphaAttr);
    const mat = new THREE.ShaderMaterial({
      vertexShader: P_VERT, fragmentShader: P_FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { soft: { value: additive ? 0.0 : 0.15 } },
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, r, g, b, size, life, grav = 0, drag = 0, grow = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow;
    this.alpha[i] = 1;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const i3 = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= d; this.vel[i3 + 1] = this.vel[i3 + 1] * d - this.grav[i] * dt; this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.02 && this.grav[i] > 0) { this.pos[i3 + 1] = 0.02; this.vel[i3 + 1] *= -0.3; this.vel[i3] *= 0.5; this.vel[i3 + 2] *= 0.5; }
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.max(0, Math.min(1, t * 1.6));
    }
    this.posAttr.needsUpdate = this.colAttr.needsUpdate = this.sizeAttr.needsUpdate = this.alphaAttr.needsUpdate = true;
  }

  clear() { this.life.fill(0); this.alpha.fill(0); }
}

export class Effects {
  constructor(scene, quality) {
    this.scene = scene;
    this.q = quality;
    const tex = getTextures();
    const mul = quality.particles;
    this.add = new ParticleSystem(scene, Math.round(900 * mul), true);
    this.norm = new ParticleSystem(scene, Math.round(900 * mul), false);
    this.mul = mul;

    // Marcas de bala
    this.decalGeo = new THREE.PlaneGeometry(0.16, 0.16);
    this.decalMat = new THREE.MeshBasicMaterial({
      map: tex.bulletHole, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    });
    this.scorchMat = new THREE.MeshBasicMaterial({
      map: tex.scorch, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    });
    this.decals = [];
    this.decalIdx = 0;
    for (let i = 0; i < quality.maxDecals; i++) {
      const m = new THREE.Mesh(this.decalGeo, this.decalMat);
      m.visible = false; m.matrixAutoUpdate = true;
      scene.add(m); this.decals.push(m);
    }

    // Trazadoras
    this.tracerGeo = new THREE.BoxGeometry(0.018, 0.018, 1);
    this.tracerGeo.translate(0, 0, 0.5);
    this.tracers = [];
    for (let i = 0; i < 40; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffd890, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const m = new THREE.Mesh(this.tracerGeo, mat);
      m.visible = false; m.userData.life = 0; m.frustumCulled = false;
      scene.add(m); this.tracers.push(m);
    }
    this.tracerIdx = 0;

    // Destellos (sprites) para disparos enemigos y explosiones
    this.flashMat = new THREE.SpriteMaterial({ map: tex.flare, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.flashes = [];
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(this.flashMat.clone());
      s.visible = false; s.userData.life = 0;
      scene.add(s); this.flashes.push(s);
    }
    this.flashIdx = 0;

    // Luz de explosión (siempre presente para no recompilar shaders)
    this.boomLight = new THREE.PointLight(0xff9a40, 0, 22, 1.5);
    scene.add(this.boomLight);
    this.boomT = 0;
    this.scorches = [];
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  impact(point, normal, surface = 'concrete') {
    const n = Math.round(10 * this.mul);
    const isWood = surface === 'wood' || surface === 'crate';
    const isMetal = surface === 'metal' || surface.startsWith('container') || surface === 'darkMetal';
    const isSand = surface === 'sand' || surface === 'sandbag';
    // chispas
    const sparks = isMetal ? n * 1.5 : n * 0.5;
    for (let i = 0; i < sparks; i++) {
      this.add.emit(point.x, point.y, point.z,
        normal.x * 3 + (Math.random() - 0.5) * 6, normal.y * 3 + Math.random() * 4, normal.z * 3 + (Math.random() - 0.5) * 6,
        1, 0.75 + Math.random() * 0.2, 0.4, 0.06 + Math.random() * 0.05, 0.15 + Math.random() * 0.25, 14, 1);
    }
    // polvo / astillas
    const dc = isWood ? [0.45, 0.33, 0.2] : isSand ? [0.55, 0.47, 0.33] : isMetal ? [0.35, 0.35, 0.36] : [0.6, 0.58, 0.55];
    for (let i = 0; i < n; i++) {
      this.norm.emit(point.x + normal.x * 0.05, point.y + normal.y * 0.05, point.z + normal.z * 0.05,
        normal.x * (1 + Math.random() * 2) + (Math.random() - 0.5) * 1.5,
        normal.y * (1 + Math.random() * 2) + Math.random() * 1.2,
        normal.z * (1 + Math.random() * 2) + (Math.random() - 0.5) * 1.5,
        dc[0], dc[1], dc[2], 0.12 + Math.random() * 0.15, 0.4 + Math.random() * 0.5, 2.5, 2.5, 0.5);
    }
    // calcomanía
    const d = this.decals[this.decalIdx];
    this.decalIdx = (this.decalIdx + 1) % this.decals.length;
    d.position.set(point.x + normal.x * 0.01, point.y + normal.y * 0.01, point.z + normal.z * 0.01);
    this._v.set(normal.x, normal.y, normal.z);
    d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._v);
    d.rotateZ(Math.random() * Math.PI * 2);
    const s = 0.7 + Math.random() * 0.6;
    d.scale.set(s, s, s);
    d.visible = true;
  }

  blood(point, dir, amount = 1) {
    const n = Math.round(14 * this.mul * amount);
    for (let i = 0; i < n; i++) {
      this.norm.emit(point.x, point.y, point.z,
        dir.x * 2.5 + (Math.random() - 0.5) * 3, dir.y * 2 + Math.random() * 2.5, dir.z * 2.5 + (Math.random() - 0.5) * 3,
        0.45 + Math.random() * 0.2, 0.02, 0.02, 0.08 + Math.random() * 0.12, 0.35 + Math.random() * 0.4, 9, 1.5, 0.2);
    }
    for (let i = 0; i < 3; i++) {
      this.norm.emit(point.x, point.y, point.z, dir.x * 0.6, 0.3, dir.z * 0.6, 0.35, 0.03, 0.03, 0.3, 0.45, 0, 2, 1.2);
    }
  }

  // Partículas de "desintegración" al morir un enemigo
  deathBurst(point, color = [1, 0.3, 0.2]) {
    const n = Math.round(30 * this.mul);
    for (let i = 0; i < n; i++) {
      this.add.emit(point.x + (Math.random() - 0.5) * 0.5, point.y + Math.random() * 1.6, point.z + (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 2, Math.random() * 3, (Math.random() - 0.5) * 2,
        color[0], color[1], color[2], 0.06 + Math.random() * 0.08, 0.6 + Math.random() * 0.6, -1, 1.5, 0);
    }
  }

  tracer(from, to, color = 0xffd890, width = 1) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    t.position.copy(from);
    t.lookAt(to);
    t.scale.set(width, width, len);
    t.material.color.setHex(color);
    t.material.opacity = 0.9;
    t.userData.life = 0.07;
    t.visible = true;
  }

  flash(pos, size = 0.7, life = 0.05) {
    const f = this.flashes[this.flashIdx];
    this.flashIdx = (this.flashIdx + 1) % this.flashes.length;
    f.position.copy(pos);
    f.scale.set(size, size, size);
    f.material.rotation = Math.random() * Math.PI;
    f.material.opacity = 1;
    f.userData.life = life; f.userData.max = life;
    f.visible = true;
  }

  explosion(pos) {
    const n = Math.round(60 * this.mul);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, sp = 4 + Math.random() * 9;
      this.add.emit(pos.x, pos.y + 0.3, pos.z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 2, Math.sin(a) * Math.cos(e) * sp,
        1, 0.5 + Math.random() * 0.35, 0.15, 0.5 + Math.random() * 0.7, 0.35 + Math.random() * 0.4, 3, 3.5, 2.5);
    }
    for (let i = 0; i < n * 0.4; i++) {
      this.add.emit(pos.x, pos.y + 0.3, pos.z, (Math.random() - 0.5) * 18, Math.random() * 14, (Math.random() - 0.5) * 18,
        1, 0.8, 0.4, 0.08, 0.8 + Math.random() * 0.6, 16, 0.5, 0);
    }
    for (let i = 0; i < n * 0.6; i++) {
      const g = 0.12 + Math.random() * 0.12;
      this.norm.emit(pos.x + (Math.random() - 0.5), pos.y + 0.5 + Math.random(), pos.z + (Math.random() - 0.5),
        (Math.random() - 0.5) * 3, 1.5 + Math.random() * 3, (Math.random() - 0.5) * 3,
        g, g, g, 1.2 + Math.random() * 1.2, 1.6 + Math.random() * 1.6, -0.6, 1.2, 1.8);
    }
    this.flash(this._v.set(pos.x, pos.y + 0.8, pos.z), 6, 0.18);
    this.boomLight.position.set(pos.x, pos.y + 1.5, pos.z);
    this.boomT = 0.35;
    // marca de quemadura en el suelo
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 3.5), this.scorchMat);
    sc.rotation.x = -Math.PI / 2; sc.position.set(pos.x, 0.015, pos.z);
    this.scene.add(sc); this.scorches.push(sc);
  }

  update(dt) {
    this.add.update(dt);
    this.norm.update(dt);
    for (const t of this.tracers) {
      if (!t.visible) continue;
      t.userData.life -= dt;
      t.material.opacity = Math.max(0, t.userData.life / 0.07) * 0.9;
      if (t.userData.life <= 0) t.visible = false;
    }
    for (const f of this.flashes) {
      if (!f.visible) continue;
      f.userData.life -= dt;
      f.material.opacity = Math.max(0, f.userData.life / f.userData.max);
      if (f.userData.life <= 0) f.visible = false;
    }
    if (this.boomT > 0) {
      this.boomT -= dt;
      this.boomLight.intensity = Math.max(0, this.boomT / 0.35) * 220;
    } else this.boomLight.intensity = 0;
  }

  reset() {
    this.add.clear(); this.norm.clear();
    for (const d of this.decals) d.visible = false;
    for (const t of this.tracers) t.visible = false;
    for (const f of this.flashes) f.visible = false;
    for (const s of this.scorches) { this.scene.remove(s); s.geometry.dispose(); }
    this.scorches = [];
    this.boomT = 0;
  }
}
