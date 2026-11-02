// Sistema de colisiones propio basado en AABB (cajas alineadas a ejes).
// Equivalente ligero a Rapier para un FPS: movimiento con deslizamiento,
// subida de escalones, raycast con método de slabs y consultas de solapamiento.

const EPS = 0.001;

export class CollisionWorld {
  constructor() {
    this.boxes = [];
    // Rejilla espacial 2D (XZ) para acelerar consultas
    this.cell = 4;
    this.grid = new Map();
  }

  clear() {
    this.boxes.length = 0;
    this.grid.clear();
  }

  _key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }

  add(minX, minY, minZ, maxX, maxY, maxZ, data = {}) {
    const box = {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
      active: true,
      ...data,
    };
    this.boxes.push(box);
    const c = this.cell;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++) {
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const k = this._key(ix, iz);
        let arr = this.grid.get(k);
        if (!arr) { arr = []; this.grid.set(k, arr); }
        arr.push(box);
      }
    }
    return box;
  }

  remove(box) { box.active = false; }

  // Devuelve cajas candidatas en un rango XZ
  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const c = this.cell;
    const stamp = ++this._stamp || (this._stamp = 1);
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++) {
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const arr = this.grid.get(this._key(ix, iz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const b = arr[i];
          if (!b.active || b._stamp === stamp) continue;
          b._stamp = stamp;
          out.push(b);
        }
      }
    }
    return out;
  }

  // Solapamiento de un cuerpo (cilindro aproximado por AABB) con el mundo
  overlaps(pos, r, h, out = []) {
    const cand = this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r, this._tmp || (this._tmp = []));
    out.length = 0;
    for (let i = 0; i < cand.length; i++) {
      const b = cand[i];
      if (b.noBody) continue;
      if (pos.x - r < b.max.x - EPS && pos.x + r > b.min.x + EPS &&
          pos.y < b.max.y - EPS && pos.y + h > b.min.y + EPS &&
          pos.z - r < b.max.z - EPS && pos.z + r > b.min.z + EPS) out.push(b);
    }
    return out;
  }

  _moveAxis(pos, r, h, axis, amount) {
    if (amount === 0) return false;
    pos[axis] += amount;
    const hits = this.overlaps(pos, r, h, this._hits || (this._hits = []));
    if (hits.length === 0) return false;
    for (const b of hits) {
      if (axis === 'y') {
        if (amount > 0) pos.y = Math.min(pos.y, b.min.y - h - EPS);
        else pos.y = Math.max(pos.y, b.max.y + EPS);
      } else if (amount > 0) {
        pos[axis] = Math.min(pos[axis], b.min[axis] - r - EPS);
      } else {
        pos[axis] = Math.max(pos[axis], b.max[axis] + r + EPS);
      }
    }
    return true;
  }

  // Mueve un cuerpo con deslizamiento y subida de escalones.
  // Devuelve {grounded, hitCeiling, hitWall, stepped}
  move(pos, r, h, delta, grounded, stepHeight = 0.45) {
    const res = { grounded: false, hitCeiling: false, hitWall: false, stepped: 0 };
    const len = Math.max(Math.abs(delta.x), Math.abs(delta.y), Math.abs(delta.z));
    const steps = Math.max(1, Math.ceil(len / 0.15));
    const dx = delta.x / steps, dy = delta.y / steps, dz = delta.z / steps;

    for (let s = 0; s < steps; s++) {
      // Vertical
      if (this._moveAxis(pos, r, h, 'y', dy)) {
        if (dy < 0) { res.grounded = true; grounded = true; } else res.hitCeiling = true;
      }
      // Horizontal con escalones
      for (const axis of ['x', 'z']) {
        const amt = axis === 'x' ? dx : dz;
        if (amt === 0) continue;
        const sx = pos.x, sy = pos.y, sz = pos.z;
        if (this._moveAxis(pos, r, h, axis, amt)) {
          if (grounded && stepHeight > 0) {
            // Intentar subir escalón
            const blockedAt = pos[axis];
            pos.x = sx; pos.y = sy; pos.z = sz;
            pos.y += stepHeight;
            if (this.overlaps(pos, r, h, this._hits).length === 0) {
              pos[axis] += amt;
              if (this.overlaps(pos, r, h, this._hits).length === 0) {
                // Bajar hasta apoyar
                const beforeY = pos.y;
                this._moveAxis(pos, r, h, 'y', -stepHeight - 0.01);
                res.stepped += pos.y - sy;
                if (pos.y > beforeY) pos.y = beforeY;
                continue;
              }
            }
            pos.x = sx; pos.y = sy; pos.z = sz;
            pos[axis] = blockedAt;
          }
          res.hitWall = true;
        }
      }
    }
    // Comprobación de suelo (pequeña sonda)
    if (!res.grounded && delta.y <= 0) {
      pos.y -= 0.05;
      if (this.overlaps(pos, r, h, this._hits).length > 0) res.grounded = true;
      pos.y += 0.05;
    }
    return res;
  }

  // Raycast contra cajas. dir debe estar normalizada.
  // Devuelve {t, box, normal:{x,y,z}} o null
  raycast(origin, dir, maxDist, filter = null) {
    // Recorrido por celdas de la rejilla (DDA aproximado mediante muestreo del bounding del rayo)
    const ex = origin.x + dir.x * maxDist, ez = origin.z + dir.z * maxDist;
    const minX = Math.min(origin.x, ex), maxX = Math.max(origin.x, ex);
    const minZ = Math.min(origin.z, ez), maxZ = Math.max(origin.z, ez);
    let cand;
    if ((maxX - minX) * (maxZ - minZ) > 900) cand = this.boxes; // rayos muy largos y diagonales
    else cand = this.query(minX, minZ, maxX, maxZ, this._rayTmp || (this._rayTmp = []));

    let best = maxDist, bestBox = null, bestAxis = 0, bestSign = 0;
    const ix = 1 / (dir.x || 1e-9), iy = 1 / (dir.y || 1e-9), iz = 1 / (dir.z || 1e-9);
    for (let i = 0; i < cand.length; i++) {
      const b = cand[i];
      if (!b.active || b.noRay) continue;
      if (filter && !filter(b)) continue;
      let t1 = (b.min.x - origin.x) * ix, t2 = (b.max.x - origin.x) * ix;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2), axis = 0;
      t1 = (b.min.y - origin.y) * iy; t2 = (b.max.y - origin.y) * iy;
      let n = Math.min(t1, t2);
      if (n > tmin) { tmin = n; axis = 1; }
      tmax = Math.min(tmax, Math.max(t1, t2));
      t1 = (b.min.z - origin.z) * iz; t2 = (b.max.z - origin.z) * iz;
      n = Math.min(t1, t2);
      if (n > tmin) { tmin = n; axis = 2; }
      tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmax >= Math.max(tmin, 0) && tmin < best && tmin >= 0) {
        best = tmin; bestBox = b; bestAxis = axis;
        bestSign = axis === 0 ? -Math.sign(dir.x) : axis === 1 ? -Math.sign(dir.y) : -Math.sign(dir.z);
      }
    }
    if (!bestBox) return null;
    return {
      t: best,
      box: bestBox,
      normal: { x: bestAxis === 0 ? bestSign : 0, y: bestAxis === 1 ? bestSign : 0, z: bestAxis === 2 ? bestSign : 0 },
    };
  }

  // Línea de visión libre entre dos puntos
  lineOfSight(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.001) return true;
    const dir = { x: dx / d, y: dy / d, z: dz / d };
    const hit = this.raycast(a, dir, d, (bx) => !bx.seeThrough);
    return !hit;
  }
}
