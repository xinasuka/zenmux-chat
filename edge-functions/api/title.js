// edge-functions/api/title.js
// 边缘端高阶会话标题合成服务：基于第一轮精炼对话内容与免费文本模型，无流式单次生成高质量会话标题。
// 鉴权保护：通过 EdgeOne KV 校验用户 8 位访问口令；上游密钥只驻留在平台环境变量 ZENMUX_API_KEY。

const UPSTREAM = 'https://zenmux.ai/api/v1/chat/completions';

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

import { verifyUserToken } from './_auth.js';

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

function sanitizeTitle(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let t = raw.trim();

  // 1. 彻底剔除深度思考过程 (<think>...</think>, <thought>...</thought>，包含未闭合片段)
  t = t.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
  t = t.replace(/<thought>[\s\S]*?(?:<\/thought>|$)/gi, '').trim();

  // 2. 剔除元数据前缀（包含各种加粗、方括号、破折号修饰）
  t = t.replace(/^(?:[*_`~#\s"'\(\[【]*(?:title|session\s*title|conversation\s*title|topic|subject|标题|会话标题|对话标题|对话主题|主题)[*_`~#\s"'\)\]】]*[\s:：\-—–—\.]*)+/i, '').trim();

  // 3. 剔除 Markdown 标头与外层包裹修饰符
  t = t.replace(/^#{1,6}\s+/, '');
  t = t.replace(/^[*_`~"'\(\[【“‘«「『\s]+|[*_`~"'\)\]】”’»」』\s]+$/g, '').trim();

  // 4. 剔除前端遗留的冒号或分隔符
  t = t.replace(/^[\s:：\-—–—\.]+|[\s:：\-—–—\.]+$/g, '').trim();

  // 5. 剔除尾部句号与标点符号
  t = t.replace(/[。？！?!.,;:：；、\s]+$/, '').trim();

  // 6. 规整内部换行与连贯空格
  t = t.replace(/\s+/g, ' ').trim();

  return t;
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const apiKey = env.ZENMUX_API_KEY ? String(env.ZENMUX_API_KEY).trim() : '';
    if (!apiKey) {
      return json({ error: '服务端未配置环境变量 ZENMUX_API_KEY' }, 500);
    }

    // 统一门禁鉴权：通过 EdgeOne KV 校验 8 位用户口令
    const auth = await verifyUserToken(request, env);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (_) {
      return json({ error: '请求体不是合法 JSON' }, 400);
    }

    const { model, prompt, response } = payload || {};
    if (!model || typeof model !== 'string') {
      return json({ error: '缺少有效的 model 参数' }, 400);
    }

    const userText = (prompt || '').trim().slice(0, 600);
    const asstText = (response || '').trim().slice(0, 600);
    if (!userText) {
      return json({ error: '缺少有效的对话内容 (prompt)' }, 400);
    }

    const combinedDialogue = `User Inquiry: ${userText}\n\nAssistant Summary: ${asstText || '(No response provided)'}`;

    const systemPrompt =
      'You are a succinct conversation summarizer. Analyze the initial dialogue exchange and generate a clear, accurate session title.\n' +
      'Rules:\n' +
      '1. Length: Exactly 4 to 10 words if English; exactly 4 to 12 characters if Chinese.\n' +
      '2. Do NOT use quotation marks, colons, brackets, or markdown formatting.\n' +
      '3. Do NOT include prefixes like "Title:", "Session:", "主题：", or "对话：".\n' +
      '4. Strictly match the primary language of the conversation.\n' +
      '5. Return ONLY the raw title text, nothing else.';

    const upstreamPayload = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: combinedDialogue }
      ],
      stream: false,
      max_tokens: 2048,
      temperature: 0.2,
      reasoning: { enabled: false }
    };

    let upstreamRes;
    try {
      upstreamRes = await fetch(UPSTREAM, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'ZenMux-Chat-Title/2.21 (contact@zenmux.ai)',
        },
        body: JSON.stringify(upstreamPayload),
      });
    } catch (netErr) {
      return json({ error: '上游标题生成接口请求超时或连接中断', detail: String(netErr && netErr.message) }, 504);
    }

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text().catch(() => '');
      return json({ error: `上游返回异常 HTTP ${upstreamRes.status}`, detail: errText }, 502);
    }

    const resJson = await upstreamRes.json().catch(() => null);
    const choice = resJson && resJson.choices && resJson.choices[0];
    const msg = choice && choice.message;
    const rawContent = (msg && (msg.content || msg.reasoning_content)) || '';

    const finalTitle = sanitizeTitle(rawContent);
    if (!finalTitle || finalTitle.length < 2) {
      // 容错降级：返回 200 + title: null，客户端静默保留启发式标题，杜绝浏览器控制台输出红色 422 网络错误
      return json({ title: null, error: '合成标题为空或内容不足', raw: rawContent }, 200);
    }

    return json({ title: finalTitle.slice(0, 36) }, 200);
  } catch (fatalErr) {
    return json({
      error: '标题合成服务内部异常',
      detail: String(fatalErr && fatalErr.message)
    }, 500);
  }
}
