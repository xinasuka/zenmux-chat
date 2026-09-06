// cloud-functions/api/images.js
// 在 EdgeOne Cloud Functions (云函数容器沙箱) 上反向代理 ZenMux 的 images/generations 接口。
// 运行于中心机房 Node.js 22 容器环境，享有 300 秒超长物理时限，从容支撑 2K 高清扩散与漫长去噪过程。
// 客户端向此接口发送生图请求，API Key 安全保存在服务端环境变量中。

const UPSTREAM_OPENAI = 'https://zenmux.ai/api/v1/images/generations';
const UPSTREAM_VERTEX_BASE = 'https://zenmux.ai/api/vertex-ai/v1/publishers';

const VERTEX_PROVIDERS = new Set([
  'bfl',
  'klingai',
  'qwen',
  'bytedance',
  'google',
  'tencent',
  'z-ai',
  'sapiens-ai',
  'meta',
  'x-ai',
]);

const KNOWN_PROVIDER_PREFIXES = {
  kling: 'klingai',
  qwen: 'qwen',
  seedream: 'bytedance',
  doubao: 'bytedance',
  flux: 'bfl',
  glm: 'z-ai',
  hy: 'tencent',
  hunyuan: 'tencent',
  agnes: 'sapiens-ai',
  gemini: 'google',
  imagen: 'google',
  gpt: 'openai',
  dall: 'openai',
  muse: 'meta',
  grok: 'x-ai',
};

function normalizeModelIdentifier(rawModel) {
  if (!rawModel) return 'openai/gpt-image-2';
  const trimmed = String(rawModel).trim();
  if (trimmed.includes('/')) return trimmed;

  const lower = trimmed.toLowerCase();
  for (const [prefix, provider] of Object.entries(KNOWN_PROVIDER_PREFIXES)) {
    if (lower.startsWith(prefix) || lower.includes(prefix)) {
      return `${provider}/${trimmed}`;
    }
  }
  return trimmed;
}

function isGoogleGeminiModel(modelId) {
  if (!modelId) return false;
  return /gemini/i.test(modelId);
}

function isVertexModel(modelId) {
  if (!modelId) return false;
  if (isGoogleGeminiModel(modelId)) return true;
  const provider = modelId.split('/')[0].toLowerCase();
  return VERTEX_PROVIDERS.has(provider);
}

