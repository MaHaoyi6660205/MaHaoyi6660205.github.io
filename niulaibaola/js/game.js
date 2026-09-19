/* ===========================================================
 * 牛来豹拉大冒险 —— 主控
 * 状态机 / 战斗循环 / 存档 / 强化与基因点 / 界面联动
 * =========================================================== */
(function (NLB) {
  'use strict';
  const M = NLB.M;
  const C = NLB.CONFIG;
  const S = NLB.Sound;

  const SAVE_KEY = 'nlb_save_v1';

  function $(id) { return document.getElementById(id); }

  class Game {
    constructor() {
      this.canvas = null; this.ctx = null;
      this.camera = new NLB.Camera();
      this.particles = new NLB.Particles();
      this.state = 'menu';         // menu | battle | over
      this.paused = false;
      this.players = [];
      this.enemies = [];
      this.projectiles = [];
      this.pickups = [];
      this.bounds = { w: 1280, h: 720 };
      this.world = null;
      this.waves = null;
      this.boss = null;
      this.warnCircle = null;
      this.level = 1; this.field = 'adventure';
      this.fieldScale = { hp: 1, dmg: 1, speed: 1, genes: 1 };
      this.stats = null;
      this.controlled = 0;         // 0 牛来 / 1 豹拉
      this.swapCd = 0;
      this.battleGenes = 0;
      this.kills = 0;
      this.battleTime = 0;
      this.endTimer = 0;
      this.hudTick = 0;
      this.tipTimer = 0;
      this.lastTs = 0;
      this.save = this.defaultSave();
      this.upgradeQueue = 0;
      this.pendingResult = null;
      this.bossEl = null;
    }

    /* ---------------- 存档 ---------------- */
    defaultSave() {
      return {
        version: 1, genes: 0, unlocked: 1,
        cleared: {}, upgrades: [], shop: {},
        kills: 0, runs: 0, best: 0,
      };
    }
    loadSave() {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (raw) {
          const d = JSON.parse(raw);
          if (d && d.version === 1) {
            this.save = Object.assign(this.defaultSave(), d);
            this.save.cleared = d.cleared || {};
            this.save.upgrades = d.upgrades || [];
            this.save.shop = d.shop || {};
          }
        }
      } catch (e) { /* 读档失败则用新档 */ }
    }
    writeSave() {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch (e) { /* 忽略 */ }
    }
    resetSave() {
      this.save = this.defaultSave();
      this.writeSave();
      this.refreshMenu();
    }
    isCleared(level, field) {
      const c = this.save.cleared[level];
      return !!(c && c[field]);
    }
    isUnlocked(level) {
      return level <= this.save.unlocked;
    }

    /* ---------------- 初始化 ---------------- */
    init(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      NLB.game = this;
      NLB.Input.init(canvas);
      this.loadSave();
      this.stats = NLB.computeStats(this.save);
      this.bindUI();
      this.resize();
      window.addEventListener('resize', () => this.resize());
      this.buildIdleScene();
      this.refreshMenu();
      this.showScreen('screen-menu');
      this.lastTs = performance.now();
      requestAnimationFrame((t) => this.loop(t));
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth, h = window.innerHeight;
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.dpr = dpr;
      this.camera.resize(w, h);
    }

    /* 菜单背景场景 */
    buildIdleScene() {
      const info = NLB.levelInfo(1);
      this.world = new NLB.World(1, info.field.adventure.size, info.theme);
      this.bounds = { w: this.world.w, h: this.world.h };
      this.players = [
        new NLB.Player('niu', 320, this.bounds.h * 0.5 - 30, this.stats),
        new NLB.Player('bao', 320, this.bounds.h * 0.5 + 50, this.stats),
      ];
      this.players[0].controlled = true;
      this.enemies = []; this.projectiles = []; this.pickups = [];
      this.particles.clear();
      this.camera.snap(this.bounds.w * 0.5, this.bounds.h * 0.5, this.bounds);
    }

    /* ---------------- 界面 ---------------- */
    showScreen(id) {
      ['screen-menu', 'screen-levels', 'screen-upgrade', 'screen-result', 'screen-pause', 'screen-shop', 'screen-help']
        .forEach((s) => { const el = $(s); if (el) el.classList.toggle('hidden', s !== id); });
      $('hud').classList.toggle('hidden', id !== null && id !== 'screen-pause');
      if (id !== null) this.currentScreen = id;
    }
    hideAllScreens() {
      ['screen-menu', 'screen-levels', 'screen-upgrade', 'screen-result', 'screen-pause', 'screen-shop', 'screen-help']
        .forEach((s) => { const el = $(s); if (el) el.classList.add('hidden'); });
      $('hud').classList.remove('hidden');
      this.currentScreen = null;
    }
    toast(msg, ms) {
      const el = $('toast');
      el.textContent = msg;
      el.classList.remove('hidden');
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => el.classList.add('hidden'), ms || 1800);
    }
    bigTip(text, sub) {
      const el = $('center-tip');
      el.innerHTML = text + (sub ? '<small>' + sub + '</small>' : '');
      el.classList.remove('hidden');
      this.tipTimer = 1.8;
    }
    announceWave(i, total, boss) {
      if (boss) this.bigTip('BOSS 来袭', '第 ' + i + ' / ' + total + ' 波');
      else this.bigTip('第 ' + i + ' 波', '共 ' + total + ' 波');
    }

    bindUI() {
      const click = (id, fn) => {
        const el = $(id);
        if (el) el.addEventListener('click', () => { S.resume(); S.play('ui'); fn(); });
      };
      click('btn-start', () => { this.save.unlocked = this.save.unlocked || 1; this.showLevels(); });
      click('btn-continue', () => {
        const lv = Math.min(this.save.unlocked, C.TOTAL_LEVELS);
        if (this.save.genes === 0 && this.save.unlocked === 1 && !this.isCleared(1, 'adventure')) {
          this.startBattle(1, 'adventure');
        } else {
          this.showLevels();
        }
      });
      click('btn-shop', () => this.showShop('screen-menu'));
      click('btn-help', () => this.showScreen('screen-help'));
      click('btn-help-back', () => this.showScreen(this.state === 'battle' && this.paused ? 'screen-pause' : 'screen-menu'));
      click('btn-reset', () => {
        if (confirm('确定清空所有存档进度吗？此操作不可撤销。')) { this.resetSave(); this.toast('存档已清空'); }
      });
      click('btn-back-menu', () => this.showScreen('screen-menu'));
      click('btn-to-shop', () => this.showShop('screen-levels'));
      click('btn-shop-back', () => this.showScreen(this._shopBack || 'screen-menu'));
      click('btn-pause', () => this.togglePause(true));
      click('btn-resume', () => this.togglePause(false));
      click('btn-pause-help', () => this.showScreen('screen-help'));
      click('btn-abandon', () => { this.paused = false; this.endBattle(false, true); });

      /* 音效开关（追加到暂停面板） */
      const pauseBtns = document.querySelector('#screen-pause .menu-btns');
      if (pauseBtns) {
        const b = document.createElement('button');
        b.className = 'btn big ghost';
        b.id = 'btn-sound';
        b.textContent = '音效：开';
        b.addEventListener('click', () => {
          S.enabled = !S.enabled;
          b.textContent = '音效：' + (S.enabled ? '开' : '关');
          if (S.enabled) S.play('ui');
        });
        pauseBtns.appendChild(b);
      }
    }

    refreshMenu() {
      const s = this.save;
      $('menu-save').textContent = s.unlocked > 1 || s.cleared[1]
        ? ('进度：第 ' + Math.min(s.unlocked, C.TOTAL_LEVELS) + ' 关 · 基因点 ' + s.genes + ' · 强化 ' + s.upgrades.length + ' 项')
        : '暂无存档';
      $('lv-gene').textContent = s.genes;
      if ($('shop-gene')) $('shop-gene').textContent = s.genes;
    }

    /* ---------------- 关卡选择 ---------------- */
    showLevels() {
      this.refreshMenu();
      const grid = $('level-grid');
      grid.innerHTML = '';
      for (let lv = 1; lv <= C.TOTAL_LEVELS; lv++) {
        const info = NLB.levelInfo(lv);
        const unlocked = this.isUnlocked(lv);
        const card = document.createElement('div');
        card.className = 'level-card' + (unlocked ? ' unlocked' : ' locked') + (info.boss ? ' boss' : '');
        const advDone = this.isCleared(lv, 'adventure');
        const eliteDone = this.isCleared(lv, 'elite');
        const advGene = this.geneReward(lv, 'adventure', !advDone);
        const eliteGene = this.geneReward(lv, 'elite', !eliteDone);
        card.innerHTML =
          '<div class="level-no">第 ' + lv + ' 关</div>' +
          '<div class="level-name">' + info.name + '</div>' +
          (info.boss ? '<div class="level-boss-tag">BOSS ' + info.boss + '</div>' : '') +
          '<div class="locked-tip">' + (unlocked ? (info.boss ? '首领据点' : '已解锁') : '通关上一关解锁') + '</div>' +
          '<div class="field-row"></div>';
        const row = card.querySelector('.field-row');
        const mkBtn = (label, sub, cls, fn) => {
          const b = document.createElement('button');
          b.className = 'field-btn ' + cls;
          b.innerHTML = '<b>' + label + '</b><span>' + sub + '</span>';
          b.addEventListener('click', () => { S.resume(); S.play('ui'); fn(); });
          row.appendChild(b);
          return b;
        };
        if (unlocked) {
          mkBtn('冒险场' + (advDone ? ' ✓' : ''), advDone ? '已通关' : ('+' + advGene + ' 基因'), advDone ? 'done' : '',
            () => this.startBattle(lv, 'adventure'));
          mkBtn('精英场' + (eliteDone ? ' ✓' : ''), eliteDone ? '已通关' : ('+' + eliteGene + ' 基因'), 'elite' + (eliteDone ? ' done' : ''),
            () => this.startBattle(lv, 'elite'));
        } else {
          mkBtn('冒险场', '未解锁', '', () => this.toast('请先通关第 ' + (lv - 1) + ' 关'));
          mkBtn('精英场', '未解锁', 'elite', () => this.toast('请先通关第 ' + (lv - 1) + ' 关'));
        }
        grid.appendChild(card);
      }
      this.showScreen('screen-levels');
    }

    geneReward(level, field, first) {
      const elite = field === 'elite';
      let v = (C.GENE.base + C.GENE.perLevel * level);
      if (elite) v *= C.ELITE.genes;
      if (first) v += C.GENE.firstClearBonus;
      return Math.round(v);
    }

    /* ---------------- 基因实验室 ---------------- */
    showShop(backScreen) {
      this._shopBack = backScreen || 'screen-menu';
      this.refreshMenu();
      const grid = $('shop-grid');
      grid.innerHTML = '';
      NLB.SHOP.forEach((item) => {
        const lv = this.save.shop[item.id] || 0;
        const maxed = lv >= item.max;
        const cost = NLB.shopCost(item, lv);
        const card = document.createElement('div');
        card.className = 'shop-card';
        card.innerHTML =
          '<div class="shop-name">' + item.name + '</div>' +
          '<div class="shop-desc">' + item.desc + '</div>' +
          '<div class="shop-lv">等级 ' + lv + ' / ' + item.max + '</div>';
        const b = document.createElement('button');
        b.className = 'btn tiny shop-buy' + (maxed ? '' : ' primary');
        b.textContent = maxed ? '已满级' : ('购买 · ' + cost + ' 基因');
        b.disabled = maxed || this.save.genes < cost;
        b.addEventListener('click', () => {
          const c2 = NLB.shopCost(item, this.save.shop[item.id] || 0);
          if (this.save.genes < c2) { this.toast('基因点不足'); return; }
          this.save.genes -= c2;
          this.save.shop[item.id] = (this.save.shop[item.id] || 0) + 1;
          this.writeSave();
          this.stats = NLB.computeStats(this.save);
          S.play('levelup');
          this.toast(item.name + ' 提升至 ' + this.save.shop[item.id] + ' 级');
          this.showShop(this._shopBack);
        });
        card.appendChild(b);
        grid.appendChild(card);
      });
      this.showScreen('screen-shop');
    }

    /* ---------------- 开战 ---------------- */
    startBattle(level, field) {
      S.resume();
      this.level = level;
      this.field = field;
      const info = NLB.levelInfo(level);
      const size = info.field[field].size;
      this.stats = NLB.computeStats(this.save);
      this.world = new NLB.World(level, size, info.theme);
      this.bounds = { w: this.world.w, h: this.world.h };
      this.fieldScale = field === 'elite'
        ? { hp: C.ELITE.hp, dmg: C.ELITE.dmg, speed: C.ELITE.speed, genes: C.ELITE.genes }
        : { hp: 1, dmg: 1, speed: 1, genes: 1 };

      const cx = C.WORLD.margin + 150, cy = this.bounds.h * 0.5;
      this.players = [
        new NLB.Player('niu', cx, cy - 60, this.stats),
        new NLB.Player('bao', cx, cy + 70, this.stats),
      ];
      this.players.forEach((p) => { p.intent = { mx: 0, my: 0 }; p.spawnT = 0; p.invul = 1.2; });
      this.controlled = 0;
      this.players[0].controlled = true;
      this.ais = this.players.map((p) => new NLB.AIController(p));

      this.enemies = []; this.projectiles = []; this.pickups = [];
      this.particles.clear();
      this.boss = null; this.warnCircle = null;
      this.battleGenes = 0; this.kills = 0; this.battleTime = 0;
      this.endTimer = 0; this.swapCd = 0;
      this.waves = new NLB.WaveRunner(info.field[field].waves, this);
      this.state = 'battle';
      this.paused = false;
      this.pendingResult = null;
      this.camera.snap(this.players[0].x, this.players[0].y, this.bounds);
      this.hideAllScreens();
      this.setBoss(null);
      this.updateHud(true);
      this.bigTip('第 ' + level + ' 关 · ' + (field === 'elite' ? '精英场' : '冒险场'), info.name);
      this.waves.start();
      this.save.runs++;
      this.writeSave();
    }

    setBoss(e) {
      this.boss = e;
      const bar = $('bossbar');
      bar.classList.toggle('hidden', !e);
      if (e) $('boss-name').textContent = e.name;
    }

    otherOf(p) {
      return this.players[0] === p ? this.players[1] : this.players[0];
    }
    float(x, y, text, color, big) { this.particles.text(x, y, text, color, big); }
    gainGenes(v) {
      this.battleGenes += v;
      if (this.battleGenes > this.save.best) { /* 单场记录 */ }
    }
    onEnemyKilled(e) { this.kills++; this.save.kills++; }
    onWaveCleared(i, total) {
      /* 每清一波小幅回血，保证续航 */
      const heal = C.COMBAT.waveClearHeal || 0;
      if (heal > 0) {
        for (const p of this.players) {
          if (!p.downed) p.heal(p.maxHp * heal, false);
        }
      }
      if (i < total) this.bigTip('第 ' + i + ' 波肃清', '准备迎接下一波');
    }

    /* ---------------- 战斗循环 ---------------- */
    loop(ts) {
      let dt = (ts - this.lastTs) / 1000;
      this.lastTs = ts;
      if (!isFinite(dt) || dt < 0) dt = 0;
      dt = Math.min(dt, 0.05);
      try {
        if (this.paused && (NLB.Input.hit('Escape') || NLB.Input.hit('p'))) this.togglePause(false);
        if (this.state === 'battle' && !this.paused) this.update(dt);
        else if (this.state === 'menu') this.updateIdle(dt);
        this.draw();
      } catch (err) {
        console.error('[NLB] 运行时错误：', err);
      }
      NLB.Input.endFrame();
      requestAnimationFrame((t) => this.loop(t));
    }

    updateIdle(dt) {
      /* 菜单背景：缓慢平移镜头 + 角色待机小动作 */
      this.camera.x += 26 * dt;
      if (this.camera.x > this.bounds.w - this.camera.w) this.camera.x = 0;
      this.camera.y = this.bounds.h * 0.5 - this.camera.h * 0.5;
      for (const p of this.players) {
        p.walkPhase += dt * 3;
        p.aim = 0; p.facing = 1;
      }
      this.particles.update(dt);
    }

    update(dt) {
      this.battleTime += dt;
      const g = this;

      /* --- 输入：切换角色 --- */
      if (this.swapCd > 0) this.swapCd -= dt;
      const wantSwap = NLB.Input.hit('Tab') || NLB.Input.hit('1') || NLB.Input.hit('2');
      if (wantSwap) {
        let target = NLB.Input.hit('1') ? 0 : NLB.Input.hit('2') ? 1 : (this.controlled === 0 ? 1 : 0);
        if (target !== this.controlled && !this.players[target].downed && this.swapCd <= 0) {
          const prev = this.players[this.controlled];
          prev.controlled = false;
          this.controlled = target;
          this.players[target].controlled = true;
          this.swapCd = this.stats.team.swapCd;
          if (this.stats.team.swapHeal > 0) {
            this.players[0].heal(this.players[0].maxHp * this.stats.team.swapHeal, false);
            this.players[1].heal(this.players[1].maxHp * this.stats.team.swapHeal, false);
          }
          this.particles.ring(this.players[target].x, this.players[target].y, { color: '#ffb648', r1: 90 });
          S.play('ui');
          $('swap-hint').classList.remove('hidden');
          clearTimeout(this._swapT);
          this._swapT = setTimeout(() => $('swap-hint').classList.add('hidden'), 450);
        }
      }
      if (NLB.Input.hit('Escape') || NLB.Input.hit('p')) this.togglePause(true);

      /* --- 玩家意图 --- */
      const cp = this.players[this.controlled];
      if (!cp.downed) {
        const mv = NLB.Input.moveVec();
        const useMouse = (performance.now() - (NLB.Input.mouse.t || 0)) < 2500;
        const mw = this.camera.toWorld(NLB.Input.mouse.x, NLB.Input.mouse.y);
        const intent = {
          mx: mv.x, my: mv.y,
          attack: NLB.Input.down('j') || NLB.Input.mouse.left,
          skill: NLB.Input.hit('k') || NLB.Input.mouse.right || NLB.Input.hit('Shift'),
          aimX: useMouse ? mw.x : null,
          aimY: useMouse ? mw.y : null,
        };
        cp.intent = intent;
      } else {
        cp.intent = { mx: 0, my: 0 };
        /* 被控角色倒地 → 自动把操控交给队友 */
        const other = this.otherOf(cp);
        if (!other.downed) {
          cp.controlled = false; other.controlled = true;
          this.controlled = this.players.indexOf(other);
        }
      }
      /* AI 队友 */
      for (const ai of this.ais) {
        if (ai.p === cp) continue;
        ai.update(dt, g);
      }

      /* --- 实体更新 --- */
      for (const p of this.players) p.update(dt, g);

      /* 玩家互相分离 */
      const sep = M.separate(this.players[0], this.players[1]);
      if (sep && !this.players[0].downed && !this.players[1].downed) {
        this.players[0].x -= sep.nx * sep.overlap * 0.4;
        this.players[0].y -= sep.ny * sep.overlap * 0.4;
        this.players[1].x += sep.nx * sep.overlap * 0.4;
        this.players[1].y += sep.ny * sep.overlap * 0.4;
      }
      /* 玩家与敌人分离 */
      for (const p of this.players) {
        if (p.downed) continue;
        for (const e of this.enemies) {
          if (!e.alive || e.spawnT > 0) continue;
          const s2 = M.separate(p, e);
          if (!s2) continue;
          const push = e.isBoss ? 0.9 : 0.42;
          p.x -= s2.nx * s2.overlap * push; p.y -= s2.ny * s2.overlap * push;
          if (!e.isBoss) { e.x += s2.nx * s2.overlap * 0.35; e.y += s2.ny * s2.overlap * 0.35; }
        }
      }
      /* 敌人之间分离 */
      for (let i = 0; i < this.enemies.length; i++) {
        const a = this.enemies[i];
        if (!a.alive || a.isBoss) continue;
        for (let j = i + 1; j < this.enemies.length; j++) {
          const b = this.enemies[j];
          if (!b.alive) continue;
          const s2 = M.separate(a, b);
          if (!s2) continue;
          const w = b.isBoss ? 1 : 0.5;
          a.x -= s2.nx * s2.overlap * w; a.y -= s2.ny * s2.overlap * w;
          if (!b.isBoss) { b.x += s2.nx * s2.overlap * 0.5; b.y += s2.ny * s2.overlap * 0.5; }
        }
      }
      /* 敌人与玩家接触伤害（贴身持续小伤害，避免卡住无伤） */
      for (const e of this.enemies) {
        if (!e.alive || e.spawnT > 0 || e.isBoss) continue;
        for (const p of this.players) {
          if (p.downed) continue;
          const d = M.dist(e.x, e.y, p.x, p.y);
          if (d < e.r + p.r - 4 && p.invul <= 0) {
            p.takeDamage(e.dmg * 0.22, e.x, e.y, 180);
          }
        }
      }

      for (const e of this.enemies) e.update(dt, g);
      for (const pr of this.projectiles) pr.update(dt, g);
      for (const pk of this.pickups) pk.update(dt, g);

      /* 清理 */
      for (let i = this.enemies.length - 1; i >= 0; i--) if (this.enemies[i].dead) this.enemies.splice(i, 1);
      for (let i = this.projectiles.length - 1; i >= 0; i--) if (this.projectiles[i].dead) this.projectiles.splice(i, 1);
      for (let i = this.pickups.length - 1; i >= 0; i--) if (this.pickups[i].dead) this.pickups.splice(i, 1);
      if (this.boss && !this.boss.alive) this.setBoss(null);

      /* 波次 */
      if (this.waves) this.waves.update(dt);

      /* 预警圈 */
      if (this.warnCircle) {
        this.warnCircle.t -= dt;
        if (this.warnCircle.t <= 0) this.warnCircle = null;
      }

      this.particles.update(dt);
      this.camera.update(dt);
      const focus = this.players[this.controlled].downed ? this.otherOf(this.players[this.controlled]) : this.players[this.controlled];
      this.camera.follow(focus.x, focus.y, dt, this.bounds);

      /* 提示计时 */
      if (this.tipTimer > 0) {
        this.tipTimer -= dt;
        if (this.tipTimer <= 0) $('center-tip').classList.add('hidden');
      }

      /* 胜负判定 */
      const allOut = this.players.every((p) => p.downed && p.downT <= 0 && p.autoReviveT <= 0);
      if (allOut) {
        this.endBattle(false);
        return;
      }
      if (this.waves && this.waves.finished && this.enemies.length === 0 && !this.pendingResult) {
        this.endTimer += dt;
        if (this.endTimer > 0.7) this.endBattle(true);
      }

      this.updateHud(false);
    }

    togglePause(on) {
      if (this.state !== 'battle') return;
      this.paused = on;
      if (on) { this.showScreen('screen-pause'); $('hud').classList.remove('hidden'); }
      else this.hideAllScreens();
    }

    /* ---------------- HUD ---------------- */
    updateHud(force) {
      this.hudTick -= 1;
      const showText = force || this.hudTick <= 0;
      if (showText) this.hudTick = 6;

      const p0 = this.players[0], p1 = this.players[1];
      const setBar = (bar, ratio) => {
        bar.style.transform = 'scaleX(' + M.clamp(ratio, 0, 1) + ')';
      };
      const upd = (p, idPre) => {
        const ratio = p.hp / p.maxHp;
        const bar = $(idPre);
        setBar(bar, ratio);
        bar.parentNode.classList.toggle('low', ratio <= 0.5 && ratio > 0.25);
        bar.parentNode.classList.toggle('crit', ratio <= 0.25);
        if (showText) $(idPre.replace('hp-', 'hptext-')).textContent = Math.max(0, Math.ceil(p.hp)) + '/' + p.maxHp;
        const sk = $(idPre.replace('hp-', 'sk-'));
        const skRatio = 1 - M.clamp(p.skillTimer / Math.max(0.1, p.st.skillCd), 0, 1);
        setBar(sk, skRatio);
        sk.parentNode.classList.toggle('ready', p.skillTimer <= 0);
        $(idPre.replace('hp-', 'pcard-')).classList.toggle('active', p.controlled);
        $(idPre.replace('hp-', 'pcard-')).classList.toggle('down', p.downed);
      };
      upd(p0, 'hp-niu'); upd(p1, 'hp-bao');

      if (showText) {
        const info = NLB.levelInfo(this.level);
        $('hud-level').textContent = '第 ' + this.level + ' 关 · ' + (this.field === 'elite' ? '精英场' : '冒险场') + ' · ' + info.name;
        $('hud-wave').textContent = '波次 ' + Math.max(1, this.waves ? this.waves.current : 1) + '/' + (this.waves ? this.waves.total : 1) +
          (this.waves && this.waves.state === 'fight' ? ' · 剩余 ' + this.aliveCount() : '');
        $('hud-gene').textContent = '基因点 ' + this.save.genes + (this.battleGenes ? ' (+' + Math.round(this.battleGenes) + ')' : '');
      }
      if (this.boss) {
        setBar($('boss-hp'), this.boss.hp / this.boss.maxHp);
        if (showText) {
          $('boss-name').textContent = this.boss.name + (this.boss.phase > 1 ? ' · 第 ' + this.boss.phase + ' 阶段' : '');
        }
      }
    }
    aliveCount() {
      let n = 0;
      for (const e of this.enemies) if (e.alive) n++;
      return n;
    }

    /* ---------------- 结算 ---------------- */
    endBattle(win, abandoned) {
      if (this.state !== 'battle') return;
      this.state = 'over';
      this.setBoss(null);
      $('center-tip').classList.add('hidden');
      const lv = this.level, field = this.field;
      const first = win && !this.isCleared(lv, field);
      let genes = 0;
      if (win) {
        genes = this.geneReward(lv, field, first) + Math.round(this.battleGenes);
        this.save.genes += genes;
        this.save.cleared[lv] = this.save.cleared[lv] || {};
        this.save.cleared[lv][field] = true;
        this.save.unlocked = Math.max(this.save.unlocked, Math.min(lv + 1, C.TOTAL_LEVELS));
        this.save.best = Math.max(this.save.best || 0, genes);
        this.writeSave();
        S.play('win');
      } else {
        genes = Math.round(this.battleGenes * 0.5);
        this.save.genes += genes;
        this.writeSave();
        S.play('lose');
      }
      this.refreshMenu();

      const mins = Math.floor(this.battleTime / 60), secs = Math.floor(this.battleTime % 60);
      const timeStr = mins + ':' + (secs < 10 ? '0' : '') + secs;
      const title = $('res-title');
      title.textContent = win ? (field === 'elite' ? '精英场 通关！' : '冒险场 通关！') : (abandoned ? '已放弃挑战' : '战斗失败');
      title.style.color = win ? '#7bd66a' : '#e8574a';

      let html = '';
      html += '<div>关卡：第 ' + lv + ' 关 · ' + (field === 'elite' ? '精英场' : '冒险场') + '</div>';
      html += '<div>击杀敌人：<b>' + this.kills + '</b></div>';
      html += '<div>耗时：<b>' + timeStr + '</b></div>';
      html += '<div>获得基因点：<b>+' + genes + '</b>' + (win && first ? '（含首通奖励）' : '') + '</div>';
      if (win && lv === C.TOTAL_LEVELS && field === 'elite') html += '<div style="color:#ffb648;margin-top:8px">🏆 你已征服虎王神殿精英场，远征圆满！</div>';
      $('res-stats').innerHTML = html;

      const btns = $('res-btns');
      btns.innerHTML = '';
      const mk = (label, cls, fn) => {
        const b = document.createElement('button');
        b.className = 'btn big ' + cls;
        b.textContent = label;
        b.addEventListener('click', () => { S.play('ui'); fn(); });
        btns.appendChild(b);
        return b;
      };
      if (win) {
        const ups = field === 'elite' ? 2 : 1;
        this.upgradeQueue = ups;
        mk('领取强化 ×' + ups, 'primary', () => this.showUpgrade(ups, () => this.showLevels()));
        if (lv < C.TOTAL_LEVELS) mk('直接进入下一关', 'ghost', () => { this.upgradeQueue = ups; this.showUpgrade(ups, () => this.startBattle(lv + 1, 'adventure')); });
      } else {
        mk('重新挑战', 'primary', () => this.startBattle(lv, field));
        mk('返回地图', 'ghost', () => this.showLevels());
      }
      mk('回到主菜单', 'ghost', () => { this.state = 'menu'; this.buildIdleScene(); this.showScreen('screen-menu'); });
      this.showScreen('screen-result');
    }

    /* ---------------- 强化选择 ---------------- */
    showUpgrade(count, onDone) {
      this._upgradeDone = onDone;
      this._upgradeLeft = count;
      this.renderUpgrade();
    }
    renderUpgrade() {
      if (this._upgradeLeft <= 0) {
        const fn = this._upgradeDone;
        this._upgradeDone = null;
        this.showScreen('screen-levels');
        this.refreshMenu();
        if (fn) fn();
        return;
      }
      $('up-title').textContent = '选择一项强化' + (this._upgradeLeft > 1 ? '（剩余 ' + this._upgradeLeft + ' 次）' : '');
      const row = $('upgrade-row');
      row.innerHTML = '';
      const opts = NLB.rollUpgrades(this.save, 3);
      if (!opts.length) {
        const d = document.createElement('div');
        d.textContent = '所有强化均已满级，继续挑战新的战场吧！';
        row.appendChild(d);
        const b = document.createElement('button');
        b.className = 'btn big primary';
        b.textContent = '继续';
        b.addEventListener('click', () => { this._upgradeLeft = 0; this.renderUpgrade(); });
        row.appendChild(b);
        this.showScreen('screen-upgrade');
        return;
      }
      opts.forEach((u) => {
        const card = document.createElement('div');
        card.className = 'up-card';
        const ownerCls = u.target === 'niu' ? 'niu' : u.target === 'bao' ? 'bao' : 'team';
        const ownerText = u.target === 'niu' ? '牛来专属' : u.target === 'bao' ? '豹拉专属' : '全队通用';
        const have = this.save.upgrades.filter((id) => id === u.id).length;
        card.innerHTML =
          '<div class="up-icon">' + u.icon + '</div>' +
          '<div class="up-name">' + u.name + '</div>' +
          '<div class="up-desc">' + u.desc + '</div>' +
          '<div><span class="up-owner ' + ownerCls + '">' + ownerText + (have ? ' · 已持有 ' + have + '/' + u.max : '') + '</span></div>';
        card.addEventListener('click', () => {
          S.play('levelup');
          this.save.upgrades.push(u.id);
          this.writeSave();
          this.stats = NLB.computeStats(this.save);
          this.toast('获得强化：' + u.name);
          this._upgradeLeft--;
          this.renderUpgrade();
        });
        row.appendChild(card);
      });
      this.showScreen('screen-upgrade');
    }

    /* ---------------- 绘制 ---------------- */
    draw() {
      const ctx = this.ctx;
      if (!ctx) return;
      const dpr = this.dpr || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.fillStyle = this.world ? this.world.theme.sky : '#1b2417';
      ctx.fillRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);

      ctx.save();
      this.camera.apply(ctx);

      if (this.world) {
        this.world.drawGround(ctx, this.camera);
        this.world.drawDecor(ctx, this.camera);
      }
      /* Boss 预警圈 */
      if (this.warnCircle) {
        const w = this.warnCircle;
        ctx.save();
        ctx.globalAlpha = 0.4 * (w.t / w.max);
        ctx.strokeStyle = '#ff6a55'; ctx.lineWidth = 6;
        ctx.setLineDash([16, 12]);
        ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      /* 影子 */
      for (const p of this.players) p.drawShadow(ctx);
      for (const e of this.enemies) if (e.alive || e.dying) e.drawShadow(ctx);
      for (const pk of this.pickups) pk.drawShadow(ctx);

      /* 按 y 排序绘制 */
      const drawables = [];
      for (const p of this.players) drawables.push(p);
      for (const e of this.enemies) drawables.push(e);
      for (const pk of this.pickups) drawables.push(pk);
      drawables.sort((a, b) => (a.y - b.y));
      for (const d of drawables) {
        if (d.draw) d.draw(ctx);
      }
      for (const pr of this.projectiles) pr.draw(ctx);
      this.particles.draw(ctx);
      ctx.restore();

      if (this.world) {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.world.drawVignette(ctx, {
          x: this.camera.x, y: this.camera.y, w: this.camera.w, h: this.camera.h,
        });
        ctx.restore();
      }

      /* 暂停遮罩提示 */
      if (this.paused) {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.fillRect(0, 0, this.camera.w, this.camera.h);
        ctx.restore();
      }
    }
  }

  NLB.Game = Game;
})(window.NLB);
