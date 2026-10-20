// キャラの3Dモデル（基本の形を組み合わせて作る）と、動き（ポーズ）
import * as THREE from 'three';
import { toon, addOutline, roundedBox, canvasTex } from './gfx.js';
import { TEAM } from './config.js';
import { damp, clamp } from './util.js';

const HEAD_R = 0.27;

function capsule(r, len, mat, outline, ow = 0.018) {
  const g = new THREE.CapsuleGeometry(r, len, 4, 12);
  const m = new THREE.Mesh(g, mat);
  if (outline != null) addOutline(m, outline, ow);
  return m;
}
function sphere(r, mat, outline, ow = 0.018, ws = 18, hs = 14) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), mat);
  if (outline != null) addOutline(m, outline, ow);
  return m;
}

// 顔（頭の球にそのまま描く。正面は u=0.25）
function faceTexture(look) {
  const skin = '#' + new THREE.Color(look.skin).getHexString();
  const eye = '#' + new THREE.Color(look.eye).getHexString();
  return canvasTex(1024, 512, (ctx, W, H) => {
    ctx.fillStyle = skin;
    ctx.fillRect(0, 0, W, H);
    const cx = W * 0.25;
    const ey = H * 0.535;
    const sx = 46; // 目のはなれ具合
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // ほっぺ
    if (look.blush || look.face === 'grin') {
      ctx.fillStyle = look.blush ? 'rgba(255,110,120,0.45)' : 'rgba(255,120,110,0.28)';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(cx + s * 70, ey + 40, 24, 13, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // まゆ
    ctx.strokeStyle = '#2a1d17';
    ctx.lineWidth = 9;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      if (look.face === 'grin') {
        ctx.moveTo(cx + s * (sx - 26), ey - 54);
        ctx.quadraticCurveTo(cx + s * sx, ey - 70, cx + s * (sx + 28), ey - 58);
      } else if (look.face === 'cool') {
        ctx.moveTo(cx + s * (sx - 24), ey - 50);
        ctx.lineTo(cx + s * (sx + 26), ey - 55);
      } else {
        ctx.moveTo(cx + s * (sx - 22), ey - 50);
        ctx.quadraticCurveTo(cx + s * sx, ey - 56, cx + s * (sx + 24), ey - 50);
      }
      ctx.stroke();
    }
    // 目
    for (const s of [-1, 1]) {
      const x = cx + s * sx;
      if (look.face === 'grin') {
        // 笑って細くなった目
        ctx.strokeStyle = eye;
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(x - 20, ey + 4);
        ctx.quadraticCurveTo(x, ey - 18, x + 20, ey + 4);
        ctx.stroke();
      } else {
        const ew = look.face === 'cool' ? 17 : 19;
        const eh = look.face === 'cool' ? 22 : 27;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(x, ey, ew + 4, eh + 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = eye;
        ctx.beginPath();
        ctx.ellipse(x + s * 1, ey + 2, ew - 3, eh - 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0d0907';
        ctx.beginPath();
        ctx.ellipse(x + s * 1, ey + 4, ew - 10, eh - 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x - 6, ey - 9, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + 6, ey + 9, 3, 0, Math.PI * 2);
        ctx.fill();
        // 上のまつげ線
        ctx.strokeStyle = '#1a120e';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(x - ew - 5, ey - eh * 0.45);
        ctx.quadraticCurveTo(x, ey - eh - 8, x + ew + 5, ey - eh * 0.45);
        ctx.stroke();
      }
    }
    // 鼻
    ctx.strokeStyle = 'rgba(120,70,50,0.55)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx + 2, ey + 22);
    ctx.lineTo(cx - 4, ey + 34);
    ctx.stroke();
    // 口
    const my = ey + 64;
    if (look.face === 'grin') {
      ctx.fillStyle = '#7a1f22';
      ctx.beginPath();
      ctx.moveTo(cx - 40, my - 10);
      ctx.quadraticCurveTo(cx, my - 2, cx + 40, my - 10);
      ctx.quadraticCurveTo(cx + 30, my + 30, cx, my + 32);
      ctx.quadraticCurveTo(cx - 30, my + 30, cx - 40, my - 10);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(cx - 36, my - 8);
      ctx.quadraticCurveTo(cx, my, cx + 36, my - 8);
      ctx.lineTo(cx + 32, my + 4);
      ctx.quadraticCurveTo(cx, my + 10, cx - 32, my + 4);
      ctx.fill();
      ctx.fillStyle = '#ff8c8c';
      ctx.beginPath();
      ctx.ellipse(cx, my + 22, 16, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (look.face === 'oh') {
      ctx.fillStyle = '#b8323a';
      ctx.beginPath();
      ctx.ellipse(cx, my + 2, 13, 15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff9aa0';
      ctx.beginPath();
      ctx.ellipse(cx, my + 9, 8, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = '#8a3b2e';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx - 18, my);
      ctx.quadraticCurveTo(cx, my + 9, cx + 20, my - 3);
      ctx.stroke();
    }
  });
}

// 髪：頭より少し大きい球を作り、えりあし・前髪のラインより下を引き上げる
function hairCap(style, color, outline) {
  const r = HEAD_R * 1.1;
  const g = new THREE.SphereGeometry(r, 36, 26);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const hem = (az, i) => {
    const a = Math.abs(az);
    let front, back = -0.62, side = -0.18;
    if (style === 'bowl') {
      front = 0.2;
      side = -0.12;
      back = -0.58;
    } else if (style === 'center') {
      // まん中分け：まん中は高く、こめかみで下がる
      front = a < 0.55 ? 0.62 - (a / 0.55) * 0.5 : 0.12;
      side = -0.22;
    } else {
      front = 0.26 + Math.sin(az * 9 + 1) * 0.07;
      side = -0.2;
    }
    if (a < 1.1) return front + (side - front) * smooth(0.55, 1.1, a);
    return side + (back - side) * smooth(1.1, 2.7, a);
  };
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const az = Math.atan2(v.x, v.z);
    const lim = hem(az) * r;
    if (v.y < lim) {
      v.y = lim;
      // 切り口を頭にそわせる
      const k = Math.sqrt(Math.max(0, r * r - lim * lim)) / Math.max(0.0001, Math.hypot(v.x, v.z));
      v.x *= k * 0.97;
      v.z *= k * 0.97;
    }
    if (style === 'bowl') {
      v.x *= 1.08;
      v.z *= 1.05;
    }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, toon(color));
  addOutline(m, outline, 0.014);
  return m;
}
function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function spike(len, rad, color, outline) {
  const g = new THREE.ConeGeometry(rad, len, 8, 1);
  g.translate(0, len / 2, 0);
  const m = new THREE.Mesh(g, toon(color));
  addOutline(m, outline, 0.012);
  return m;
}

export function buildPuncher(def, teamIdx) {
  const look = def.look;
  const team = TEAM[teamIdx];
  const outline = team.dark;
  const ow = 0.02;
  const root = new THREE.Group();
  const scaleBox = new THREE.Group(); // 身長
  const s = 0.82 * look.height;
  scaleBox.scale.setScalar(s);
  scaleBox.position.y = -0.18 * s; // 当たりの中心を体のまん中に
  root.add(scaleBox);

  const body = new THREE.Group(); // 腰を中心にした全身（飛ぶときに前に倒す）
  scaleBox.add(body);
  const spine = new THREE.Group();
  spine.position.y = 0.05;
  body.add(spine);

  const mSkin = toon(look.skin);
  const mShirt = toon(look.shirt);
  const mSleeve = toon(look.sleeve);
  const mPants = toon(look.pants);
  const mShoe = toon(look.shoe);
  const mAcc = toon(look.shoeAccent);
  const mGlove = toon(team.hex);
  const mGlove2 = toon(0xffffff);

  // 胴
  const torso = capsule(0.19 * look.build, 0.2, mShirt, outline, ow);
  torso.position.y = 0.3;
  torso.scale.set(1, 1, 0.82);
  spine.add(torso);
  // 胸のチームマーク
  const badge = new THREE.Mesh(new THREE.CircleGeometry(0.055, 16), new THREE.MeshBasicMaterial({ color: team.hex }));
  badge.position.set(0.075, 0.36, 0.165 * look.build);
  spine.add(badge);
  if (look.extra === 'tigerBand') {
    // トラ：白T の下に茶色の長袖（首まわり）
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.022, 6, 16), toon(look.sleeve));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.56;
    spine.add(collar);
  }
  // 腰
  const hips = sphere(0.19 * look.build, mPants, outline, ow);
  hips.scale.set(1.02, 0.62, 0.86);
  hips.position.y = 0.02;
  body.add(hips);
  // 首と頭
  const neck = capsule(0.06, 0.06, mSkin);
  neck.position.y = 0.6;
  spine.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.88;
  spine.add(head);
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 36, 26), new THREE.MeshToonMaterial({ map: faceTexture(look), gradientMap: toon(0xffffff).gradientMap }));
  headMesh.scale.set(look.hairStyle === 'center' ? 0.93 : 1, 1.02, look.hairStyle === 'center' ? 0.97 : 1);
  addOutline(headMesh, outline, 0.012);
  head.add(headMesh);
  // 耳
  for (const sx of [-1, 1]) {
    const ear = sphere(0.055, mSkin, outline, 0.01, 10, 8);
    ear.scale.set(0.55, 1, 0.8);
    ear.position.set(sx * HEAD_R * 0.95, -0.02, -0.01);
    head.add(ear);
  }
  const hair = hairCap(look.hairStyle, look.hair, outline);
  hair.position.y = 0.012;
  head.add(hair);
  if (look.hairStyle === 'messy') {
    const spikes = [
      [0.0, 0.25, 0.12, -0.5, 0.35],
      [0.1, 0.24, 0.05, -0.2, 0.7],
      [-0.1, 0.25, 0.06, -0.35, -0.5],
      [0.16, 0.18, 0.16, -0.95, 0.9],
      [-0.05, 0.27, -0.1, 0.5, 0.2],
      [0.12, 0.2, -0.12, 0.7, 0.8],
    ];
    for (const [x, y, z, rx, rz] of spikes) {
      const sp = spike(0.16, 0.07, look.hair, outline);
      sp.position.set(x, y - 0.06, z);
      sp.rotation.set(rx, 0, -rz);
      head.add(sp);
    }
  } else if (look.hairStyle === 'center') {
    for (const sx of [-1, 1]) {
      const sw = sphere(0.12, toon(look.hair), outline, 0.012, 12, 10);
      sw.scale.set(0.9, 0.55, 0.5);
      sw.position.set(sx * 0.13, 0.16, 0.17);
      sw.rotation.set(-0.4, 0, sx * 0.5);
      head.add(sw);
    }
  } else if (look.hairStyle === 'bowl') {
    const bang = sphere(0.2, toon(look.hair), outline, 0.012, 16, 10);
    bang.scale.set(1.25, 0.42, 0.55);
    bang.position.set(0, 0.11, 0.17);
    head.add(bang);
  }
  // 小物
  if (look.extra === 'glasses') {
    const gm = toon(0x2b2522);
    const glasses = new THREE.Group();
    for (const sx of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.0085, 8, 24), gm);
      ring.position.set(sx * 0.088, -0.038, HEAD_R * 0.96);
      ring.rotation.y = sx * 0.22;
      glasses.add(ring);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.064, 20), new THREE.MeshBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.22 }));
      lens.position.copy(ring.position);
      lens.rotation.y = sx * 0.22;
      glasses.add(lens);
      const temple = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.012, 0.26), gm);
      temple.position.set(sx * 0.158, -0.03, 0.12);
      glasses.add(temple);
    }
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.05, 6), gm);
    bridge.rotation.z = Math.PI / 2;
    bridge.position.set(0, -0.03, HEAD_R * 0.99);
    glasses.add(bridge);
    glasses.scale.x = 0.93;
    head.add(glasses);
    root.userData.glasses = glasses;
  }
  if (look.extra === 'goggles') {
    const strap = new THREE.Mesh(new THREE.TorusGeometry(HEAD_R * 1.12, 0.018, 6, 30), toon(0x15171c));
    strap.rotation.x = Math.PI / 2 - 0.35;
    strap.position.y = 0.13;
    head.add(strap);
    for (const sx of [-1, 1]) {
      const frame = sphere(0.068, toon(0x15171c), outline, 0.01, 14, 10);
      frame.scale.set(1.15, 0.8, 0.55);
      frame.position.set(sx * 0.085, 0.2, 0.22);
      frame.rotation.x = -0.55;
      head.add(frame);
      const lens = sphere(0.056, toon(0x2f6db5), null, 0, 14, 10);
      lens.scale.set(1.1, 0.75, 0.4);
      lens.position.set(sx * 0.085, 0.205, 0.245);
      lens.rotation.x = -0.55;
      head.add(lens);
      const shine = new THREE.Mesh(new THREE.CircleGeometry(0.014, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      shine.position.set(sx * 0.085 - 0.02, 0.225, 0.27);
      shine.rotation.x = -0.55;
      head.add(shine);
    }
  }

  // 腕
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.24 * look.build, 0.47, 0);
    spine.add(shoulder);
    const upper = capsule(0.072, 0.17, look.shortSleeve ? mSleeve : mSleeve, outline, ow);
    upper.position.y = -0.13;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.27;
    shoulder.add(elbow);
    const lower = capsule(0.062, 0.15, look.shortSleeve ? mSkin : mSleeve, outline, ow);
    lower.position.y = -0.1;
    elbow.add(lower);
    if (look.extra === 'tigerBand') {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.07, 12), toon(0xff9a1f));
      band.position.y = -0.2;
      elbow.add(band);
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.077, 0.077, 0.018, 12), toon(0x1a1a1a));
      stripe.position.y = -0.2;
      elbow.add(stripe);
    }
    const glove = sphere(0.125, mGlove, outline, ow);
    glove.scale.set(1, 1.05, 1.15);
    glove.position.set(0, -0.29, 0.015);
    elbow.add(glove);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.09, 0.07, 12), mGlove2);
    cuff.position.y = -0.18;
    elbow.add(cuff);
    arms.push({ shoulder, elbow, glove, side });
  }
  // 脚
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.1, -0.04, 0);
    body.add(hip);
    const upper = capsule(0.088, 0.17, mPants, outline, ow);
    upper.position.y = -0.14;
    hip.add(upper);
    const knee = new THREE.Group();
    knee.position.y = -0.3;
    hip.add(knee);
    const lower = capsule(0.078, 0.17, look.extra === 'goggles' ? mSkin : mPants, outline, ow);
    lower.position.y = -0.13;
    knee.add(lower);
    const shoe = new THREE.Mesh(roundedBox(0.17, 0.12, 0.3, 0.05, 2), mShoe);
    addOutline(shoe, outline, ow);
    shoe.position.set(0, -0.3, 0.05);
    knee.add(shoe);
    const sole = new THREE.Mesh(roundedBox(0.175, 0.04, 0.31, 0.018, 1), mAcc);
    sole.position.set(0, -0.355, 0.05);
    knee.add(sole);
    // かかとの噴射口（飛ぶと光る）
    const jet = new THREE.Mesh(new THREE.CircleGeometry(0.05, 12), new THREE.MeshBasicMaterial({ color: team.light }));
    jet.position.set(0, -0.31, -0.105);
    jet.rotation.y = Math.PI;
    knee.add(jet);
    legs.push({ hip, knee, side, jet });
  }

  root.userData.parts = { scaleBox, body, spine, head, arms, legs, hair };
  root.userData.def = def;
  root.userData.team = teamIdx;
  root.traverse((o) => {
    if (o.isMesh) o.frustumCulled = true;
  });
  return root;
}