function extractImageFromResponse(parsed, defaultPrompt = '') {
  if (!parsed || typeof parsed !== 'object') return [];
  const images = [];
  const seenUrls = new Set();
  const seenB64Prefixes = new Set();

  const pushItem = (item, revised = '') => {
    if (!item) return;

    // 1. Direct string handling (URL or base64)
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        if (!seenUrls.has(trimmed)) {
          seenUrls.add(trimmed);
          images.push({ url: trimmed, revised_prompt: revised || defaultPrompt });
        }
      } else {
        const cleanB64 = trimmed.replace(/^data:image\/[a-z]+;base64,/i, '').replace(/\s+/g, '');
        const prefix = cleanB64.slice(0, 32);
        if (cleanB64.length > 50 && !seenB64Prefixes.has(prefix)) {
          seenB64Prefixes.add(prefix);
          images.push({ b64_json: cleanB64, revised_prompt: revised || defaultPrompt });
        }
      }
      return;
    }

    if (typeof item !== 'object') return;

    // 2. String representation inside image property
    if (typeof item.image === 'string') {
      pushItem(item.image, revised || item.revised_prompt || item.revisedPrompt || item.prompt);
      return;
    }

    // 3. Exhaustive Base64 extraction across all vendor conventions
    const b64 =
      item.b64_json ||
      item.bytesBase64Encoded ||
      item.binary_data_base64 ||
      item.imageBytes ||
      item.image_bytes ||
      item.b64_image ||
      (item.image && (item.image.imageBytes || item.image.image_bytes || item.image.b64_json || item.image.bytesBase64Encoded || item.image.binary_data_base64)) ||
      (item.inlineData && item.inlineData.data) ||
      (item.inline_data && item.inline_data.data);

    // 4. Exhaustive URL extraction (including gcsUri, uri, imageUrl, image_url)
    const url =
      item.url ||
      item.gcsUri ||
      item.gcs_uri ||
      item.uri ||
      item.imageUrl ||
      item.image_url ||
      (item.image && (item.image.url || item.image.gcsUri || item.image.uri || item.image.imageUrl));

    const revisedPrompt = item.revised_prompt || item.revisedPrompt || item.prompt || revised || defaultPrompt;

    if (b64) {
      const cleanB64 = String(b64).replace(/^data:image\/[a-z]+;base64,/i, '').replace(/\s+/g, '');
      const prefix = cleanB64.slice(0, 32);
      if (cleanB64.length > 50 && !seenB64Prefixes.has(prefix)) {
        seenB64Prefixes.add(prefix);
        images.push({ b64_json: cleanB64, revised_prompt: revisedPrompt });
      }
    } else if (url) {
      const trimmedUrl = String(url).trim();
      if (trimmedUrl && !seenUrls.has(trimmedUrl)) {
        seenUrls.add(trimmedUrl);
        images.push({ url: trimmedUrl, revised_prompt: revisedPrompt });
      }
    }
  };

  // Upstream prediction structures
  if (Array.isArray(parsed.predictions)) {
    parsed.predictions.forEach((p) => pushItem(p));
  }

  const genImgs = parsed.generatedImages || parsed.generated_images;
  if (Array.isArray(genImgs)) {
    genImgs.forEach((p) => pushItem(p));
  }

  if (Array.isArray(parsed.candidates)) {
    parsed.candidates.forEach((cand) => {
      const parts = (cand.content && cand.content.parts) || [];
      let textDesc = '';
      parts.forEach((part) => {
        if (part.text) {
          textDesc = part.text.trim();
        }
      });
      parts.forEach((part) => {
        if (part.inlineData && part.inlineData.data) {
          pushItem(part.inlineData.data, textDesc);
        } else if (part.inline_data && part.inline_data.data) {
          pushItem(part.inline_data.data, textDesc);
        }
      });
    });
  }

  if (Array.isArray(parsed.data)) {
    parsed.data.forEach((p) => pushItem(p));
  }

  if (Array.isArray(parsed.images)) {
    parsed.images.forEach((p) => pushItem(p));
  }

  // Alibaba DashScope / Qwen Wanx structures
  if (parsed.output && typeof parsed.output === 'object') {
    if (Array.isArray(parsed.output.results)) {
      parsed.output.results.forEach((p) => pushItem(p));
    }
    if (Array.isArray(parsed.output.images)) {
      parsed.output.images.forEach((p) => pushItem(p));
    }
    if (typeof parsed.output.url === 'string') {
      pushItem(parsed.output.url);
    }
  }

  // Kling AI task_result structures
  if (parsed.task_result && typeof parsed.task_result === 'object') {
    if (Array.isArray(parsed.task_result.images)) {
      parsed.task_result.images.forEach((p) => pushItem(p));
    }
  }

  // Generic result container structures
  if (parsed.result && typeof parsed.result === 'object') {
    if (Array.isArray(parsed.result.images)) {
      parsed.result.images.forEach((p) => pushItem(p));
    }
    if (Array.isArray(parsed.result.data)) {
      parsed.result.data.forEach((p) => pushItem(p));
    }
    if (typeof parsed.result.url === 'string') {
      pushItem(parsed.result.url);
    }
  }

  // Deep recursive fallback if primary structural matching found nothing
  if (images.length === 0) {
    const scanObject = (obj, depth = 0) => {
      if (!obj || depth > 5) return;
      if (typeof obj === 'string') {
        const str = obj.trim();
        if (str.startsWith('https://') || str.startsWith('http://')) {
          if (/\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(str) || /(storage\.googleapis|dashscope|kling|byteimg|myqcloud|volces|zenmux)/i.test(str)) {
            pushItem(str);
          }
        } else if (str.length > 200 && /^[A-Za-z0-9+/=]+$/.test(str.replace(/\s+/g, ''))) {
          pushItem(str);
        }
        return;
      }
      if (Array.isArray(obj)) {
        obj.forEach((child) => scanObject(child, depth + 1));
      } else if (typeof obj === 'object') {
        for (const k of Object.keys(obj)) {
          scanObject(obj[k], depth + 1);
        }
      }
    };
    scanObject(parsed);
  }

  return images;
}

