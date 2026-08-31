# ZenMux Chat

基于 **腾讯云 EdgeOne Pages 国际版（edgeone.ai）** 构建的高性能个人 AI 对话工作站：**现代静态前端 + 客户端全模态解析引擎 + 边缘函数安全反代**。

实现国内网络环境**无需代理直连**访问 ZenMux 平台全量大模型（OpenAI / Anthropic / Gemini / DeepSeek / Qwen / LLaMA 等），API Key 严密封装于边缘端，本地 IndexedDB 存储，月度维护成本 **¥0**。

```
┌───────────────────────────┐         ① 跨境一跳直连 (免代理)         ┌────────────────────────────────┐
│   浏览器端 (中国大陆直连)   │ ─────────────────────────────────> │   EdgeOne Pages 境外边缘节点   │
│ ------------------------- │                                    │ ------------------------------ │
│ • 客户端 Canvas 图像压缩  │ <───────────────────────────────── │ • 校验 X-Access-Token 访问门禁 │
│ • 40+ 源码/PDF 文本提取   │           SSE 零缓冲流式响应        │ • 注入服务端 Secret API Key    │
│ • IndexedDB 会话持久化    │                                    └────────────────────────────────┘
│ • 双阶启发式智能会话命名  │                                                    │
└───────────────────────────┘                                                    │ ② 境外内网高速转发
                                                                                 ▼
                                                                 ┌────────────────────────────────┐
                                                                 │      zenmux.ai 聚合平台        │
                                                                 │ (GPT-4o/Claude/DeepSeek/Qwen)  │
                                                                 └────────────────────────────────┘
```

---

## 一、 为什么我们要这么做？（Design Rationale）

1. **解决跨境直连与网络阻断痛点**：
   ZenMux.ai 聚合了全球顶尖的商业与开源大模型，但在中国大陆常规网络环境下受阻。通过部署在 EdgeOne 国际版境外 Anycast 边缘节点，客户端发起一跳请求直达边缘节点，再由边缘节点同域转发至 ZenMux，**彻底摆脱了客户端代理工具的束缚**。
2. **核心资产安全隔离（API Key 永不落地）**：
   前端仅通过自定义访问口令（`ACCESS_TOKEN`）进行身份认证，ZenMux 的付费 `API_KEY` 仅存在于 EdgeOne 边缘加密 Secret 环境变量中，杜绝前端源码或抓包泄露风险。
3. **极致的零运维与零成本（Serverless & Local-First）**：
   - **计算前置（Client-Side Compute）**：图像重采样、PDF 解析、代码提取、Markdown 渲染与智能命名全部在用户本地浏览器完成，不消耗服务端任何昂贵算力；
   - **存储本地化（Local-First DB）**：对话历史与附件全量保存在本机的 `IndexedDB` 中，隐私安全且无需付费云数据库。

---

## 二、 核心技术架构与实现特性

### 1. 客户端多模态与文件解析引擎 (`app.js`)
* **图像智能降采样与压缩（`ImageProcessor`）**：
  在客户端利用 HTML5 Canvas 2D 进行自适应双线性插值压缩（最大边长限制 1600px，JPEG 质量 0.82），将 5~15MB 原始高清图片无损压缩至 80~250KB，**完美规避边缘函数 1MB 请求体硬上限**；
* **代码与文档就地文本提取（`FileTextExtractor`）**：
  - **40+ 种格式原生毫秒级秒读**：涵盖 `.py`, `.js`, `.ts`, `.go`, `.rs`, `.java`, `.c`, `.cpp`, `.sh`, `.sql`, `.json`, `.csv`, `.yaml`, `.xml`, `.log`, `.md` 等；
  - **PDF 按需分页解析**：动态按需加载 PDF.js 提取纯文本内容；
  - **上下文语义注入（In-Context Injection）**：以标准 Markdown 围栏隔离注入 Prompt，**让所有大模型（即使上游不支持文件多模态）均可直接分析代码与长文档**；
* **Token 容量防御安全阀**：
  单文件上限 10 万字符（约 2.5~3 万 Token），超出部分平滑截断并附加提示，防止撑爆大模型 Context Window。

### 2. 双阶智能命名与内联交互
* **零额外 API 消耗的会话命名（`TitleExtractor`）**：
  - **阶段 1（首问即时去噪）**：自动清洗「请问」、「帮我写一个」等前缀助词，结合附件名初拟标题；
  - **阶段 2（首轮回复嗅探）**：AI 流式生成完毕后，本地正则抓取 AI 回复中的 Markdown 标题（`# 标题`）或加粗主题（`**主题**`）自动润色；
* **侧边栏内联编辑**：
  悬停显示精美线性 SVG 按钮，支持双击标题或点击修改按钮原地呼出输入框，修改即刻同步至 IndexedDB。

### 3. AnySearch 实时联网检索与引用溯源 (`AnySearchService` & `/api/search.js`)
* **全模型无缝联网（Model-Agnostic RAG）**：
  无需依赖特定模型的内置工具调用，一键让 DeepSeek、Qwen、Claude、GPT 等全平台模型获得实时全网检索能力；
* **极低 Token 消耗与精炼注入**：
  提取清洗后的高密度 Snippet 摘要构建隔离 Grounding 上下文，较原生网页抓取降低 **80%+ Prompt Token 成本**；
* **精美溯源 UI**：
  回答气泡中自适应渲染 `<details class="msg-sources">` 引用来源卡片，展示网页 Favicon/域名标签、标题与直达外链。

