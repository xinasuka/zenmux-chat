// edge-functions/api/images.js
// 在 EdgeOne Pages 边缘节点上反向代理 ZenMux 的 images/generations 接口。
// 客户端向此接口发送原生生图请求，API Key 安全保存在服务端环境变量中。

const UPSTREAM = 'https://zenmux.ai/api/v1/images/generations';

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
    const isGptModel = /^(openai\/|gpt-|dall-e)/i.test(model);

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
      // Non-GPT models (e.g. Google Imagen, Recraft, Flux) expect 1k/2k resolutions and standard formats
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

    let upstream;
    try {
      upstream = await fetch(UPSTREAM, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': 'ZenMux-Chat/2.12 (contact@zenmux.ai)',
        },
        body: JSON.stringify(forwardBody),
      });
    } catch (fetchErr) {
      return json({
        error: '无法连接上游 ZenMux 图像生成服务',
        detail: String(fetchErr && fetchErr.message),
      }, 502);
    }

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
          const retryRes = await fetch(UPSTREAM, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
              'User-Agent': 'ZenMux-Chat/2.12 (contact@zenmux.ai)',
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

    return new Response(text, {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (fatalErr) {
    return json({
      error: '图像生成网关运行时异常',
      detail: String(fatalErr && fatalErr.message),
    }, 500);
  }
}
