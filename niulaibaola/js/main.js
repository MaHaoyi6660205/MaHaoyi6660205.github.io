/* ===========================================================
 * 牛来豹拉大冒险 —— 启动入口
 * =========================================================== */
(function (NLB) {
  'use strict';

  function boot() {
    const canvas = document.getElementById('game');
    const game = new NLB.Game();
    NLB.game = game;
    game.init(canvas);

    /* 首次交互后再恢复音频上下文（浏览器自动播放策略） */
    const resume = () => { NLB.Sound.resume(); };
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });

    /* 页面隐藏时自动暂停，避免回来后掉帧堆积 */
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && game.state === 'battle' && !game.paused) game.togglePause(true);
      game.lastTs = performance.now();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.NLB);
