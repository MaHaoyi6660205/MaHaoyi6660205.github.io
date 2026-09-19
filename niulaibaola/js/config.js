/* ===========================================================
 * 牛来豹拉大冒险 —— 配置层
 * 基础属性 / 强化池 / 基因实验室 / 关卡数据
 * =========================================================== */
(function (NLB) {
  'use strict';

  const CONFIG = {
    TOTAL_LEVELS: 10,
    WORLD: { w: 2300, h: 1250, margin: 70 },
    /* 战场尺寸：精英场略大 */
    FIELD: {
      adventure: { w: 2300, h: 1250 },
      elite: { w: 2600, h: 1350 },
    },
    /* 基础属性（会在强化计算中被乘算/加算） */
    BASE: {
      niu: {
        hp: 165, speed: 218, radius: 24, dmg: 1,
        atkCd: 0.44, atkDmg: 32, atkRange: 96, atkArc: 2.2,
        slowOnHit: false, dashShock: false,
        skillCd: 5.0, dashTime: 0.42, dashSpeed: 720, dashDmg: 55, dashRadius: 46,
        crit: 0.05, critMul: 1.8, dr: 0.15, lifesteal: 0,
      },
      bao: {
        hp: 95, speed: 262, radius: 21, dmg: 1,
        atkCd: 0.30, atkDmg: 22, projSpeed: 640, projLife: 1.05,
        skillCd: 6.0, furyTime: 2.4, furyRate: 2.6, furyPierce: 2,
        crit: 0.12, critMul: 1.9, dr: 0, lifesteal: 0,
        pierce: 0, arrows: 1, spread: 0.16,
      },
      team: {
        geneMul: 1, pickupRange: 74, swapCd: 0.6, swapHeal: 0,
        linkHeal: 0, loneWolf: 0, reviveCount: 0, magnet: 1,
      },
    },
    /* 敌人基础属性（随关卡线性成长） */
    ENEMY: {
      wolf: { hp: 58, speed: 152, dmg: 12, radius: 19, atkCd: 1.25, range: 56, windup: 0.34, genes: 2 },
      wolfElite: { hp: 132, speed: 168, dmg: 19, radius: 25, atkCd: 1.05, range: 64, windup: 0.30, genes: 6 },
      wolfking: { hp: 1750, speed: 152, dmg: 24, radius: 44, atkCd: 1.5, range: 92, windup: 0.42, genes: 60 },
      tiger: { hp: 4200, speed: 176, dmg: 32, radius: 52, atkCd: 1.3, range: 110, windup: 0.38, genes: 140 },
    },
    /* 关卡成长系数 */
    SCALE: { hpPerLevel: 0.16, dmgPerLevel: 0.085 },
    ELITE: { hp: 1.7, dmg: 1.32, speed: 1.06, count: 1.3, genes: 2.5 },
    COMBAT: {
      reviveRange: 78, reviveTime: 2.2, downTime: 22, reviveHpRatio: 0.45,
      hitStun: 0.16, invulAfterHit: 0.45,
      touchDmgRatio: 0.17,      // 贴身接触伤害系数
      waveClearHeal: 0.08,      // 每清一波回复的生命比例
    },
    GENE: {
      /* 通关奖励：基础 + 关卡加成，精英场 ×2.5 */
      base: 12, perLevel: 5, firstClearBonus: 8,
    },
  };

  /* ---------------- 关卡数据 ---------------- */
  const LEVEL_THEMES = [
    { name: '青草平原', ground: '#3f6b34', ground2: '#4a7c3c', decor: 'grass', sky: '#2a3a24', fog: 'rgba(120,180,110,.06)' },
    { name: '迷雾森林', ground: '#2f5a37', ground2: '#37663f', decor: 'forest', sky: '#1c2f22', fog: 'rgba(90,150,110,.09)' },
    { name: '裂石峡谷', ground: '#6b5a42', ground2: '#7a6750', decor: 'canyon', sky: '#3a2f24', fog: 'rgba(200,170,120,.06)' },
    { name: '腐沼泽地', ground: '#3b4f3a', ground2: '#445a41', decor: 'swamp', sky: '#1e2a20', fog: 'rgba(120,160,90,.10)' },
    { name: '狼王巢穴', ground: '#4a4340', ground2: '#544b47', decor: 'den', sky: '#241f1e', fog: 'rgba(180,90,70,.10)' },
    { name: '霜寒雪原', ground: '#8fa3ad', ground2: '#a3b7c0', decor: 'snow', sky: '#2b3941', fog: 'rgba(200,225,240,.10)' },
    { name: '灼热荒漠', ground: '#a8894f', ground2: '#b89a5c', decor: 'desert', sky: '#40331f', fog: 'rgba(240,200,120,.08)' },
    { name: '熔岩火山', ground: '#4a2b22', ground2: '#5c352a', decor: 'volcano', sky: '#2a1512', fog: 'rgba(255,120,50,.10)' },
    { name: '远古废墟', ground: '#4b4d55', ground2: '#565862', decor: 'ruin', sky: '#232530', fog: 'rgba(150,160,200,.08)' },
    { name: '虎王神殿', ground: '#5a3a24', ground2: '#6b4630', decor: 'temple', sky: '#2c1a12', fog: 'rgba(255,160,60,.10)' },
  ];

  /* 生成某关某场的波次配置 */
  function buildWavePlan(level, field) {
    const elite = field === 'elite';
    const waves = [];
    /* 波数保持一致，精英场靠强度与密度拉开差距，避免单纯拖长战斗时间 */
    let waveCount = 3 + Math.floor(level / 4);
    waveCount = Math.min(waveCount, 5);
    for (let w = 0; w < waveCount; w++) {
      const baseCount = 2 + Math.round(level * 0.45) + Math.floor(w * 0.45);
      const count = Math.max(3, Math.round(baseCount * (elite ? CONFIG.ELITE.count : 1)));
      const eliteRatio = Math.min(0.55, (elite ? 0.22 : 0.06) + level * 0.035 + (w >= waveCount - 1 ? 0.12 : 0));
      waves.push({ count, eliteRatio, boss: null });
    }
    /* Boss 波：第 5 关狼王，第 10 关老虎 */
    if (level === 5) {
      waves.push({ boss: 'wolfking', count: elite ? 4 : 2, eliteRatio: elite ? 0.6 : 0.2 });
    } else if (level === 10) {
      waves.push({ boss: 'tiger', count: elite ? 5 : 3, eliteRatio: elite ? 0.7 : 0.3 });
    }
    return waves;
  }

  function levelInfo(level) {
    const t = LEVEL_THEMES[level - 1];
    return {
      level,
      name: t.name,
      theme: t,
      boss: level === 5 ? '狼王' : level === 10 ? '老虎' : null,
      field: {
        adventure: { size: CONFIG.FIELD.adventure, waves: buildWavePlan(level, 'adventure') },
        elite: { size: CONFIG.FIELD.elite, waves: buildWavePlan(level, 'elite') },
      },
    };
  }

  /* ---------------- 强化池 ---------------- */
  /* target: niu / bao / team(通用) ; max: 可重复次数 */
  const UPGRADES = [
    /* 通用 */
    { id: 'hp', name: '野蛮体魄', icon: '❤️', target: 'team', max: 6, desc: '两名角色生命上限 +16%，并立即回复等量生命。', apply: (s) => { s.niu.hp *= 1.16; s.bao.hp *= 1.16; } },
    { id: 'dmg', name: '利刃磨炼', icon: '⚔️', target: 'team', max: 6, desc: '两名角色造成伤害 +14%。', apply: (s) => { s.niu.dmg *= 1.14; s.bao.dmg *= 1.14; } },
    { id: 'spd', name: '疾风步法', icon: '💨', target: 'team', max: 4, desc: '两名角色移动速度 +11%。', apply: (s) => { s.niu.speed *= 1.11; s.bao.speed *= 1.11; } },
    { id: 'cd', name: '战斗专注', icon: '⏳', target: 'team', max: 4, desc: '技能冷却时间 -16%。', apply: (s) => { s.niu.skillCd *= 0.84; s.bao.skillCd *= 0.84; } },
    { id: 'crit', name: '致命本能', icon: '🎯', target: 'team', max: 5, desc: '暴击率 +8%，暴击伤害 +15%。', apply: (s) => { s.niu.crit += 0.08; s.bao.crit += 0.08; s.niu.critMul += 0.15; s.bao.critMul += 0.15; } },
    { id: 'lifesteal', name: '嗜血基因', icon: '🩸', target: 'team', max: 3, desc: '造成伤害的 7% 转化为生命回复。', apply: (s) => { s.niu.lifesteal += 0.07; s.bao.lifesteal += 0.07; } },
    { id: 'dr', name: '坚韧皮毛', icon: '🛡️', target: 'team', max: 4, desc: '受到伤害 -9%。', apply: (s) => { s.niu.dr = 1 - (1 - s.niu.dr) * 0.91; s.bao.dr = 1 - (1 - s.bao.dr) * 0.91; } },
    { id: 'gene', name: '贪婪嗅觉', icon: '🧬', target: 'team', max: 3, desc: '基因点获取 +20%，拾取范围 +50%。', apply: (s) => { s.team.geneMul += 0.2; s.team.pickupRange += 40; } },
    /* 牛来专属 */
    { id: 'niu_horn', name: '巨角强化', icon: '🐂', target: 'niu', max: 4, desc: '牛来近战范围 +18%，近战伤害 +16%。', apply: (s) => { s.niu.atkRange *= 1.18; s.niu.atkDmg *= 1.16; } },
    { id: 'niu_dash', name: '铁蹄践踏', icon: '💥', target: 'niu', max: 3, desc: '牛来冲撞伤害 +45%，落地产生范围震击。', apply: (s) => { s.niu.dashDmg *= 1.45; s.niu.dashShock = true; } },
    { id: 'niu_skin', name: '厚牛皮甲', icon: '🧱', target: 'niu', max: 3, desc: '牛来额外减伤 12%，生命 +10%。', apply: (s) => { s.niu.dr = 1 - (1 - s.niu.dr) * 0.88; s.niu.hp *= 1.10; } },
    { id: 'niu_roar', name: '震慑战吼', icon: '📣', target: 'niu', max: 2, desc: '牛来命中使敌人减速 35%，持续 1.5 秒。', apply: (s) => { s.niu.slowOnHit = true; } },
    { id: 'niu_fury', name: '狂牛之怒', icon: '🔥', target: 'niu', max: 2, desc: '牛来攻击速度 +22%，冲撞冷却 -20%。', apply: (s) => { s.niu.atkCd *= 0.78; s.niu.skillCd *= 0.8; } },
    /* 豹拉专属 */
    { id: 'bao_multi', name: '分裂爪刃', icon: '🗡️', target: 'bao', max: 3, desc: '豹拉每次攻击多发射 1 枚爪刃（伤害略降）。', apply: (s) => { s.bao.arrows += 1; s.bao.dmg *= 0.88; } },
    { id: 'bao_pierce', name: '穿透弹道', icon: '➶', target: 'bao', max: 3, desc: '豹拉爪刃可额外穿透 1 个敌人。', apply: (s) => { s.bao.pierce += 1; } },
    { id: 'bao_hunt', name: '追猎标记', icon: '👁️', target: 'bao', max: 3, desc: '豹拉暴击伤害 +45%，暴击率 +6%。', apply: (s) => { s.bao.critMul += 0.45; s.bao.crit += 0.06; } },
    { id: 'bao_wind', name: '疾风身法', icon: '🌪️', target: 'bao', max: 3, desc: '豹拉移动速度 +16%，攻击间隔 -12%。', apply: (s) => { s.bao.speed *= 1.16; s.bao.atkCd *= 0.88; } },
    { id: 'bao_range', name: '锐爪长击', icon: '🏹', target: 'bao', max: 3, desc: '豹拉爪刃伤害 +20%，飞行速度 +25%。', apply: (s) => { s.bao.dmg *= 1.2; s.bao.projSpeed *= 1.25; } },
    /* 队伍协同 */
    { id: 'team_bond', name: '羁绊链接', icon: '🤝', target: 'team', max: 2, desc: '切换角色时双方回复 10% 生命，切换冷却减半。', apply: (s) => { s.team.swapHeal += 0.1; s.team.swapCd *= 0.5; } },
    { id: 'team_link', name: '生命共享', icon: '💞', target: 'team', max: 2, desc: '一方拾取回血时，另一名角色也回复 55%。', apply: (s) => { s.team.linkHeal += 0.55; } },
    { id: 'team_lone', name: '背水一战', icon: '😤', target: 'team', max: 2, desc: '队友倒地时，存活角色伤害 +35%、减伤 +15%。', apply: (s) => { s.team.loneWolf += 0.35; } },
    { id: 'team_revive', name: '不屈意志', icon: '✨', target: 'team', max: 2, desc: '每次战斗可获得 1 次自动复活（回复 50% 生命）。', apply: (s) => { s.team.reviveCount += 1; } },
  ];

  const UPGRADE_MAP = {};
  UPGRADES.forEach((u) => { UPGRADE_MAP[u.id] = u; });

  /* ---------------- 基因实验室（永久商店） ---------------- */
  const SHOP = [
    { id: 's_hp', name: '体质序列', desc: '两名角色生命上限 +6%', baseCost: 18, costStep: 12, max: 10, apply: (s) => { s.niu.hp *= 1.06; s.bao.hp *= 1.06; } },
    { id: 's_dmg', name: '力量序列', desc: '两名角色伤害 +5%', baseCost: 22, costStep: 14, max: 10, apply: (s) => { s.niu.dmg *= 1.05; s.bao.dmg *= 1.05; } },
    { id: 's_spd', name: '敏捷序列', desc: '两名角色移速 +3%', baseCost: 16, costStep: 10, max: 8, apply: (s) => { s.niu.speed *= 1.03; s.bao.speed *= 1.03; } },
    { id: 's_cd', name: '专注序列', desc: '技能冷却 -4%', baseCost: 20, costStep: 13, max: 8, apply: (s) => { s.niu.skillCd *= 0.96; s.bao.skillCd *= 0.96; } },
    { id: 's_crit', name: '幸运序列', desc: '暴击率 +2.5%', baseCost: 24, costStep: 15, max: 8, apply: (s) => { s.niu.crit += 0.025; s.bao.crit += 0.025; } },
    { id: 's_gene', name: '贪婪序列', desc: '基因点获取 +8%', baseCost: 30, costStep: 20, max: 6, apply: (s) => { s.team.geneMul += 0.08; } },
    { id: 's_start', name: '战前补给', desc: '每场战斗开局获得一层护盾（吸收 1 次伤害）', baseCost: 60, costStep: 0, max: 1, apply: (s) => { s.team.shield = 1; } },
  ];
  const SHOP_MAP = {};
  SHOP.forEach((s) => { SHOP_MAP[s.id] = s; });

  /* 依据存档计算最终属性 */
  function computeStats(save) {
    const B = CONFIG.BASE;
    const s = {
      niu: Object.assign({}, B.niu),
      bao: Object.assign({}, B.bao),
      team: Object.assign({}, B.team, { shield: 0 }),
    };
    (save.upgrades || []).forEach((id) => {
      const u = UPGRADE_MAP[id];
      if (u) u.apply(s);
    });
    Object.keys(save.shop || {}).forEach((id) => {
      const item = SHOP_MAP[id];
      if (!item) return;
      const lv = save.shop[id] || 0;
      for (let i = 0; i < lv; i++) item.apply(s);
    });
    s.niu.hp = Math.round(s.niu.hp);
    s.bao.hp = Math.round(s.bao.hp);
    s.niu.crit = Math.min(0.85, s.niu.crit);
    s.bao.crit = Math.min(0.85, s.bao.crit);
    s.niu.dr = Math.min(0.7, s.niu.dr);
    s.bao.dr = Math.min(0.7, s.bao.dr);
    return s;
  }

  /* 抽取 3 个可选强化（排除已达上限的） */
  function rollUpgrades(save, n) {
    const count = n || 3;
    const pool = UPGRADES.filter((u) => {
      const have = save.upgrades.filter((id) => id === u.id).length;
      return have < u.max;
    });
    return NLB.M.shuffle(pool).slice(0, count);
  }

  function shopCost(item, lv) {
    return item.baseCost + item.costStep * lv;
  }

  NLB.CONFIG = CONFIG;
  NLB.LEVEL_THEMES = LEVEL_THEMES;
  NLB.UPGRADES = UPGRADES;
  NLB.UPGRADE_MAP = UPGRADE_MAP;
  NLB.SHOP = SHOP;
  NLB.SHOP_MAP = SHOP_MAP;
  NLB.computeStats = computeStats;
  NLB.rollUpgrades = rollUpgrades;
  NLB.shopCost = shopCost;
  NLB.levelInfo = levelInfo;
})(window.NLB);

