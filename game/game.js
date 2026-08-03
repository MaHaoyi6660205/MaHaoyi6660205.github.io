/* ============================================================
 *  AC Runner — 像素编程大冒险
 *  纯 Canvas 像素风，零依赖，可直接在 GitHub Pages 运行
 * ============================================================ */

(() => {
  'use strict';

  // ---------- 获取画布 ----------
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // ---------- 常量 ----------
  const TILE = 40;
  const COLS = 20;
  const ROWS = 12;
  const W = TILE * COLS;  // 800
  const H = TILE * ROWS;  // 480
  canvas.width = W;
  canvas.height = H;

  // ---------- 游戏状态 ----------
  const STATE = { MENU: 0, PLAYING: 1, WIN: 2, FAIL: 3 };
  let gameState = STATE.MENU;

  // ---------- 玩家 ----------
  const player = {
    x: 1, y: 1,
    px: 0, py: 0,
    dir: 'down',
    frame: 0,
    frameTimer: 0,
    moving: false,
    speed: 180,
    dashTimer: 0,
    invincible: 0,
    trail: [],
  };

  // ---------- 计时 ----------
  let startTime = 0;
  let elapsed = 0;
  let collisionCount = 0;
  let maxSpeed = 1;

  // ---------- 输入 ----------
  const keys = {};
  window.addEventListener('keydown', e => {
    keys[e.key] = true;
    if (e.key === ' ' && gameState === STATE.PLAYING) {
      e.preventDefault();
      startDash();
    }
    if (e.key === 'r' || e.key === 'R') {
      if (gameState !== STATE.MENU) resetGame();
    }
    if (e.key === 'Enter' && gameState === STATE.MENU) startGame();
    if (e.key === 'Enter' && (gameState === STATE.WIN || gameState === STATE.FAIL)) resetGame();
  });
  window.addEventListener('keyup', e => { keys[e.key] = false; });

  // ---------- 关卡设计 ----------
  // 符号: . 空地  # 墙  P 起点  A 终点(AC)
  //        W WA   T TLE   M MLE   R RE   ~ 装饰地板
  const LEVEL = [
    "####################", // 0
    "#P......W.........R#", // 1
    "#............~.....#", // 2
    "#..................#", // 3
    "#...M..............#", // 4
    "#......~.....T.....#", // 5
    "#...............~..#", // 6
    "#...........~.W....#", // 7
    "#..................#", // 8
    "#T............M.W..#", // 9
    "#.~..R............A#", // 10
    "####################", // 11
  ];

  // 验证所有行长度
  (function validateLevel() {
    for (let i = 0; i < LEVEL.length; i++) {
      if (LEVEL[i].length !== COLS) {
        console.error(`Level row ${i} has length ${LEVEL[i].length}, expected ${COLS}: "${LEVEL[i]}"`);
      }
    }
    if (LEVEL.length !== ROWS) {
      console.error(`Level has ${LEVEL.length} rows, expected ${ROWS}`);
    }
  })();

  let grid = [];
  let acPos = { x: 0, y: 0 };
  let tleZones = [];
  let mleZones = [];
  let reZones = [];
  let waZones = [];

  let particles = [];
  let floatTexts = [];

  // ---------- 关卡解析 ----------
  function parseLevel() {
    grid = [];
    tleZones = []; mleZones = []; reZones = []; waZones = [];
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) {
        const ch = LEVEL[r][c];
        let cell = 0;
        switch (ch) {
          case '#': cell = 1; break;
          case 'P': player.x = c; player.y = r; cell = 0; break;
          case 'A': acPos = { x: c, y: r }; cell = 2; break;
          case 'W': waZones.push({ x: c, y: r }); cell = 0; break;
          case 'T': tleZones.push({ x: c, y: r }); cell = 0; break;
          case 'M': mleZones.push({ x: c, y: r }); cell = 0; break;
          case 'R': reZones.push({ x: c, y: r }); cell = 0; break;
          default: cell = 0;
        }
        row.push(cell);
      }
      grid.push(row);
    }
    player.px = player.x * TILE;
    player.py = player.y * TILE;
  }

  // ---------- 工具函数 ----------
  function isWall(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return true;
    return grid[r][c] === 1;
  }

  function addParticle(x, y, color, count) {
    count = count || 6;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: x, y: y,
        vx: (Math.random() - 0.5) * 120,
        vy: (Math.random() - 0.5) * 120 - 30,
        life: 0.6 + Math.random() * 0.4,
        maxLife: 1,
        color: color,
        size: 2 + Math.floor(Math.random() * 3),
      });
    }
  }

  function addFloatText(x, y, text, color) {
    floatTexts.push({ x: x, y: y, text: text, color: color, life: 1.5, maxLife: 1.5 });
  }

  // ---------- 冲刺 ----------
  function startDash() {
    if (player.dashTimer <= 0) {
      player.dashTimer = 0.35;
      addFloatText(player.px + 10, player.py - 10, 'DASH!', '#58a6ff');
    }
  }

  // ---------- 重置 ----------
  function resetGame() {
    parseLevel();
    player.dir = 'down';
    player.frame = 0;
    player.frameTimer = 0;
    player.moving = false;
    player.dashTimer = 0;
    player.invincible = 0;
    player.trail = [];
    collisionCount = 0;
    elapsed = 0;
    maxSpeed = 1;
    particles = [];
    floatTexts = [];
    gameState = STATE.PLAYING;
    startTime = performance.now();
    hideAllOverlays();
  }

  function startGame() { resetGame(); }

  // ---------- 更新逻辑 ----------
  function update(dt) {
    if (gameState !== STATE.PLAYING) return;

    elapsed += dt;
    if (player.dashTimer > 0) player.dashTimer -= dt;
    if (player.invincible > 0) player.invincible -= dt;

    let dx = 0, dy = 0;
    const speedMult = player.dashTimer > 0 ? 2.2 : 1;
    const currentSpeed = player.speed * speedMult;

    if (currentSpeed > player.speed * 1.5) {
      const sp = (currentSpeed / player.speed);
      if (sp > maxSpeed) maxSpeed = sp;
    }

    if (keys['ArrowUp'] || keys['w'] || keys['W'])    { dy = -1; player.dir = 'up'; }
    else if (keys['ArrowDown'] || keys['s'] || keys['S']) { dy = 1;  player.dir = 'down'; }
    else if (keys['ArrowLeft'] || keys['a'] || keys['A'])  { dx = -1; player.dir = 'left'; }
    else if (keys['ArrowRight'] || keys['d'] || keys['D'])  { dx = 1;  player.dir = 'right'; }

    if (dx !== 0 && dy !== 0) {
      const inv = 1 / Math.SQRT2;
      dx *= inv; dy *= inv;
    }

    player.moving = (dx !== 0 || dy !== 0);

    if (player.moving) {
      const moveDist = currentSpeed * dt;
      const newPx = player.px + dx * moveDist;
      const newPy = player.py + dy * moveDist;

      const targetCx = Math.floor(newPx / TILE);
      const targetCy = Math.floor(player.py / TILE);
      if (!isWall(targetCx, targetCy)) player.px = newPx;

      const targetCy2 = Math.floor(newPy / TILE);
      const targetCx2 = Math.floor(player.px / TILE);
      if (!isWall(targetCx2, targetCy2)) player.py = newPy;

      player.px = Math.max(0, Math.min(W - TILE, player.px));
      player.py = Math.max(0, Math.min(H - TILE, player.py));

      player.frameTimer += dt;
      if (player.frameTimer > 0.12) {
        player.frame = (player.frame + 1) % 4;
        player.frameTimer = 0;
      }

      if (player.dashTimer > 0 && Math.random() < 0.5) {
        player.trail.push({ x: player.px, y: player.py, life: 0.3 });
      }
    } else {
      player.frame = 0;
    }

    player.x = Math.floor(player.px / TILE);
    player.y = Math.floor(player.py / TILE);

    player.trail = player.trail.filter(t => { t.life -= dt; return t.life > 0; });

    // AC 终点检测
    if (player.x === acPos.x && player.y === acPos.y) {
      winGame();
      return;
    }

    // 障碍检测
    if (player.invincible <= 0) {
      const px = player.x, py = player.y;

      for (let i = 0; i < waZones.length; i++) {
        if (waZones[i].x === px && waZones[i].y === py) {
          collisionCount++;
          addParticle(player.px + TILE/2, player.py + TILE/2, '#f85149', 12);
          addFloatText(player.px, player.py - 10, 'WA!', '#f85149');
          player.px = 1 * TILE;
          player.py = 1 * TILE;
          player.invincible = 1.0;
          break;
        }
      }

      for (let i = 0; i < tleZones.length; i++) {
        if (tleZones[i].x === px && tleZones[i].y === py) {
          collisionCount++;
          addParticle(player.px + TILE/2, player.py + TILE/2, '#d29922', 10);
          addFloatText(player.px, player.py - 10, 'TLE!', '#d29922');
          player.speed = 90;
          setTimeout(function() { player.speed = 180; }, 2000);
          player.invincible = 0.8;
          break;
        }
      }

      for (let i = 0; i < mleZones.length; i++) {
        if (mleZones[i].x === px && mleZones[i].y === py) {
          collisionCount++;
          addParticle(player.px + TILE/2, player.py + TILE/2, '#a371f7', 10);
          addFloatText(player.px, player.py - 10, 'MLE!', '#a371f7');
          if (player.dir === 'left')       player.px += TILE;
          else if (player.dir === 'right') player.px -= TILE;
          else if (player.dir === 'up')    player.py += TILE;
          else if (player.dir === 'down')  player.py -= TILE;
          elapsed += 3;
          player.invincible = 1.0;
          break;
        }
      }

      for (let i = 0; i < reZones.length; i++) {
        if (reZones[i].x === px && reZones[i].y === py) {
          collisionCount++;
          addParticle(player.px + TILE/2, player.py + TILE/2, '#f0883e', 10);
          addFloatText(player.px, player.py - 10, 'RE!', '#f0883e');
          let attempts = 0;
          while (attempts < 100) {
            const rx = 1 + Math.floor(Math.random() * (COLS - 2));
            const ry = 1 + Math.floor(Math.random() * (ROWS - 2));
            if (!isWall(rx, ry) && !(rx === px && ry === py)) {
              player.px = rx * TILE;
              player.py = ry * TILE;
              break;
            }
            attempts++;
          }
          player.invincible = 1.0;
          break;
        }
      }
    }

    particles.forEach(function(p) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 60 * dt;
      p.life -= dt;
    });
    particles = particles.filter(function(p) { return p.life > 0; });

    floatTexts.forEach(function(ft) {
      ft.y -= 30 * dt;
      ft.life -= dt;
    });
    floatTexts = floatTexts.filter(function(ft) { return ft.life > 0; });

    // UI 更新
    document.getElementById('timer').textContent = elapsed.toFixed(1) + 's';
    const distNow = Math.abs(player.x - acPos.x) + Math.abs(player.y - acPos.y);
    const distMax = (COLS - 2) + (ROWS - 2);
    const pct = Math.max(0, Math.min(100, Math.round((1 - distNow / distMax) * 100)));
    document.getElementById('progress').textContent = pct + '%';
    const spdStr = player.dashTimer > 0 ? (maxSpeed.toFixed(1) + 'x') : '1x';
    document.getElementById('speed').textContent = spdStr;
  }

  // ---------- 胜利 ----------
  function winGame() {
    gameState = STATE.WIN;
    addParticle(player.px + TILE/2, player.py + TILE/2, '#3fb950', 30);
    document.getElementById('finalTime').textContent = elapsed.toFixed(1) + 's';
    document.getElementById('finalCollisions').textContent = collisionCount;
    document.getElementById('finalSpeed').textContent = maxSpeed.toFixed(1) + 'x';
    setTimeout(function() {
      document.getElementById('winOverlay').classList.remove('hidden');
    }, 600);
  }

  // ---------- 绘制 ----------
  function draw() {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);

    // 网格线
    ctx.strokeStyle = '#161b22';
    ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath(); ctx.moveTo(c * TILE, 0); ctx.lineTo(c * TILE, H); ctx.stroke();
    }
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath(); ctx.moveTo(0, r * TILE); ctx.lineTo(W, r * TILE); ctx.stroke();
    }

    // 装饰地板
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (LEVEL[r][c] === '~') {
          ctx.fillStyle = '#161b22';
          ctx.fillRect(c * TILE + 4, r * TILE + 4, TILE - 8, TILE - 8);
          ctx.fillStyle = '#21262d';
          ctx.fillRect(c * TILE + 10, r * TILE + 14, 4, 4);
          ctx.fillRect(c * TILE + 22, r * TILE + 24, 4, 4);
          ctx.fillRect(c * TILE + 16, r * TILE + 32, 4, 4);
        }
      }
    }

    // 墙壁
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (isWall(c, r)) drawWall(c * TILE, r * TILE);
      }
    }

    // 障碍
    waZones.forEach(function(z) { drawWA(z.x * TILE, z.y * TILE, elapsed); });
    tleZones.forEach(function(z) { drawTLE(z.x * TILE, z.y * TILE, elapsed); });
    mleZones.forEach(function(z) { drawMLE(z.x * TILE, z.y * TILE, elapsed); });
    reZones.forEach(function(z) { drawRE(z.x * TILE, z.y * TILE, elapsed); });

    // AC 终点
    drawAC(acPos.x * TILE, acPos.y * TILE, elapsed);

    // 残影
    player.trail.forEach(function(t) {
      const alpha = t.life / 0.3 * 0.4;
      drawPlayer(t.x, t.y, alpha);
    });

    // 玩家
    const blink = player.invincible > 0 && Math.floor(elapsed * 10) % 2 === 0;
    if (!blink) drawPlayer(player.px, player.py, 1);

    // 粒子
    particles.forEach(function(p) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    });
    ctx.globalAlpha = 1;

    // 浮动文字
    floatTexts.forEach(function(ft) {
      ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
      ctx.fillStyle = ft.color;
      ctx.font = 'bold 14px Courier New';
      ctx.textAlign = 'center';
      ctx.fillText(ft.text, ft.x + TILE/2, ft.y);
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  // ---------- 像素绘制 ----------
  function drawWall(px, py) {
    ctx.fillStyle = '#21262d'; ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = '#30363d'; ctx.fillRect(px, py, TILE, 3); ctx.fillRect(px, py, 3, TILE);
    ctx.fillStyle = '#161b22'; ctx.fillRect(px, py + TILE - 3, TILE, 3); ctx.fillRect(px + TILE - 3, py, 3, TILE);
    ctx.fillStyle = '#161b22';
    ctx.fillRect(px + TILE/2 - 1, py + 4, 2, TILE - 8);
    ctx.fillRect(px + 4, py + TILE/2 - 1, TILE/2 - 5, 2);
    ctx.fillRect(px + TILE/2 + 3, py + TILE/2 - 1, TILE/2 - 6, 2);
  }

  function drawPlayer(px, py, alpha) {
    ctx.globalAlpha = alpha;
    const f = player.frame;
    const dir = player.dir;
    const bob = player.moving ? (f % 2 === 0 ? 0 : -2) : 0;

    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(px + 8, py + 32, 24, 4);

    // 身体
    const bodyY = py + 8 + bob;
    ctx.fillStyle = '#58a6ff'; ctx.fillRect(px + 8, bodyY + 4, 24, 20);
    ctx.fillStyle = '#388bfd'; ctx.fillRect(px + 8, bodyY + 20, 24, 4);
    ctx.fillStyle = '#79c0ff'; ctx.fillRect(px + 8, bodyY + 4, 4, 20);

    // 头
    ctx.fillStyle = '#f0d9b5'; ctx.fillRect(px + 10, bodyY - 10, 20, 16);
    ctx.fillStyle = '#1c2333'; ctx.fillRect(px + 10, bodyY - 10, 20, 5); ctx.fillRect(px + 10, bodyY - 10, 4, 8);

    // 眼睛（朝向）
    ctx.fillStyle = '#1c2333';
    if (dir === 'right')      ctx.fillRect(px + 22, bodyY - 5, 4, 4);
    else if (dir === 'left')  ctx.fillRect(px + 14, bodyY - 5, 4, 4);
    else if (dir === 'down') { ctx.fillRect(px + 16, bodyY - 4, 3, 3); ctx.fillRect(px + 21, bodyY - 4, 3, 3); }
    else                      { ctx.fillRect(px + 16, bodyY - 3, 3, 2); ctx.fillRect(px + 21, bodyY - 3, 3, 2); }

    // 腿
    ctx.fillStyle = '#30363d';
    const legO = player.moving ? (f % 2 === 0 ? -2 : 2) : 0;
    ctx.fillRect(px + 10, bodyY + 24, 8, 8 + legO);
    ctx.fillRect(px + 22, bodyY + 24, 8, 8 - legO);

    // 手臂
    ctx.fillStyle = '#58a6ff';
    const armO = player.moving ? (f % 2 === 0 ? 2 : -2) : 0;
    ctx.fillRect(px + 4, bodyY + 8 + armO, 4, 12);
    ctx.fillRect(px + 32, bodyY + 8 - armO, 4, 12);

    // 背包
    ctx.fillStyle = '#30363d'; ctx.fillRect(px + 30, bodyY + 6, 6, 10);

    ctx.globalAlpha = 1;
  }

  function drawAC(px, py, time) {
    const pulse = 1 + Math.sin(time * 3) * 0.1;
    const cx = px + TILE/2, cy = py + TILE/2;

    ctx.fillStyle = 'rgba(63,185,80,0.15)';
    ctx.fillRect(px - 4, py - 4, TILE + 8, TILE + 8);

    const s = TILE * pulse;
    const ox = cx - s/2, oy = cy - s/2;
    ctx.fillStyle = '#3fb950'; ctx.fillRect(ox, oy, s, s);
    ctx.fillStyle = '#2ea043'; ctx.fillRect(ox + 4, oy + 4, s - 8, s - 8);

    // 对勾
    ctx.fillStyle = '#fff';
    ctx.fillRect(ox + 8,  oy + s/2 - 2, 4, 4);
    ctx.fillRect(ox + 12, oy + s/2 + 2, 4, 4);
    ctx.fillRect(ox + 16, oy + s/2 - 6, 4, 4);

    ctx.fillStyle = '#3fb950'; ctx.font = 'bold 8px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('AC', cx, py + TILE + 12);
    ctx.textAlign = 'left';
  }

  function drawWA(px, py, time) {
    const shake = Math.sin(time * 6) * 2;
    const x = px + shake;
    ctx.fillStyle = '#f85149'; ctx.fillRect(x + 2, py + 2, TILE - 4, TILE - 4);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + 10, py + 10, 4, 20);
    ctx.fillRect(x + 18, py + 10, 4, 20);
    ctx.fillRect(x + 10, py + 18, 12, 4);
    ctx.fillStyle = '#f85149'; ctx.font = 'bold 8px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('WA', px + TILE/2, py + TILE + 12);
    ctx.textAlign = 'left';
  }

  function drawTLE(px, py, time) {
    const slow = Math.sin(time * 2) * 0.3 + 0.7;
    ctx.fillStyle = 'rgba(210,153,34,' + slow + ')';
    ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
    ctx.fillStyle = '#fff';
    ctx.fillRect(px + 14, py + 6, 12, 4);
    ctx.fillRect(px + 14, py + 30, 12, 4);
    ctx.fillRect(px + 16, py + 10, 8, 20);
    const sandY = py + 14 + (time * 10) % 16;
    ctx.fillRect(px + 18, sandY, 4, 4);
    ctx.fillStyle = '#d29922'; ctx.font = 'bold 8px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('TLE', px + TILE/2, py + TILE + 12);
    ctx.textAlign = 'left';
  }

  function drawMLE(px, py, time) {
    const grow = Math.sin(time * 4) * 2;
    const x = px + 4 - grow/2, y = py + 4 - grow/2;
    const s = TILE - 8 + grow;
    ctx.fillStyle = '#a371f7'; ctx.fillRect(x, y, s, s);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + 4, y + 6,  s - 8, 3);
    ctx.fillRect(x + 4, y + 12, s - 8, 3);
    ctx.fillRect(x + 4, y + 18, s - 8, 3);
    ctx.fillStyle = '#a371f7'; ctx.font = 'bold 8px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('MLE', px + TILE/2, py + TILE + 12);
    ctx.textAlign = 'left';
  }

  function drawRE(px, py, time) {
    const rot = time * 3;
    ctx.fillStyle = '#f0883e'; ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
    ctx.fillStyle = '#fff';
    const cx = px + TILE/2, cy = py + TILE/2, r = 10;
    for (let i = 0; i < 3; i++) {
      const angle = rot + i * (Math.PI * 2 / 3);
      const tx = Math.round(cx + Math.cos(angle) * r);
      const ty = Math.round(cy + Math.sin(angle) * r);
      ctx.fillRect(tx - 2, ty - 2, 4, 4);
    }
    ctx.fillStyle = '#f0883e'; ctx.font = 'bold 8px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('RE', px + TILE/2, py + TILE + 12);
    ctx.textAlign = 'left';
  }

  // ---------- 遮罩控制 ----------
  function hideAllOverlays() {
    document.getElementById('startOverlay').classList.add('hidden');
    document.getElementById('winOverlay').classList.add('hidden');
    document.getElementById('failOverlay').classList.add('hidden');
  }

  // ---------- 按钮绑定 ----------
  document.getElementById('startBtn').addEventListener('click', startGame);
  document.getElementById('restartBtn').addEventListener('click', resetGame);
  document.getElementById('retryBtn').addEventListener('click', resetGame);

  // ---------- 主循环 ----------
  let lastTime = performance.now();
  function gameLoop() {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(gameLoop);
  }

  // ---------- 启动 ----------
  parseLevel();
  gameLoop();

})();
