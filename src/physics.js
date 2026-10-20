// ステージの当たり判定（箱・たて円柱・球）と、光線の当たり
import * as THREE from 'three';

// 当たりの形：
//  { t:'box', x,y,z, hx,hy,hz, ry }  ry だけ回せる箱
//  { t:'cyl', x,z, r, y0, y1 }       たての円柱
//  { t:'sph', x,y,z, r }
export class World {
  constructor() {
    this.cols = [];
    this.floorY = 0;
    this.bounds = null; // {x, zMin, zMax, yMin, yMax}
    this.grid = new Map();
    this.cell = 24;
  }
  add(c) {
    // 回転の cos/sin と、ざっくりの範囲を先に計算しておく
    if (c.t === 'box') {
      c.cos = Math.cos(c.ry || 0);
      c.sin = Math.sin(c.ry || 0);
      const ex = Math.abs(c.hx * c.cos) + Math.abs(c.hz * c.sin);
      const ez = Math.abs(c.hx * c.sin) + Math.abs(c.hz * c.cos);
      c.min = [c.x - ex, c.y - c.hy, c.z - ez];
      c.max = [c.x + ex, c.y + c.hy, c.z + ez];
    } else if (c.t === 'cyl') {
      c.min = [c.x - c.r, c.y0, c.z - c.r];
      c.max = [c.x + c.r, c.y1, c.z + c.r];
    } else {
      c.min = [c.x - c.r, c.y - c.r, c.z - c.r];
      c.max = [c.x + c.r, c.y + c.r, c.z + c.r];
    }
    c.id = this.cols.length;
    this.cols.push(c);
    const s = this.cell;
    for (let gx = Math.floor(c.min[0] / s); gx <= Math.floor(c.max[0] / s); gx++)
      for (let gz = Math.floor(c.min[2] / s); gz <= Math.floor(c.max[2] / s); gz++) {
        const k = gx + ',' + gz;
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(c);
      }
    return c;
  }
  near(x, z, r, out) {
    out.length = 0;
    const s = this.cell;
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let gx = Math.floor((x - r) / s); gx <= Math.floor((x + r) / s); gx++)
      for (let gz = Math.floor((z - r) / s); gz <= Math.floor((z + r) / s); gz++) {
        const arr = this.grid.get(gx + ',' + gz);
        if (!arr) continue;
        for (const c of arr) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          out.push(c);
        }
      }
    return out;
  }

  // 球（中心 p, 半径 r）をステージから押し出す。地面に立ったら ground を返す
  // vel を壁の向きに沿わせる。戻り値：{ground:boolean, normal:Vector3|null, hitWall:boolean}
  resolveSphere(p, r, vel, info) {
    info.ground = false;
    info.hitWall = false;
    info.wallNormal.set(0, 0, 0);
    info.groundY = -Infinity;
    const list = this.near(p.x, p.z, r + 1, this._tmpList || (this._tmpList = []));
    for (let iter = 0; iter < 2; iter++) {
      for (const c of list) {
        if (p.x + r < c.min[0] || p.x - r > c.max[0] || p.y + r < c.min[1] || p.y - r > c.max[1] || p.z + r < c.min[2] || p.z - r > c.max[2]) continue;
        if (!pushOut(c, p, r, _n)) continue;
        applyNormal(_n, vel, info);
      }
    }
    // 床（雲海）
    if (p.y - r < this.floorY) {
      p.y = this.floorY + r;
      _n.set(0, 1, 0);
      _n.w = 0;
      applyNormal(_n, vel, info);
    }
    // 場外の見えない壁
    const b = this.bounds;
    if (b) {
      if (p.x < -b.x) { p.x = -b.x; if (vel.x < 0) vel.x = 0; info.hitWall = true; info.wallNormal.set(1, 0, 0); }
      if (p.x > b.x) { p.x = b.x; if (vel.x > 0) vel.x = 0; info.hitWall = true; info.wallNormal.set(-1, 0, 0); }
      if (p.z < b.zMin) { p.z = b.zMin; if (vel.z < 0) vel.z = 0; info.hitWall = true; info.wallNormal.set(0, 0, 1); }
      if (p.z > b.zMax) { p.z = b.zMax; if (vel.z > 0) vel.z = 0; info.hitWall = true; info.wallNormal.set(0, 0, -1); }
      if (p.y > b.yMax) { p.y = b.yMax; if (vel.y > 0) vel.y = 0; }
    }
    return info;
  }

  // 光線：最初に当たる距離（なければ Infinity）
  raycast(o, d, maxDist) {
    let best = maxDist;
    // 調べる範囲：光線が通るマス（ざっくり：はじめと終わりを含む範囲）
    const ex = o.x + d.x * maxDist, ez = o.z + d.z * maxDist;
    const minx = Math.min(o.x, ex), maxx = Math.max(o.x, ex), minz = Math.min(o.z, ez), maxz = Math.max(o.z, ez);
    const list = this._rayList || (this._rayList = []);
    list.length = 0;
    const s = this.cell;
    const seen = this._seen2 || (this._seen2 = new Set());
    seen.clear();
    for (let gx = Math.floor(minx / s); gx <= Math.floor(maxx / s); gx++)
      for (let gz = Math.floor(minz / s); gz <= Math.floor(maxz / s); gz++) {
        const arr = this.grid.get(gx + ',' + gz);
        if (!arr) continue;
        for (const c of arr) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          list.push(c);
        }
      }
    for (const c of list) {
      const t = rayHit(c, o, d, best);
      if (t < best) best = t;
    }
    if (d.y < 0) {
      const t = (this.floorY - o.y) / d.y;
      if (t >= 0 && t < best) best = t;
    }
    return best;
  }

  // 下にある床の高さ（影を置く場所）
  groundBelow(p, maxDown = 80) {
    const t = this.raycast(p, _down, maxDown);
    return t === Infinity || t >= maxDown ? null : p.y - t;
  }
}

