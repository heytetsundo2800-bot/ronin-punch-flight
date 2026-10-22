// キャラの足もとの影（丸い影を、真下の床に置く）
// 空中戦では「どれくらいの高さにいるか」が分かりにくい。UTS2の講演でも、飛んでいくキャラは
// 高さに合わせて影を小さく・うすくする（AOに近い考え方）と説明されていた。それと同じにする
import * as THREE from 'three';
import { shadowTex } from './gfx.js';

const MAX_DOWN = 46;
const _p = new THREE.Vector3();

export class BlobShadows {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.geo.rotateX(-Math.PI / 2);
    this.base = new THREE.MeshBasicMaterial({ map: shadowTex(), color: 0x1a1030, transparent: true, depthWrite: false, opacity: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true });
    this.items = new Map();
    this.n = 0;
  }
  update(punchers) {
    this.n++;
    for (const p of punchers) {
      let it = this.items.get(p);
      if (!it) {
        const m = new THREE.Mesh(this.geo, this.base.clone());
        m.renderOrder = 1;
        m.frustumCulled = false;
        this.scene.add(m);
        it = { m, gy: null, k: 0 };
        this.items.set(p, it);
      }
      const m = it.m;
      if (!p.alive || !p.model || !p.model.visible) {
        m.visible = false;
        continue;
      }
      // 下の床を調べるのは、2フレームに1回（人ごとにずらす）
      if (it.gy == null || (this.n + (p.netId || 0)) % 2 === 0) {
        _p.copy(p.pos);
        it.gy = this.world.groundBelow(_p, MAX_DOWN, 'tree'); // 木の上には落とさない
      }
      if (it.gy == null) {
        m.visible = false;
        continue;
      }
      const h = Math.max(0, p.pos.y - it.gy);
      const k = 1 - Math.min(1, h / MAX_DOWN);
      m.visible = k > 0.03;
      m.position.set(p.pos.x, it.gy + 0.05, p.pos.z);
      const big = p.buffs && p.buffs.big > 0 ? 2.3 : 1;
      const s = (0.9 + 0.9 * k) * big;
      m.scale.set(s, 1, s);
      m.material.opacity = 0.85 * k * k + 0.1;
    }
  }
  dispose() {
    for (const it of this.items.values()) {
      this.scene.remove(it.m);
      it.m.material.dispose();
    }
    this.items.clear();
    this.geo.dispose();
    this.base.dispose();
  }
}