### 4. 高性能异步存储引擎 (`ZenMuxDB`)
* 基于浏览器原生 **IndexedDB**（数据库：`ZenMuxChatDB`，对象仓库：`conversations`）；
* 突破传统 `localStorage` 5MB 配额限制，支持海量历史会话、长文与图片数据的流畅存储与毫秒级索引。

### 5. 边缘流式中继与安全网关 (`edge-functions/api/`)
* **零缓冲流式传输（True SSE Streaming）**：
  边缘函数基于 Web Streams API 实现 `ReadableStream` 零拷贝透传，并注入 `X-Accel-Buffering: no` 响应头，确保 Token 实时逐字输出；
* **安全密钥托管**：
  ZenMux 与 AnySearch 的 API Key 均托管于边缘端 Secret 环境变量，前端仅需验证 `X-Access-Token` 统一访问门禁。

---

## 三、 快速部署指南

### 前置准备
1. **EdgeOne 国际站账号**：注册于 [edgeone.ai](https://edgeone.ai)（非腾讯云国内站）；
2. **GitHub 账号与代码仓库**：Fork 或推送本项目；
3. **自定义域名**：准备一个二级域名（如 `chat.yourdomain.com`），**免备案且无 401 限制**；
4. **ZenMux API Key**：在 [zenmux.ai](https://zenmux.ai) 控制台生成。

---

### 部署步骤

#### 第 1 步：导入 EdgeOne Pages 项目
1. 登录 [edgeone.ai 控制台](https://edgeone.ai) → 进入 **Pages**（或 **Makers**）；
2. 点击 **Create project** → **Import a Git Repository** → 选择本仓库；
3. 构建配置填入：
   - **Framework Preset**: 留空或选择 `Other`
   - **Build Command**: 留空
   - **Output Directory**: `.`（一个英文点，表示项目根目录）
4. **Acceleration Region（加速区域）务必选择 `Global availability zone (exclude Chinese mainland)`**
   > ⚠️ **极为重要**：选择“全球可用区（不含中国大陆）”**完全免 ICP 备案**。
5. 点击 **Start deployment** 完成初次构建。

#### 第 2 步：绑定自定义域名与申请 SSL 证书
1. 进入项目页 → **Domain Management** → **Add custom domain**；
2. 填入您的二级域名（如 `chat.yourdomain.com`）；
3. 在域名解析服务商（Cloudflare / DNSPod / 阿里云等）添加 EdgeOne 给出的 **两项解析记录**：
   - **TXT 记录**（用于域名所有权校验）
   - **CNAME 记录**（用于流量接入调度）
4. 校验通过后，在域名列表点击 **HTTPS configuration** → 选择 **Apply for free certificate**（免费自动续期证书）并开启 **Force HTTPS Access**。

#### 第 3 步：配置环境变量（Secrets）
进入项目页 → **Settings** → **Environment Variables**，添加以下加密变量：

| 变量名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `ZENMUX_API_KEY` | **Secret** | 在 zenmux.ai 获取的大模型 API 密钥 |
| `ACCESS_TOKEN` | **Secret** | 自行设定的前端访问口令（防止接口被盗刷） |
| `ANYSEARCH_API_KEY` | **Secret** | *(可选)* 在 anysearch.com 获取的检索密钥，用于开启实时全网联网搜索 |

添加完成后，点击项目右上角 **Redeploy** 重新部署以使变量生效。

---

## 四、 本地开发与联调

由于本项目前端为零依赖纯静态架构，可直接启动本地服务器：

```bash
# 方式 1：Node 本地预览
npm run dev

# 方式 2：Python 快速服务
python3 -m http.server 8088
```

如需在本地同时模拟 EdgeOne 边缘函数环境，可安装官方 CLI：
```bash
npm i -g edgeone
edgeone login
edgeone pages link
edgeone pages dev
```

---

## 五、 工程边界与注意事项 (Engineering Guardrails)

| 维度 | 限制与边界 | 应对与保障机制 |
| :--- | :--- | :--- |
| **边缘函数请求体上限** | 单次 POST 请求体约为 **1MB ~ 2MB** | 客户端 Canvas 自动将图片采样压缩至 200KB 内，保证多图请求依然稳健 |
| **函数执行生命周期** | Edge Functions 最长单次连接为 **120 秒** | 避免开启超长推理耗时任务，支持前端随时点击「■ 停止」中断流式 |
| **域名访问限制** | EdgeOne 默认赠送的 `*.edgeone.app` 在大陆访问会触发 401 限制 | 绑定免备案自定义域名并开启全球加速（不含大陆区）彻底解决 |
| **大模型上下文窗口** | 超大文件注入可能耗尽 Token 配额 | `FileTextExtractor` 设立 10 万字符防御性截断机制 |

---

## 六、 仓库目录结构

```text
├── index.html                  # 页面结构骨架、附件托盘与联网检索开关
├── styles.css                  # 现代化极简暗色主题、来源卡片与响应式布局样式
├── app.js                      # 核心引擎：IndexedDB 存储、Canvas 压缩、AnySearch 检索与流式控制
├── edge-functions/
│   └── api/
│       ├── chat.js             # 边缘对话函数：鉴权校验、密钥注入与 SSE 零拷贝转发
│       ├── models.js           # 边缘模型函数：ZenMux 可用模型元数据安全代理
│       └── search.js           # 边缘检索函数：AnySearch 搜索引擎安全代理与鉴权中继
├── edgeone.json                # EdgeOne Pages 部署构建规范描述文件
├── package.json                # 项目元数据与开发命令
└── .env.example                # 环境变量配置模板参考
```
