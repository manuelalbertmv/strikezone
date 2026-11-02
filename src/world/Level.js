// Construcción del mapa: geometría estática fusionada por material, colisionadores,
// iluminación, cielo, barriles explosivos, puntos de suministros y zonas de aparición.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getTextures } from './Textures.js';
import { NavGrid } from './NavGrid.js';

export const MAP_HALF = 44;

const SKY_VERT = `
varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`;
const SKY_FRAG = `
uniform vec3 sunDir; varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  vec3 zenith = vec3(0.20,0.36,0.62);
  vec3 horizon = vec3(0.86,0.70,0.52);
  vec3 col = mix(horizon, zenith, pow(max(h,0.0), 0.55));
  col = mix(col, vec3(0.42,0.38,0.34), clamp(-h*5.0,0.0,1.0));
  float s = max(dot(d, normalize(sunDir)), 0.0);
  col += vec3(1.0,0.75,0.45) * pow(s, 8.0) * 0.35;
  col += vec3(1.0,0.92,0.75) * smoothstep(0.9975, 0.999, s) * 4.0;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

class StaticBuilder {
  constructor() { this.groups = new Map(); }
  add(key, geo) {
    if (!this.groups.has(key)) this.groups.set(key, []);
    this.groups.get(key).push(geo);
  }
  build(materials, parent) {
    const meshes = [];
    for (const [key, geos] of this.groups) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      const def = materials[key];
      const mesh = new THREE.Mesh(merged, def.material);
      mesh.castShadow = def.castShadow !== false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  }
}

function worldUV(geo, tile) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
    let u, v;
    if (nx > 0.5) { u = z; v = y; } else if (ny > 0.5) { u = x; v = z; } else { u = x; v = y; }
    uv.setXY(i, u / tile, v / tile);
  }
  uv.needsUpdate = true;
}

export class Level {
  constructor(scene, world, quality) {
    this.scene = scene;
    this.world = world;
    this.quality = quality;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.tex = getTextures();
    this.builder = new StaticBuilder();
    this.barrels = [];
    this.pickups = [];
    this.interiorLights = [];
    this.spawnPoints = [];
    this.playerSpawn = new THREE.Vector3(0, 0, 12);
    this.makeMaterials();
    this.buildLighting();
    this.buildMap();
    this.builder.build(this.materials, this.root);
    this.nav = new NavGrid(world, 45, 0.5, 0.34);
    this.buildDynamic();
  }

  makeMaterials() {
    const t = this.tex;
    const std = (tex, opts = {}) => new THREE.MeshStandardMaterial({
      map: tex.map, bumpMap: tex.bump || null, bumpScale: opts.bump ?? 1.2,
      roughness: opts.roughness ?? 0.9, metalness: opts.metalness ?? 0, color: opts.color ?? 0xffffff,
    });
    const M = (material, tile, uvMode = 'world', castShadow = true) => ({ material, tile, uvMode, castShadow });
    this.materials = {
      ground: M(std(t.asphalt, { roughness: 0.95 }), 6, 'world', false),
      concrete: M(std(t.concrete), 3),
      concreteDark: M(std(t.concreteDark), 3),
      bricks: M(std(t.bricks, { roughness: 0.92 }), 3),
      plaster: M(std(t.plaster), 3),
      plasterBlue: M(std(t.plasterBlue), 3),
      tiles: M(std(t.tiles, { roughness: 0.6, bump: 0.6 }), 2, 'world', false),
      containerRed: M(std(t.containerRed, { metalness: 0.35, roughness: 0.65 }), 2.6),
      containerBlue: M(std(t.containerBlue, { metalness: 0.35, roughness: 0.65 }), 2.6),
      containerGreen: M(std(t.containerGreen, { metalness: 0.35, roughness: 0.65 }), 2.6),
      containerYellow: M(std(t.containerYellow, { metalness: 0.35, roughness: 0.65 }), 2.6),
      crate: M(std(t.crate, { roughness: 0.85 }), 1, 'box'),
      sandbag: M(std(t.sandbag, { roughness: 1, bump: 2 }), 1.6),
      metal: M(new THREE.MeshStandardMaterial({ color: 0x4a4d50, roughness: 0.45, metalness: 0.7 }), 1),
      darkMetal: M(new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.6, metalness: 0.5 }), 1),
      rubber: M(new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 }), 1),
      glass: M(new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.8 }), 1),
      lamp: M(new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffd9a0, emissiveIntensity: 3 }), 1, 'box', false),
      carRed: M(new THREE.MeshStandardMaterial({ color: 0x8a1f1a, roughness: 0.35, metalness: 0.6 }), 1),
      carGrey: M(new THREE.MeshStandardMaterial({ color: 0x6b7073, roughness: 0.35, metalness: 0.6 }), 1),
      stripe: M(new THREE.MeshStandardMaterial({ color: 0xd8b02a, roughness: 0.7 }), 1),
    };
  }

  // Caja estática por esquinas mínimas/máximas
  box(x0, y0, z0, x1, y1, z1, mat, opts = {}) {
    const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0;
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    geo.translate(x0 + sx / 2, y0 + sy / 2, z0 + sz / 2);
    const def = this.materials[mat];
    if (def.uvMode === 'world') worldUV(geo, def.tile);
    this.builder.add(mat, geo);
    if (opts.collide !== false) {
      this.world.add(x0, y0, z0, x1, y1, z1, { material: opts.surface || mat, seeThrough: !!opts.seeThrough });
    }
  }

  // Geometría arbitraria sin colisión (decoración)
  deco(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(m);
    if (geo.index === null) { /* ok */ }
    // normalizar atributos para fusión
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    const g = geo.index ? geo : geo;
    this.builder.add(mat, g.index ? g : g);
  }

  // Muro con huecos: segmentos [a,b] a lo largo de un eje
  wallX(z0, z1, xs, h, mat, y0 = 0) { for (const [a, b] of xs) this.box(a, y0, z0, b, y0 + h, z1, mat); }
  wallZ(x0, x1, zs, h, mat, y0 = 0) { for (const [a, b] of zs) this.box(x0, y0, a, x1, y0 + h, b, mat); }

  container(x0, z0, alongX, mat, y0 = 0) {
    const L = 6, W = 2.4, H = 2.6;
    const x1 = alongX ? x0 + L : x0 + W, z1 = alongX ? z0 + W : z0 + L;
    this.box(x0, y0, z0, x1, y0 + H, z1, mat);
    // marcos de las puertas
    const fx = alongX ? x1 : (x0 + x1) / 2;
    if (alongX) this.box(x1, y0, z0 + 0.05, x1 + 0.06, y0 + H, z1 - 0.05, 'darkMetal', { collide: false });
    else this.box(x0 + 0.05, y0, z1, x1 - 0.05, y0 + H, z1 + 0.06, 'darkMetal', { collide: false });
    return fx;
  }

  crateStack(x, z, n = 1, s = 1.2) {
    const offs = [[0, 0, 0], [s + 0.05, 0, 0], [s * 0.5, s, 0.1], [0, 0, s + 0.05]];
    for (let i = 0; i < n; i++) {
      const [ox, oy, oz] = offs[i];
      this.box(x + ox, oy, z + oz, x + ox + s, oy + s, z + oz + s, 'crate', { surface: 'wood' });
    }
  }

  jersey(x, z, alongX, len = 3) {
    if (alongX) {
      this.box(x, 0, z - 0.35, x + len, 0.35, z + 0.35, 'concrete');
      this.box(x, 0.35, z - 0.18, x + len, 0.85, z + 0.18, 'concrete');
    } else {
      this.box(x - 0.35, 0, z, x + 0.35, 0.35, z + len, 'concrete');
      this.box(x - 0.18, 0.35, z, x + 0.18, 0.85, z + len, 'concrete');
    }
  }

  sandbags(x0, z0, x1, z1, h = 1.0, y0 = 0) { this.box(x0, y0, z0, x1, y0 + h, z1, 'sandbag', { surface: 'sand' }); }

  lampPost(x, z) {
    this.box(x - 0.1, 0, z - 0.1, x + 0.1, 6, z + 0.1, 'darkMetal', { surface: 'metal' });
    this.box(x - 0.06, 5.8, z - 0.06, x + 1.4, 5.92, z + 0.06, 'darkMetal', { collide: false });
    this.box(x + 1.0, 5.6, z - 0.22, x + 1.6, 5.8, z + 0.22, 'darkMetal', { collide: false });
    this.box(x + 1.05, 5.56, z - 0.18, x + 1.55, 5.6, z + 0.18, 'lamp', { collide: false });
  }

  car(x, z, alongX, mat) {
    const L = 4.3, W = 1.85;
    const [x0, z0, x1, z1] = alongX ? [x, z, x + L, z + W] : [x, z, x + W, z + L];
    this.box(x0, 0.3, z0, x1, 1.0, z1, mat, { surface: 'metal' });
    // cabina
    if (alongX) this.box(x0 + 1.1, 1.0, z0 + 0.12, x1 - 1.0, 1.5, z1 - 0.12, 'glass', { surface: 'metal' });
    else this.box(x0 + 0.12, 1.0, z0 + 1.1, x1 - 0.12, 1.5, z1 - 1.0, 'glass', { surface: 'metal' });
    // ruedas
    const wheel = () => new THREE.CylinderGeometry(0.34, 0.34, 0.25, 14);
    const pts = alongX
      ? [[x0 + 0.8, z0 - 0.02], [x1 - 0.8, z0 - 0.02], [x0 + 0.8, z1 + 0.02], [x1 - 0.8, z1 + 0.02]]
      : [[x0 - 0.02, z0 + 0.8], [x0 - 0.02, z1 - 0.8], [x1 + 0.02, z0 + 0.8], [x1 + 0.02, z1 - 0.8]];
    for (const [wx, wz] of pts) {
      if (alongX) this.deco(wheel(), 'rubber', wx, 0.34, wz, Math.PI / 2, 0, 0);
      else this.deco(wheel(), 'rubber', wx, 0.34, wz, 0, 0, Math.PI / 2);
    }
    this.world.add(x0, 0, z0, x1, 0.3, z1, { material: 'metal' });
  }

  buildLighting() {
    const q = this.quality;
    const hemi = new THREE.HemisphereLight(0xbcd2ff, 0x5a4a38, 0.75);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd8a8, 2.6);
    this.sunDir = new THREE.Vector3(-0.55, 0.62, 0.35).normalize();
    sun.position.copy(this.sunDir).multiplyScalar(60);
    sun.castShadow = q.shadows;
    if (q.shadows) {
      sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      const c = sun.shadow.camera;
      c.left = -34; c.right = 34; c.top = 34; c.bottom = -34; c.near = 1; c.far = 160;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.03;
    }
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    // Cielo
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(400, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, uniforms: { sunDir: { value: this.sunDir } } }),
    );
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    this.sky = sky;
    this.scene.add(sky);
    this.scene.fog = new THREE.Fog(0xc9b49a, 45, 150);
  }

  // La sombra sigue al jugador (ajustada a la rejilla de texels para evitar parpadeo)
  updateShadow(playerPos) {
    this.sky.position.copy(playerPos);
    if (!this.sun.castShadow) return;
    const texel = 68 / this.quality.shadowSize;
    const cx = Math.round(playerPos.x / texel) * texel, cz = Math.round(playerPos.z / texel) * texel;
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx + this.sunDir.x * 60, this.sunDir.y * 60, cz + this.sunDir.z * 60);
  }

  addInteriorLight(x, y, z, color = 0xffd8a0, intensity = 18, dist = 16) {
    // lámpara visible siempre
    this.box(x - 0.6, y - 0.08, z - 0.15, x + 0.6, y, z + 0.15, 'lamp', { collide: false });
    const l = new THREE.PointLight(color, intensity, dist, 1.6);
    l.position.set(x, y - 0.4, z);
    l.visible = this.quality.extraLights;
    this.scene.add(l);
    this.interiorLights.push(l);
  }

  // Cambia la calidad gráfica en caliente (sombras, luces interiores)
  applyQuality(q) {
    this.quality = q;
    for (const l of this.interiorLights) l.visible = q.extraLights;
    this.sun.castShadow = q.shadows;
    if (q.shadows) {
      if (this.sun.shadow.mapSize.x !== q.shadowSize) {
        this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
        if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      }
      const c = this.sun.shadow.camera;
      c.left = -34; c.right = 34; c.top = 34; c.bottom = -34; c.near = 1; c.far = 160;
      c.updateProjectionMatrix();
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.03;
    }
  }

  // ¿Hay techo sobre este punto? (para iluminar el arma en interiores)
  isIndoors(pos) {
    const hit = this.world.raycast({ x: pos.x, y: pos.y + 1.7, z: pos.z }, { x: 0, y: 1, z: 0 }, 8);
    return !!hit;
  }

  buildMap() {
    const H = MAP_HALF;
    // Suelo
    this.box(-H - 6, -1, -H - 6, H + 6, 0, H + 6, 'ground', { surface: 'concrete' });
    // Perímetro
    this.box(-H - 1, 0, -H - 1, H + 1, 6, -H, 'concreteDark');
    this.box(-H - 1, 0, H, H + 1, 6, H + 1, 'concreteDark');
    this.box(-H - 1, 0, -H, -H, 6, H, 'concreteDark');
    this.box(H, 0, -H, H + 1, 6, H, 'concreteDark');
    // remate superior del muro
    for (const [a, b, c, d] of [[-H - 1.2, -H - 1.2, H + 1.2, -H + 0.2], [-H - 1.2, H - 0.2, H + 1.2, H + 1.2], [-H - 1.2, -H, -H + 0.2, H], [H - 0.2, -H, H + 1.2, H]]) {
      this.box(a, 6, b, c, 6.25, d, 'concrete', { collide: false });
    }

    this.buildWarehouse();
    this.buildOffice();
    this.buildPlaza();
    this.buildContainerYard();
    this.buildRuins();
    this.buildBunker();
    this.buildLanes();
  }

  buildWarehouse() {
    const t = 0.4, Hh = 5;
    // Almacén NO: x -40..-16, z -40..-20
    this.box(-40, 0.0, -40, -16, 0.02, -20, 'tiles', { collide: false });
    this.wallX(-40, -40 + t, [[-40, -16]], Hh, 'bricks');
    this.wallZ(-40, -40 + t, [[-40, -20]], Hh, 'bricks');
    this.wallX(-20 - t, -20, [[-40, -31.2], [-28.8, -24], [-20, -16]], Hh, 'bricks');
    this.box(-31.2, 2.6, -20 - t, -28.8, Hh, -20, 'bricks');
    this.box(-24, 3.6, -20 - t, -20, Hh, -20, 'bricks');
    this.box(-24.1, 3.45, -20.5, -19.9, 3.6, -19.9, 'stripe', { collide: false });
    this.wallZ(-16 - t, -16, [[-40, -31.2], [-28.8, -20]], Hh, 'bricks');
    this.box(-16 - t, 2.6, -31.2, -16, Hh, -28.8, 'bricks');
    // divisoria interior
    this.wallZ(-28.2, -27.8, [[-39.6, -34.2], [-32, -26]], Hh, 'plaster');
    this.box(-28.2, 2.6, -34.2, -27.8, Hh, -32, 'plaster');
    // techo
    this.box(-40.2, Hh, -40.2, -15.8, Hh + 0.3, -19.8, 'concreteDark');
    // estanterías (racks)
    for (const z0 of [-38.5, -33]) {
      for (const x0 of [-25.5, -21]) {
        this.box(x0, 0, z0, x0 + 0.9, 0.12, z0 + 4, 'metal', { collide: false });
        this.box(x0, 0, z0, x0 + 0.9, 3.2, z0 + 4, 'darkMetal', { surface: 'metal', collide: true });
        for (const y of [1.0, 2.1]) this.box(x0 - 0.02, y, z0 - 0.02, x0 + 0.92, y + 0.08, z0 + 4.02, 'stripe', { collide: false });
      }
    }
    // cajas interiores
    this.crateStack(-38.5, -38.5, 3);
    this.crateStack(-33, -26, 2);
    this.crateStack(-38.6, -24, 1);
    this.crateStack(-18, -38.5, 3, 1.0);
    this.box(-35, 0, -31.5, -33.2, 1.0, -30.3, 'crate', { surface: 'wood' });
    this.addInteriorLight(-34, 4.95, -30);
    this.addInteriorLight(-22, 4.95, -30);
  }

  buildOffice() {
    const t = 0.4, Hh = 4.2;
    // Oficinas SE: x 16..38, z 18..38
    this.box(16, 0.0, 18, 38, 0.02, 38, 'tiles', { collide: false });
    this.wallX(18, 18 + t, [[16, 21], [23.2, 28], [33, 38]], Hh, 'plasterBlue');
    this.box(21, 2.6, 18, 23.2, Hh, 18 + t, 'plasterBlue');
    this.box(28, 0, 18, 33, 1.1, 18 + t, 'plasterBlue');
    this.box(28, 2.3, 18, 33, Hh, 18 + t, 'plasterBlue');
    this.box(28, 1.1, 18.15, 33, 1.16, 18.25, 'darkMetal', { collide: false });
    this.wallZ(16, 16 + t, [[18, 29], [31.2, 38]], Hh, 'plasterBlue');
    this.box(16, 2.6, 29, 16 + t, Hh, 31.2, 'plasterBlue');
    this.wallX(38 - t, 38, [[16, 38]], Hh, 'plasterBlue');
    this.wallZ(38 - t, 38, [[18, 38]], Hh, 'plasterBlue');
    // interiores
    this.wallX(26, 26.4, [[16.4, 24], [26, 32]], Hh, 'plaster');
    this.box(24, 2.6, 26, 26, Hh, 26.4, 'plaster');
    this.wallZ(27.8, 28.2, [[26.4, 31], [33, 37.6]], Hh, 'plaster');
    this.box(27.8, 2.6, 31, 28.2, Hh, 33, 'plaster');
    // techo
    this.box(15.8, Hh, 17.8, 38.2, Hh + 0.3, 38.2, 'concreteDark');
    // escritorios y archivadores
    const desk = (x, z) => {
      this.box(x, 0.72, z, x + 1.6, 0.78, z + 0.8, 'darkMetal', { surface: 'wood' });
      this.box(x, 0, z, x + 1.6, 0.72, z + 0.08, 'darkMetal', { surface: 'metal' });
      this.box(x + 0.6, 0.78, z + 0.35, x + 1.0, 1.1, z + 0.4, 'darkMetal', { collide: false });
      this.world.add(x, 0, z, x + 1.6, 0.78, z + 0.8, { material: 'metal', noRay: true });
    };
    desk(18, 21); desk(18, 23.5); desk(30, 21); desk(34, 23);
    desk(19, 34); desk(31, 35);
    for (const [x, z] of [[37, 28], [37, 29], [16.5, 27]]) this.box(x - 0.5, 0, z - 0.4, x + 0.5, 1.9, z + 0.4, 'metal', { surface: 'metal' });
    this.crateStack(21.5, 29, 2, 1.0);
    this.addInteriorLight(22, 4.15, 22);
    this.addInteriorLight(33, 4.15, 30);
  }

  buildPlaza() {
    // Plataforma central elevada con escaleras
    this.box(-5, 0, -5, 5, 1.5, 5, 'concrete');
    this.box(-5.1, 1.5, -5.1, 5.1, 1.62, 5.1, 'concreteDark', { collide: false });
    for (let i = 1; i <= 5; i++) {
      const h = 0.3 * i;
      this.box(-1.5, 0, -5 - (6 - i) * 0.5, 1.5, h, -5 - (5 - i) * 0.5, 'concreteDark');
      this.box(-1.5, 0, 5 + (5 - i) * 0.5, 1.5, h, 5 + (6 - i) * 0.5, 'concreteDark');
    }
    const y = 1.5;
    this.sandbags(-5, -5, -2, -4.4, 0.95, y);
    this.sandbags(2, -5, 5, -4.4, 0.95, y);
    this.sandbags(-5, 4.4, -2, 5, 0.95, y);
    this.sandbags(2, 4.4, 5, 5, 0.95, y);
    this.sandbags(4.4, -2, 5, 2, 0.95, y);
    this.sandbags(-5, -2, -4.4, 2, 0.95, y);
    this.box(-0.6, y, -0.6, 0.6, y + 1.2, 0.6, 'crate', { surface: 'wood' });
    // mástil
    this.box(-0.06, y + 1.2, -0.06, 0.06, y + 7, 0.06, 'metal', { collide: false });
  }

  buildContainerYard() {
    this.container(16, -38, true, 'containerRed');
    this.container(16, -38, true, 'containerBlue', 2.6);
    this.container(25, -38, true, 'containerGreen');
    this.container(33, -38, true, 'containerYellow');
    this.container(16, -30, false, 'containerBlue');
    this.container(22, -28, true, 'containerYellow');
    this.container(31, -30, true, 'containerRed');
    this.container(31, -30, true, 'containerGreen', 2.6);
    this.container(34, -24, false, 'containerBlue');
    this.container(20, -18, true, 'containerGreen');
    this.container(27, -23, false, 'containerRed');
    this.crateStack(24, -33, 3);
    this.crateStack(38, -33, 2);
    this.crateStack(30.5, -20, 1);
    // grúa decorativa (pórtico)
    for (const x of [14.5, 40.5]) this.box(x - 0.3, 0, -41, x + 0.3, 10, -40.4, 'stripe', { surface: 'metal' });
    this.box(14, 10, -41, 41, 10.8, -40.4, 'stripe', { collide: false });
  }

  buildRuins() {
    // Ruinas SO: x -40..-14, z 14..40
    this.wallX(20, 20.5, [[-36, -31]], 3.5, 'bricks');
    this.wallX(20, 20.5, [[-29, -25]], 2.0, 'bricks');
    this.wallX(20, 20.5, [[-25, -22]], 1.2, 'bricks');
    this.wallZ(-36, -35.5, [[20.5, 26], [28, 34]], 3.0, 'bricks');
    this.wallX(33.5, 34, [[-35.5, -30]], 2.5, 'bricks');
    this.wallX(33.5, 34, [[-27, -22]], 3.2, 'bricks');
    this.wallZ(-22.5, -22, [[20.5, 25]], 3.0, 'bricks');
    this.wallZ(-22.5, -22, [[29, 33.5]], 1.4, 'bricks');
    for (const [x, z] of [[-31, 27], [-27, 27]]) this.box(x - 0.3, 0, z - 0.3, x + 0.3, 3.2, z + 0.3, 'concrete');
    this.box(-31.3, 3.2, 26.7, -26.7, 3.5, 27.3, 'concrete');
    this.crateStack(-34.5, 30.5, 2);
    this.crateStack(-26, 22, 1);
    this.sandbags(-30, 30, -27, 30.6, 1.0);
    // escombros decorativos
    const r = (s) => { const x = Math.sin(s * 12.9898) * 43758.5453; return x - Math.floor(x); };
    for (let i = 0; i < 22; i++) {
      const s = 0.2 + r(i) * 0.5;
      const geo = new THREE.BoxGeometry(s, s * 0.6, s * 1.2);
      this.deco(geo, 'bricks', -38 + r(i + 50) * 22, s * 0.25, 16 + r(i + 90) * 22, r(i) * 2, r(i + 3) * 3, r(i + 7));
    }
    this.wallZ(-18, -17.5, [[16, 22]], 2.2, 'bricks');
    this.wallX(38, 38.5, [[-30, -22]], 1.6, 'bricks');
  }

  buildBunker() {
    // Búnker norte: x -4..4, z -30..-24
    const h = 2.8;
    this.wallX(-30, -29.5, [[-4, 4]], h, 'concreteDark');
    this.wallX(-24.5, -24, [[-4, -1], [1, 4]], h, 'concreteDark');
    this.box(-1, 2.2, -24.5, 1, h, -24, 'concreteDark');
    this.wallZ(-4, -3.5, [[-29.5, -28], [-26, -24.5]], h, 'concreteDark');
    this.box(-4, 0, -28, -3.5, 1.1, -26, 'concreteDark');
    this.box(-4, 1.9, -28, -3.5, h, -26, 'concreteDark');
    this.wallZ(3.5, 4, [[-29.5, -28], [-26, -24.5]], h, 'concreteDark');
    this.box(3.5, 0, -28, 4, 1.1, -26, 'concreteDark');
    this.box(3.5, 1.9, -28, 4, h, -26, 'concreteDark');
    this.box(-4.3, h, -30.3, 4.3, h + 0.35, -23.7, 'concrete');
    this.crateStack(-2.8, -29.2, 1, 1.0);
    this.sandbags(-6, -21, -2, -20.4, 1.0);
    this.sandbags(2, -21, 6, -20.4, 1.0);
  }

  buildLanes() {
    // Barreras y coberturas en los carriles
    this.jersey(-13, 0, true);
    this.jersey(10, 0, true);
    this.jersey(-1.5, -14, true);
    this.jersey(-1.5, 15, true);
    this.jersey(-9, -18, false);
    this.jersey(9, 17, false);
    this.box(-14, 0, -14, -13.4, 1.2, -6, 'concrete');
    this.box(13.4, 0, 6, 14, 1.2, 14, 'concrete');
    this.crateStack(-10.5, -10.5, 2);
    this.crateStack(9.5, 9.5, 2);
    this.crateStack(-11, 11.5, 3);
    this.crateStack(10, -12, 3);
    for (const [x, z] of [[-12, -12], [12, 12], [12, -12], [-12, 12]]) this.lampPost(x, z);

    // Carril oeste: camión
    this.box(-33, 0.9, -8, -30.6, 3.6, 2, 'containerGreen', { surface: 'metal' });
    this.world.add(-33, 0, -8, -30.6, 0.9, 2, { material: 'metal' });
    this.box(-32.8, 0.5, -7.8, -30.8, 0.9, 1.8, 'darkMetal', { collide: false });
    this.box(-33, 0.5, 2.2, -30.6, 3.0, 5, 'carRed', { surface: 'metal' });
    this.box(-32.9, 2.0, 4.9, -30.7, 2.8, 5.02, 'glass', { collide: false });
    this.world.add(-33, 0, 2.2, -30.6, 0.5, 5, { material: 'metal' });
    for (const z of [-6.5, -4.5, 0.5, 4]) {
      for (const x of [-33.05, -30.55]) this.deco(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 14), 'rubber', x, 0.5, z, 0, 0, Math.PI / 2);
    }
    this.sandbags(-24, -4, -20, -3.4, 1.0);
    this.sandbags(-24, 6, -20, 6.6, 1.0);
    this.crateStack(-40, -14, 2);
    this.crateStack(-40, 8, 3);
    this.jersey(-28, 11, true, 4);

    // Carril este: caseta y tanques
    this.box(36, 0, -6, 39, 2.8, -3, 'plaster');
    this.box(35.8, 2.8, -6.2, 39.2, 3.0, -2.8, 'darkMetal', { collide: false });
    this.box(35.98, 1.2, -5.2, 36.0, 2.2, -3.8, 'glass', { collide: false });
    for (const z of [6, 10]) {
      this.deco(new THREE.CylinderGeometry(1.4, 1.4, 3.5, 20), 'metal', 39.5, 1.75, z);
      this.world.add(38.1, 0, z - 1.4, 40.9, 3.5, z + 1.4, { material: 'metal' });
    }
    this.sandbags(24, -4, 24.6, 0, 1.0);
    this.sandbags(24, 6, 24.6, 10, 1.0);
    this.crateStack(30, 2, 3);
    this.crateStack(18, -6, 1);
    this.jersey(30, 13, true, 4);

    // Sur: aparcamiento
    this.car(-6, 24, true, 'carRed');
    this.car(4, 28, false, 'carGrey');
    this.car(-2, 36, true, 'carGrey');
    this.car(9, 36, false, 'carRed');
    for (let x = -12; x <= 12; x += 3) this.box(x, 0.01, 31.8, x + 0.12, 0.02, 34.6, 'stripe', { collide: false });
    // valla publicitaria
    this.box(-0.15, 0, 41.5, 0.15, 4, 41.8, 'darkMetal', { surface: 'metal' });
    this.box(-4, 4, 41.4, 4, 6.5, 41.7, 'containerYellow', { collide: false });

    // Norte: barricadas
    this.sandbags(-12, -34, -8, -33.4, 1.0);
    this.sandbags(8, -34, 12, -33.4, 1.0);
    this.crateStack(-12, -40, 2);
    this.crateStack(10, -40, 1);

    // Zonas de aparición enemiga (bordes del mapa y edificios)
    this.spawnPoints = [
      [-42, -2], [-42, 12], [42, -2], [42, 2], [-8, -42], [8, -42], [-8, 42], [10, 42],
      [-30, -30], [29, -33], [20, 32], [-30, 26], [-42, -42], [42, -42], [-42, 42], [42, 42],
    ].map(([x, z]) => new THREE.Vector3(x, 0, z));
  }

  buildDynamic() {
    const t = this.tex;
    // Barriles explosivos
    this.barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.2, 18);
    this.barrelMat = new THREE.MeshStandardMaterial({ map: t.barrel.map, roughness: 0.55, metalness: 0.4 });
    this.barrelSpots = [
      [-26, -23.5], [-38, -21.5], [2.5, -9], [-14.5, -1.8], [20, -21], [29.5, -15],
      [24.5, 16], [-20, 18], [-12, 26], [12.5, -30.5], [37, 13.5], [-37, 0], [19, 31],
    ];
    // Suministros
    this.pickupSpots = [
      { type: 'health', p: [-3, 1.5, 2] }, { type: 'health', p: [-34, 0, -36.5] },
      { type: 'health', p: [34.5, 0, 35.5] }, { type: 'health', p: [37.5, 0, -14] },
      { type: 'health', p: [-26, 0, 28.5] },
      { type: 'ammo', p: [3, 1.5, -2] }, { type: 'ammo', p: [-24, 0, -27] },
      { type: 'ammo', p: [20, 0, 22.5] }, { type: 'ammo', p: [-28.5, 0, 24] },
      { type: 'ammo', p: [-20, 0, 9] }, { type: 'ammo', p: [20, 0, -9] },
      { type: 'ammo', p: [0, 0, -27] },
    ];
    this.resetDynamic();
  }

  resetDynamic() {
    for (const b of this.barrels) {
      this.root.remove(b.mesh);
      this.world.remove(b.box);
    }
    this.barrels = [];
    for (const [x, z] of this.barrelSpots) {
      const mesh = new THREE.Mesh(this.barrelGeo, this.barrelMat);
      mesh.position.set(x, 0.6, z);
      mesh.rotation.y = (x * 7 + z) % 3;
      mesh.castShadow = mesh.receiveShadow = true;
      this.root.add(mesh);
      const box = this.world.add(x - 0.4, 0, z - 0.4, x + 0.4, 1.2, z + 0.4, { material: 'metal' });
      const barrel = { mesh, box, hp: 30, alive: true, pos: new THREE.Vector3(x, 0.6, z), fuse: -1 };
      box.barrel = barrel;
      this.barrels.push(barrel);
    }
    this.nav.rebuildRegion(-45, -45, 45, 45);
  }
}
