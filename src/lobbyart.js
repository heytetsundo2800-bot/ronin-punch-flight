// ロビー（タイトル・ホーム・キャラ選び）の背景
// ステージと同じ描き方（stageart.js の空・雲海・雲・浮島のシェーダー）で作る。
// 前は「グラデーションの空＋円柱と円すいの島」だけで、いちばん最初に見る画面がいちばん素人っぽかった
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as ART from './stageart.js';
import { toon, addOutline, lineColor } from './gfx.js';
import { mulberry32, TAU } from './util.js';

// 昼のサクラ浮島と同じ色合い。太陽の光る場所は、カメラから見て右上の奥（ロゴのうしろが明るくなる）
const ENV = {
  fog: [0xcfe7fb, 70, 430],
  hemi: [0xffffff, 0x8fa4d6, 1.55],
  sun: [0xfff1dc, 2.2, [4, 8, 6]], // 島とキャラを照らす光（手前の右上から）
  sky: { zen: 0x1d6fe0, up: 0x55a6f4, hor: 0xbfe2fb, horSun: 0xe8f6ff, fog: 0xcfe7fb, sun: [0.42, 0.4, -0.81], sunCol: 0xfffbea, glowCol: 0xfff0c8, glow: 0.42, halo: 0.6, cirrus: 0.45, cirrusCol: 0xf6fbff },
  sea: { lit: 0xebf0fb, shade: 0xbcc8ee, deep: 0xa2b0e0, flat: 0xd9e6f9, sunDir: [0.4, 1.0, -0.6] },
  cloud: { lit: 0xedf1fb, shade: 0xb9c3ec, core: 0x9da8dd, rim: 0xffffff, horizon: 0xcfe7fb, sunDir: [0.42, 0.4, -0.81] },
  light: { lit: [1.0, 0.985, 0.95], shade: [0.66, 0.69, 0.86], rim: [0.55, 0.6, 0.66], bounce: [0.1, 0.12, 0.2] },
};
const ROCK = { rockA: 0xb39379, rockB: 0x957764, rockC: 0xc9ae8f, crack: 0x5a4136, soil: 0x6e4a30, moss: 0x6ea84f };
const GRASS = { g1: 0x7fca5a, g2: 0x5ea845, g3: 0xaedd6b, petal: 0xffbfd4, petal2: 0xffe4ee, petalAmt: 0.55 };

// 足場の島の上面の高さ（キャラの足もと）
export const LOBBY_GROUND = -0.71;

