# Mineradio

Windows Electron 桌面 + Android 沉浸式音乐播放器。整合天气电台、搜索播放、歌词舞台、粒子视觉、3D 歌单架和可扩展音源系统。

> **声明**：本项目是基于 [XxHuberrr/Mineradio](https://github.com/XxHuberrr/Mineradio.git) 的二次开发版本，增加了队列持久化、播放模式记忆修复、空队列粒子初始化、Android APK 构建适配、LX Music 音源集成等功能改进。本项目仅供学习研究。

Mineradio 是一款 Windows 桌面沉浸式音乐播放器，把搜索播放、歌词舞台、粒子视觉、3D 歌单架和完整桌面模式组合成一个更接近现场感的私人音乐空间。

---



安装时只需要下载并运行 `Mineradio-2.0.2-Setup.exe`。不要把 `.blockmap`、`latest.yml` 或 `win-unpacked` 当成正式安装包。

## 运行与构建

```bash
# 安装依赖
npm install

# 启动桌面端（Electron）
npm start

# 构建 Windows NSIS 安装包 → dist/
npm run build:win

# ── Android APK 构建 ──
# Windows（推荐）
cd android
build-apk.bat
# 输出：android/Mineradio-debug.apk

# Linux / macOS
cd android && bash build-apk.sh

# Release 构建
cd android && build-apk.bat --release     # → android/Mineradio-release.apk
```

> 小众 Electron 桌面软件、未签名安装包有时会被浏览器、Windows Defender 或 SmartScreen 提示风险。请先确认安装包来自上面的蓝奏云或 GitHub Release 官方入口，文件名是 `Mineradio-2.0.2-Setup.exe`。

---

## 功能截图

### 桌面端（Windows）

Mineradio 2.0 重新整理了视觉层次、桌面模式、主页与搜索体验，并收紧了连续播放、启动和后台性能表现。

![PC 歌单页面](docs/screenshots/pc端歌单页面.png)

**多来源搜索筛选**

![多来源搜索](docs/screenshots/根据源的不同来源可以进行查询筛选页面.png)

**扩展音源配置**

![扩展音源](docs/screenshots/)

### 移动端（Android）

> **注意**：当前安卓版本仅适配**横屏**模式，竖屏布局尚未优化，请在横屏下使用以获得完整体验。

**歌单页面**

![Android 歌单](docs/screenshots/android端歌单页面.png)

**扩展音源配置**

![Android 扩展音源](docs/screenshots/android端落雪源配置页面.png)

**搜索页面**

![Android 搜索](docs/screenshots/android端搜索页面.png)

---

当前版本：`2.0.2`

状态：Mineradio 2.0.2 正式版。

> 安全提示：`v1.0.10` 及更早旧安装包不再建议继续安装或传播。请使用本页提供的 `Mineradio-2.0.2-Setup.exe`。

## 核心特性

- 首页包含每日推荐、平台推荐、继续听、听歌画像和我的歌单入口
- 完整桌面模式保留播放器、主页、歌单和桌面交互
- 支持本地 MP4 与 Wallpaper Engine 视觉内容
- 播放后切换到 Emily / 默认播放态视觉，歌词舞台与粒子舞台同步工作
- 基于节奏的电影镜头视觉系统
- 面向长播客和 DJ 曲目的专属视觉模式
- 歌词舞台、自定义歌词、歌词位置与视觉控制
- 自定义专辑封面上传与裁剪
- 右键唤起 3D 歌单架，支持歌单队列浏览
- **多音源搜索播放** — 支持网易云、QQ 音乐、LX Music 扩展音源等多种音源接入
- **可扩展音源系统** — 插件式架构，支持自定义音源扩展（兼容 LX Music 音源格式）
- **Open-Meteo 天气电台** — 根据天气 mood 生成播放队列
- **粒子视觉** — 封面粒子系统，节奏驱动电影镜头，空场星空壁纸
- **DIY 视觉控制台** — 实时调节粒子、着色、歌单架、性能等参数
- **GitHub 自动更新** — 检测 Release 新版本并下载安装（桌面端）
- **Android 支持** — 横屏沉浸式音乐播放体验，内置 Node.js 运行时

---

## ☕ 赞赏

如果这个项目对你有所帮助，欢迎请作者喝杯咖啡

| 微信 | 支付宝 |
|------|--------|
| ![微信赞赏](docs/screenshots/微信打赏支付二维码.png) | ![支付宝赞赏](docs/screenshots/支付宝打赏收款二维码.jpg) |

---

正式分发以 `Mineradio-2.0.2-Setup.exe` 为准，不建议直接使用 `win-unpacked` 目录。安装包会创建桌面快捷方式。

已经安装过旧版本的用户可直接运行 `Mineradio-2.0.2-Setup.exe` 完成更新。

---

## 技术架构

```
resources/app/
├── desktop/main.js               # Electron 主进程
├── desktop/preload.js            # contextBridge
├── public/index.html             # 主前端（模块化加载）
├── public/js/modules/            # 前端模块（状态/场景/视觉/节拍/歌单架/播放）
├── server.js                     # 本地 HTTP API 服务
├── lx-search.js                  # LX 模式搜索实现
├── lx-source-engine.js           # LX 音源 VM 沙箱引擎
├── dj-analyzer.js                # 节奏/音频分析引擎
├── android/                      # Android Capacitor 项目
│   ├── www/mobile-bridge.js      # 移动端 API 路由补丁
│   └── www/nodejs-project/       # Node.js 运行时服务端
└── docs/                         # 文档与截图
```

- 前端纯 vanilla HTML/CSS/JS，无打包器，模块化 ES6 加载
- 后端 Node.js CommonJS，无 TypeScript
- 桌面端 `asar: false`，文件直接暴露
- 更新通过 GitHub Releases API 检测

---

## 免责声明

1. **学习目的**：本项目仅供个人学习、研究和技术交流使用，**严禁用于任何商业用途或盈利行为**。

2. **非官方客户端**：Mineradio 不是网易云音乐、QQ 音乐、酷狗音乐、酷我音乐、咪咕音乐或任何音乐平台的官方客户端，与上述平台没有任何关联。

3. **版权与协议**：使用本项目时，请遵守对应音乐平台的用户协议、服务条款和版权规则。所有音乐内容的版权归原始权利人所有。请勿利用本项目侵犯他人知识产权。

4. **无担保**：本项目按"现状"提供，不提供任何明示或暗示的担保。作者不对因使用本项目而产生的任何直接或间接损失承担责任。

5. **用户责任**：使用者应自行确保其使用行为符合当地法律法规。如因使用本项目产生任何法律纠纷，由使用者自行承担全部责任。

---

基于 [XxHuberrr/Mineradio](https://github.com/XxHuberrr/Mineradio.git) 二次开发
