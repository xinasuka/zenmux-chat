# ZenMux Chat（EdgeOne Pages 版）

国内不开代理、直接用浏览器聊 ZenMux 上的模型。前端静态页 + 边缘函数反代，API Key 不出服务端。

## 架构

```
浏览器（大陆，无代理）
   │  ① 跨境一跳，到腾讯自有境外节点
   ▼
EdgeOne Pages 边缘节点（中国香港 / 东京）
   │  ② 边缘函数读 Secret 环境变量，注入 Key
   ▼
zenmux.ai（Cloudflare）
```

第 ① 段走腾讯自有骨干，社区实测可达（港 ~100ms 移动 / ~250ms 非移动，东京 ~200ms 三网）。
第 ② 段是境外对境外，无障碍。

## 部署步骤

1. 注册 <https://edgeone.ai>（国际站，只需邮箱 + GitHub，不要信用卡/手机号）。
2. 控制台新建 Pages 项目 → Import a Git Repository，把本目录推到 GitHub 后导入。
   - 构建命令留空，输出目录填 `.`（根目录）。
3. **加速区域选 `全球可用区（不含中国大陆）`**，这样自定义域名免 ICP 备案。
4. **绑定你自己的域名**（必须，见下方"坑 1"）。
5. 项目设置 → 环境变量，加两条，**类型都选 Secret**：

   | 变量 | 说明 |
   |---|---|
   | `ZENMUX_API_KEY` | ZenMux 的 API Key |
   | `ACCESS_TOKEN` | 你自己编的访问口令，前端首次打开要填 |

6. 推代码触发构建，完成后用你的域名访问。

本地调试：

```bash
npm install -g edgeone
edgeone login
edgeone pages init      # 已含 edge-functions/ 与配置时可跳过
edgeone pages link      # 关联线上项目，同步环境变量
edgeone pages dev       # http://localhost:8088
```

## 已验证 / 未验证

**已验证（官方原文 + 第三方实机项目）：**

- EdgeOne Pages 的边缘函数支持 `fetch` + `ReadableStream` 透传 SSE；官方 Node Functions 文档给了 SSE 示例。
- 开源项目 `fbigun/edgeone-function-ai-api` 就是同一套路的 AI API 反代，实机跑通了流式，
  其做法是 `connectTimeout 10s / readTimeout 120s / writeTimeout 10s` + 响应头 `X-Accel-Buffering: no`。
  本项目的 `chat.js` 采用了同样的响应头。
- 环境变量支持 Secret 加密类型，通过 `context.env.xxx` 读取。

**未验证 / 有风险：**

- **边缘函数有 ~120s 墙钟上限。** 模型若超过 120s 不吐 token，连接会被掐断。
  缓解：别开超长深度思考；前端"停止"按钮可以随时中断重来。
- **边缘函数 CPU 时间 200ms/次**（不含 I/O 等待）。这里是纯转发，属 I/O 密集，不会撞限。
- Edge Functions 请求体上限 1MB，长对话上下文别塞太多。
- 国内到该边缘节点的**流式长连接**稳定性没有公开压测数据。静态首屏快 ≠ SSE 不卡。先小规模试。

## 坑

1. **默认 `*.edgeone.app` 域名从大陆访问会 401。** 官方文档明文：经项目域名/部署域名访问时，
   大陆网络环境必须用控制台生成的预览链接，有效期 3 小时，超时即 401。
   → 必须绑自定义域名。绑定后免备案，且不受该门禁限制。
2. 加速区域若选"中国大陆可用区"或"全球可用区"，自定义域名要 ICP 备案。不备案就选
   "全球可用区（不含中国大陆）"。
3. 若 `ACCESS_TOKEN` 不设置，函数在 URL 泄露时等于开放代理。**务必设置。**
4. 静态资源路由优先级高于边缘函数路由，别把静态文件放到 `api/` 路径下。

## 文件

```
index.html                    前端（无外部 CDN 依赖，可离线打开）
edge-functions/api/chat.js    SSE 反代
edge-functions/api/models.js  模型列表透传
```