function mapSizeToAspectRatio(size) {
  if (!size || size === 'auto' || size === '1024x1024' || size === '1k' || size === '2k') {
    return '1:1';
  }
  if (size === '1536x1024' || size === '3:2') return '3:2';
  if (size === '1024x1536' || size === '2:3') return '2:3';
  if (size === '16:9') return '16:9';
  if (size === '9:16') return '9:16';
  if (size === '4:3') return '4:3';
  if (size === '3:4') return '3:4';
  if (size === '21:9') return '21:9';
  return '1:1';
}


const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, X-Access-Token, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  // legacy 重定向：将 GET 请求无缝引导至高吞吐 Anycast 边缘流式函数 /api/image-stream
  const { request } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get('url');
  if (!target) {
    return json({ error: '缺少有效的 url 参数' }, 400);
  }
  return new Response(null, {
    status: 307,
    headers: {
      ...CORS,
      Location: `/api/image-stream?url=${encodeURIComponent(target)}`,
    },
  });
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const apiKey = env.ZENMUX_API_KEY ? String(env.ZENMUX_API_KEY).trim() : '';
    if (!apiKey) {
      return json({ error: '服务端未配置环境变量 ZENMUX_API_KEY' }, 500);
    }

    // 统一门禁鉴权：通过 EdgeOne KV (ZENMUX_CHAT) 校验 8 位用户口令
    const token = (request.headers.get('X-Access-Token') || '').trim();
    if (!token) {
      return json({ error: '未提供访问口令 (X-Access-Token)' }, 401);
    }
    const kv = (env && env.ZENMUX_CHAT) || (env && env.ZENMUX_KV);
    if (!kv) {
      return json({ error: '服务端未绑定 ZENMUX_CHAT KV 命名空间' }, 500);
    }
    const user = await kv.get(`user:${token}`, { type: 'json' }).catch(() => null);
    if (!user || user.status !== 'active') {
      return json({ error: '访问口令无效或已被禁用' }, 401);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return json({ error: '请求体不是合法 JSON' }, 400);
    }

    if (!payload || !payload.prompt || !String(payload.prompt).trim()) {
      return json({ error: '缺少必需的 prompt 参数' }, 400);
    }

    const model = normalizeModelIdentifier(payload.model || 'openai/gpt-image-2');
    const isGemini = isGoogleGeminiModel(model);
    const isVertex = isVertexModel(model);
    const isGptModel = /^(openai\/|gpt-|dall-e)/i.test(model);

    const acceptsSse = Boolean(request.headers.get('Accept') && request.headers.get('Accept').includes('text/event-stream'));

    const doFetchUpstream = async () => {
      // 1. 针对 Google Vertex AI 生态模型进行动态路由与协议转换
      if (isVertex) {
        let vertexUrl = '';
        let vertexBody = null;

        if (isGemini) {
          // Google Gemini Banana 模型 (gemini-2.5-flash-image, gemini-3.1-flash-lite-image 等)
          // 依据 ZenMux 官方规范，必须调用 generateContent 接口并声明 responseModalities: ['TEXT', 'IMAGE']
          const geminiModelName = model.includes('/') ? model.split('/').slice(1).join('/') : model;
          vertexUrl = `${UPSTREAM_VERTEX_BASE}/google/models/${geminiModelName}:generateContent`;
          vertexBody = {
            contents: [
              {
                role: 'user',
                parts: [{ text: String(payload.prompt).trim() }],
              },
            ],
            generationConfig: {
              responseModalities: ['TEXT', 'IMAGE'],
            },
          };
        } else {
          // 非 Google 扩散模型 (Kling, Qwen, Flux, ByteDance Seedream 等) 调用 predict 接口
          const parts = model.split('/');
          const provider = parts.length > 1 ? parts[0] : (KNOWN_PROVIDER_PREFIXES[model.toLowerCase()] || 'google');
          const modelName = parts.length > 1 ? parts.slice(1).join('/') : model;
          vertexUrl = `${UPSTREAM_VERTEX_BASE}/${provider}/models/${modelName}:predict`;

          const parameters = {
            sampleCount: payload.n ? Math.max(1, Math.min(Number(payload.n) || 1, 4)) : 1,
            outputOptions: {
              mimeType: 'image/png',
            },
          };

          const ratio = mapSizeToAspectRatio(payload.size);
          if (ratio) {
            parameters.aspectRatio = ratio;
          }

          if (payload.size && payload.size !== 'auto') {
            if (payload.size === '2k' || payload.size.includes('2048')) {
              parameters.sampleImageSize = '2K';
            } else if (payload.size === '1k' || payload.size === '1024x1024') {
              parameters.sampleImageSize = '1K';
            }
            parameters.imageSize = payload.size;
          }

          if (payload.quality && payload.quality !== 'auto') {
            parameters.quality = payload.quality;
          }

          vertexBody = {
            instances: [{ prompt: String(payload.prompt).trim() }],
            parameters,
          };
        }

        let upstream = await fetch(vertexUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'User-Agent': 'ZenMux-Chat-Cloud/2.14 (contact@zenmux.ai)',
          },
          body: JSON.stringify(vertexBody),
        });

        let status = upstream.status;
        let text = await upstream.text();

        // 自主参数降级：若非 Google 模型因参数冲突返回 400/422，立即用纯净基线参数自动重试
        if (!isGemini && (status === 400 || status === 422)) {
          try {
            const baselineBody = {
              instances: [{ prompt: String(payload.prompt).trim() }],
              parameters: {
                sampleCount: 1,
              },
            };
            const retryRes = await fetch(vertexUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
                'User-Agent': 'ZenMux-Chat-Cloud/2.14 (contact@zenmux.ai)',
              },
              body: JSON.stringify(baselineBody),
            });
            if (retryRes.ok) {
              status = retryRes.status;
              text = await retryRes.text();
            }
          } catch (_) {}
        }

        // 容灾回退：若 Vertex AI 返回 404 (如 model_not_supported)，自动回退至 OpenAI Images 接口重试
        if (status === 404 && text.includes('model_not_supported')) {
          try {
            const fallbackRes = await fetch(UPSTREAM_OPENAI, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
                'User-Agent': 'ZenMux-Chat-Cloud/2.14 (contact@zenmux.ai)',
              },
              body: JSON.stringify({
                model,
                prompt: String(payload.prompt).trim(),
              }),
            });
            if (fallbackRes.ok) {
              status = fallbackRes.status;
              text = await fallbackRes.text();
            }
          } catch (_) {}
        }

        // 全能归一化：提取任意上游结构生成的图像 URL 或 Base64，即刻返回，不阻塞等待二进制下载
        if (status >= 200 && status < 300) {
          try {
            const parsed = JSON.parse(text);
            const images = extractImageFromResponse(parsed, String(payload.prompt).trim());
            if (images.length > 0) {
              text = JSON.stringify({ data: images });
            } else {
              status = 502;
              text = JSON.stringify({
                error: '上游图像生成服务未返回可识别的图像数据',
                detail: text,
              });
            }
          } catch (_) {}
        }

        return { status, text };
      }

      // 2. 针对 OpenAI / xAI / Meta 等原生 OpenAI Images 接口模型
      const forwardBody = {
        model,
        prompt: String(payload.prompt).trim(),
      };

      if (payload.n) {
        forwardBody.n = Math.max(1, Math.min(Number(payload.n) || 1, 4));
      }

      if (isGptModel) {
        // OpenAI GPT Image models support pixel sizes, quality, background, output_format
        if (payload.size && payload.size !== 'auto') {
          forwardBody.size = payload.size;
        }
        if (payload.quality && payload.quality !== 'auto') {
          forwardBody.quality = payload.quality;
        }
        if (payload.background && payload.background !== 'auto') {
          forwardBody.background = payload.background;
        }
        if (payload.output_format && payload.output_format !== 'auto') {
          forwardBody.output_format = payload.output_format;
        }
      } else {
        // Non-GPT models on OpenAI endpoint (e.g. Grok, Muse) expect 1k/2k
        if (payload.size && payload.size !== 'auto') {
          if (payload.size === '1024x1024' || payload.size === '1k') {
            forwardBody.size = '1k';
          } else if (payload.size.includes('2048') || payload.size === '2k') {
            forwardBody.size = '2k';
          } else {
            forwardBody.size = payload.size;
          }
        }
      }

      let upstream = await fetch(UPSTREAM_OPENAI, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': 'ZenMux-Chat-Cloud/2.14 (contact@zenmux.ai)',
        },
        body: JSON.stringify(forwardBody),
      });

      let status = upstream.status;
      let text = await upstream.text();

      // Autonomous Upstream 422 Resolution/Parameter Recovery
      if (status === 422) {
        let shouldRetry = false;
        const retryBody = { ...forwardBody };

        if (text.includes('expected `1k` or `2k`')) {
          retryBody.size = (retryBody.size === '2k' || (retryBody.size && retryBody.size.includes('2048'))) ? '2k' : '1k';
          delete retryBody.background;
          delete retryBody.output_format;
          delete retryBody.quality;
          shouldRetry = true;
        } else if (text.includes('background') || text.includes('output_format') || text.includes('quality')) {
          delete retryBody.background;
          delete retryBody.output_format;
          delete retryBody.quality;
          shouldRetry = true;
        }

        if (shouldRetry) {
          try {
            const retryRes = await fetch(UPSTREAM_OPENAI, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
                'User-Agent': 'ZenMux-Chat-Cloud/2.14 (contact@zenmux.ai)',
              },
              body: JSON.stringify(retryBody),
            });
            status = retryRes.status;
            text = await retryRes.text();
          } catch (_) {
            // Keep original response if retry network fails
          }
        }
      }

      // Universal response normalization: return generated image URL/base64 immediately
      if (status >= 200 && status < 300) {
        try {
          const parsed = JSON.parse(text);
          const images = extractImageFromResponse(parsed, String(payload.prompt).trim());
          if (images.length > 0) {
            text = JSON.stringify({ data: images });
          } else {
            status = 502;
            text = JSON.stringify({
              error: '上游图像生成服务未返回可识别的图像数据',
              detail: text,
            });
          }
        } catch (_) {}
      }

      return { status, text };
    };

    if (acceptsSse) {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      (async () => {
        // Immediate ping to flush headers & establish streaming connection
        await writer.write(encoder.encode(': ping\n\n'));

        // Keep-alive timer sends comment every 2.5s to maintain active socket
        const timer = setInterval(async () => {
          try {
            await writer.write(encoder.encode(': keep-alive\n\n'));
          } catch (_) {}
        }, 2500);

        try {
          const { status, text } = await doFetchUpstream();
          clearInterval(timer);

          if (status >= 200 && status < 300) {
            await writer.write(encoder.encode(`event: result\ndata: ${text}\n\n`));
          } else {
            await writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ status, error: text })}\n\n`));
          }
        } catch (fetchErr) {
          clearInterval(timer);
          await writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ status: 502, error: '无法连接上游 ZenMux 图像生成服务: ' + (fetchErr && fetchErr.message) })}\n\n`));
        } finally {
          await writer.close();
        }
      })();

      return new Response(readable, {
        status: 200,
        headers: {
          ...CORS,
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      });
    }

    // Synchronous fallback for non-SSE clients
    let result;
    try {
      result = await doFetchUpstream();
    } catch (fetchErr) {
      return json({
        error: '无法连接上游 ZenMux 图像生成服务',
        detail: String(fetchErr && fetchErr.message),
      }, 502);
    }

    return new Response(result.text, {
      status: result.status,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (fatalErr) {
    return json({
      error: '图像生成网关运行时异常',
      detail: String(fatalErr && fatalErr.message),
    }, 500);
  }
}

// Universal handler fallback for EdgeOne Cloud Functions router
export async function onRequest(context) {
  const method = (context.request.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    return onRequestOptions(context);
  }
  if (method === 'POST') {
    return onRequestPost(context);
  }
  return json({ error: `Method ${method} not allowed` }, 405);
}
