/* ===========================================================
 * 牛来豹拉大冒险 —— 队友 AI
 * 未被操控的角色由 AI 接管：走位 / 输出 / 救援 / 躲避
 * =========================================================== */
(function (NLB) {
  'use strict';
  const M = NLB.M;
  const C = NLB.CONFIG;
  const S = NLB.Sound;

  class AIController {
    constructor(player) {
      this.p = player;
      this.think = 0;
      this.strafeDir = Math.random() < 0.5 ? 1 : -1;
      this.strafeT = M.rand(0.8, 2.0);
      this.target = null;
      this.retarget = 0;
      this.skill = 0;
    }

    /* 选目标：距离优先，Boss 有额外权重，濒死敌人优先补刀 */
    pickTarget(g) {
      let best = null, bs = 1e9;
      for (const e of g.enemies) {
        if (!e.alive || e.spawnT > 0) continue;
        let d = M.dist(this.p.x, this.p.y, e.x, e.y);
        if (e.isBoss) d -= 130;
        if (e.hp < e.maxHp * 0.25) d -= 90;
        if (d < bs) { bs = d; best = e; }
      }
      /* 若无敌人，则把队友当作跟随目标 */
      if (!best) {
        const mate = g.otherOf(this.p);
        return mate ? { x: mate.x, y: mate.y, r: mate.r, fake: true } : null;
      }
      return best;
    }

    update(dt, g) {
      const p = this.p;
      const intent = { mx: 0, my: 0, attack: false, skill: false, aimX: null, aimY: null };
      p.intent = intent;

      if (p.downed) return;
      if (p.dashT > 0) { intent.mx = p.dashDirX; intent.my = p.dashDirY; return; }

      this.think -= dt;
      this.retarget -= dt;
      this.strafeT -= dt;
      if (this.retarget <= 0 || !this.target || (this.target.alive === false && !this.target.fake)) {
        this.target = this.pickTarget(g);
        this.retarget = M.rand(0.35, 0.7);
      }
      const t = this.target;
      const mate = g.otherOf(p);
      const hpRatio = p.hp / p.maxHp;

      /* 救援优先：队友倒地时赶过去 */
      const needRescue = mate && mate.downed && !p.downed;

      if (!t) {
        /* 场上无目标：向队友靠拢 */
        if (mate && !mate.downed) {
          const d = M.dist(p.x, p.y, mate.x, mate.y);
          if (d > 90) {
            const a = M.angle(p.x, p.y, mate.x, mate.y);
            intent.mx = Math.cos(a); intent.my = Math.sin(a);
          }
        }
        return;
      }

      const dx = t.x - p.x, dy = t.y - p.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const ang = Math.atan2(dy, dx);
      /* 瞄准带一点预判 */
      const lead = t.vx != null ? 0.12 : 0;
      intent.aimX = t.x + (t.vx || 0) * lead;
      intent.aimY = t.y + (t.vy || 0) * lead;

      const enemies = g.enemies;
      let nearCount = 0, nearestDist = 1e9, nearest = null;
      for (const e of enemies) {
        if (!e.alive || e.spawnT > 0) continue;
        const dd = M.dist(p.x, p.y, e.x, e.y);
        if (dd < 200) nearCount++;
        if (dd < nearestDist) { nearestDist = dd; nearest = e; }
      }

      /* 躲避：Boss 冲锋 / 狼前摇 */
      let dodge = null;
      if (nearest && !nearest.fake) {
        const st = nearest.state;
        if ((st === 'charge' || st === 'windup' || st === 'claw') && nearestDist < 260) {
          const away = M.angle(nearest.x, nearest.y, p.x, p.y);
          dodge = { x: Math.cos(away + Math.PI / 2 * this.strafeDir), y: Math.sin(away + Math.PI / 2 * this.strafeDir) };
        }
      }
      /* 低血撤离 */
      const flee = hpRatio < 0.32 && nearestDist < 240 && !needRescue;

      if (p.isNiu) {
        /* ---- 牛来：贴身缠斗 ---- */
        const range = p.st.atkRange * 0.82;
        if (needRescue) {
          const dm = M.dist(p.x, p.y, mate.x, mate.y);
          if (dm > C.COMBAT.reviveRange * 0.7) {
            const a = M.angle(p.x, p.y, mate.x, mate.y);
            intent.mx = Math.cos(a); intent.my = Math.sin(a);
          }
          /* 顺手攻击贴脸的敌人 */
          if (nearestDist < range + 20 && !t.fake) intent.attack = true;
        } else if (dodge) {
          intent.mx = dodge.x; intent.my = dodge.y;
        } else if (flee) {
          const away = M.angle(nearest.x, nearest.y, p.x, p.y);
          intent.mx = Math.cos(away) * 0.9 + Math.cos(ang) * 0.1;
          intent.my = Math.sin(away) * 0.9 + Math.sin(ang) * 0.1;
        } else if (d > range) {
          /* 接近目标（略微绕圈，避免笔直撞脸） */
          const side = this.strafeDir * 0.35;
          intent.mx = Math.cos(ang) - Math.sin(ang) * side;
          intent.my = Math.sin(ang) + Math.cos(ang) * side;
          const l = Math.hypot(intent.mx, intent.my) || 1;
          intent.mx /= l; intent.my /= l;
        } else {
          /* 交战距离：小幅绕圈保持贴身 */
          intent.mx = -Math.sin(ang) * this.strafeDir * 0.6;
          intent.my = Math.cos(ang) * this.strafeDir * 0.6;
          if (!t.fake) intent.attack = true;
        }
        /* 冲撞：目标较远且敌群密集，或面对 Boss */
        if (!needRescue && !t.fake && p.skillTimer <= 0 && this.skill <= 0) {
          const wantDash = (nearCount >= 2 && d > 120 && d < 520) ||
            (t.isBoss && d > 140 && d < 520) ||
            (t.hp < t.maxHp * 0.3 && d > 100 && d < 420);
          if (wantDash) {
            intent.mx = Math.cos(ang); intent.my = Math.sin(ang);
            intent.skill = true;
            this.skill = M.rand(0.6, 1.2);
          }
        }
      } else {
        /* ---- 豹拉：风筝输出 ---- */
        const ideal = 300, tooClose = 185, tooFar = 400;
        if (needRescue) {
          const dm = M.dist(p.x, p.y, mate.x, mate.y);
          if (dm > C.COMBAT.reviveRange * 0.7) {
            const a = M.angle(p.x, p.y, mate.x, mate.y);
            intent.mx = Math.cos(a); intent.my = Math.sin(a);
          }
          if (!t.fake && d < 620) intent.attack = true;
        } else if (dodge) {
          intent.mx = dodge.x; intent.my = dodge.y;
          if (!t.fake) intent.attack = true;
        } else if (flee || (!t.fake && d < tooClose)) {
          const away = M.angle(t.x, t.y, p.x, p.y);
          intent.mx = Math.cos(away) * 0.85 - Math.sin(away) * 0.4 * this.strafeDir;
          intent.my = Math.sin(away) * 0.85 + Math.cos(away) * 0.4 * this.strafeDir;
          const l = Math.hypot(intent.mx, intent.my) || 1;
          intent.mx /= l; intent.my /= l;
          if (!t.fake) intent.attack = true;
        } else if (!t.fake && d > tooFar) {
          intent.mx = Math.cos(ang) * 0.9; intent.my = Math.sin(ang) * 0.9;
          intent.attack = true;
        } else {
          /* 保持距离侧移射击 */
          intent.mx = -Math.sin(ang) * this.strafeDir * 0.8;
          intent.my = Math.cos(ang) * this.strafeDir * 0.8;
          if (!t.fake) intent.attack = true;
        }
        /* 疾风连射：敌人成群或面对 Boss */
        if (!needRescue && !t.fake && p.skillTimer <= 0 && this.skill <= 0) {
          if (nearCount >= 3 || (t.isBoss && d < 560) || (t.hp > t.maxHp * 0.6 && nearCount >= 2)) {
            intent.skill = true;
            this.skill = M.rand(1.0, 2.0);
          }
        }
      }

      if (this.think <= 0) {
        this.think = M.rand(0.15, 0.3);
      }
      if (this.strafeT <= 0) {
        this.strafeT = M.rand(1.0, 2.4);
        if (Math.random() < 0.5) this.strafeDir *= -1;
      }
      if (this.skill > 0) this.skill -= dt;
    }
  }

  NLB.AIController = AIController;
})(window.NLB);
