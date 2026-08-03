# 🎮 AC Runner — 像素编程大冒险

一个运行在 GitHub Pages 上的像素风小游戏。控制你的程序员小人，从代码仓库的左上角出发，避开各种编程错误障碍，冲向右下角的 `AC (Accepted)` 终点！

## 🎯 玩法

- 用 **方向键** 或 **WASD** 移动小人
- **空格键** 冲刺加速（有冷却）
- **R 键** 随时重新开始
- 从 **左上角** 出发，到达 **右下角绿色 AC 方块** 即胜利

## 🚧 障碍说明

| 障碍 | 效果 |
|---|---|
| 🔴 **WA** (Wrong Answer) | 踩到后回到起点 |
| 🟡 **TLE** (Time Limit Exceeded) | 踩到后减速 2 秒 |
| 🟣 **MLE** (Memory Limit Exceeded) | 踩到后弹回 + 惩罚 3 秒 |
| 🟠 **RE** (Runtime Error) | 踩到后随机传送到地图其他位置 |

## 🚀 部署到 GitHub Pages

1. 新建仓库，命名为 `你的用户名.github.io`
2. 将本目录下的所有文件（`index.html`、`style.css`、`game.js`）上传到仓库根目录
3. 进入仓库 **Settings → Pages**，Source 选择 `Deploy from a branch`，Branch 选 `main`
4. 等待 1-2 分钟，访问 `https://你的用户名.github.io` 即可开始游戏

## 📁 文件结构

```
.
├── index.html   ← 网页入口
├── style.css    ← 样式与动画
├── game.js      ← 游戏核心逻辑（纯 Canvas，零依赖）
└── README.md    ← 本文件
```

## 🛠 技术栈

- 纯 HTML5 Canvas（无引擎、无依赖）
- 原生 JavaScript（无框架）
- CSS3 动画
- 像素风渲染（`image-rendering: pixelated`）

## 📜 License

MIT
