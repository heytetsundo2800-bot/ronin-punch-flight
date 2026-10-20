// 端末どうしを直接つなぐ（WebRTC のデータチャンネル）
//   r：とどくまで送りなおす・順番どおり（ロビー・できごと）
//   u：送りなおさない・順番は気にしない（試合中の位置。古いものは捨ててよい）
export const rtcSupported = () => typeof RTCPeerConnection !== 'undefined';

// ICE の候補が集まるのを待つ（全部そろう・外向きの候補が出て少したつ・時間切れ のどれか）
function gather(pc, maxMs = 3000) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    let done = false, haveSrflx = false;
    const t0 = performance.now();
    const fin = () => {
      if (done) return;
      done = true;
      clearInterval(iv);
      pc.removeEventListener('icegatheringstatechange', onState);
      pc.removeEventListener('icecandidate', onCand);
      resolve();
    };
    const onState = () => pc.iceGatheringState === 'complete' && fin();
    const onCand = (e) => {
      if (!e.candidate) return fin();
      if (/ typ (srflx|relay) /.test(e.candidate.candidate || '')) haveSrflx = true;
    };
    const iv = setInterval(() => {
      const t = performance.now() - t0;
      if (t > maxMs || (haveSrflx && t > 1200)) fin();
    }, 100);
    pc.addEventListener('icegatheringstatechange', onState);
    pc.addEventListener('icecandidate', onCand);
  });
}

export class Peer {
  constructor(id, iceServers) {
    this.id = id;
    this.pc = new RTCPeerConnection({ iceServers: iceServers && iceServers.length ? iceServers : [{ urls: 'stun:stun.l.google.com:19302' }] });
    this.r = null;
    this.u = null;
    this.open = false;
    this.closed = false;
    this.lastHeard = performance.now();
    this.rtt = 0;
    this.onmsg = null; // (obj) JSON
    this.onbin = null; // (ArrayBuffer)
    this.onopen = null;
    this.onclose = null;
    this._pingN = 0;
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      this.onstate && this.onstate(s);
      if (s === 'failed' || s === 'closed') this.close('rtc-' + s);
    };
    this.pc.ondatachannel = (e) => this.attach(e.channel);
  }
  attach(ch) {
    ch.binaryType = 'arraybuffer';
    if (ch.label === 'r') this.r = ch;
    else if (ch.label === 'u') this.u = ch;
    ch.onopen = () => this.checkOpen();
    ch.onclose = () => this.close('dc-close');
    ch.onerror = () => {};
    ch.onmessage = (e) => {
      // テスト用：通信のおくれ・ゆらぎ・欠けをまねる（window.__rpfLag = {ms, jitter, loss}）
      const L = typeof window !== 'undefined' && window.__rpfLag;
      if (L && !e.__lagged) {
        if (ch.label === 'u' && Math.random() < (L.loss || 0)) return;
        const d = (L.ms || 0) + Math.random() * (L.jitter || 0);
        const at = performance.now() + d;
        // とどく順番は、r（順番どおり）だけ守る
        const t = ch.label === 'r' ? Math.max(at, (this._lagT || 0) + 0.01) : at;
        if (ch.label === 'r') this._lagT = t;
        const ev = { data: e.data, __lagged: true };
        setTimeout(() => ch.onmessage(ev), Math.max(0, t - performance.now()));
        return;
      }
      this.lastHeard = performance.now();
      if (typeof e.data === 'string') {
        let o = null;
        try {
          o = JSON.parse(e.data);
        } catch (err) {
          return;
        }
        if (!o) return;
        if (o.t === 'ping') return this.send({ t: 'pong', n: o.n, s: o.s });
        if (o.t === 'pong') {
          if (o.s) this.rtt = this.rtt ? this.rtt * 0.7 + (performance.now() - o.s) * 0.3 : performance.now() - o.s;
          return;
        }
        this.onmsg && this.onmsg(o);
      } else if (e.data instanceof ArrayBuffer) this.onbin && this.onbin(e.data);
    };
    this.checkOpen();
  }
  checkOpen() {
    if (this.open || this.closed) return;
    if (this.r && this.r.readyState === 'open' && this.u && this.u.readyState === 'open') {
      this.open = true;
      this.lastHeard = performance.now();
      this.onopen && this.onopen();
    }
  }
  // 入る人：申しこみ（offer）を作る
  async offer() {
    this.attach(this.pc.createDataChannel('r', { ordered: true }));
    this.attach(this.pc.createDataChannel('u', { ordered: false, maxRetransmits: 0 }));
    const o = await this.pc.createOffer();
    await this.pc.setLocalDescription(o);
    await gather(this.pc);
    return this.pc.localDescription.sdp;
  }
  // 部屋の人：申しこみに答える（answer）
  async answer(sdp) {
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    const a = await this.pc.createAnswer();
    await this.pc.setLocalDescription(a);
    await gather(this.pc);
    return this.pc.localDescription.sdp;
  }
  async accept(sdp) {
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
  }
  send(obj) {
    if (!this.r || this.r.readyState !== 'open') return false;
    try {
      this.r.send(JSON.stringify(obj));
      return true;
    } catch (e) {
      return false;
    }
  }
  sendBin(buf) {
    const ch = this.u;
    if (!ch || ch.readyState !== 'open') return false;
    // 送りきれずにたまっているときは捨てる（古い位置を送っても意味がない）
    if (ch.bufferedAmount > 64 * 1024) return false;
    try {
      ch.send(buf);
      return true;
    } catch (e) {
      return false;
    }
  }
  ping() {
    this.send({ t: 'ping', n: ++this._pingN, s: performance.now() });
  }
  close(why) {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    try {
      this.r && this.r.close();
    } catch (e) {}
    try {
      this.u && this.u.close();
    } catch (e) {}
    try {
      this.pc.close();
    } catch (e) {}
    this.onclose && this.onclose(why || 'close');
  }
}
