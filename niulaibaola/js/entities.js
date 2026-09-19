/* ===========================================================
 * 牛来豹拉大冒险 —— 实体层
 * 基类 / 玩家（牛来·豹拉） / 敌人（狼·狼王·老虎） / 弹道 / 掉落
 * =========================================================== */
(function (NLB) {
  'use strict';
  const M = NLB.M;
  const C = NLB.CONFIG;
  const S = NLB.Sound;

  /* ---------------- 实体基类 ---------------- */
  class Entity {
    constructor(x, y, r) {
      this.x = x; this.y = y; this.r = r;
      this.vx = 0; this.vy = 0;
      this.hp = 1; this.maxHp = 1;
      this.alive = true; this.dying = false; this.dead = false;
      this.facing = 1;           // 1 右 / -1 左
      this.aim = 0;              // 朝向弧度
      this.flash = 0;            // 受击白闪
      this.hitStun = 0;
      this.slowT = 0; this.slowF = 1;
      this.spawnT = 0.35;        // 出场保护/淡入
      this.deathT = 0;
      this.shadow = true;
    }
    get centerY() { return this.y; }
    knock(nx, ny, power) { this.vx += nx * power; this.vy += ny * power; }
    applySlow(f, t) { this.slowF = Math.min(this.slowF, f); this.slowT = Math.max(this.slowT, t); }
    tickCommon(dt) {
      if (this.flash > 0) this.flash -= dt;
      if (this.hitStun > 0) this.hitStun -= dt;
      if (this.spawnT > 0) this.spawnT -= dt;
      if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) this.slowF = 1; }
      const d = Math.exp(-6 * dt);
      this.vx *= d; this.vy *= d;
    }
    moveWithBounds(dt, bounds) {
      const sf = this.slowF;
      this.x += this.vx * dt * sf;
      this.y += this.vy * dt * sf;
      const m = C.WORLD.margin;
      this.x = M.clamp(this.x, m + this.r, bounds.w - m - this.r);
      this.y = M.clamp(this.y, m + this.r, bounds.h - m - this.r);
    }
    drawShadow(ctx) {
      ctx.save();
      ctx.globalAlpha = 0.26;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(this.x, this.y + this.r * 0.72, this.r * 0.95, this.r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    drawHpBar(ctx, w) {
      if (this.hp >= this.maxHp) return;
      const bw = w || this.r * 2.2, bh = 5;
      const x = this.x - bw / 2, y = this.y - this.r - 16;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      M.roundRect(ctx, x - 1, y - 1, bw + 2, bh + 2, 3); ctx.fill();
      ctx.fillStyle = this.hp / this.maxHp > 0.35 ? '#7bd66a' : '#e8574a';
      M.roundRect(ctx, x, y, bw * Math.max(0, this.hp / this.maxHp), bh, 2.5); ctx.fill();
      ctx.restore();
    }
  }

  /* ---------------- 玩家 ---------------- */
  class Player extends Entity {
    constructor(kind, x, y, stats) {
      super(x, y, kind === 'niu' ? C.BASE.niu.radius : C.BASE.bao.radius);
      this.kind = kind;                       // 'niu' | 'bao'
      this.name = kind === 'niu' ? '牛来' : '豹拉';
      this.st = kind === 'niu' ? stats.niu : stats.bao;
      this.team = stats.team;
      this.maxHp = this.st.hp;
      this.hp = this.maxHp;
      this.atkTimer = 0;
      this.skillTimer = 0;
      this.dashT = 0; this.dashDirX = 1; this.dashDirY = 0; this.dashHit = null;
      this.furyT = 0;
      this.controlled = false;
      this.downed = false; this.downT = 0; this.rescue = 0; this.autoReviveT = 0;
      this.shield = stats.team.shield || 0;
      this.invul = 0.6;
      this.walkPhase = 0;
      this.attackAnim = 0;
      this.moving = false;
    }
    get isNiu() { return this.kind === 'niu'; }

    /* 倒地判定 */
    down() {
      if (this.downed) return;
      this.downed = true;
      this.hp = 0;
      this.downT = C.COMBAT.downTime;
      this.rescue = 0;
      this.dashT = 0; this.furyT = 0;
      if (this.team.reviveCount > 0) {
        this.team.reviveCount -= 1;
        this.autoReviveT = 1.6;
        NLB.game.float(this.x, this.y - 40, '不屈意志！', '#ffd98a', true);
      }
      S.play('die');
      NLB.game.particles.burst(this.x, this.y, { count: 16, color: '#e8574a', speedMax: 260 });
    }
    reviveAt(ratio) {
      this.downed = false;
      this.hp = Math.max(1, Math.round(this.maxHp * ratio));
      this.invul = 1.4;
      this.rescue = 0;
      this.autoReviveT = 0;
      NLB.game.particles.ring(this.x, this.y, { color: '#7bd66a', r1: 110 });
      NLB.game.float(this.x, this.y - 40, '重新站起！', '#7bd66a', true);
      S.play('levelup');
    }
    heal(amount, link) {
      if (this.downed) return 0;
      const before = this.hp;
      this.hp = Math.min(this.maxHp, this.hp + amount);
      const got = this.hp - before;
      if (got > 0.5) NLB.game.float(this.x, this.y - 30, '+' + Math.round(got), '#7bd66a');
      if (link && NLB.game.otherOf(this) && !NLB.game.otherOf(this).downed) {
        NLB.game.otherOf(this).heal(amount * this.team.linkHeal, false);
      }
      return got;
    }

    /* 承受伤害 */
    takeDamage(amount, srcX, srcY, knockPower) {
      if (this.downed || this.invul > 0 || this.spawnT > 0) return 0;
      let dr = this.st.dr;
      /* 队友倒地 → 背水一战 */
      const mate = NLB.game.otherOf(this);
      if (mate && mate.downed && this.team.loneWolf > 0) dr = 1 - (1 - dr) * (1 - 0.15);
      if (this.shield > 0) {
        this.shield -= 1;
        this.invul = 0.5; this.flash = 0.25;
        NLB.game.particles.ring(this.x, this.y, { color: '#6cc7ff', r1: 70 });
        NLB.game.float(this.x, this.y - 36, '护盾抵挡', '#6cc7ff');
        S.play('hit');
        return 0;
      }
      const real = Math.max(1, amount * (1 - dr));
      this.hp -= real;
      this.flash = 0.22;
      this.invul = C.COMBAT.invulAfterHit * 0.6;
      this.hitStun = C.COMBAT.hitStun;
      if (srcX != null) {
        const a = M.angle(srcX, srcY, this.x, this.y);
        this.knock(Math.cos(a), Math.sin(a), knockPower || 150);
      }
      NLB.game.float(this.x, this.y - 26, Math.round(real), this.controlled ? '#ff8a7d' : '#ffd0a8');
      NLB.game.particles.burst(this.x, this.y, { count: 6, color: '#ff8a7d', speedMax: 170, rMax: 4 });
      NLB.game.camera.shake(this.controlled ? 7 : 4, 0.16);
      S.play('hurt');
      if (this.hp <= 0) this.down();
      return real;
    }

    /* 普通攻击 */
    attack(g) {
      if (this.atkTimer > 0 || this.downed || this.dashT > 0) return false;
      this.atkTimer = this.st.atkCd * (this.furyT > 0 ? 1 : 1);
      this.attackAnim = 0.22;
      if (this.isNiu) this.meleeSwing(g);
      else this.shoot(g);
      return true;
    }
    meleeSwing(g) {
      S.play('swing');
      const dmg = this.st.atkDmg * this.st.dmg;
      const range = this.st.atkRange, arc = this.st.atkArc;
      g.particles.burst(
        this.x + Math.cos(this.aim) * range * 0.55,
        this.y + Math.sin(this.aim) * range * 0.55,
        { count: 10, color: '#ffe9b8', angle: this.aim, spread: 0.9, speedMax: 240, rMax: 4, lifeMax: 0.32 }
      );
      let hitAny = false;
      for (const e of g.enemies) {
        if (!e.alive || e.spawnT > 0) continue;
        if (!M.inArc(e.x, e.y, this.x, this.y, this.aim, arc, range + e.r)) continue;
        const d = this.rollDamage(dmg, e);
        e.takeDamage(d.amount, this.x, this.y, 240, d.crit);
        if (this.st.slowOnHit) e.applySlow(0.65, 1.5);
        this.onDealDamage(d.amount);
        hitAny = true;
      }
      if (hitAny) { S.play('hit'); g.camera.shake(3, 0.1); }
    }
    shoot(g) {
      S.play('shoot');
      const rateBonus = this.furyT > 0 ? 1 / this.st.furyRate : 1;
      this.atkTimer = this.st.atkCd * rateBonus;
      const n = this.st.arrows;
      const dmg = this.st.atkDmg * this.st.dmg;
      for (let i = 0; i < n; i++) {
        let a = this.aim;
        if (n > 1) a += (i - (n - 1) / 2) * this.st.spread * 1.6;
        const sp = this.st.projSpeed;
        g.projectiles.push(new Projectile({
          x: this.x + Math.cos(a) * (this.r + 6),
          y: this.y + Math.sin(a) * (this.r + 6),
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          dmg, r: 7, life: this.st.projLife,
          pierce: this.st.pierce + (this.furyT > 0 ? this.st.furyPierce : 0),
          owner: this, color: '#ffe08a', kind: 'claw', angle: a,
        }));
      }
      g.particles.burst(this.x + Math.cos(this.aim) * this.r, this.y + Math.sin(this.aim) * this.r,
        { count: 4, color: '#ffe08a', angle: this.aim, spread: 0.4, speedMax: 140, rMax: 3, lifeMax: 0.2 });
    }
    /* 技能 */
    useSkill(g) {
      if (this.skillTimer > 0 || this.downed || this.dashT > 0) return false;
      this.skillTimer = this.st.skillCd;
      if (this.isNiu) {
        const mv = this.intent ? this.intent.mx : Math.cos(this.aim);
        const mv2 = this.intent ? this.intent.my : Math.sin(this.aim);
        const l = Math.hypot(mv, mv2) || 1;
        this.dashDirX = mv / l; this.dashDirY = mv2 / l;
        this.dashT = this.st.dashTime;
        this.dashHit = new Set();
        this.invul = Math.max(this.invul, 0.3);
        S.play('dash');
        g.particles.burst(this.x, this.y, { count: 12, color: '#c9a06a', speedMax: 200 });
        g.float(this.x, this.y - 42, '蛮牛冲撞！', '#ffb648');
      } else {
        this.furyT = this.st.furyTime;
        S.play('levelup');
        g.particles.ring(this.x, this.y, { color: '#ffe08a', r1: 100 });
        g.float(this.x, this.y - 42, '疾风连射！', '#ffe08a');
      }
      return true;
    }
    rollDamage(base, target) {
      const crit = Math.random() < this.st.crit;
      let amount = base * (crit ? this.st.critMul : 1);
      amount *= M.rand(0.94, 1.06);
      return { amount, crit };
    }
    onDealDamage(amount) {
      if (this.st.lifesteal > 0) this.heal(amount * this.st.lifesteal, false);
    }

    update(dt, g) {
      this.tickCommon(dt);
      if (this.invul > 0) this.invul -= dt;
      if (this.attackAnim > 0) this.attackAnim -= dt;
      if (this.atkTimer > 0) this.atkTimer -= dt;
      if (this.skillTimer > 0) this.skillTimer -= dt;
      if (this.furyT > 0) this.furyT -= dt;

      if (this.downed) {
        this.downT -= dt;
        if (this.autoReviveT > 0) {
          this.autoReviveT -= dt;
          if (this.autoReviveT <= 0) this.reviveAt(0.5);
        }
        /* 队友救援 */
        const mate = g.otherOf(this);
        if (mate && !mate.downed && M.dist(mate.x, mate.y, this.x, this.y) < C.COMBAT.reviveRange) {
          this.rescue += dt * (mate.controlled ? 1.35 : 1);
          if (this.rescue >= C.COMBAT.reviveTime) this.reviveAt(C.COMBAT.reviveHpRatio);
        } else {
          this.rescue = Math.max(0, this.rescue - dt * 0.6);
        }
        this.vx *= 0.9; this.vy *= 0.9;
        this.moveWithBounds(dt, g.bounds);
        return;
      }

      const it = this.intent || { mx: 0, my: 0, attack: false, skill: false };
      let mx = it.mx, my = it.my;
      const ml = Math.hypot(mx, my);
      this.moving = ml > 0.05;
      if (ml > 1) { mx /= ml; my /= ml; }

      if (this.dashT > 0) {
        /* 冲撞中 */
        this.dashT -= dt;
        const sp = this.st.dashSpeed;
        this.x += this.dashDirX * sp * dt;
        this.y += this.dashDirY * sp * dt;
        this.vx = this.dashDirX * sp * 0.4; this.vy = this.dashDirY * sp * 0.4;
        if (Math.random() < 0.7) {
          g.particles.burst(this.x, this.y, { count: 2, color: '#d8b483', speedMax: 90, rMax: 5, lifeMax: 0.3 });
        }
        for (const e of g.enemies) {
          if (!e.alive || this.dashHit.has(e)) continue;
          if (M.dist(e.x, e.y, this.x, this.y) < this.st.dashRadius + e.r) {
            this.dashHit.add(e);
            const d = this.rollDamage(this.st.dashDmg * this.st.dmg, e);
            e.takeDamage(d.amount, this.x, this.y, 420, d.crit);
            e.stun = Math.max(e.stun || 0, 0.35);
            if (this.st.slowOnHit) e.applySlow(0.65, 1.5);
            this.onDealDamage(d.amount);
            g.camera.shake(8, 0.16);
            S.play('hit');
          }
        }
        if (this.dashT <= 0 && this.st.dashShock) {
          g.particles.ring(this.x, this.y, { color: '#ffb648', r1: 150, width: 6 });
          g.camera.shake(10, 0.2);
          for (const e of g.enemies) {
            if (!e.alive) continue;
            if (M.dist(e.x, e.y, this.x, this.y) < 150) {
              const d = this.rollDamage(this.st.dashDmg * this.st.dmg * 0.6, e);
              e.takeDamage(d.amount, this.x, this.y, 300, d.crit);
              this.onDealDamage(d.amount);
            }
          }
        }
      } else {
        const sp = this.st.speed * (this.furyT > 0 ? 1.08 : 1);
        if (this.hitStun <= 0) {
          this.x += mx * sp * dt * this.slowF;
          this.y += my * sp * dt * this.slowF;
        } else {
          this.x += mx * sp * 0.3 * dt;
          this.y += my * sp * 0.3 * dt;
        }
        if (this.moving) {
          this.walkPhase += dt * (this.isNiu ? 9 : 12);
          this.facing = mx >= 0 ? 1 : -1;
        } else {
          this.walkPhase += dt * 2;
        }
      }

      this.moveWithBounds(dt, g.bounds);

      /* 攻击朝向 */
      if (it.aimX != null) {
        this.aim = M.angle(this.x, this.y, it.aimX, it.aimY);
      } else if (this.moving) {
        this.aim = Math.atan2(my, mx);
      }
      if (Math.cos(this.aim) >= 0) this.facing = 1; else this.facing = -1;

      if (it.attack) this.attack(g);
      if (it.skill) this.useSkill(g);
    }

    /* ---- 绘制 ---- */
    draw(ctx) {
      ctx.save();
      ctx.translate(this.x, this.y);
      if (this.downed) {
        ctx.globalAlpha = 0.85;
        ctx.rotate(1.35);
        ctx.scale(this.facing || 1, 1);
      } else {
        ctx.scale(this.facing, 1);
      }
      const bob = this.moving ? Math.sin(this.walkPhase) * 2.2 : Math.sin(this.walkPhase * 0.5) * 1.1;
      ctx.translate(0, bob * 0.5);

      if (this.flash > 0) { ctx.shadowColor = '#fff'; ctx.shadowBlur = 18; }
      if (this.isNiu) drawNiu(ctx, this); else drawBao(ctx, this);
      ctx.shadowBlur = 0;
      ctx.restore();

      /* 无敌护盾闪烁 */
      if (this.invul > 0 && !this.downed) {
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.25 * Math.sin(performance.now() / 60);
        ctx.strokeStyle = '#6cc7ff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.r + 8, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      /* 倒地救援环 */
      if (this.downed) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.r + 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - this.downT / C.COMBAT.downTime)); ctx.stroke();
        if (this.rescue > 0) {
          ctx.strokeStyle = '#7bd66a'; ctx.lineWidth = 5;
          ctx.beginPath(); ctx.arc(this.x, this.y, this.r + 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, this.rescue / C.COMBAT.reviveTime)); ctx.stroke();
        }
        ctx.fillStyle = '#ffd0a8'; ctx.font = 'bold 13px system-ui,sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(this.autoReviveT > 0 ? '不屈意志…' : '等待救援 [靠近]', this.x, this.y - this.r - 24);
        ctx.restore();
      }
      /* 操控标识 */
      if (this.controlled && !this.downed) {
        ctx.save();
        const t = performance.now() / 300;
        ctx.fillStyle = '#ffb648';
        ctx.beginPath();
        const ay = this.y - this.r - 26 + Math.sin(t) * 3;
        ctx.moveTo(this.x, ay + 9); ctx.lineTo(this.x - 7, ay - 3); ctx.lineTo(this.x + 7, ay - 3);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      if (this.furyT > 0 && !this.downed) {
        ctx.save();
        ctx.globalAlpha = 0.4 + 0.2 * Math.sin(performance.now() / 70);
        ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.r + 12, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
  }

  /* ---- 牛来形象 ---- */
  function drawNiu(ctx, p) {
    const r = p.r;
    // 腿
    ctx.fillStyle = '#6b4a2f';
    const legSw = p.moving ? Math.sin(p.walkPhase) * 4 : 0;
    M.roundRect(ctx, -r * 0.6, r * 0.35, r * 0.34, r * 0.55 + legSw * 0.2, 3); ctx.fill();
    M.roundRect(ctx, r * 0.24, r * 0.35, r * 0.34, r * 0.55 - legSw * 0.2, 3); ctx.fill();
    // 身体
    if (!p._grd) { const g2 = ctx.createLinearGradient(0, -r, 0, r); g2.addColorStop(0, '#a9743f'); g2.addColorStop(1, '#7d5228'); p._grd = g2; }
    ctx.fillStyle = p._grd;
    ctx.beginPath(); ctx.ellipse(0, r * 0.12, r * 0.98, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    // 白斑
    ctx.fillStyle = 'rgba(255,240,220,.75)';
    ctx.beginPath(); ctx.ellipse(-r * 0.25, r * 0.2, r * 0.32, r * 0.22, 0.4, 0, Math.PI * 2); ctx.fill();
    // 头
    ctx.save();
    ctx.translate(r * 0.55, -r * 0.28);
    ctx.fillStyle = '#8a5c31';
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.62, r * 0.52, 0, 0, Math.PI * 2); ctx.fill();
    // 口鼻
    ctx.fillStyle = '#e8c9a8';
    ctx.beginPath(); ctx.ellipse(r * 0.3, r * 0.16, r * 0.3, r * 0.24, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5b3a22';
    ctx.beginPath(); ctx.arc(r * 0.22, r * 0.12, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.42, r * 0.12, 1.8, 0, Math.PI * 2); ctx.fill();
    // 眼
    ctx.fillStyle = '#20140c';
    ctx.beginPath(); ctx.arc(r * 0.16, -r * 0.12, r * 0.11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(r * 0.19, -r * 0.15, r * 0.045, 0, Math.PI * 2); ctx.fill();
    // 角
    ctx.fillStyle = '#f0e2c8';
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, -r * 0.38); ctx.lineTo(-r * 0.55, -r * 0.78); ctx.lineTo(-r * 0.02, -r * 0.62);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 0.3, -r * 0.42); ctx.lineTo(r * 0.34, -r * 0.92); ctx.lineTo(r * 0.5, -r * 0.4);
    ctx.closePath(); ctx.fill();
    // 耳
    ctx.fillStyle = '#7d5228';
    ctx.beginPath(); ctx.ellipse(-r * 0.42, -r * 0.1, r * 0.18, r * 0.11, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // 攻击挥砍特效
    if (p.attackAnim > 0) {
      const k = p.attackAnim / 0.22;
      ctx.save();
      ctx.globalAlpha = k * 0.75;
      ctx.strokeStyle = '#ffe9b8'; ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(r * 0.4, 0, p.st.atkRange * 0.75, -p.st.atkArc / 2, p.st.atkArc / 2);
      ctx.stroke();
      ctx.restore();
    }
    // 冲撞气流
    if (p.dashT > 0) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#e8d0a8';
      ctx.beginPath(); ctx.ellipse(-r * 0.9, 0, r * 0.7, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  /* ---- 豹拉形象 ---- */
  function drawBao(ctx, p) {
    const r = p.r;
    // 尾巴
    ctx.save();
    ctx.strokeStyle = '#e0a534'; ctx.lineWidth = r * 0.22; ctx.lineCap = 'round';
    const tailW = Math.sin(p.walkPhase * 0.8) * 0.5;
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, 0);
    ctx.quadraticCurveTo(-r * 1.5, -r * 0.4 + tailW * 10, -r * 1.65, -r * 1.0 + tailW * 14);
    ctx.stroke();
    ctx.restore();
    // 腿
    ctx.fillStyle = '#b8822a';
    const legSw = p.moving ? Math.sin(p.walkPhase) * 4 : 0;
    M.roundRect(ctx, -r * 0.5, r * 0.3, r * 0.28, r * 0.6 + legSw * 0.25, 3); ctx.fill();
    M.roundRect(ctx, r * 0.2, r * 0.3, r * 0.28, r * 0.6 - legSw * 0.25, 3); ctx.fill();
    // 身体
    if (!p._grd) { const g2 = ctx.createLinearGradient(0, -r, 0, r); g2.addColorStop(0, '#f6c85a'); g2.addColorStop(1, '#d9a02f'); p._grd = g2; }
    ctx.fillStyle = p._grd;
    ctx.beginPath(); ctx.ellipse(0, r * 0.1, r * 0.92, r * 0.66, -0.12, 0, Math.PI * 2); ctx.fill();
    // 斑点
    ctx.fillStyle = 'rgba(60,35,10,.75)';
    const spots = [[-0.45, -0.1], [-0.1, 0.2], [0.3, -0.15], [0.55, 0.18], [-0.3, 0.3]];
    for (const spt of spots) {
      ctx.beginPath(); ctx.arc(r * spt[0], r * spt[1], r * 0.09, 0, Math.PI * 2); ctx.fill();
    }
    // 头
    ctx.save();
    ctx.translate(r * 0.6, -r * 0.38);
    ctx.fillStyle = '#f5c25e';
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.56, r * 0.48, 0, 0, Math.PI * 2); ctx.fill();
    // 耳
    ctx.fillStyle = '#e0a534';
    ctx.beginPath(); ctx.moveTo(-r * 0.3, -r * 0.35); ctx.lineTo(-r * 0.42, -r * 0.86); ctx.lineTo(-r * 0.02, -r * 0.5); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(r * 0.22, -r * 0.4); ctx.lineTo(r * 0.3, -r * 0.88); ctx.lineTo(r * 0.5, -r * 0.36); ctx.closePath(); ctx.fill();
    // 口鼻
    ctx.fillStyle = '#fff2d6';
    ctx.beginPath(); ctx.ellipse(r * 0.3, r * 0.14, r * 0.26, r * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c0563f';
    ctx.beginPath(); ctx.ellipse(r * 0.36, r * 0.1, r * 0.07, r * 0.05, 0, 0, Math.PI * 2); ctx.fill();
    // 眼
    ctx.fillStyle = '#2a1a08';
    ctx.beginPath(); ctx.ellipse(r * 0.16, -r * 0.1, r * 0.12, r * 0.14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8ce07a';
    ctx.beginPath(); ctx.ellipse(r * 0.2, -r * 0.1, r * 0.06, r * 0.09, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1005';
    ctx.beginPath(); ctx.ellipse(r * 0.22, -r * 0.1, r * 0.025, r * 0.06, 0, 0, Math.PI * 2); ctx.fill();
    // 胡须
    ctx.strokeStyle = 'rgba(255,250,235,.7)'; ctx.lineWidth = 1.2;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(r * 0.34, r * 0.16 + i * 3);
      ctx.lineTo(r * 0.66, r * 0.1 + i * 6); ctx.stroke();
    }
    ctx.restore();
    // 蓄力/连射特效
    if (p.furyT > 0) {
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.25 * Math.sin(performance.now() / 60);
      ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 2.5;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, r * (1.2 + i * 0.35), performance.now() / 400 + i, performance.now() / 400 + i + 1.6);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* ---------------- 弹道 ---------------- */
  class Projectile {
    constructor(o) {
      this.x = o.x; this.y = o.y; this.vx = o.vx; this.vy = o.vy;
      this.dmg = o.dmg; this.r = o.r || 7; this.life = o.life || 1;
      this.pierce = o.pierce || 0; this.hits = new Set();
      this.owner = o.owner; this.color = o.color || '#ffe08a';
      this.kind = o.kind || 'claw'; this.angle = o.angle || 0;
      this.friendly = o.friendly !== false;
      this.dead = false; this.trail = [];
      this.spin = 0;
    }
    update(dt, g) {
      this.life -= dt;
      if (this.life <= 0) { this.dead = true; return; }
      this.spin += dt * 14;
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.trail.push({ x: this.x, y: this.y, t: 0.22 });
      if (this.trail.length > 8) this.trail.shift();
      for (const t of this.trail) t.t -= dt;

      const m = C.WORLD.margin;
      if (this.x < m || this.y < m || this.x > g.bounds.w - m || this.y > g.bounds.h - m) { this.dead = true; return; }

      if (this.friendly) {
        for (const e of g.enemies) {
          if (!e.alive || this.hits.has(e) || e.spawnT > 0) continue;
          if (M.dist(e.x, e.y, this.x, this.y) < e.r + this.r) {
            this.hits.add(e);
            const d = this.owner.rollDamage(this.dmg, e);
            e.takeDamage(d.amount, this.x, this.y, 60, d.crit);
            if (this.owner.st && this.owner.st.slowOnHit) e.applySlow(0.65, 1.5);
            this.owner.onDealDamage(d.amount);
            S.play('hit');
            if (this.hits.size > this.pierce) { this.dead = true; return; }
          }
        }
      } else {
        for (const p of g.players) {
          if (p.downed || this.hits.has(p)) continue;
          if (M.dist(p.x, p.y, this.x, this.y) < p.r + this.r) {
            this.hits.add(p);
            p.takeDamage(this.dmg, this.x, this.y, 180);
            this.dead = true; return;
          }
        }
      }
    }
    draw(ctx) {
      ctx.save();
      if (this.kind === 'wave') {
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = this.color; ctx.lineWidth = this.r;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.r * 2.4, 0, Math.PI * 2); ctx.stroke();
      } else {
        for (const t of this.trail) {
          if (t.t <= 0) continue;
          ctx.globalAlpha = t.t * 1.6;
          ctx.fillStyle = this.color;
          ctx.beginPath(); ctx.arc(t.x, t.y, this.r * 0.6, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle + this.spin);
        ctx.fillStyle = this.color;
        ctx.shadowColor = this.color; ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(this.r * 1.7, 0);
        ctx.quadraticCurveTo(0, this.r * 0.85, -this.r * 1.1, 0);
        ctx.quadraticCurveTo(0, -this.r * 0.85, this.r * 1.7, 0);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.beginPath(); ctx.arc(0, 0, this.r * 0.3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  /* ---------------- 掉落物 ---------------- */
  class Pickup {
    constructor(x, y, type, value) {
      this.x = x; this.y = y; this.r = 11;
      this.type = type; this.value = value;
      this.life = 22; this.t = 0; this.dead = false;
      this.vx = M.rand(-40, 40); this.vy = M.rand(-40, 40);
      this.bob = M.rand(0, 6);
    }
    update(dt, g) {
      this.t += dt; this.life -= dt;
      if (this.life <= 0) { this.dead = true; return; }
      const d = Math.exp(-5 * dt);
      this.vx *= d; this.vy *= d;
      /* 磁吸 */
      let best = null, bd = 1e9;
      for (const p of g.players) {
        if (p.downed) continue;
        const dd = M.dist(p.x, p.y, this.x, this.y);
        if (dd < bd) { bd = dd; best = p; }
      }
      const range = g.stats.team.pickupRange;
      if (best && bd < range) {
        const a = M.angle(this.x, this.y, best.x, best.y);
        const pull = 380 * (1 - bd / range);
        this.x += Math.cos(a) * pull * dt;
        this.y += Math.sin(a) * pull * dt;
        if (bd < best.r + this.r + 4) {
          this.dead = true;
          this.collect(best, g);
          return;
        }
      } else {
        this.x += this.vx * dt; this.y += this.vy * dt;
      }
      this.bob += dt * 4;
    }
    collect(p, g) {
      S.play('pick');
      if (this.type === 'gene') {
        const v = Math.round(this.value * g.stats.team.geneMul);
        g.gainGenes(v);
        g.float(this.x, this.y, '+' + v + ' 基因', '#ffb648');
      } else if (this.type === 'heal') {
        p.heal(this.value, true);
        g.particles.ring(p.x, p.y, { color: '#7bd66a', r1: 60 });
      } else if (this.type === 'energy') {
        p.skillTimer = Math.max(0, p.skillTimer - 2.2);
        g.float(p.x, p.y - 40, '技能冷却 -2s', '#6cc7ff');
      }
      g.particles.burst(this.x, this.y, { count: 6, color: this.type === 'gene' ? '#ffb648' : '#7bd66a', speedMax: 130, rMax: 3 });
    }
    drawShadow(ctx) {
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(this.x, this.y + 10, 8, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    draw(ctx) {
      ctx.save();
      const b = Math.sin(this.bob) * 3;
      ctx.globalAlpha = this.life < 3 ? (0.35 + 0.65 * Math.abs(Math.sin(this.life * 6))) : 1;
      ctx.translate(this.x, this.y + b);
      ctx.shadowColor = this.type === 'gene' ? '#ffb648' : '#7bd66a';
      ctx.shadowBlur = 10;
      if (this.type === 'gene') {
        ctx.fillStyle = '#ffb648';
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + this.t;
          const rr = i % 2 ? 5 : 11;
          ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fill();
      } else if (this.type === 'heal') {
        ctx.fillStyle = '#7bd66a';
        M.roundRect(ctx, -9, -7, 18, 14, 5); ctx.fill();
        ctx.fillStyle = '#d8f5cf';
        M.roundRect(ctx, -5, -4, 10, 8, 3); ctx.fill();
      } else {
        ctx.fillStyle = '#6cc7ff';
        ctx.beginPath();
        ctx.moveTo(0, -11); ctx.lineTo(7, 1); ctx.lineTo(0, 11); ctx.lineTo(-7, 1);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }

  /* ---------------- 敌人 ---------------- */
  class Enemy extends Entity {
    constructor(kind, x, y, level, fieldScale, isElite) {
      const base = C.ENEMY[kind];
      super(x, y, base.radius * (isElite && kind === 'wolf' ? 1.25 : 1));
      this.kind = kind;
      this.isElite = !!isElite;
      this.level = level;
      const hpGrow = 1 + C.SCALE.hpPerLevel * (level - 1);
      const dmgGrow = 1 + C.SCALE.dmgPerLevel * (level - 1);
      /* Boss 血量基数已经很厚，精英场加成打折，避免战斗过长 */
      const fhp = fieldScale.hp || 1;
      const hpFieldMul = this.isBoss ? 1 + (fhp - 1) * 0.7 : fhp;
      this.maxHp = Math.round(base.hp * hpGrow * hpFieldMul * (this.isElite ? 1.9 : 1));
      this.hp = this.maxHp;
      this.dmg = base.dmg * dmgGrow * (fieldScale.dmg || 1) * (this.isElite ? 1.35 : 1);
      this.speed = base.speed * (fieldScale.speed || 1) * (this.isElite ? 1.05 : 1);
      this.atkCdMax = base.atkCd;
      this.atkRange = base.range;
      this.windupMax = base.windup;
      this.geneValue = base.genes * (fieldScale.genes || 1) * (this.isElite ? 2.2 : 1);
      this.atkTimer = M.rand(0.2, 0.8);
      this.state = 'chase';
      this.stateT = 0;
      this.windup = 0;
      this.stun = 0;
      this.target = null;
      this.wobble = M.rand(0, 6);
      this.name = kind === 'wolf' ? (isElite ? '精英狼' : '野狼') : kind === 'wolfking' ? '狼王' : '虎王';
      this.isBoss = kind === 'wolfking' || kind === 'tiger';
      /* Boss 阶段 */
      this.phase = 1;
      this.skillCd = this.isBoss ? 2.4 : 0;
      this.chargeDir = { x: 1, y: 0 };
      this.chargeT = 0;
      this.summonCount = 0;
      this.deathT = 0;
      if (this.isBoss) this.r *= 1;
    }

    takeDamage(amount, srcX, srcY, knockPower, crit) {
      if (!this.alive) return 0;
      this.hp -= amount;
      this.flash = 0.18;
      if (srcX != null) {
        const a = M.angle(srcX, srcY, this.x, this.y);
        this.knock(Math.cos(a), Math.sin(a), knockPower || 120);
      }
      NLB.game.float(this.x + M.rand(-10, 10), this.y - this.r * 0.6,
        (crit ? '★' : '') + Math.round(amount), crit ? '#ffd24a' : '#fff0d0');
      NLB.game.particles.burst(this.x, this.y - this.r * 0.3,
        { count: crit ? 10 : 5, color: '#c94f3d', speedMax: crit ? 220 : 150, rMax: 4 });
      if (this.isBoss) {
        const r = this.hp / this.maxHp;
        /* Boss 每掉 25% 血补给一次回血，保证 Boss 战的续航 */
        const marks = [0.75, 0.5, 0.25];
        this._healMarks = this._healMarks || 0;
        while (this._healMarks < marks.length && r <= marks[this._healMarks]) {
          this._healMarks++;
          const gg = NLB.game;
          for (let i = 0; i < 2; i++) {
            gg.pickups.push(new Pickup(this.x + M.rand(-46, 46), this.y + M.rand(-34, 34), 'heal', 36));
          }
        }
        const np = this.kind === 'tiger' ? (r < 0.32 ? 3 : r < 0.65 ? 2 : 1) : (r < 0.4 ? 2 : 1);
        if (np !== this.phase) {
          this.phase = np;
          this.state = 'roar'; this.stateT = 1.1; this.stun = 0;
          S.play('roar');
          NLB.game.camera.shake(16, 0.5);
          NLB.game.bigTip(this.name + ' 进入第 ' + np + ' 阶段！');
          NLB.game.particles.ring(this.x, this.y, { color: '#ff8a7d', r1: 260, width: 8 });
        }
      }
      if (this.hp <= 0) this.die();
      return amount;
    }

    die() {
      if (!this.alive) return;
      this.alive = false;
      this.dying = true;
      this.deathT = 0.45;
      const g = NLB.game;
      S.play(this.isBoss ? 'boss' : 'die');
      g.particles.burst(this.x, this.y, {
        count: this.isBoss ? 40 : 14, color: this.isBoss ? '#ff8a7d' : '#b9836a',
        speedMax: this.isBoss ? 380 : 220, rMax: 7,
      });
      g.particles.ring(this.x, this.y, { color: '#ffb648', r1: this.isBoss ? 320 : 90, width: this.isBoss ? 8 : 4 });
      g.camera.shake(this.isBoss ? 20 : 5, this.isBoss ? 0.6 : 0.18);
      /* 掉落 */
      const gv = Math.max(1, Math.round(this.geneValue));
      const n = this.isBoss ? 18 : (this.isElite ? 4 : 1);
      for (let i = 0; i < n; i++) {
        g.pickups.push(new Pickup(this.x + M.rand(-24, 24), this.y + M.rand(-16, 16), 'gene', gv / n));
      }
      const healChance = this.isBoss ? 1 : (this.isElite ? 0.55 : 0.14);
      if (Math.random() < healChance) {
        const hn = this.isBoss ? 5 : 1;
        for (let i = 0; i < hn; i++) {
          g.pickups.push(new Pickup(this.x + M.rand(-30, 30), this.y + M.rand(-20, 20), 'heal', this.isBoss ? 40 : 26));
        }
      }
      if (Math.random() < (this.isBoss ? 1 : 0.1)) {
        g.pickups.push(new Pickup(this.x + M.rand(-20, 20), this.y + M.rand(-14, 14), 'energy', 0));
      }
      g.onEnemyKilled(this);
    }

    /* 选择目标：优先近的、优先被操控的（略有权重） */
    pickTarget(g) {
      let best = null, bs = -1e9;
      for (const p of g.players) {
        if (p.downed) continue;
        const d = M.dist(p.x, p.y, this.x, this.y);
        let score = -d;
        if (p.controlled) score += 140;          // 稍微偏好玩家操控的角色
        if (p.isNiu && this.isBoss) score += 40; // Boss 偏爱硬碰硬
        if (score > bs) { bs = score; best = p; }
      }
      this.target = best;
      return best;
    }

    update(dt, g) {
      this.tickCommon(dt);
      if (!this.alive) {
        this.deathT -= dt;
        if (this.deathT <= 0) this.dead = true;
        return;
      }
      if (this.stun > 0) { this.stun -= dt; this.moveWithBounds(dt, g.bounds); return; }
      if (this.spawnT > 0) { this.moveWithBounds(dt, g.bounds); return; }

      const t = this.pickTarget(g);
      this.stateT += dt;
      this.wobble += dt * (this.isBoss ? 4 : 8);
      if (this.skillCd > 0) this.skillCd -= dt;

      if (!t) { this.vx *= 0.9; this.vy *= 0.9; this.moveWithBounds(dt, g.bounds); return; }

      const ang = M.angle(this.x, this.y, t.x, t.y);
      this.aim = ang;
      this.facing = Math.cos(ang) >= 0 ? 1 : -1;
      const d = M.dist(this.x, this.y, t.x, t.y);

      if (this.isBoss) { this.updateBoss(dt, g, t, d, ang); return; }

      /* 普通狼：追击 → 前摇 → 扑咬 → 恢复 */
      switch (this.state) {
        case 'chase': {
          const sp = this.speed;
          this.x += Math.cos(ang) * sp * dt * this.slowF;
          this.y += Math.sin(ang) * sp * dt * this.slowF;
          if (d < this.atkRange + t.r && this.atkTimer <= 0) {
            this.state = 'windup'; this.windup = this.windupMax; this.stateT = 0;
          }
          break;
        }
        case 'windup': {
          this.windup -= dt;
          this.x += Math.cos(ang) * 40 * dt;
          if (this.windup <= 0) {
            /* 扑击判定 */
            this.state = 'recover';
            this.stateT = 0;
            this.atkTimer = this.atkCdMax * M.rand(0.85, 1.2);
            const lunge = this.isElite ? 210 : 150;
            this.vx = Math.cos(ang) * lunge; this.vy = Math.sin(ang) * lunge;
            if (d < this.atkRange + t.r + 16) {
              t.takeDamage(this.dmg, this.x, this.y, 260);
              S.play('hit');
            }
            g.particles.burst(this.x + Math.cos(ang) * this.r, this.y + Math.sin(ang) * this.r,
              { count: 6, color: '#d8c8b0', angle: ang, spread: 0.7, speedMax: 200, rMax: 4 });
          }
          break;
        }
        case 'recover': {
          if (this.stateT > 0.32) { this.state = 'chase'; }
          break;
        }
      }
      this.moveWithBounds(dt, g.bounds);
      if (this.atkTimer > 0) this.atkTimer -= dt;
    }

    /* Boss 行为 */
    updateBoss(dt, g, t, d, ang) {
      const spd = this.speed * (this.phase >= 2 ? 1.18 : 1) * (this.phase >= 3 ? 1.12 : 1);
      switch (this.state) {
        case 'chase': {
          if (d > this.atkRange + t.r) {
            this.x += Math.cos(ang) * spd * dt * this.slowF;
            this.y += Math.sin(ang) * spd * dt * this.slowF;
          }
          if (this.skillCd <= 0) {
            const roll = Math.random();
            if (this.kind === 'wolfking') {
              if (d > 320 && roll < 0.5) this.start('charge', 0.75, g);
              else if (this.summonCount < (this.phase >= 2 ? 6 : 3) && roll < 0.75) this.start('summon', 0.85, g);
              else if (d < 220 && roll < 0.9) this.start('roar', 0.95, g);
              else this.start('claw', 0.35, g);
            } else {
              if (roll < 0.32) this.start('charge', 0.7, g);
              else if (roll < 0.56 && this.phase >= 2) this.start('wave', 0.8, g);
              else if (roll < 0.74 && this.summonCount < (this.phase >= 3 ? 8 : 4)) this.start('summon', 0.9, g);
              else if (d < 260 && roll < 0.9) this.start('roar', 0.9, g);
              else this.start('claw', 0.3, g);
            }
            this.skillCd = (this.phase >= 3 ? 1.5 : this.phase >= 2 ? 2.1 : 2.9) * M.rand(0.85, 1.2);
          } else if (d < this.atkRange + t.r && this.atkTimer <= 0) {
            this.start('claw', 0.3, g);
            this.atkTimer = this.atkCdMax;
          }
          break;
        }
        case 'claw': {
          /* 三连爪：前摇后连续判定 */
          this.x += Math.cos(ang) * 90 * dt;
          const total = 0.95;
          const k = this.stateT / total;
          if (k > 0.28 && !this._hit1) {
            this._hit1 = true;
            this.clawHit(g, t, ang, 1);
          }
          if (k > 0.55 && !this._hit2) { this._hit2 = true; this.clawHit(g, t, ang, 1.05); }
          if (k > 0.82 && !this._hit3) { this._hit3 = true; this.clawHit(g, t, ang, 1.35); }
          if (this.stateT >= total) this.state = 'chase';
          break;
        }
        case 'charge': {
          if (this.stateT < 0.55) {
            /* 预警：锁定方向 */
            this.chargeDir = { x: Math.cos(ang), y: Math.sin(ang) };
            if (Math.random() < 0.5) {
              g.particles.burst(this.x + this.chargeDir.x * this.r, this.y + this.chargeDir.y * this.r,
                { count: 2, color: '#ff8a7d', speedMax: 90, rMax: 4 });
            }
          } else {
            const cs = 640 * (this.phase >= 3 ? 1.15 : 1);
            this.x += this.chargeDir.x * cs * dt;
            this.y += this.chargeDir.y * cs * dt;
            const bounced = this.x <= C.WORLD.margin + this.r || this.x >= g.bounds.w - C.WORLD.margin - this.r ||
              this.y <= C.WORLD.margin + this.r || this.y >= g.bounds.h - C.WORLD.margin - this.r;
            for (const p of g.players) {
              if (p.downed) continue;
              if (M.dist(p.x, p.y, this.x, this.y) < this.r + p.r + 12 && !this._chargeHit) {
                this._chargeHit = true;
                p.takeDamage(this.dmg * 1.35, this.x, this.y, 520);
                g.camera.shake(14, 0.3);
              }
            }
            if (Math.random() < 0.8) {
              g.particles.burst(this.x, this.y, { count: 3, color: '#c94f3d', speedMax: 160, rMax: 6, lifeMax: 0.4 });
            }
            if (this.stateT > 1.25 || (bounced && this.stateT > 0.75)) {
              this.state = 'chase'; this._chargeHit = false;
              g.camera.shake(10, 0.2);
            }
          }
          break;
        }
        case 'summon': {
          if (this.stateT > 0.55 && !this._summoned) {
            this._summoned = true;
            const n = this.phase >= 3 ? 3 : 2;
            S.play('roar');
            for (let i = 0; i < n; i++) {
              const a = (i / n) * Math.PI * 2 + Math.random();
              const sx = M.clamp(this.x + Math.cos(a) * 150, C.WORLD.margin + 30, g.bounds.w - C.WORLD.margin - 30);
              const sy = M.clamp(this.y + Math.sin(a) * 150, C.WORLD.margin + 30, g.bounds.h - C.WORLD.margin - 30);
              const w = new Enemy('wolf', sx, sy, this.level, g.fieldScale, this.phase >= 3);
              w.hp = w.maxHp * 0.75;
              g.enemies.push(w);
              g.particles.ring(sx, sy, { color: '#ff8a7d', r1: 70 });
              this.summonCount++;
            }
            g.bigTip(this.name + ' 召唤了随从！');
          }
          if (this.stateT > 1.1) this.state = 'chase';
          break;
        }
        case 'roar': {
          if (this.stateT > 0.5 && !this._roared) {
            this._roared = true;
            S.play('roar');
            g.camera.shake(15, 0.45);
            g.particles.ring(this.x, this.y, { color: '#ffb648', r1: 300, width: 7 });
            for (const p of g.players) {
              if (p.downed) continue;
              const dd = M.dist(p.x, p.y, this.x, this.y);
              if (dd < 300) {
                p.takeDamage(this.dmg * 0.55, this.x, this.y, 340);
                p.applySlow(0.6, 1.8);
              }
            }
          }
          if (this.stateT > 1.1) this.state = 'chase';
          break;
        }
        case 'wave': {
          /* 老虎：地裂波，扇形发射 3 道 */
          if (this.stateT > 0.5 && !this._waved) {
            this._waved = true;
            S.play('roar');
            for (let i = -1; i <= 1; i++) {
              const a = ang + i * 0.42;
              g.projectiles.push(new Projectile({
                x: this.x + Math.cos(a) * (this.r + 10), y: this.y + Math.sin(a) * (this.r + 10),
                vx: Math.cos(a) * 380, vy: Math.sin(a) * 380,
                dmg: this.dmg * 0.8, r: 16, life: 2.0, pierce: 99,
                owner: { rollDamage: () => ({ amount: this.dmg * 0.8, crit: false }), onDealDamage: () => { }, st: null },
                color: '#ff7a3d', kind: 'wave', angle: a, friendly: false,
              }));
            }
          }
          if (this.stateT > 1.0) this.state = 'chase';
          break;
        }
        default: this.state = 'chase';
      }
      this.moveWithBounds(dt, g.bounds);
      if (this.atkTimer > 0) this.atkTimer -= dt;
    }
    start(state, delay, g) {
      this.state = state; this.stateT = 0;
      this._hit1 = this._hit2 = this._hit3 = false;
      this._chargeHit = false; this._summoned = false; this._roared = false; this._waved = false;
      if (state === 'roar' || state === 'summon' || state === 'charge') {
        /* 预警圈 */
        g.warnCircle = { x: this.x, y: this.y, r: state === 'roar' ? 300 : 120, t: 0.6, max: 0.6 };
      }
    }
    clawHit(g, t, ang, mul) {
      S.play('swing');
      const reach = this.atkRange + 26;
      g.particles.burst(this.x + Math.cos(ang) * reach * 0.6, this.y + Math.sin(ang) * reach * 0.6,
        { count: 10, color: '#ffd0a8', angle: ang, spread: 0.9, speedMax: 240, rMax: 5 });
      for (const p of g.players) {
        if (p.downed) continue;
        if (M.inArc(p.x, p.y, this.x, this.y, ang, 1.9, reach + p.r)) {
          p.takeDamage(this.dmg * mul, this.x, this.y, 300);
          g.camera.shake(9, 0.18);
        }
      }
    }

    draw(ctx) {
      ctx.save();
      if (this.dying) {
        const k = Math.max(0, this.deathT / 0.45);
        ctx.globalAlpha = k;
        ctx.translate(this.x, this.y);
        ctx.scale(1 + (1 - k) * 0.5, Math.max(0.05, k));
        ctx.translate(-this.x, -this.y);
      }
      ctx.translate(this.x, this.y);
      ctx.scale(this.facing, 1);
      if (this.spawnT > 0) {
        const k = 1 - this.spawnT / 0.35;
        ctx.globalAlpha = k;
        ctx.scale(0.6 + k * 0.4, 0.6 + k * 0.4);
      }
      if (this.flash > 0) {
        ctx.shadowColor = '#fff'; ctx.shadowBlur = 16;
      }
      if (this.kind === 'wolf' || this.kind === 'wolfking') drawWolf(ctx, this);
      else drawTiger(ctx, this);
      ctx.shadowBlur = 0;
      ctx.restore();
      if (this.alive) this.drawHpBar(ctx, this.isBoss ? 0 : null);
      /* 状态提示 */
      if (this.alive && (this.state === 'windup' || this.state === 'charge' || this.state === 'roar')) {
        ctx.save();
        const pulse = 0.4 + 0.4 * Math.sin(performance.now() / 90);
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = '#ff6a55'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.r + 12, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawWolf(ctx, e) {
    const r = e.r;
    const boss = e.kind === 'wolfking';
    const bodyC1 = boss ? '#6a6360' : (e.isElite ? '#7b7269' : '#8b8177');
    const bodyC2 = boss ? '#3d3835' : (e.isElite ? '#4c453e' : '#5a5148');
    const wob = Math.sin(e.wobble) * 2;
    /* 尾 */
    ctx.save();
    ctx.strokeStyle = bodyC2; ctx.lineWidth = r * 0.26; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-r * 0.75, -r * 0.1);
    ctx.quadraticCurveTo(-r * 1.5, -r * 0.5 + wob, -r * 1.7, -r * 0.95 + wob);
    ctx.stroke(); ctx.restore();
    /* 腿 */
    ctx.fillStyle = bodyC2;
    const lw = Math.sin(e.wobble) * 5;
    M.roundRect(ctx, -r * 0.55, r * 0.32, r * 0.26, r * 0.6 + lw * 0.2, 3); ctx.fill();
    M.roundRect(ctx, r * 0.22, r * 0.32, r * 0.26, r * 0.6 - lw * 0.2, 3); ctx.fill();
    /* 身体 */
    if (!e._grd) { const g2 = ctx.createLinearGradient(0, -r, 0, r); g2.addColorStop(0, bodyC1); g2.addColorStop(1, bodyC2); e._grd = g2; }
    ctx.fillStyle = e._grd;
    ctx.beginPath(); ctx.ellipse(0, r * 0.08, r * 0.95, r * 0.62, -0.1, 0, Math.PI * 2); ctx.fill();
    /* 背鬃 */
    ctx.fillStyle = boss ? '#2f2b28' : '#423b34';
    for (let i = 0; i < (boss ? 7 : 4); i++) {
      const px = -r * 0.7 + i * r * 0.26;
      ctx.beginPath();
      ctx.moveTo(px, -r * 0.42);
      ctx.lineTo(px + r * 0.1, -r * (boss ? 1.05 : 0.82));
      ctx.lineTo(px + r * 0.2, -r * 0.42);
      ctx.closePath(); ctx.fill();
    }
    /* 头 */
    ctx.save();
    ctx.translate(r * 0.62, -r * 0.32);
    ctx.fillStyle = bodyC1;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.55, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    /* 耳 */
    ctx.fillStyle = bodyC2;
    ctx.beginPath(); ctx.moveTo(-r * 0.3, -r * 0.3); ctx.lineTo(-r * 0.4, -r * 0.85); ctx.lineTo(r * 0.0, -r * 0.45); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(r * 0.18, -r * 0.36); ctx.lineTo(r * 0.3, -r * 0.9); ctx.lineTo(r * 0.46, -r * 0.32); ctx.closePath(); ctx.fill();
    /* 吻部 */
    ctx.fillStyle = '#2c2724';
    ctx.beginPath(); ctx.ellipse(r * 0.4, r * 0.14, r * 0.3, r * 0.19, 0.2, 0, Math.PI * 2); ctx.fill();
    /* 牙 */
    if (e.state === 'windup' || e.state === 'claw') {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(r * 0.42, r * 0.16); ctx.lineTo(r * 0.5, r * 0.34); ctx.lineTo(r * 0.55, r * 0.16); ctx.closePath(); ctx.fill();
    }
    /* 眼 */
    const eyeC = boss ? '#ff3b2f' : (e.isElite ? '#ffb648' : '#e8d76a');
    ctx.fillStyle = eyeC;
    ctx.shadowColor = eyeC; ctx.shadowBlur = boss ? 14 : 6;
    ctx.beginPath(); ctx.ellipse(r * 0.18, -r * 0.08, r * 0.13, r * 0.09, 0.25, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#1a1410';
    ctx.beginPath(); ctx.ellipse(r * 0.22, -r * 0.08, r * 0.045, r * 0.07, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    /* 精英标记 */
    if (e.isElite) {
      ctx.save();
      ctx.fillStyle = '#ffb648'; ctx.font = 'bold ' + Math.round(r * 0.7) + 'px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('★', 0, -r * 1.25);
      ctx.restore();
    }
  }

  function drawTiger(ctx, e) {
    const r = e.r;
    const wob = Math.sin(e.wobble) * 2.5;
    /* 尾 */
    ctx.save();
    ctx.strokeStyle = '#c9761f'; ctx.lineWidth = r * 0.22; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-r * 0.8, -r * 0.05);
    ctx.quadraticCurveTo(-r * 1.5, -r * 0.5 + wob, -r * 1.8, -r * 1.1 + wob);
    ctx.stroke(); ctx.restore();
    /* 腿 */
    ctx.fillStyle = '#b8661a';
    const lw = Math.sin(e.wobble) * 6;
    M.roundRect(ctx, -r * 0.55, r * 0.3, r * 0.3, r * 0.62 + lw * 0.2, 4); ctx.fill();
    M.roundRect(ctx, r * 0.2, r * 0.3, r * 0.3, r * 0.62 - lw * 0.2, 4); ctx.fill();
    /* 身体 */
    if (!e._grd) { const g2 = ctx.createLinearGradient(0, -r, 0, r); g2.addColorStop(0, '#f5a83c'); g2.addColorStop(1, '#c9761f'); e._grd = g2; }
    ctx.fillStyle = e._grd;
    ctx.beginPath(); ctx.ellipse(0, r * 0.05, r, r * 0.68, -0.08, 0, Math.PI * 2); ctx.fill();
    /* 腹部 */
    ctx.fillStyle = '#fff0d6';
    ctx.beginPath(); ctx.ellipse(0, r * 0.42, r * 0.72, r * 0.26, 0, 0, Math.PI * 2); ctx.fill();
    /* 黑纹 */
    ctx.strokeStyle = '#2b1a10'; ctx.lineWidth = r * 0.11; ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const px = -r * 0.65 + i * r * 0.33;
      ctx.beginPath();
      ctx.moveTo(px, -r * 0.45);
      ctx.quadraticCurveTo(px + r * 0.1, -r * 0.05, px - r * 0.05, r * 0.3);
      ctx.stroke();
    }
    /* 头 */
    ctx.save();
    ctx.translate(r * 0.66, -r * 0.35);
    ctx.fillStyle = '#f5a83c';
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.6, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    /* 耳 */
    ctx.fillStyle = '#c9761f';
    ctx.beginPath(); ctx.moveTo(-r * 0.34, -r * 0.32); ctx.lineTo(-r * 0.44, -r * 0.9); ctx.lineTo(-r * 0.02, -r * 0.48); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(r * 0.2, -r * 0.38); ctx.lineTo(r * 0.34, -r * 0.95); ctx.lineTo(r * 0.52, -r * 0.34); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2b1a10';
    ctx.beginPath(); ctx.ellipse(-r * 0.28, -r * 0.6, r * 0.1, r * 0.14, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(r * 0.3, -r * 0.64, r * 0.1, r * 0.14, -0.3, 0, Math.PI * 2); ctx.fill();
    /* 王字纹 */
    ctx.strokeStyle = '#2b1a10'; ctx.lineWidth = r * 0.075;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(-r * 0.16, -r * 0.2 + i * r * 0.13); ctx.lineTo(r * 0.16, -r * 0.2 + i * r * 0.13); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, -r * 0.34); ctx.lineTo(0, -r * 0.02); ctx.stroke();
    /* 吻 */
    ctx.fillStyle = '#fff0d6';
    ctx.beginPath(); ctx.ellipse(r * 0.34, r * 0.18, r * 0.32, r * 0.22, 0.15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d9534f';
    ctx.beginPath(); ctx.ellipse(r * 0.4, r * 0.14, r * 0.08, r * 0.06, 0, 0, Math.PI * 2); ctx.fill();
    /* 眼 */
    const bossEye = e.phase >= 3 ? '#ff2e1f' : '#ffe14a';
    ctx.fillStyle = bossEye;
    ctx.shadowColor = bossEye; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.ellipse(r * 0.14, -r * 0.06, r * 0.15, r * 0.11, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#1a0d05';
    ctx.beginPath(); ctx.ellipse(r * 0.19, -r * 0.06, r * 0.05, r * 0.08, 0, 0, Math.PI * 2); ctx.fill();
    /* 獠牙 */
    if (e.state === 'claw' || e.state === 'roar') {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(r * 0.36, r * 0.24); ctx.lineTo(r * 0.44, r * 0.5); ctx.lineTo(r * 0.52, r * 0.24); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(r * 0.55, r * 0.22); ctx.lineTo(r * 0.62, r * 0.44); ctx.lineTo(r * 0.68, r * 0.2); ctx.closePath(); ctx.fill();
    }
    /* 胡须 */
    ctx.strokeStyle = 'rgba(255,250,235,.75)'; ctx.lineWidth = 1.4;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(r * 0.4, r * 0.18 + i * 4);
      ctx.lineTo(r * 0.78, r * 0.12 + i * 8); ctx.stroke();
    }
    ctx.restore();
    /* 狂暴光环 */
    if (e.phase >= 2) {
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.2 * Math.sin(performance.now() / 120);
      ctx.strokeStyle = '#ff5a3c'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.25, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  NLB.Entity = Entity;
  NLB.Player = Player;
  NLB.Enemy = Enemy;
  NLB.Projectile = Projectile;
  NLB.Pickup = Pickup;
})(window.NLB);
