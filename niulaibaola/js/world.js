/* ===========================================================
 * 牛来豹拉大冒险 —— 场景与波次
 * 地形绘制（10 种主题） / 波次调度 / 刷怪
 * =========================================================== */
(function (NLB) {
  'use strict';
  const M = NLB.M;
  const C = NLB.CONFIG;

  /* ---------------- 场景 ---------------- */
  class World {
    constructor(level, size, theme) {
      this.level = level;
      this.w = size.w; this.h = size.h;
      this.theme = theme;
      this.decor = [];
      this.borderProps = [];
      this._build();
    }
    _build() {
      const rnd = M.seeded(this.level * 7919 + this.w);
      const m = C.WORLD.margin;
      /* 地面低矮装饰 */
      const kinds = {
        grass: ['tuft', 'flower', 'stone'],
        forest: ['tuft', 'mushroom', 'stone', 'log'],
        canyon: ['stone', 'crack', 'bone'],
        swamp: ['mushroom', 'tuft', 'bone'],
        den: ['bone', 'stone', 'skull'],
        snow: ['ice', 'stone', 'pine'],
        desert: ['stone', 'bone', 'cactus'],
        volcano: ['crack', 'stone', 'bone'],
        ruin: ['pillar', 'stone', 'bone'],
        temple: ['pillar', 'stone', 'bone'],
      }[this.theme.decor] || ['tuft', 'stone'];
      const count = Math.round((this.w * this.h) / 26000);
      for (let i = 0; i < count; i++) {
        this.decor.push({
          x: m + 20 + rnd() * (this.w - 2 * m - 40),
          y: m + 20 + rnd() * (this.h - 2 * m - 40),
          kind: kinds[Math.floor(rnd() * kinds.length)],
          s: 0.7 + rnd() * 0.8,
          rot: rnd() * Math.PI * 2,
          seed: rnd(),
        });
      }
      /* 边界林 / 岩壁 */
      const bCount = Math.round(this.w / 120);
      for (let i = 0; i < bCount; i++) {
        const x = rnd() * this.w;
        this.borderProps.push({ x, y: m * 0.45, kind: 'top', s: 0.8 + rnd() * 0.7, seed: rnd() });
        this.borderProps.push({ x: rnd() * this.w, y: this.h - m * 0.45, kind: 'bottom', s: 0.8 + rnd() * 0.7, seed: rnd() });
      }
      for (let i = 0; i < Math.round(this.h / 150); i++) {
        this.borderProps.push({ x: m * 0.45, y: rnd() * this.h, kind: 'left', s: 0.8 + rnd() * 0.7, seed: rnd() });
        this.borderProps.push({ x: this.w - m * 0.45, y: rnd() * this.h, kind: 'right', s: 0.8 + rnd() * 0.7, seed: rnd() });
      }
    }

    drawGround(ctx, cam) {
      const th = this.theme;
      const x0 = Math.max(0, cam.x - 60), y0 = Math.max(0, cam.y - 60);
      const x1 = Math.min(this.w, cam.x + cam.w + 60), y1 = Math.min(this.h, cam.y + cam.h + 60);
      ctx.fillStyle = th.ground;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      /* 斑块纹理 */
      const tile = 128;
      const rnd = M.seeded(this.level * 104729);
      const sx = Math.floor(x0 / tile) * tile, sy = Math.floor(y0 / tile) * tile;
      for (let tx = sx; tx < x1; tx += tile) {
        for (let ty = sy; ty < y1; ty += tile) {
          const r = ((Math.floor(tx / tile) * 73856093) ^ (Math.floor(ty / tile) * 19349663)) % 100 / 100;
          if (r < 0.45) continue;
          ctx.fillStyle = th.ground2;
          ctx.globalAlpha = 0.35 + (r % 0.3);
          ctx.beginPath();
          ctx.ellipse(tx + tile * (0.2 + r * 0.6), ty + tile * (0.2 + r * 0.6), tile * (0.16 + r * 0.13), tile * (0.11 + r * 0.09), r * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    drawDecor(ctx, cam) {
      const m = C.WORLD.margin;
      /* 地面装饰 */
      for (const d of this.decor) {
        if (d.x < cam.x - 60 || d.x > cam.x + cam.w + 60 || d.y < cam.y - 60 || d.y > cam.y + cam.h + 60) continue;
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.scale(d.s, d.s);
        ctx.rotate(d.rot);
        drawProp(ctx, d.kind, this.theme, d.seed);
        ctx.restore();
      }
      /* 边界带（上下左右） */
      ctx.save();
      const th = this.theme;
      /* 边界暗色区 */
      const gradT = ctx.createLinearGradient(0, 0, 0, m);
      gradT.addColorStop(0, 'rgba(0,0,0,.55)'); gradT.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradT; ctx.fillRect(0, 0, this.w, m);
      const gradB = ctx.createLinearGradient(0, this.h, 0, this.h - m);
      gradB.addColorStop(0, 'rgba(0,0,0,.55)'); gradB.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradB; ctx.fillRect(0, this.h - m, this.w, m);
      const gradL = ctx.createLinearGradient(0, 0, m, 0);
      gradL.addColorStop(0, 'rgba(0,0,0,.55)'); gradL.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradL; ctx.fillRect(0, 0, m, this.h);
      const gradR = ctx.createLinearGradient(this.w, 0, this.w - m, 0);
      gradR.addColorStop(0, 'rgba(0,0,0,.55)'); gradR.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradR; ctx.fillRect(this.w - m, 0, m, this.h);
      ctx.restore();
      for (const b of this.borderProps) {
        if (b.x < cam.x - 80 || b.x > cam.x + cam.w + 80) continue;
        if (b.y < cam.y - 80 || b.y > cam.y + cam.h + 80) continue;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.scale(b.s, b.s);
        drawBorderProp(ctx, this.theme, b.seed);
        ctx.restore();
      }
    }

    drawVignette(ctx, cam) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      const g = ctx.createRadialGradient(cam.x + cam.w / 2, cam.y + cam.h / 2, Math.min(cam.w, cam.h) * 0.35,
        cam.x + cam.w / 2, cam.y + cam.h / 2, Math.max(cam.w, cam.h) * 0.78);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,.45)');
      ctx.fillStyle = g;
      ctx.fillRect(cam.x, cam.y, cam.w, cam.h);
      if (this.theme.fog) {
        ctx.fillStyle = this.theme.fog;
        ctx.fillRect(cam.x, cam.y, cam.w, cam.h);
      }
      ctx.restore();
    }
  }

  function drawProp(ctx, kind, theme, seed) {
    switch (kind) {
      case 'tuft':
        ctx.strokeStyle = theme.decor === 'snow' ? 'rgba(255,255,255,.75)' : 'rgba(150,200,110,.75)';
        ctx.lineWidth = 2.4; ctx.lineCap = 'round';
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath(); ctx.moveTo(i * 3.2, 0);
          ctx.quadraticCurveTo(i * 4, -8, i * 5.5, -14 - (seed * 6));
          ctx.stroke();
        }
        break;
      case 'flower':
        ctx.strokeStyle = 'rgba(140,190,100,.7)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -12); ctx.stroke();
        const fc = ['#ffd86a', '#ff8fb0', '#fff0d0'][Math.floor(seed * 3) % 3];
        ctx.fillStyle = fc;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          ctx.beginPath(); ctx.arc(Math.cos(a) * 4, -12 + Math.sin(a) * 4, 3, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#fff6c8';
        ctx.beginPath(); ctx.arc(0, -12, 2, 0, Math.PI * 2); ctx.fill();
        break;
      case 'stone':
        ctx.fillStyle = 'rgba(90,86,80,.85)';
        ctx.beginPath(); ctx.ellipse(0, 0, 12, 8, 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(140,136,128,.7)';
        ctx.beginPath(); ctx.ellipse(-3, -2.5, 7, 4, 0.3, 0, Math.PI * 2); ctx.fill();
        break;
      case 'mushroom':
        ctx.fillStyle = '#e8dcc0';
        M.roundRect(ctx, -2.5, -8, 5, 9, 2); ctx.fill();
        ctx.fillStyle = '#c9584a';
        ctx.beginPath(); ctx.ellipse(0, -9, 9, 5.5, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = 'rgba(255,240,220,.8)';
        ctx.beginPath(); ctx.arc(-4, -11, 1.8, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(3, -12, 1.5, 0, Math.PI * 2); ctx.fill();
        break;
      case 'bone':
        ctx.fillStyle = 'rgba(230,225,205,.8)';
        M.roundRect(ctx, -10, -2, 20, 4.5, 2.2); ctx.fill();
        ctx.beginPath(); ctx.arc(-10, -3, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(-10, 2.5, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(10, -3, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(10, 2.5, 3.2, 0, Math.PI * 2); ctx.fill();
        break;
      case 'skull':
        ctx.fillStyle = 'rgba(235,230,212,.85)';
        ctx.beginPath(); ctx.ellipse(0, -2, 10, 8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(40,32,26,.85)';
        ctx.beginPath(); ctx.ellipse(-4, -3, 2.6, 3.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(4, -3, 2.6, 3.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(210,200,180,.9)';
        M.roundRect(ctx, -6, 5, 12, 5, 2); ctx.fill();
        break;
      case 'log':
        ctx.fillStyle = 'rgba(96,68,42,.85)';
        M.roundRect(ctx, -18, -7, 36, 14, 6); ctx.fill();
        ctx.fillStyle = 'rgba(140,100,64,.8)';
        ctx.beginPath(); ctx.ellipse(18, 0, 4, 7, 0, 0, Math.PI * 2); ctx.fill();
        break;
      case 'crack':
        ctx.strokeStyle = theme.decor === 'volcano' ? 'rgba(255,120,40,.75)' : 'rgba(30,22,16,.6)';
        ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-16, 0);
        ctx.lineTo(-4, 6 + seed * 4); ctx.lineTo(6, -4); ctx.lineTo(18, 3);
        ctx.stroke();
        break;
      case 'ice':
        ctx.fillStyle = 'rgba(200,230,245,.7)';
        ctx.beginPath();
        ctx.moveTo(-12, 4); ctx.lineTo(0, -12); ctx.lineTo(12, 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.6)';
        ctx.beginPath();
        ctx.moveTo(-5, 4); ctx.lineTo(0, -6); ctx.lineTo(5, 4); ctx.closePath(); ctx.fill();
        break;
      case 'pine':
        ctx.fillStyle = 'rgba(30,60,45,.85)';
        ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(9, 4); ctx.lineTo(-9, 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.5)';
        ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(4, -6); ctx.lineTo(-4, -6); ctx.closePath(); ctx.fill();
        break;
      case 'cactus':
        ctx.fillStyle = 'rgba(60,110,60,.85)';
        M.roundRect(ctx, -5, -22, 10, 26, 5); ctx.fill();
        M.roundRect(ctx, -14, -14, 9, 6, 3); ctx.fill();
        M.roundRect(ctx, 5, -18, 9, 6, 3); ctx.fill();
        break;
      case 'pillar':
        ctx.fillStyle = 'rgba(120,118,128,.75)';
        M.roundRect(ctx, -9, -26, 18, 30, 3); ctx.fill();
        ctx.fillStyle = 'rgba(160,158,168,.6)';
        M.roundRect(ctx, -12, -30, 24, 6, 2); ctx.fill();
        ctx.strokeStyle = 'rgba(60,58,66,.6)'; ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-9, -20 + i * 9); ctx.lineTo(9, -20 + i * 9); ctx.stroke(); }
        break;
      default: break;
    }
  }

  function drawBorderProp(ctx, theme, seed) {
    /* 边界处的树 / 岩柱，玩家无法进入 */
    const s = 0.9 + seed * 0.4;
    if (theme.decor === 'canyon' || theme.decor === 'volcano' || theme.decor === 'ruin' || theme.decor === 'temple') {
      ctx.fillStyle = theme.decor === 'volcano' ? '#3a201a' : (theme.decor === 'canyon' ? '#5b4a38' : '#4a4a55');
      ctx.beginPath();
      ctx.moveTo(-18 * s, 14); ctx.lineTo(-8 * s, -30 * s - seed * 14);
      ctx.lineTo(6 * s, -22 * s); ctx.lineTo(18 * s, 14);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.beginPath();
      ctx.moveTo(-8 * s, -30 * s - seed * 14); ctx.lineTo(6 * s, -22 * s); ctx.lineTo(-2 * s, -10 * s);
      ctx.closePath(); ctx.fill();
    } else {
      /* 树 */
      ctx.fillStyle = '#4a3320';
      M.roundRect(ctx, -4 * s, -6, 8 * s, 24, 3); ctx.fill();
      const leaf = theme.decor === 'snow' ? '#5c7a72' : (theme.decor === 'desert' ? '#7d8a4a' : (theme.decor === 'den' ? '#3c4438' : '#2f5a37'));
      ctx.fillStyle = leaf;
      ctx.beginPath(); ctx.arc(0, -18 * s, 17 * s, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-12 * s, -8 * s, 12 * s, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(12 * s, -9 * s, 12 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.beginPath(); ctx.arc(-5 * s, -22 * s, 8 * s, 0, Math.PI * 2); ctx.fill();
    }
  }

  /* ---------------- 波次调度 ---------------- */
  class WaveRunner {
    constructor(plan, g) {
      this.plan = plan;
      this.g = g;
      this.index = -1;
      this.state = 'idle';   // idle | announce | spawn | fight | gap | done
      this.timer = 0;
      this.spawnQueue = [];
      this.total = plan.length;
    }
    get current() { return this.index + 1; }

    start() {
      this.index = -1;
      this.next();
    }
    next() {
      this.index++;
      if (this.index >= this.plan.length) { this.state = 'done'; return; }
      const w = this.plan[this.index];
      this.spawnQueue = this.build(w);
      this.state = 'announce';
      this.timer = w.boss ? 2.2 : 1.1;
      this.g.announceWave(this.index + 1, this.plan.length, !!w.boss);
      if (w.boss) NLB.Sound.play('boss');
    }
    build(w) {
      const list = [];
      if (w.boss) list.push({ kind: w.boss });
      for (let i = 0; i < w.count; i++) {
        list.push({ kind: 'wolf', elite: Math.random() < w.eliteRatio });
      }
      return list;
    }
    spawnOne(item) {
      const g = this.g;
      const m = C.WORLD.margin + 30;
      let x = 0, y = 0, ok = false;
      /* 刷在合理交战距离内，且离两名角色都不算太远，避免满地图跑图 */
      for (let tries = 0; tries < 40; tries++) {
        x = M.rand(m, g.bounds.w - m);
        y = M.rand(m, g.bounds.h - m);
        let minD = 1e9, maxD = 0;
        for (const p of g.players) {
          const d = M.dist(p.x, p.y, x, y);
          minD = Math.min(minD, d); maxD = Math.max(maxD, d);
        }
        if (minD > 350 && maxD < 820) { ok = true; break; }
      }
      if (!ok) {
        const p0 = g.players[g.controlled] || g.players[0];
        const a = M.rand(0, Math.PI * 2);
        x = M.clamp(p0.x + Math.cos(a) * 560, m, g.bounds.w - m);
        y = M.clamp(p0.y + Math.sin(a) * 560, m, g.bounds.h - m);
      }
      const e = new NLB.Enemy(item.kind, x, y, g.level, g.fieldScale, !!item.elite);
      g.enemies.push(e);
      g.particles.ring(x, y, { color: item.kind === 'wolf' ? '#b9836a' : '#ff8a7d', r1: 110 });
      if (e.isBoss) {
        g.setBoss(e);
        g.camera.shake(14, 0.6);
      }
    }
    update(dt) {
      const g = this.g;
      switch (this.state) {
        case 'announce':
          this.timer -= dt;
          if (this.timer <= 0) { this.state = 'spawn'; this.timer = 0; }
          break;
        case 'spawn': {
          /* 分批刷出，避免瞬间堆脸 */
          this.timer -= dt;
          if (this.timer <= 0 && this.spawnQueue.length) {
            const item = this.spawnQueue.shift();
            this.spawnOne(item);
            this.timer = item.kind === 'wolf' ? 0.14 : 0;
          }
          if (!this.spawnQueue.length) { this.state = 'fight'; }
          break;
        }
        case 'fight': {
          let alive = 0;
          for (const e of g.enemies) if (e.alive) alive++;
          if (alive === 0) {
            this.state = 'gap';
            this.timer = 1.4;
            g.onWaveCleared(this.index + 1, this.plan.length);
          }
          break;
        }
        case 'gap':
          this.timer -= dt;
          if (this.timer <= 0) this.next();
          break;
        default: break;
      }
    }
    get finished() { return this.state === 'done'; }
  }

  NLB.World = World;
  NLB.WaveRunner = WaveRunner;
})(window.NLB);
