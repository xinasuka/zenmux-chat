<div align="center">
  <img src="./icon.png" width="96" height="96" alt="ZenMux Chat Logo" style="border-radius: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.15);">
  <h1>ZenMux Chat</h1>
  <p><b>A fast, elegant, and private AI chat workstation powered by ZenMux & Tencent Cloud EdgeOne</b></p>
  <p>
    <a href="#quick-start">Quick Start</a> •
    <a href="#key-features">Features</a> •
    <a href="#deployment-guide">Deploy</a> •
    <a href="#中文说明">中文说明</a>
  </p>
</div>

---

## Overview

**ZenMux Chat** is a lightweight, all-in-one AI chat workstation designed for personal use. Deployable on **Tencent Cloud EdgeOne Pages**, it gives you high-speed, direct access to the world's leading AI models (OpenAI, Anthropic Claude, DeepSeek, Google Gemini, Qwen, and more) with zero proxy requirements, built-in search tools, and natural voice interaction.

---

## Key Features

* **Direct Access Everywhere**: High-speed, stable connections across global and mainland networks without proxy configuration.
* **Modular Plugin & Tool Ecosystem**: Toggle specialized tools dynamically:
  - **Live Web Search** (AnySearch)
  - **Deep Web Extraction** (Firecrawl v2 for dynamic React and SPA sites)
  - **Semantic Scholar** (200M+ academic papers and citation graph)
  - **OpenAlex Knowledge Base** (250M+ global scientific works, DOI and open-access PDFs)
  - **Wikipedia Knowledge Base** (60M+ encyclopedia articles, concept definitions, and historical facts)
  - **Global News** (NewsAPI for 80,000+ international news outlets)
  - **Global Weather** (Open-Meteo real-time conditions and 7-day forecasts)
  - **GitHub Explorer** (Repository metrics, releases, issues, and trending discovery)
  - **Global Financial Market** (CoinGecko crypto, global fiat exchange rates, and US stock quotes)
  - **Code & Math Sandbox** (In-browser isolated sandbox for exact arithmetic, compound calculations, and algorithmic verification)
* **Native Image Generation Studio**: Choose image-capable models (e.g. gpt-image-2, FLUX) to morph the interface into an image creation studio with custom aspect ratios (1:1, 3:2, 2:3), rendering quality, transparent PNG backgrounds, and zero-cloud-trace IndexedDB local persistence.
* **Personalized Custom Instructions**: Tell the AI your background, favorite writing style, or preferred format so it automatically follows your preferences in every conversation.
* **Smart Long-Term Memory**: The AI remembers your enduring habits, ongoing projects, and background across conversations. You can easily review, click to modify, or clear your memories at any time in Settings.
* **Unified Thinking Process**: Collapsible timeline for reasoning models, presenting thoughts, tool calls, and final answers in a structured sequence.
* **Voice Read-Aloud & Dictation**: Listen to responses with natural neural voices or speak your prompt directly via speech-to-text.
* **Images, Documents & Code**: Drag-and-drop support for images, PDF files, and 40+ code file formats.
* **Real-Time Token Usage Metrics**: Transparent tracking of prompt, completion, and reasoning token consumption per conversational turn.
* **Progressive Web App (PWA) & Mobile APK**: Install directly to your home screen on iOS and Android with full-screen standalone experience, offline shell caching, or compile into a native Android APK via Capacitor.
* **Private & Safe**: Chat history is stored locally in your browser (IndexedDB). API keys are encrypted securely on the edge server and never exposed to the client.
* **Enterprise-Grade Access Governance**: Dedicated Admin Console (`admin.html`) backed by Tencent Cloud EdgeOne Key-Value (KV: `ZENMUX_CHAT`) storage and in-memory V8 isolate caching. Create, enable, or revoke user access tokens instantly with zero external database configuration.
* **Zero Infrastructure Cost**: Hosted on Tencent Cloud EdgeOne Pages serverless infrastructure.

---

## Quick Start & Deployment Guide

### 1. Fork or Clone this Repository
```bash
git clone https://github.com/xinasuka/zenmux-chat.git
```