// ===== ポーズ =====
// 各関節の目標の角度を決め、なめらかに近づける
const tmpPose = {};
function basePose(P) {
  P.bodyX = 0;
  P.bodyZ = 0;
  P.bodyY = 0;
  P.bodyRise = 0;
  P.spineY = 0;
  P.spineX = 0;
  P.headX = 0;
  P.headY = 0;
  P.sx = [0, 0];
  P.sz = [0.12, 0.12];
  P.sy = [0, 0];
  P.ex = [0, 0];
  P.hx = [0, 0];
  P.hz = [0, 0];
  P.kx = [0, 0];
  return P;
}

// state: { mode, t, speed01, turn, punchSide, punchPhase, heavy, ground, runPhase, roll, flip }
export function poseModel(root, st, dt) {
  const parts = root.userData.parts;
  const P = basePose(tmpPose);
  const t = st.t;
  const L = 0, R = 1;
  switch (st.mode) {
    case 'fly':
    case 'dash': {
      const k = st.mode === 'dash' ? 1 : clamp(st.speed01, 0, 1);
      P.bodyX = 0.25 + 1.1 * k;
      // 片手を前に、もう片手は体にそわせる
      if (st.mode === 'dash') {
        P.sx = [0.5, 0.5];
        P.sz = [0.35, 0.35];
        P.ex = [-0.2, -0.2];
      } else {
        P.sx = [0.35 - 0.1 * Math.sin(t * 7), -2.75 * k - 0.6 * (1 - k)];
        P.sz = [0.25, -0.05];
        P.ex = [-0.35, -0.05];
      }
      P.hx = [0.12 + 0.05 * Math.sin(t * 8), 0.05 - 0.05 * Math.sin(t * 8)];
      P.kx = [0.25, 0.4];
      P.headX = -0.9 * k;
      break;
    }
    case 'ground': {
      const ph = st.runPhase || 0;
      const k = clamp(st.speed01, 0, 1);
      P.bodyX = 0.18 * k;
      P.sx = [Math.sin(ph) * 0.9 * k - 0.2, -Math.sin(ph) * 0.9 * k - 0.2];
      P.ex = [-1.1, -1.1];
      P.hx = [-Math.sin(ph) * 0.8 * k, Math.sin(ph) * 0.8 * k];
      P.kx = [Math.max(0, Math.cos(ph)) * 1.1 * k + 0.05, Math.max(0, -Math.cos(ph)) * 1.1 * k + 0.05];
      P.bodyRise = Math.abs(Math.sin(ph)) * 0.04 * k;
      if (k < 0.1) {
        // 立ちポーズ（ファイティングポーズ）
        P.sx = [-0.9, -0.9];
        P.sz = [0.25, 0.25];
        P.ex = [-1.6, -1.6];
        P.hx = [-0.08, 0.12];
        P.kx = [0.12, 0.08];
      }
      break;
    }
    case 'punch': {
      // ホバーのかまえから、punchSide の腕でまっすぐ打つ
      const p = st.punchPhase; // 0→1
      const side = st.punchSide;
      const ext = p < 0.35 ? p / 0.35 : 1 - (p - 0.35) / 0.65;
      P.bodyX = 0.15;
      P.sx = [-0.95, -0.95];
      P.sz = [0.28, 0.28];
      P.ex = [-1.55, -1.55];
      P.hx = [0.1, -0.15];
      P.kx = [0.5, 0.3];
      if (st.heavy) {
        // アッパー
        P.sx[side] = -0.4 - 2.4 * ext;
        P.ex[side] = -1.4 + 1.2 * ext;
        P.bodyX = 0.2 - 0.45 * ext;
        P.spineY = (side === R ? -1 : 1) * 0.4 * ext;
      } else {
        P.sx[side] = -0.95 - 0.65 * ext;
        P.sz[side] = 0.28 - 0.42 * ext;
        P.ex[side] = -1.55 + 1.5 * ext;
        P.spineY = (side === R ? -1 : 1) * 0.55 * ext;
      }
      break;
    }
    case 'shoot': {
      const p = st.punchPhase;
      const side = st.punchSide;
      const ext = p < 0.25 ? p / 0.25 : 1 - (p - 0.25) / 0.75;
      P.bodyX = 0.1;
      P.sx = [-0.7, -0.7];
      P.ex = [-1.3, -1.3];
      P.sx[side] = -1.45 - 0.2 * ext;
      P.ex[side] = -0.3 + 0.3 * ext;
      P.spineY = (side === R ? -1 : 1) * 0.3;
      P.hx = [0.1, -0.15];
      P.kx = [0.5, 0.3];
      break;
    }
    case 'hurt': {
      P.bodyX = -0.45;
      P.sx = [0.6, 0.6];
      P.sz = [0.9, 0.9];
      P.ex = [-0.3, -0.3];
      P.hx = [-0.4, -0.2];
      P.kx = [0.6, 0.5];
      P.headX = 0.4;
      break;
    }
    case 'stun': {
      P.bodyX = 0.1;
      P.bodyZ = Math.sin(t * 9) * 0.15;
      P.sx = [0.2, 0.2];
      P.sz = [0.5, 0.5];
      P.ex = [-0.2, -0.2];
      P.headY = Math.sin(t * 7) * 0.4;
      P.kx = [0.4, 0.4];
      break;
    }
    case 'ko': {
      P.bodyX = -1.2;
      P.sx = [-2.6, -2.6];
      P.sz = [1.0, 1.0];
      P.hx = [-0.6, -0.4];
      P.kx = [0.3, 0.6];
      break;
    }
    case 'special': {
      P.bodyX = -0.15;
      P.sx = [-1.2, -1.2];
      P.sz = [1.1, 1.1];
      P.ex = [-0.2, -0.2];
      P.hx = [-0.3, 0.3];
      P.hz = [0.25, -0.25];
      P.kx = [0.3, 0.3];
      P.headX = -0.25;
      break;
    }
    case 'win': {
      const b = Math.sin(t * 5);
      P.sx = [-0.4, -2.9 - 0.15 * b];
      P.sz = [0.3, 0.25];
      P.ex = [-1.7, -0.1];
      P.hx = [-0.1, 0.15];
      P.kx = [0.15, 0.1];
      P.bodyRise = Math.abs(b) * 0.05;
      P.headX = -0.2;
      break;
    }
    case 'lose': {
      P.bodyX = 0.35;
      P.headX = 0.5;
      P.sx = [0.15, 0.15];
      P.sz = [0.1, 0.1];
      P.kx = [0.2, 0.2];
      break;
    }
    default: {
      // ホバー（空中でかまえる）
      P.bodyX = 0.12;
      P.bodyZ = clamp(-st.turn * 0.3, -0.4, 0.4);
      P.sx = [-0.95 + 0.06 * Math.sin(t * 2.2), -0.95 + 0.06 * Math.sin(t * 2.2 + 1)];
      P.sz = [0.28, 0.28];
      P.ex = [-1.65, -1.65];
      P.hx = [-0.05 + 0.08 * Math.sin(t * 2), 0.25 + 0.08 * Math.sin(t * 2 + 1.2)];
      P.kx = [0.35, 0.6];
      P.bodyRise = Math.sin(t * 2.4) * 0.04;
    }
  }
  const k = st.snap ? 1000 : 16;
  parts.body.rotation.x = damp(parts.body.rotation.x, P.bodyX, k, dt);
  parts.body.rotation.z = damp(parts.body.rotation.z, P.bodyZ, 10, dt);
  parts.body.position.y = damp(parts.body.position.y, P.bodyRise, 12, dt);
  parts.spine.rotation.y = damp(parts.spine.rotation.y, P.spineY, 22, dt);
  parts.head.rotation.x = damp(parts.head.rotation.x, P.headX, 10, dt);
  parts.head.rotation.y = damp(parts.head.rotation.y, P.headY, 10, dt);
  for (let i = 0; i < 2; i++) {
    const a = parts.arms[i];
    a.shoulder.rotation.x = damp(a.shoulder.rotation.x, P.sx[i], k + 6, dt);
    a.shoulder.rotation.z = damp(a.shoulder.rotation.z, P.sz[i] * a.side, k, dt);
    a.elbow.rotation.x = damp(a.elbow.rotation.x, P.ex[i], k + 6, dt);
    const g = parts.legs[i];
    g.hip.rotation.x = damp(g.hip.rotation.x, -P.hx[i], k, dt);
    g.hip.rotation.z = damp(g.hip.rotation.z, P.hz[i], k, dt);
    g.knee.rotation.x = damp(g.knee.rotation.x, P.kx[i], k, dt);
  }
}

export function setJetGlow(root, on) {
  const parts = root.userData.parts;
  for (const g of parts.legs) g.jet.visible = on;
}
