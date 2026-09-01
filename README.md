<div align="center">
  <img src="./icon.png" width="96" height="96" alt="ZenMux Chat Logo" style="border-radius: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.15);">
  <h1>ZenMux Chat</h1>
  <p><b>A fast, beautiful, and private AI chat assistant powered by ZenMux & Tencent Cloud EdgeOne</b></p>
  <p>
    <a href="#-quick-start">Quick Start</a> •
    <a href="#-key-features">Features</a> •
    <a href="#-deployment-guide">Deploy</a> •
    <a href="#中文说明">中文说明</a>
  </p>
</div>

---

## ✨ Overview

**ZenMux Chat** is a lightweight, all-in-one AI chat workstation designed for personal use. Deployable for free on **Tencent Cloud EdgeOne Pages**, it gives you high-speed, direct access to the world's best AI models (OpenAI, Anthropic Claude, DeepSeek, Google Gemini, Qwen, and more) with **zero proxy requirements**, **built-in web search**, and **natural voice interaction**.

---

## 🚀 Key Features

* ⚡ **Direct Access Everywhere**: Fast, stable connections without needing any VPN or proxy tools.
* 🔌 **Modular Plugin & Tool Ecosystem**: Toggle specialized tools on the fly:
  - 🔍 **Live Web Search** (AnySearch)
  - 📄 **Deep Web Extraction** (Firecrawl v2 for dynamic React/SPA sites)
  - 🎓 **Semantic Scholar** (200M+ academic papers & citation graph)
  - 📚 **OpenAlex Knowledge Base** (250M+ global scientific works, DOI & open-access PDFs)
  - 📰 **Global News** (NewsAPI for 80,000+ international news outlets)
  - 🌤️ **Global Weather** (Open-Meteo real-time & 7-day forecasts)
  - 💻 **GitHub Explorer** (Repository metrics, releases & README inspection)
* 🧠 **Unified Thinking Process**: Beautiful collapsible thinking timeline for reasoning models, showing thoughts, search, and page extraction steps together.
* 🎙️ **Voice Read-Aloud & Dictation**: Listen to responses with natural neural voices (with speed controls) or speak your prompt directly.
* 📎 **Images, Documents & Code**: Drag-and-drop support for images, PDF files, and 40+ code file formats.
* 🔒 **Private & Safe**: Your chat history is stored locally in your browser (IndexedDB). Your API keys are encrypted securely on the edge server and never exposed to the browser.
* 💰 **100% Free Hosting**: Hosted on Tencent Cloud EdgeOne Pages with zero monthly infrastructure cost.

---

## 🛠️ Quick Start & 3-Minute Deployment

### 1. Fork or Clone this Repository
```bash
git clone https://github.com/xinasuka/zenmux-chat.git
```

