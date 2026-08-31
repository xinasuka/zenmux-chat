# ZenMux Chat

在 **EdgeOne Pages 国际版**（edgeone.ai）上跑的个人对话站：静态前端 + 边缘函数反代 ZenMux API。
目标效果——国内浏览器**不开代理**直接聊天，API Key 不出服务端，月成本 ¥0。

```
浏览器（大陆，无代理）
   │  ① 跨境一跳，到 EdgeOne 境外节点
   ▼
EdgeOne Pages 边缘函数（/api/chat）
   │  ② 注入 Secret 里的 Key，境外→境外
   ▼
zenmux.ai（Cloudflare）
```

---

## 一、前置条件（缺一不可）

| # | 需要 | 状态 | 说明 |
|---|---|---|---|
| 1 | EdgeOne 国际站账号 | ✅ 已注册 | edgeone.ai，非腾讯云国内站 |
| 2 | GitHub 账号 | ✅ 已有 | 用于托管代码、触发自动构建 |
| 3 | **一个自己的域名** | ⬜ **待确认** | **硬门槛，见下方说明** |
| 4 | ZenMux API Key | ⬜ 待获取 | zenmux.ai 控制台创建 |

### 为什么必须要有域名

EdgeOne Pages 官方域名文档（[Domain Management Overview](https://pages.edgeone.ai/document/domain-overview)）原文规定：

> 经**项目域名**和**部署域名**访问时，中国大陆网络环境必须使用系统生成的预览 URL，
> 链接有效期 3 小时，超时返回 **401**。非中国大陆网络环境可直接访问。

也就是说平台送的 `*.edgeone.app` 从大陆访问会 401，且预览链接 3 小时就失效。
官方文档紧接着给出建议：

> It is advisable to bind a custom domain to create a stable access channel.
> No ICP Filing Registration is required in **global availability zones (excluding Chinese mainland)**.

**绑定自定义域名 + 加速区域选"全球可用区（不含中国大陆）" → 免备案、不受 401 门禁限制。**

域名很便宜：`.xyz` / `.top` 首年通常十几元。已有任何闲置域名都可用，用一个子域名即可（如 `chat.你的域名.com`）。

---

## 二、部署步骤

### 第 1 步：拿到两个密钥

**ZenMux API Key** — 登录 zenmux.ai → 控制台 → API Keys → 创建，复制保存。

**访问口令 ACCESS_TOKEN** — 自己编一个（如 `MyChat2026!xK9`）。
它的作用是给你的 `/api/chat` 加一道锁：URL 一旦泄露，别人没有口令也用不了，不会变成免费开放代理。**强烈建议设置。**

### 第 2 步：GitHub 建仓库并推送 —— ✅ 已完成

仓库已建好并推送：

| 项 | 值 |
|---|---|
| 地址 | <https://github.com/xinasuka/zenmux-chat> |
| 可见性 | **Private（私有）** |
| 默认分支 | `main` |
| 已推送文件 | 9 个（前端 3 + 边缘函数 2 + 配置 4） |

本机 `gh` 已装在 `~/.workbuddy/binaries/gh/bin/gh`，并已写入 `~/.zshrc` 与 `~/.bash_profile` 的 PATH，
且已用 keyring 中的 `xinasuka` 账号完成登录（`gh auth status` 可查）。后续改动直接：

```bash
cd /Users/mac/WorkBuddy/2026-08-31-14-26-41/zenmux-chat
git add -A && git commit -m "说明" && git push
```

推送后 EdgeOne Pages 会自动重新构建。

> **注意**：仓库是私有的，EdgeOne Pages 第 3 步授权 GitHub 时，
> 必须选择 **Only select repositories** 并勾选 `zenmux-chat`，
> 且确认授权页出现了 "Private repository access" 权限项，否则平台读不到代码。

### 第 3 步：EdgeOne Pages 导入项目

1. 打开 <https://edgeone.ai> 并登录 → 进入 **Pages**（现也称 Makers）控制台
2. 点 **Create project** → **Import a Git Repository**
3. 首次会要求 GitHub 授权，同意并选择刚建的仓库（私有仓库也支持）
4. 构建配置页填写：

   | 字段 | 值 |
   |---|---|
   | Framework / 框架预设 | 留空或选 **Other** |
   | Build Command（构建命令） | **留空** |
   | Output Directory（输出目录） | **`.`**（一个点，表示仓库根目录） |
   | Install Command | 留空 |
   | Node Version | 留默认即可（无构建步骤，用不到） |

   > 这些值已写在仓库的 `edgeone.json` 里，控制台会自动读取；若显示不一致，以上表为准。

5. **Acceleration Region（加速区域）选 `Global availability zone (exclude Chinese mainland)`**
   —— 即"全球可用区（不含中国大陆）"。**这一步决定免备案，别选错。**
   选"中国大陆可用区"或"全球可用区"都会要求 ICP 备案。
6. 点 **Start deployment**，等构建完成（约 1 分钟）。
   **必须至少有一次成功部署**，否则后面绑域名会因无部署记录而返回 404。

### 第 4 步：绑定自定义域名（共 3 小步，缺一不可）

**4.0 复查加速区域**（决定要不要备案，事后改很麻烦）
项目页 → Settings，确认 Acceleration Region 是
`Global availability zone (exclude Chinese mainland)`。若不是，先改过来再重新部署。

**4.1 添加域名 + 所有权校验 + CNAME**

1. 项目页 → **Domain Management** → **Add custom domain**
2. 填入域名。**强烈建议用子域名**，如 `chat.example.com`（根域 CNAME 会与 MX 记录冲突）
3. 弹窗会给出**两条**需要去注册商添加的记录，**两条都加，别只加 CNAME**：

   | 顺序 | 类型 | 主机记录 / 记录名称 | 记录值 |
   |---|---|---|---|
   | ① | **TXT**（所有权校验） | EdgeOne 弹窗里 `Host` 字段去掉当前域名（例：EdgeOne 给 `edgeonereclaim.zenchat.cc.cd.` 当前域为 `zenchat.cc.cd`，则填 **`edgeonereclaim`**） | 复制弹窗里 `Value` 后面的整串 `reclaim-...`（**用拷按钮，别手敲**，长度 30+） |
   | ② | **CNAME** | 同上，去掉当前域名后的前缀 | 平台给的形如 `a4285573.xxxx.dns.edgeone.site.` |

   > 顺序无所谓，但**必须先加 TXT 并通过校验**，域名状态才会从 Pending 往前走。
   > 各家控制台"主机记录"字段叫法：DNSPod/腾讯云叫**记录名称**，阿里云叫**主机记录**，Cloudflare 叫**Name**——都是一个意思，只填**子域名前缀**（不要带当前域名、不要带 `@`、不要加根域）。
4. 回到控制台点 **Verify** / 等待状态变为 **Activated**。
   DNS 生效通常几分钟，最长 48 小时（TTL 决定）。

**4.2 申请 HTTPS 证书（⚠️ 平台不会自动发，必须手动点一次）**

官方文档原文：*"Makers does not automatically assign an HTTPS certificate to your domain."*
不配证书，`https://` 打不开。

1. 域名添加成功后 → 该域名的 **HTTPS configuration**
2. 选 **Apply for free certificate**（免费，TrustAsia / Let's Encrypt，RSA，**自动续期**）
3. 顺手打开 **Force HTTPS Access**（HTTP 301 跳 HTTPS）
4. 等证书签发部署（通常几分钟）

**4.3 验证解析是否生效**（在你自己的终端跑；本机沙箱 DNS 不可达，需你自己确认）

```bash
dig chat.example.com CNAME +short
# 应返回平台给的 CNAME 值

curl -sI https://chat.example.com | head -1
# 应返回 HTTP/2 200（或 200 OK）
```

### 第 5 步：配置环境变量（Secret）

项目页 → **Settings** → **Environment Variables**，添加两条。
**类型都选 Secret**（加密存储，不会出现在构建日志里）：

| 变量名 | 值 | 说明 |
|---|---|---|
| `ZENMUX_API_KEY` | 第 1 步的 Key | 上游 API 密钥 |
| `ACCESS_TOKEN` | 第 1 步自编口令 | 访问门禁，留空则接口完全公开 |

添加环境变量后**需要重新部署**才会生效：项目页 → 右上角 **Redeploy**（或推一次空 commit）。

### 第 6 步：打开使用

浏览器访问 `https://chat.example.com`：

1. 弹出"访问口令"框 → 填第 1 步自编的 `ACCESS_TOKEN` → 进入
   （若服务端未配置 `ACCESS_TOKEN`，留空直接点进入）
2. 顶部模型框会自动填充可选模型（数据来自 ZenMux），也可手动输入模型 ID
3. Enter 发送，Shift+Enter 换行

---

## 三、验证流式是否正常

**静态页能打开 ≠ 流式不卡**，必须单独验。在终端执行：

```bash
curl -N -s -X POST https://chat.example.com/api/chat \
  -H "Content-Type: application/json" \
  -H "X-Access-Token: 你的口令" \
  -d '{"model":"openai/gpt-5","messages":[{"role":"user","content":"从1数到30"}],"stream":true}' \
  | head -c 1500
```

- **正常**：token 一撮一撮持续往外冒
- **异常**：首字节等很久、或攒几秒一次性吐出 → 中间有缓冲，见下方排查

---

## 四、本地调试

本目录已初始化 git 并提交。本地看 UI（不含边缘函数）：

```bash
npm run dev        # 或 python3 -m http.server 8088
# 打开 http://localhost:8088
```

需要联调边缘函数（会真实读取线上环境变量）：

```bash
npm i -g edgeone
edgeone login
edgeone pages link    # 关联线上项目，同步环境变量
edgeone pages dev     # http://localhost:8088，前后端一体
```

> 注意：Edge Functions 有启动次数限制，别频繁重启 `dev`；函数内用 `console.log` 调试，日志直接输出到终端。

---

## 五、故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 打开首页 401 | 用的是 `*.edgeone.app` 默认域名 | 必须绑自定义域名，见第 4 步 |
| 口令框提示"口令不正确" | `ACCESS_TOKEN` 未配置或不一致 | 检查环境变量；环境变量改后要重新部署 |
| 提示"服务端未配置环境变量" | `ZENMUX_API_KEY` 没读到 | 确认变量名拼写、类型为 Secret、且已重新部署 |
| 模型列表为空 | Key 无效或 ZenMux 账户无额度 | 直接 curl `/api/models` 看原始返回 |
| 回复卡住不动、最后超时 | 边缘函数 120s 墙钟上限 | 别开超长深度思考；用"停止"中断重来 |
| token 攒几秒一次性吐出 | 网关缓冲了 SSE | 已加 `X-Accel-Buffering: no`；仍无效则考虑改用 Node Functions |
| 部署报构建失败 | 输出目录/构建命令填错 | 确认输出目录是 `.`，构建命令留空 |

---

## 六、已知限制（不粉饰）

1. **边缘函数 ~120s 墙钟上限**：模型若超过 120s 不吐 token，连接会被掐断。
2. **CPU 时间 200ms/次**（不含 I/O 等待）。本项目是纯转发，属 I/O 密集，不会撞限。
3. **请求体上限 1 MB**：超长对话上下文可能超限，前端已限制只回传最近 20 条消息。
4. **大陆到境外节点的 SSE 长连接稳定性没有公开压测数据**。首屏快 ≠ 流式不卡，
   这是本方案最大的未验证项，请按第三节实测。
5. 若 `ACCESS_TOKEN` 不设置，函数在 URL 泄露时等同于开放代理。

---

## 七、文件说明

```
index.html                    页面骨架（引用外部 CSS/JS，无 CDN 依赖）
styles.css                    样式，暗色主题，响应式
app.js                        全部前端逻辑：Markdown 渲染、SSE 流式读取、会话持久化
edge-functions/api/chat.js    边缘函数：SSE 反代，注入 Key，校验口令
edge-functions/api/models.js  边缘函数：模型列表透传
edgeone.json                  平台构建配置（无构建，输出根目录）
package.json                  项目元信息 + 本地预览脚本
.env.example                  环境变量模板（不含真实值）
```

路由说明：`edge-functions/api/chat.js` → `https://你的域名/api/chat`。
前端用 `X-Access-Token` 请求头传递口令，与上游的 `Authorization` 头互不干扰。