const _down = new THREE.Vector3(0, -1, 0);
const _n = new THREE.Vector3();
const _l = new THREE.Vector3();

function applyNormal(n, vel, info) {
  const vn = vel.x * n.x + vel.y * n.y + vel.z * n.z;
  if (vn < 0) {
    vel.x -= n.x * vn;
    vel.y -= n.y * vn;
    vel.z -= n.z * vn;
  }
  if (n.y > 0.62) {
    info.ground = true;
  } else if (Math.abs(n.y) < 0.62) {
    info.hitWall = true;
    info.wallNormal.copy(n);
  }
}

// 球と形の重なりを解消（p を動かす）。重なっていたら true、n に押し出す向き
function pushOut(c, p, r, n) {
  if (c.t === 'sph') {
    const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const R = c.r + r;
    if (d2 >= R * R) return false;
    const d = Math.sqrt(d2) || 0.0001;
    n.set(dx / d, dy / d, dz / d);
    p.x = c.x + n.x * R;
    p.y = c.y + n.y * R;
    p.z = c.z + n.z * R;
    return true;
  }
  if (c.t === 'cyl') {
    const dx = p.x - c.x, dz = p.z - c.z;
    const rd = Math.hypot(dx, dz);
    const inY = p.y >= c.y0 && p.y <= c.y1;
    if (inY) {
      if (rd >= c.r + r) return false;
      // 横から当たるか、上下から当たるか、近いほうへ押す
      const side = c.r + r - rd;
      const top = c.y1 + r - p.y;
      const bot = p.y - (c.y0 - r);
      if (side < top && side < bot) {
        const k = rd > 0.0001 ? 1 / rd : 0;
        n.set(dx * k || 1, 0, dz * k);
        p.x = c.x + n.x * (c.r + r);
        p.z = c.z + n.z * (c.r + r);
      } else if (top < bot) {
        n.set(0, 1, 0);
        p.y = c.y1 + r;
      } else {
        n.set(0, -1, 0);
        p.y = c.y0 - r;
      }
      return true;
    }
    // 上または下のふちの近く
    const cy = p.y > c.y1 ? c.y1 : c.y0;
    const rr = Math.min(rd, c.r);
    const k = rd > 0.0001 ? rr / rd : 0;
    const qx = c.x + dx * k, qz = c.z + dz * k;
    const ddx = p.x - qx, ddy = p.y - cy, ddz = p.z - qz;
    const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
    if (d2 >= r * r) return false;
    const d = Math.sqrt(d2) || 0.0001;
    n.set(ddx / d, ddy / d, ddz / d);
    p.x = qx + n.x * r;
    p.y = cy + n.y * r;
    p.z = qz + n.z * r;
    return true;
  }
  // 箱（yだけ回転）
  const dx = p.x - c.x, dz = p.z - c.z;
  const lx = dx * c.cos - dz * c.sin;
  const lz = dx * c.sin + dz * c.cos;
  const ly = p.y - c.y;
  const qx = Math.max(-c.hx, Math.min(c.hx, lx));
  const qy = Math.max(-c.hy, Math.min(c.hy, ly));
  const qz = Math.max(-c.hz, Math.min(c.hz, lz));
  let nx = lx - qx, ny = ly - qy, nz = lz - qz;
  let d2 = nx * nx + ny * ny + nz * nz;
  if (d2 > 0.000001) {
    if (d2 >= r * r) return false;
    const d = Math.sqrt(d2);
    nx /= d;
    ny /= d;
    nz /= d;
    const fx = qx + nx * r, fy = qy + ny * r, fz = qz + nz * r;
    setWorld(c, fx, fy, fz, p);
  } else {
    // 中心が箱の中：いちばん近い面へ
    const px = c.hx - Math.abs(lx), py = c.hy - Math.abs(ly), pz = c.hz - Math.abs(lz);
    let fx = lx, fy = ly, fz = lz;
    nx = ny = nz = 0;
    if (py <= px && py <= pz) {
      ny = Math.sign(ly) || 1;
      fy = ny * (c.hy + r);
    } else if (px <= pz) {
      nx = Math.sign(lx) || 1;
      fx = nx * (c.hx + r);
    } else {
      nz = Math.sign(lz) || 1;
      fz = nz * (c.hz + r);
    }
    setWorld(c, fx, fy, fz, p);
  }
  // 法線を世界の向きへ
  n.set(nx * c.cos + nz * c.sin, ny, -nx * c.sin + nz * c.cos);
  return true;
}
function setWorld(c, lx, ly, lz, p) {
  p.x = c.x + lx * c.cos + lz * c.sin;
  p.y = c.y + ly;
  p.z = c.z - lx * c.sin + lz * c.cos;
}

