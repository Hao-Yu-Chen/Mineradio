# Mineradio

Windows Electron 桌面沉浸式音乐播放器。整合天气电台、搜索播放、歌词舞台、粒子视觉、3D 歌单架和 GitHub 自动更新。

## 运行

```bash
npm install
npm start
npm run build:win    # 构建 NSIS Windows 安装包 → dist/
```

桌面版由 Electron 主进程加载本地服务。

## 核心特性

- **Open-Meteo 天气电台** — 根据天气 mood 生成播放队列
- **多音源搜索播放** — 网易云音乐、QQ 音乐、酷我、酷狗、咪咕，支持 LX Music（落雪音乐）自定义音源脚本
- **歌词舞台** — 桌面歌词、自定义歌词、3D 粒子歌词
- **粒子视觉** — 封面粒子、节奏驱动电影镜头
- **3D 歌单架** — 右键唤起，支持常驻与动态镜头
- **DIY 视觉控制台** — 实时调节粒子、着色、歌单架、性能等参数
- **GitHub 自动更新** — 检测 Release 新版本并下载安装

## LX Music 音源集成

整合了 LX Music（落雪音乐）的音源架构，支持加载 `.js` 格式的自定义音源脚本：

- **VM 沙箱引擎** — 兼容 `globalThis.lx` API，支持 `request`、`send`、`on`、`utils.crypto`、`utils.buffer`、`utils.zlib` 等完整接口
- **在线/本地导入** — 通过 URL 或本地文件路径导入音源脚本
- **多源搜索播放** — 内置 kw/kg/tx/wy/mg 搜索器，通过源脚本获取播放 URL
- **LX 歌单与喜欢** — 独立的本地歌单和红心喜欢系统，与默认模式隔离
- **自动换源** — 播放失败时跨音源搜索同名歌曲

音源脚本通过服务器 `/api/lx/import`（在线）和 `/api/lx/import-local`（本地）接口导入，前端设置面板提供完整的管理 UI。

## 技术架构

```
electron/
├─ desktop/main.js          # Electron 主进程
├─ desktop/preload.js       # contextBridge
├─ public/index.html         # 主前端（单文件）
├─ server.js                 # 本地 HTTP API 服务
├─ lx-search.js              # LX 模式搜索实现
├─ lx-source-engine.js       # LX 音源 VM 沙箱引擎
└─ dj-analyzer.js            # 节奏/音频分析引擎
```

- 前端纯 vanilla HTML/CSS/JS，无打包器
- 后端 Node.js CommonJS，无 TypeScript
- `asar: false`，文件直接暴露
- 更新通过 GitHub Releases API 检测

## 第三方音乐平台说明

Mineradio 不是网易云音乐、QQ 音乐或任何音乐平台的官方客户端。第三方平台接入仅用于个人学习与本地体验。请遵守对应平台的用户协议与版权规则。