export function buildLobbyArt(scene) {
  const rnd = mulberry32(20261022);
  const out = { list: [] };
  const add = (m) => {
    scene.add(m);
    out.list.push(m);
    return m;
  };
  scene.fog = new THREE.Fog(ENV.fog[0], ENV.fog[1], ENV.fog[2]);
  // 空
  const sky = add(new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), ART.skyMaterial(ENV.sky)));
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  // 雲海（ずっと下）
  const seaG = new THREE.PlaneGeometry(2600, 2600, 1, 1);
  seaG.rotateX(-Math.PI / 2);
  const sea = add(new THREE.Mesh(seaG, ART.seaMaterial(ENV, ENV.sea)));
  sea.position.y = -34;
  out.sea = sea;
  // 雲：遠くの輪（霧なし・空になじむ）と、少し近くの雲
  const farG = [], midG = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU + (rnd() - 0.5) * 0.3;
    const r = 430 + rnd() * 160;
    const size = 22 + rnd() * 28;
    const y = -40 + rnd() * 55 + (rnd() < 0.3 ? 40 + rnd() * 50 : 0);
    farG.push(ART.cloudCluster(rnd, Math.cos(a) * r, y, Math.sin(a) * r - 120, size, { yaw: a + Math.PI / 2, detail: 2, smallDetail: 1, tower: rnd() < 0.45, blend: 0.42, smallR: 0.42, bumps: 2 }));
  }
  // 画面に入りやすい奥の雲（カメラは -z を見ている）
  const MID = [
    [-70, 6, -150, 16],
    [85, 22, -210, 20],
    [-150, 30, -260, 24],
    [160, -6, -170, 14],
    [20, -20, -120, 12],
    [-40, -26, -80, 9],
  ];
  for (const [x, y, z, s] of MID) midG.push(ART.cloudCluster(rnd, x, y, z, s, { yaw: rnd() * 0.6 - 0.3, detail: 2, smallDetail: 1, tower: s > 15, smallR: 0.4, bumps: 2 }));
  // 雲海のもこもこ
  for (let i = 0; i < 14; i++) {
    const a = rnd() * TAU;
    const r = 60 + rnd() * 300;
    const size = 9 + rnd() * 15;
    midG.push(ART.cloudCluster(rnd, Math.cos(a) * r, -34 - size * 0.3, Math.sin(a) * r - 60, size, { flat: 0.42, detail: 1, n: 3 + Math.floor(rnd() * 3), len: 2.4 + rnd(), bumps: 1 }));
  }
  const merged = (list) => {
    const g = mergeGeometries(list, false);
    list.forEach((q) => q.dispose());
    return g;
  };
  const far = add(new THREE.Mesh(merged(farG), ART.cloudMaterial(ENV, { ...ENV.cloud, far: true })));
  far.frustumCulled = false;
  add(new THREE.Mesh(merged(midG), ART.cloudMaterial(ENV, { ...ENV.cloud, far: false })));
  // 浮島：足場（キャラが立つ）＋奥にいくつか
  const rockG = [], grassG = [];
  const isle = (x, top, z, R, depth) => {
    rockG.push(ART.islandRock(rnd, x, top, z, R, depth));
    grassG.push(ART.islandGrass(rnd, x, top, z, R));
  };
  isle(0, LOBBY_GROUND - 0.15, 0, 3.6, 3.4);
  const FAR_ISLES = [
    [-24, -7, -52, 6.5, 6],
    [30, 3, -88, 9, 8],
    [-62, 11, -132, 12, 11],
    [70, -14, -46, 5, 5],
    [8, 20, -190, 16, 14],
    [-12, -20, -30, 3, 3],
  ];
  for (const [x, y, z, R, d] of FAR_ISLES) isle(x, y, z, R, d);
  const rockM = ART.rockMaterial(ENV, ROCK);
  const grassM = ART.grassMaterial(ENV, GRASS);
  add(new THREE.Mesh(merged(rockG), rockM));
  add(new THREE.Mesh(merged(grassG), grassM));
  // 奥の島にサクラの木（幹＋花のかたまり）
  const trunkG = [], blossomG = [];
  const tree = (x, y, z, s) => {
    const t = new THREE.CylinderGeometry(0.16 * s, 0.3 * s, 2.4 * s, 7);
    t.translate(x, y + 1.2 * s, z);
    trunkG.push(t);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + rnd();
      const r = (0.5 + rnd() * 0.7) * s;
      const b = new THREE.IcosahedronGeometry((0.8 + rnd() * 0.5) * s, 1);
      b.translate(x + Math.cos(a) * r, y + (2.5 + rnd() * 0.9) * s, z + Math.sin(a) * r);
      blossomG.push(b);
    }
    const top = new THREE.IcosahedronGeometry(1.05 * s, 1);
    top.translate(x, y + 3.3 * s, z);
    blossomG.push(top);
  };
  tree(-25.5, -6.8, -53, 1.6);
  tree(-21, -6.8, -50, 1.1);
  tree(31, 3.2, -90, 2.0);
  tree(-60, 11.2, -134, 2.6);
  tree(10, 20.2, -192, 3.2);
  const trunk = add(new THREE.Mesh(merged(trunkG), toon(0x7a4a2c, { shade: 'warm' })));
  addOutline(trunk, lineColor(0x7a4a2c), 0.05);
  const bloss = add(new THREE.Mesh(merged(blossomG), toon(0xffb3cd, { shade: 'warm', rim: 0.3, rimColor: 0xfff0f6 })));
  addOutline(bloss, lineColor(0xffb3cd, 0.55), 0.05);
  // 足場の島の草むら（足もとの近く。キャラの立つ場所はあける）
  // カメラの手前（+z）には置かない＝画面の下が草でうまらない。小さめに
  const tuftG = [];
  for (let i = 0; i < 22; i++) {
    const a = Math.PI * (1.08 + rnd() * 0.84); // うしろ半分（-z がわ）
    const r = 0.9 + rnd() * 2.4;
    tuftG.push(ART.tuftGeo(rnd, Math.cos(a) * r, LOBBY_GROUND, Math.sin(a) * r, 0.1 + rnd() * 0.09, ART.vc(0.24, 0.45, 0.18), ART.vc(0.62, 0.86, 0.38)));
  }
  for (let i = 0; i < 8; i++) {
    const side = i % 2 ? 1 : -1;
    tuftG.push(ART.tuftGeo(rnd, side * (1.3 + rnd() * 1.6), LOBBY_GROUND, -0.4 + rnd() * 1.4, 0.09 + rnd() * 0.07, ART.vc(0.24, 0.45, 0.18), ART.vc(0.62, 0.86, 0.38)));
  }
  const tufts = add(new THREE.Mesh(merged(tuftG), toon(0xffffff, { vertexColors: true, side: THREE.DoubleSide })));
  tufts.material.side = THREE.DoubleSide;
  out.update = (t) => {
    if (sea.material.uniforms && sea.material.uniforms.uTime) sea.material.uniforms.uTime.value = t;
  };
  return out;
}
