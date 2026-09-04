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
]);

function isVertexModel(modelId) {
  if (!modelId) return false;
  const provider = modelId.split('/')[0].toLowerCase();
  return VERTEX_PROVIDERS.has(provider);
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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const apiKey = env.ZENMUX_API_KEY ? String(env.ZENMUX_API_KEY).trim() : '';
    if (!apiKey) {
      return json({ error: '服务端未配置环境变量 ZENMUX_API_KEY' }, 500);
    }

    const accessToken = env.ACCESS_TOKEN ? String(env.ACCESS_TOKEN).trim() : '';
    if (accessToken) {
      const auth = request.headers.get('X-Access-Token') || '';
      if (auth !== accessToken) {
        return json({ error: 'unauthorized' }, 401);
      }
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

    const model = payload.model || 'openai/gpt-image-2';
    const isVertex = isVertexModel(model);
    const isGptModel = /^(openai\/|gpt-|dall-e)/i.test(model);

    const acceptsSse = Boolean(request.headers.get('Accept') && request.headers.get('Accept').includes('text/event-stream'));

    const doFetchUpstream = async () => {
      // 1. 针对 Google Vertex AI 生态模型进行动态路由与协议转换
      if (isVertex) {
        const parts = model.split('/');
        const provider = parts[0];
        const modelName = parts.slice(1).join('/');
        const vertexUrl = `${UPSTREAM_VERTEX_BASE}/${provider}/models/${modelName}:predict`;

        const vertexBody = {
          instances: [{ prompt: String(payload.prompt).trim() }],
          parameters: {
            sampleCount: payload.n ? Math.max(1, Math.min(Number(payload.n) || 1, 4)) : 1,
            aspectRatio: mapSizeToAspectRatio(payload.size),
          },
        };

        let upstream = await fetch(vertexUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'User-Agent': 'ZenMux-Chat-Cloud/2.13 (contact@zenmux.ai)',
          },
          body: JSON.stringify(vertexBody),
        });

        let status = upstream.status;
        let text = await upstream.text();

        // 将 Vertex AI predictions[].bytesBase64Encoded 统一归一化为 OpenAI data[].b64_json 格式
        if (status >= 200 && status < 300) {
          try {
            const parsed = JSON.parse(text);
            if (parsed.predictions && parsed.predictions.length > 0) {
              const normalizedData = {
                data: parsed.predictions.map((p) => ({
                  b64_json: p.bytesBase64Encoded,
                  revised_prompt: String(payload.prompt).trim(),
                })),
              };
              text = JSON.stringify(normalizedData);
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
          'User-Agent': 'ZenMux-Chat-Cloud/2.13 (contact@zenmux.ai)',
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
                'User-Agent': 'ZenMux-Chat-Cloud/2.13 (contact@zenmux.ai)',
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