// 光線と形
function rayHit(c, o, d, maxT) {
  if (c.t === 'sph') {
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const cc = ox * ox + oy * oy + oz * oz - c.r * c.r;
    const disc = b * b - cc;
    if (disc < 0) return Infinity;
    const t = -b - Math.sqrt(disc);
    return t >= 0 && t < maxT ? t : cc < 0 ? 0 : Infinity;
  }
  if (c.t === 'cyl') {
    // 横の面
    let best = Infinity;
    const ox = o.x - c.x, oz = o.z - c.z;
    const a = d.x * d.x + d.z * d.z;
    if (a > 1e-8) {
      const b = ox * d.x + oz * d.z;
      const cc = ox * ox + oz * oz - c.r * c.r;
      const disc = b * b - a * cc;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / a;
        if (t >= 0) {
          const y = o.y + d.y * t;
          if (y >= c.y0 && y <= c.y1) best = t;
        }
        if (cc < 0 && o.y >= c.y0 && o.y <= c.y1) return 0;
      }
    }
    // 上下のふた
    if (Math.abs(d.y) > 1e-8) {
      for (const y of [c.y0, c.y1]) {
        const t = (y - o.y) / d.y;
        if (t >= 0 && t < best) {
          const x = ox + d.x * t, z = oz + d.z * t;
          if (x * x + z * z <= c.r * c.r) best = t;
        }
      }
    }
    return best < maxT ? best : Infinity;
  }
  // 箱：箱の中の座標で slab 法
  const dx = o.x - c.x, dz = o.z - c.z;
  const lox = dx * c.cos - dz * c.sin, loz = dx * c.sin + dz * c.cos, loy = o.y - c.y;
  const ldx = d.x * c.cos - d.z * c.sin, ldz = d.x * c.sin + d.z * c.cos, ldy = d.y;
  let tmin = 0, tmax = maxT;
  const sl = [
    [lox, ldx, c.hx],
    [loy, ldy, c.hy],
    [loz, ldz, c.hz],
  ];
  for (const [oo, dd, h] of sl) {
    if (Math.abs(dd) < 1e-9) {
      if (oo < -h || oo > h) return Infinity;
    } else {
      let t1 = (-h - oo) / dd, t2 = (h - oo) / dd;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

export function makeHitInfo() {
  return { ground: false, hitWall: false, wallNormal: new THREE.Vector3(), groundY: 0 };
}