### 2. Deploy on Tencent Cloud EdgeOne Pages
1. Log in to [Tencent Cloud EdgeOne](https://edgeone.ai/) (or EdgeOne International).
2. Create a Key-Value (KV) Namespace named `ZENMUX_CHAT` in EdgeOne Console and bind it to your Pages project with variable name `ZENMUX_CHAT`.
3. Navigate to **Pages** -> **New Project** -> Link your GitHub repository.
4. Configure the following **Environment Variables**:
   - `ADMIN_TOKEN`: Master secret password for accessing the `/admin.html` console to generate and manage user tokens.
   - `ZENMUX_API_KEY`: Your API Key from [ZenMux](https://zenmux.ai).
   - `ANYSEARCH_API_KEY` *(Optional)*: Your API Key from AnySearch for real-time web search.
   - `FIRECRAWL_API_KEY` *(Optional)*: Your API Key from [Firecrawl](https://firecrawl.dev) for deep React/SPA webpage extraction.
   - `FINNHUB_API_KEY` *(Optional)*: Your API Key from [Finnhub.io](https://finnhub.io) for US/global stock quotes.
   - `OPENALEX_API_KEY` *(Optional)*: For enhanced OpenAlex academic search rate limits.
   - `NEWSAPI_KEY` *(Optional)*: Your API Key from [NewsAPI.org](https://newsapi.org) for international breaking news.
   - `SEMANTIC_SCHOLAR_KEY` *(Optional)*: For enhanced Semantic Scholar search rate limits.
   - `GITHUB_TOKEN` *(Optional)*: For higher GitHub API rate limits.
5. Click **Deploy**.
6. Visit `https://<your-domain>/admin.html`, log in with your `ADMIN_TOKEN`, and issue access tokens for your users.

### 3. Mobile (Android & iOS)

* **Android App**: Download the pre-built, signed APK directly from [GitHub Releases](https://github.com/xinasuka/zenmux-chat/releases) and install it on your device.
* **Progressive Web App (PWA)**:
  - **iOS (Safari)**: Open your ZenChat URL, tap the **Share** icon, and select **Add to Home Screen** for a standalone, full-screen experience.
  - **Android (Chrome)**: Open the URL, tap the browser menu, and select **Install App** or **Add to Home Screen**.
* **Build from Source (Optional)**:
  ```bash
  npm run build:apk
  ```
  The compiled APK will be generated in `android/app/build/outputs/apk/debug/`.
  *(For in-depth ADB device testing, wireless debugging, and CI/CD signing workflows, see the [Architecture & Engineering Guide](design/design.md#16-android-native-app-architecture--release-pipeline).)*

---

<br>

<div align="center" id="中文说明">
  <h2>中文说明</h2>
  <p><b>轻量、优雅、零成本的个人 AI 聊天工作站</b></p>
</div>

**ZenMuxChat** 专为个人日常使用打造，基于 **腾讯云 EdgeOne Pages** 无服务器架构托管。无需代理工具，即可高速直连 ZenMux 聚合的全球顶尖 AI 模型（DeepSeek-V3/R1、Claude 3.7/3.5、GPT-4o/o1/o3、通义千问等）。

### 核心亮点

1. **高速直连**：腾讯云全球边缘节点加速，告别繁琐的网络代理配置。
2. **可插拔插件工具库**：支持随心开启或关闭专属扩展工具：
   - **实时全网搜索** (AnySearch)
   - **深度网页抓取** (Firecrawl v2 解析 React/SPA 动态站点)
   - **Semantic Scholar 文献检索** (检索 2 亿+ 论文与引用)
   - **OpenAlex 学术智库** (检索 2.5 亿+ 全球开放科研作品与 DOI)
   - **维基百科权威知识库** (Wikimedia 免 Key 检索 6,000 万+ 百科词条与概念定义)
   - **全球时事新闻** (NewsAPI 检索 80,000+ 国际权威媒体时事快讯)
   - **全球精准气象** (Open-Meteo 免 Key 实时天气与 7 日预报)
   - **GitHub 开源探索** (GitHub REST API 探索热门榜单、Star、Release 与技术栈)
   - **全球金融市场** (CoinGecko 加密货币、全球法定汇率换算与美股实时行情)
   - **代码与数学沙盒** (浏览器隔离沙盒免 Key 零延迟运行 JavaScript，验证高精度算术与算法推导)
3. **原生生图创作工作台**：切换至具有生图能力的大模型（如 gpt-image-2、FLUX）时，输入控制台自适应展开比例尺寸（1:1、3:2、2:3）、精度画质与透明背景设置；图片以二进制 Blob 原生持久化在浏览器 IndexedDB 中，秒开加载且完全不留云端存储痕迹。
4. **个性化设定 (Custom Instructions)**：告诉 AI 你的身份背景、常用偏好或期望的回答风格，AI 在每次对话中都会自动遵循。
5. **智能长期记忆 (Long-Term Memory)**：AI 会在聊天中自动记住关于你的重要习惯和背景，跨会话持续生效。你可以在设置中随时查看、点击直接修改或清空所有记忆。
6. **完整思考过程**：完整保留深度思考模型（如 DeepSeek-R1）在工具调用前后的完整思路与动作轨迹。
7. **双向语音交互**：支持自然语音朗读（可调节倍速与进度）以及麦克风语音实时转文字。
8. **多模态与文档解析**：支持图片上传、PDF 解析及 40+ 种常用编程语言与文档附件。
9. **Token 用量与消耗透明追踪**：每轮对话均支持直观查看 Prompt 输入、Completion 输出及深度推理的精确 Token 消耗指标。
10. **PWA 与 Android APK 原生编译**：支持一键添加到 iOS 与 Android 桌面作为独立全屏应用使用；同时内置 Capacitor 工具链，支持一行命令编译生成独立的 Android APK 安装包。
11. **多租户口令管理与后台**：内置基于腾讯云 EdgeOne 边缘键值存储（KV: `ZENMUX_CHAT`）的管理后台 (`admin.html`)，管理员可直接为不同使用者分配、禁用或删除访问口令，零外部数据库依赖。
12. **隐私与安全**：对话数据保存在本地浏览器中，API 密钥加密存放在边缘端，绝不泄露给前端。
13. **零服务器成本**：借助 EdgeOne Pages 免费额度，个人日常使用 0 服务器费用。

### 极速部署指南

1. **获取代码**：Fork 本项目到你的 GitHub 账户。
2. **创建 KV 命名空间**：在腾讯云 EdgeOne 控制台「边缘函数/边缘键值存储 KV」中创建命名空间 `ZENMUX_CHAT`，并在 Pages 项目中绑定变量名 `ZENMUX_CHAT`。
3. **连接 EdgeOne**：在 [腾讯云 EdgeOne 控制台](https://edgeone.ai/) 新建 Pages 项目并绑定该仓库。
4. **配置环境变量**：
   - `ADMIN_TOKEN`：管理员主控密码（用于登录 `/admin.html` 生成和管理用户口令）。
   - `ZENMUX_API_KEY`：[ZenMux.ai](https://zenmux.ai) 平台的 API Key。
   - `ANYSEARCH_API_KEY`（可选）：联网检索服务的 API Key。
   - `FIRECRAWL_API_KEY`（可选）：[Firecrawl](https://firecrawl.dev) 深度网页抓取服务的 API Key。
   - `FINNHUB_API_KEY`（可选）：[Finnhub.io](https://finnhub.io) 美股与股票行情 API Key。
   - `OPENALEX_API_KEY`（可选）：OpenAlex 学术检索 API Key。
   - `NEWSAPI_KEY`（可选）：[NewsAPI.org](https://newsapi.org) 新闻检索 API Key。
   - `SEMANTIC_SCHOLAR_KEY`（可选）：学术检索 API Key。
   - `GITHUB_TOKEN`（可选）：GitHub API Token。
5. **一键部署**：点击部署，完成首次构建。
6. **分配访问口令**：在浏览器中打开 `https://<你的域名>/admin.html`，输入 `ADMIN_TOKEN` 登录管理后台，为使用者生成访问口令，用户凭口令即可进入主站畅快使用。

### 移动端（Android 与 iOS）

* **Android 客户端**：前往 [GitHub Releases](https://github.com/xinasuka/zenmux-chat/releases) 下载官方签名的正式版安装包（APK）并在手机上直接安装。
* **渐进式 Web 应用 (PWA)**：
  - **iOS (Safari 浏览器)**：访问站点，点击分享按钮并选择「添加到主屏幕」即可作为全屏独立应用使用，永不过期。
  - **Android (Chrome 浏览器)**：访问站点，点击浏览器菜单选择「添加到主屏幕」或「安装应用」。
* **源码编译（可选）**：
  ```bash
  npm run build:apk
  ```
  编译完成的安装包生成于 `android/app/build/outputs/apk/debug/`。
  *(更多关于 ADB 调试、真机推流及自动化签名发布等开发者细节，请参阅 [架构与工程设计文档](design/design.md#16-android-native-app-architecture--release-pipeline)。)*

---

## License
Apache License 2.0. See [LICENSE](LICENSE) for details.
