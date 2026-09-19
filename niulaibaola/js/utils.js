/* ===========================================================
 * 牛来豹拉大冒险 —— 基础工具层
 * 数学 / 随机 / 输入 / 音效 / 摄像机 / 粒子
 * =========================================================== */
window.NLB = window.NLB || {};

(function (NLB) {
  'use strict';

  /* ---------------- 数学与随机 ---------------- */
  const M = {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    dist2: (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; },
    dist: (ax, ay, bx, by) => Math.sqrt(M.dist2(ax, ay, bx, by)),
    rand: (a, b) => a + Math.random() * (b - a),
    randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    chance: (p) => Math.random() < p,
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    },
    angle: (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax),
    /* 角度差归一到 [-PI, PI] */
    angDiff: (a, b) => {
      let d = (b - a) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      return d;
    },
    /* 点是否落在以 dir 为中心、夹角 arc、半径 r 的扇形内 */
    inArc(px, py, ox, oy, dir, arc, r) {
      const d2 = M.dist2(px, py, ox, oy);
      if (d2 > r * r) return false;
      if (d2 < 1) return true;
      return Math.abs(M.angDiff(dir, M.angle(ox, oy, px, py))) <= arc / 2;
    },
    /* 圆与圆分离推力 */
    separate(a, b) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.0001;
      const overlap = a.r + b.r - d;
      if (overlap <= 0) return null;
      return { nx: dx / d, ny: dy / d, overlap };
    },
    /* 确定性随机（用于地图装饰，保证每次布局一致） */
    seeded(seed) {
      let s = seed >>> 0;
      return function () {
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    },
  };

  /* ---------------- 输入 ---------------- */
  const Input = {
    keys: Object.create(null),
    pressed: Object.create(null),   // 本帧刚按下
    mouse: { x: 0, y: 0, left: false, right: false, leftPressed: false },
    _blockDefault: ['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],

    init(canvas) {
      this._canvas = canvas;
      window.addEventListener('keydown', (e) => {
        if (this._blockDefault.indexOf(e.key) >= 0) e.preventDefault();
        const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (!this.keys[k]) this.pressed[k] = true;
        this.keys[k] = true;
      });
      window.addEventListener('keyup', (e) => {
        const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        this.keys[k] = false;
      });
      window.addEventListener('blur', () => { this.keys = Object.create(null); });
      canvas.addEventListener('mousemove', (e) => {
        const r = canvas.getBoundingClientRect();
        this.mouse.x = e.clientX - r.left; this.mouse.y = e.clientY - r.top;
        this.mouse.t = performance.now();
      });
      canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
        if (e.button === 2) this.mouse.right = true;
      });
      window.addEventListener('mouseup', (e) => {
        if (e.button === 0) this.mouse.left = false;
        if (e.button === 2) this.mouse.right = false;
      });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    },
    down(k) { return !!this.keys[k]; },
    hit(k) { return !!this.pressed[k]; },
    /* 每帧末尾调用 */
    endFrame() {
      this.pressed = Object.create(null);
      this.mouse.leftPressed = false;
    },
    /* 移动向量（屏幕坐标系：y 向下为正） */
    moveVec() {
      let x = 0, y = 0;
      if (this.down('a') || this.down('ArrowLeft')) x -= 1;
      if (this.down('d') || this.down('ArrowRight')) x += 1;
      if (this.down('w') || this.down('ArrowUp')) y -= 1;
      if (this.down('s') || this.down('ArrowDown')) y += 1;
      const l = Math.hypot(x, y);
      if (l > 0) { x /= l; y /= l; }
      return { x, y };
    },
  };

  /* ---------------- 音效（WebAudio 合成，无需外部资源） ---------------- */
  const Sound = {
    ctx: null,
    enabled: true,
    master: null,
    _ensure() {
      if (this.ctx) return this.ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return null; }
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.32;
        this.master.connect(this.ctx.destination);
      } catch (e) { this.enabled = false; return null; }
      return this.ctx;
    },
    resume() { const c = this._ensure(); if (c && c.state === 'suspended') c.resume(); },
    /* 通用音效：频率扫描 + 包络 */
    blip(opt) {
      if (!this.enabled) return;
      const c = this._ensure(); if (!c) return;
      const o = opt || {};
      const t0 = c.currentTime;
      const dur = o.dur || 0.12;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = o.type || 'square';
      osc.frequency.setValueAtTime(o.f0 || 440, t0);
      if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + dur);
      const vol = (o.vol == null ? 0.5 : o.vol);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(this.master);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    },
    noise(opt) {
      if (!this.enabled) return;
      const c = this._ensure(); if (!c) return;
      const o = opt || {};
      const dur = o.dur || 0.18;
      const len = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = o.filter || 'lowpass';
      f.frequency.setValueAtTime(o.freq || 1200, c.currentTime);
      if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.freqEnd), c.currentTime + dur);
      const g = c.createGain(); g.gain.value = o.vol == null ? 0.4 : o.vol;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start();
    },
    play(name) {
      switch (name) {
        case 'swing': this.noise({ dur: 0.14, freq: 2600, freqEnd: 500, vol: 0.28 }); break;
        case 'hit': this.blip({ type: 'square', f0: 320, f1: 120, dur: 0.09, vol: 0.34 }); break;
        case 'shoot': this.blip({ type: 'triangle', f0: 900, f1: 480, dur: 0.08, vol: 0.22 }); break;
        case 'dash': this.noise({ dur: 0.26, freq: 700, freqEnd: 2400, vol: 0.3, filter: 'bandpass' }); break;
        case 'hurt': this.blip({ type: 'sawtooth', f0: 240, f1: 90, dur: 0.16, vol: 0.3 }); break;
        case 'die': this.blip({ type: 'sawtooth', f0: 180, f1: 50, dur: 0.4, vol: 0.32 }); break;
        case 'pick': this.blip({ type: 'sine', f0: 780, f1: 1250, dur: 0.1, vol: 0.24 }); break;
        case 'levelup': [0, .09, .18].forEach((d, i) => setTimeout(() => this.blip({ type: 'triangle', f0: 520 + i * 180, dur: 0.16, vol: 0.3 }), d * 1000)); break;
        case 'roar': this.blip({ type: 'sawtooth', f0: 130, f1: 55, dur: 0.7, vol: 0.42 }); this.noise({ dur: 0.7, freq: 400, freqEnd: 120, vol: 0.3 }); break;
        case 'win': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip({ type: 'triangle', f0: f, dur: 0.22, vol: 0.3 }), i * 130)); break;
        case 'lose': [392, 330, 262].forEach((f, i) => setTimeout(() => this.blip({ type: 'sawtooth', f0: f, dur: 0.34, vol: 0.28 }), i * 200)); break;
        case 'ui': this.blip({ type: 'sine', f0: 620, dur: 0.06, vol: 0.18 }); break;
        case 'boss': this.blip({ type: 'sawtooth', f0: 90, f1: 60, dur: 1.0, vol: 0.4 }); break;
        default: break;
      }
    },
  };

  /* ---------------- 摄像机 ---------------- */
  class Camera {
    constructor() { this.x = 0; this.y = 0; this.w = 1280; this.h = 720; this.shakeT = 0; this.shakeP = 0; }
    resize(w, h) { this.w = w; this.h = h; }
    follow(tx, ty, dt, bounds) {
      const nx = tx - this.w / 2, ny = ty - this.h / 2;
      const k = 1 - Math.pow(0.0015, dt);   // 平滑跟随
      this.x = M.lerp(this.x, nx, k);
      this.y = M.lerp(this.y, ny, k);
      if (bounds) {
        this.x = M.clamp(this.x, 0, Math.max(0, bounds.w - this.w));
        this.y = M.clamp(this.y, 0, Math.max(0, bounds.h - this.h));
      }
    }
    snap(tx, ty, bounds) {
      this.x = tx - this.w / 2; this.y = ty - this.h / 2;
      if (bounds) {
        this.x = M.clamp(this.x, 0, Math.max(0, bounds.w - this.w));
        this.y = M.clamp(this.y, 0, Math.max(0, bounds.h - this.h));
      }
    }
    shake(power, time) { this.shakeP = Math.max(this.shakeP, power); this.shakeT = Math.max(this.shakeT, time); }
    update(dt) {
      if (this.shakeT > 0) { this.shakeT -= dt; if (this.shakeT <= 0) { this.shakeT = 0; this.shakeP = 0; } }
    }
    offset() {
      if (this.shakeT <= 0) return { x: 0, y: 0 };
      const p = this.shakeP * (this.shakeT > 0 ? 1 : 0);
      return { x: M.rand(-p, p), y: M.rand(-p, p) };
    }
    apply(ctx) {
      const o = this.offset();
      ctx.translate(-Math.round(this.x) + o.x, -Math.round(this.y) + o.y);
    }
    toWorld(sx, sy) { return { x: sx + this.x, y: sy + this.y }; }
  }

  /* ---------------- 粒子系统 ---------------- */
  class Particles {
    constructor() { this.list = []; this.floats = []; }
    clear() { this.list.length = 0; this.floats.length = 0; }
    burst(x, y, opt) {
      const o = opt || {};
      const n = o.count || 8;
      for (let i = 0; i < n; i++) {
        const a = o.angle == null ? M.rand(0, Math.PI * 2) : o.angle + M.rand(-(o.spread || 0.6), (o.spread || 0.6));
        const sp = M.rand(o.speedMin || 60, o.speedMax || 220);
        this.list.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: M.rand(o.lifeMin || 0.2, o.lifeMax || 0.5), t: 0,
          r: M.rand(o.rMin || 2, o.rMax || 5), color: o.color || '#ffb648',
          drag: o.drag == null ? 3.2 : o.drag, glow: !!o.glow,
        });
      }
    }
    ring(x, y, opt) {
      const o = opt || {};
      this.list.push({
        ring: true, x, y, r: o.r0 || 6, r1: o.r1 || 90,
        life: o.life || 0.32, t: 0, color: o.color || '#fff', width: o.width || 4,
      });
    }
    text(x, y, str, color, big) {
      this.floats.push({ x: x + M.rand(-8, 8), y, str, color: color || '#fff', t: 0, life: big ? 1.1 : 0.75, big: !!big });
    }
    update(dt) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const p = this.list[i];
        p.t += dt;
        if (p.t >= p.life) { this.list.splice(i, 1); continue; }
        if (!p.ring) {
          const d = Math.exp(-p.drag * dt);
          p.vx *= d; p.vy *= d;
          p.x += p.vx * dt; p.y += p.vy * dt;
        }
      }
      for (let i = this.floats.length - 1; i >= 0; i--) {
        const f = this.floats[i];
        f.t += dt; f.y -= 42 * dt;
        if (f.t >= f.life) this.floats.splice(i, 1);
      }
    }
    draw(ctx) {
      for (const p of this.list) {
        const k = 1 - p.t / p.life;
        ctx.globalAlpha = Math.max(0, k);
        if (p.ring) {
          const r = M.lerp(p.r, p.r1, 1 - k * k);
          ctx.strokeStyle = p.color; ctx.lineWidth = p.width * k;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
        } else {
          ctx.fillStyle = p.color;
          if (p.glow) { ctx.shadowColor = p.color; ctx.shadowBlur = 10; }
          ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.r * k), 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      for (const f of this.floats) {
        const k = 1 - f.t / f.life;
        ctx.globalAlpha = Math.max(0, Math.min(1, k * 1.6));
        ctx.font = (f.big ? 'bold 30px' : 'bold 17px') + ' system-ui,"PingFang SC",sans-serif';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.65)';
        ctx.strokeText(f.str, f.x, f.y);
        ctx.fillStyle = f.color; ctx.fillText(f.str, f.x, f.y);
      }
      ctx.globalAlpha = 1; ctx.textAlign = 'left';
    }
  }

  NLB.M = M;
  NLB.Input = Input;
  NLB.Sound = Sound;
  NLB.Camera = Camera;
  NLB.Particles = Particles;
})(window.NLB);