### 2. Deploy on Tencent Cloud EdgeOne Pages
1. Log in to [Tencent Cloud EdgeOne](https://edgeone.ai/) (or EdgeOne International).
2. Go to **Pages** $\rightarrow$ **New Project** $\rightarrow$ Link your GitHub repository.
3. Configure the following **Environment Variables**:
   - `ACCESS_TOKEN`: A private password of your choice to protect your chat site (e.g. `mysecret123`).
   - `ZENMUX_API_KEY`: Your API Key from [ZenMux](https://zenmux.ai).
   - `ANYSEARCH_API_KEY` *(Optional)*: Your API Key from AnySearch for real-time web search.
   - `FIRECRAWL_API_KEY` *(Optional)*: Your API Key from [Firecrawl](https://firecrawl.dev) for deep React/SPA webpage extraction.
   - `OPENALEX_API_KEY` *(Optional)*: For enhanced OpenAlex academic search rate limits.
   - `NEWSAPI_KEY` *(Optional)*: Your API Key from [NewsAPI.org](https://newsapi.org) for international breaking news.
   - `SEMANTIC_SCHOLAR_KEY` *(Optional)*: For enhanced Semantic Scholar search rate limits.
   - `GITHUB_TOKEN` *(Optional)*: For higher GitHub API rate limits.
4. Click **Deploy**. Your personal AI assistant is live!

---

## 🎨 Clean & Modern Experience

* **Responsive Design**: Comfortable experience across desktop, tablet, and mobile browsers.
* **Anthropic-Style Theme**: Switch easily between Dark Mode and warm Paper Light Mode.
* **Token Usage Counter**: Track token usage for each conversation turn.
* **One-Click Export**: Copy responses in clean Markdown format with one click.

---

<br>

<div align="center" id="中文说明">
  <h2>🌟 中文说明</h2>
  <p><b>轻量、优雅、零成本的个人 AI 聊天工作站</b></p>
</div>

**ZenMux Chat** 专为个人日常使用打造，基于 **腾讯云 EdgeOne Pages** 免费无服务器架构托管。无需科学上网工具，即可在境内外网络高速直连 ZenMux 聚合的全球顶尖 AI 模型（DeepSeek-V3/R1、Claude 3.7/3.5、GPT-4o/o1/o3、通义千问等）。

### 核心亮点

1. 🌐 **高速直连**：腾讯云全球边缘节点加速，告别繁琐的网络代理配置。
2. 🔌 **可插拔插件工具库**：支持随心开启或关闭专属扩展工具：
   - 🔍 **实时全网搜索** (AnySearch)
   - 📄 **深度网页抓取** (Firecrawl v2 解析 React/SPA 动态站点)
   - 🎓 **Semantic Scholar 文献检索** (检索 2 亿+ 论文与引用)
   - 📚 **OpenAlex 学术智库** (检索 2.5 亿+ 全球开放科研作品与 DOI)
   - 📰 **全球时事新闻** (NewsAPI 检索 80,000+ 国际权威媒体时事快讯)
   - 🌤️ **全球精准气象** (Open-Meteo 免 Key 实时天气与 7 日预报)
   - 💻 **GitHub 开源探索** (GitHub REST API 探索 Star、Release 与技术栈)
3. 🧠 **完整思考过程**：完整保留深度思考模型（如 DeepSeek-R1）在工具调用前后的完整思路与动作轨迹。
4. 🎙️ **双向语音交互**：支持自然语音朗读（可调节倍速与进度）以及麦克风语音实时转文字。
5. 📎 **多模态与文档解析**：支持图片上传、PDF 解析及 40+ 种常用编程语言与文档附件。
6. 🔒 **隐私与安全**：对话数据保存在本地浏览器中，API 密钥加密存放在边缘端，绝不泄露给前端。
7. 💰 **永久零成本**：借助 EdgeOne Pages 免费额度，个人日常使用 0 服务器费用。

### 极速部署指南

1. **获取代码**：Fork 本项目到你的 GitHub 账户。
2. **连接 EdgeOne**：在 [腾讯云 EdgeOne 控制台](https://edgeone.ai/) 新建 Pages 项目并绑定该仓库。
3. **配置环境变量**：
   - `ACCESS_TOKEN`：你的专属访问密码（打开网页时输入验证）。
   - `ZENMUX_API_KEY`：[ZenMux.ai](https://zenmux.ai) 平台的 API Key。
   - `ANYSEARCH_API_KEY`（可选）：联网检索服务的 API Key。
   - `FIRECRAWL_API_KEY`（可选）：[Firecrawl](https://firecrawl.dev) 深度网页抓取服务的 API Key。
   - `OPENALEX_API_KEY`（可选）：OpenAlex 学术检索 API Key。
   - `NEWSAPI_KEY`（可选）：[NewsAPI.org](https://newsapi.org) 新闻检索 API Key。
   - `SEMANTIC_SCHOLAR_KEY`（可选）：学术检索 API Key。
   - `GITHUB_TOKEN`（可选）：GitHub API Token。
4. **一键部署**：点击部署，稍等 1 分钟即可拥有属于你自己的个人 AI 工作站！

---

## 📄 License
MIT License © 2026 ZenMux Chat
