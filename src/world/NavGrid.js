// Rejilla de navegación 2.5D con A* para la IA enemiga.
// Cada celda guarda la altura del suelo transitable y si está bloqueada.

export class NavGrid {
  constructor(world, half = 45, cell = 0.5, agentRadius = 0.32) {
    this.world = world;
    this.half = half;
    this.cell = cell;
    this.n = Math.round((half * 2) / cell);
    const N = this.n * this.n;
    this.height = new Float32Array(N);
    this.blocked = new Uint8Array(N);
    this.g = new Float32Array(N);
    this.parent = new Int32Array(N);
    this.gen = new Uint32Array(N);
    this.closedGen = new Uint32Array(N);
    this.curGen = 0;
    // montículo binario preasignado (sin crear objetos durante la búsqueda)
    this.heapF = new Float32Array(N * 2);
    this.heapI = new Int32Array(N * 2);
    this.agentRadius = agentRadius;
    this.build();
  }

  idx(ix, iz) { return iz * this.n + ix; }
  toCell(x, z) {
    return [Math.floor((x + this.half) / this.cell), Math.floor((z + this.half) / this.cell)];
  }
  cellCenter(ix, iz) {
    return [-this.half + (ix + 0.5) * this.cell, -this.half + (iz + 0.5) * this.cell];
  }

  build() {
    const { n, cell, world } = this;
    const tmp = [];
    const r = this.agentRadius;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const [cx, cz] = this.cellCenter(ix, iz);
        const id = this.idx(ix, iz);
        // altura del suelo en el centro de la celda
        const cand = world.query(cx - cell, cz - cell, cx + cell, cz + cell, tmp);
        let h = -10;
        for (const b of cand) {
          if (b.noBody) continue;
          if (cx >= b.min.x && cx <= b.max.x && cz >= b.min.z && cz <= b.max.z && b.max.y <= 2.0 && b.max.y > h) h = b.max.y;
        }
        if (h < -5) { this.blocked[id] = 1; this.height[id] = 0; continue; }
        this.height[id] = h;
        // bloqueo: algo ocupa el espacio del cuerpo sobre ese suelo
        let blk = 0;
        for (const b of cand) {
          if (b.noBody) continue;
          if (cx + r > b.min.x && cx - r < b.max.x && cz + r > b.min.z && cz - r < b.max.z &&
              b.max.y > h + 0.46 && b.min.y < h + 1.8) { blk = 1; break; }
        }
        this.blocked[id] = blk;
      }
    }
  }

  // Desbloquea/recalcula una región (p. ej. tras destruir un barril)
  rebuildRegion(minX, minZ, maxX, maxZ) {
    const saved = this.build;
    // reconstrucción simple completa de la región
    const [ax, az] = this.toCell(minX - 1, minZ - 1);
    const [bx, bz] = this.toCell(maxX + 1, maxZ + 1);
    const tmp = [];
    const r = this.agentRadius, cell = this.cell;
    for (let iz = Math.max(0, az); iz <= Math.min(this.n - 1, bz); iz++) {
      for (let ix = Math.max(0, ax); ix <= Math.min(this.n - 1, bx); ix++) {
        const [cx, cz] = this.cellCenter(ix, iz);
        const id = this.idx(ix, iz);
        const cand = this.world.query(cx - cell, cz - cell, cx + cell, cz + cell, tmp);
        let h = -10;
        for (const b of cand) {
          if (b.noBody) continue;
          if (cx >= b.min.x && cx <= b.max.x && cz >= b.min.z && cz <= b.max.z && b.max.y <= 2.0 && b.max.y > h) h = b.max.y;
        }
        if (h < -5) { this.blocked[id] = 1; continue; }
        this.height[id] = h;
        let blk = 0;
        for (const b of cand) {
          if (b.noBody) continue;
          if (cx + r > b.min.x && cx - r < b.max.x && cz + r > b.min.z && cz - r < b.max.z &&
              b.max.y > h + 0.46 && b.min.y < h + 1.8) { blk = 1; break; }
        }
        this.blocked[id] = blk;
      }
    }
    return saved;
  }

  walkable(ix, iz) {
    return ix >= 0 && iz >= 0 && ix < this.n && iz < this.n && !this.blocked[this.idx(ix, iz)];
  }

  // Celda transitable más cercana a una posición
  nearest(x, z, maxR = 8) {
    const [cx, cz] = this.toCell(x, z);
    if (this.walkable(cx, cz)) return [cx, cz];
    for (let r = 1; r <= maxR; r++) {
      let best = null, bd = Infinity;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        if (this.walkable(cx + dx, cz + dz)) {
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = [cx + dx, cz + dz]; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  canStep(a, b) { return Math.abs(this.height[a] - this.height[b]) <= 0.46; }

  // A* con heap binario. Devuelve lista de puntos [{x,y,z}] o null
  findPath(sx, sz, tx, tz, maxIter = 6000) {
    const s = this.nearest(sx, sz), t = this.nearest(tx, tz);
    if (!s || !t) return null;
    const n = this.n;
    const start = this.idx(s[0], s[1]), goal = this.idx(t[0], t[1]);
    if (start === goal) return [this._pt(goal)];
    const gen = ++this.curGen;
    const HF = this.heapF, HI = this.heapI, cap = HF.length;
    let size = 0;
    const push = (id, f) => {
      if (size >= cap) return;
      let i = size++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (HF[p] <= f) break;
        HF[i] = HF[p]; HI[i] = HI[p]; i = p;
      }
      HF[i] = f; HI[i] = id;
    };
    const pop = () => {
      const top = HI[0];
      const lf = HF[--size], li = HI[size];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= size) break;
        const r = l + 1;
        const m = r < size && HF[r] < HF[l] ? r : l;
        if (HF[m] >= lf) break;
        HF[i] = HF[m]; HI[i] = HI[m]; i = m;
      }
      HF[i] = lf; HI[i] = li;
      return top;
    };
    const gx = t[0], gz = t[1];
    const hfun = (ix, iz) => {
      const dx = Math.abs(ix - gx), dz = Math.abs(iz - gz);
      return (dx + dz) + (1.4142 - 2) * Math.min(dx, dz);
    };
    this.gen[start] = gen; this.g[start] = 0; this.parent[start] = -1;
    push(start, hfun(s[0], s[1]));
    let iter = 0, found = false;
    let bestId = start, bestH = Infinity;
    while (size > 0 && iter++ < maxIter) {
      const cur = pop();
      if (this.closedGen[cur] === gen) continue;
      this.closedGen[cur] = gen;
      if (cur === goal) { found = true; break; }
      const cx = cur % n, cz = (cur / n) | 0;
      const hh = hfun(cx, cz);
      if (hh < bestH) { bestH = hh; bestId = cur; }
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (!this.walkable(nx, nz)) continue;
        const nid = this.idx(nx, nz);
        if (this.closedGen[nid] === gen) continue;
        if (!this.canStep(cur, nid)) continue;
        if (dx && dz) {
          // evitar cortar esquinas
          const a = this.idx(cx + dx, cz), b = this.idx(cx, cz + dz);
          if (!this.walkable(cx + dx, cz) || !this.walkable(cx, cz + dz) || !this.canStep(cur, a) || !this.canStep(cur, b)) continue;
        }
        const ng = this.g[cur] + (dx && dz ? 1.4142 : 1);
        if (this.gen[nid] !== gen || ng < this.g[nid]) {
          this.gen[nid] = gen; this.g[nid] = ng; this.parent[nid] = cur;
          push(nid, ng + hfun(nx, nz));
        }
      }
    }
    const end = found ? goal : bestId;
    const ids = [];
    for (let c = end; c !== -1; c = this.parent[c]) { ids.push(c); if (ids.length > 5000) break; }
    ids.reverse();
    return this._smooth(ids);
  }

  _pt(id) {
    const ix = id % this.n, iz = (id / this.n) | 0;
    const [x, z] = this.cellCenter(ix, iz);
    return { x, y: this.height[id], z };
  }

  // Comprueba si una línea recta entre dos celdas es transitable
  _lineWalkable(a, b) {
    const n = this.n;
    const ax = a % n, az = (a / n) | 0, bx = b % n, bz = (b / n) | 0;
    const steps = Math.max(Math.abs(bx - ax), Math.abs(bz - az)) * 2;
    let prev = a;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = Math.round(ax + (bx - ax) * t), z = Math.round(az + (bz - az) * t);
      // comprobar también celdas vecinas para mantener holgura
      if (!this.walkable(x, z)) return false;
      const id = this.idx(x, z);
      if (!this.canStep(prev, id)) return false;
      prev = id;
    }
    return true;
  }

  _smooth(ids) {
    if (ids.length <= 2) return ids.map((i) => this._pt(i));
    const out = [ids[0]];
    let i = 0;
    while (i < ids.length - 1) {
      let j = Math.min(ids.length - 1, i + 40);
      while (j > i + 1 && !this._lineWalkable(ids[i], ids[j])) j--;
      out.push(ids[j]);
      i = j;
    }
    return out.slice(1).map((id) => this._pt(id));
  }

  randomWalkable(rand = Math.random) {
    for (let k = 0; k < 200; k++) {
      const ix = (rand() * this.n) | 0, iz = (rand() * this.n) | 0;
      if (this.walkable(ix, iz) && this.height[this.idx(ix, iz)] < 0.1) {
        const [x, z] = this.cellCenter(ix, iz);
        return { x, z };
      }
    }
    return { x: 0, z: 10 };
  }
}
