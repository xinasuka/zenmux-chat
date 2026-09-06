// edge-functions/api/models.js
// 聚合 ZenMux OpenAI 与 Google Vertex AI 模型列表，供前端下拉选择。受 ACCESS_TOKEN 保护。

const UPSTREAM_V1 = 'https://zenmux.ai/api/v1/models';
const UPSTREAM_VERTEX = 'https://zenmux.ai/api/vertex-ai/v1beta/models';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, X-Access-Token, Content-Type',
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

export async function onRequestGet(context) {
  try {
    const { request, env } = context;

    const apiKey = env.ZENMUX_API_KEY ? String(env.ZENMUX_API_KEY).trim() : '';
    if (!apiKey) {
      return json({ error: '服务端未配置环境变量 ZENMUX_API_KEY' }, 500);
    }

    // 统一门禁鉴权：通过 EdgeOne KV (ZENMUX_CHAT) 校验 8 位用户口令
    const auth = await verifyUserToken(request, env);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': 'ZenMux-Chat-Edge/2.13 (contact@zenmux.ai)',
    };

    // 并行拉取 OpenAI 与 Vertex AI 双协议模型目录，防御性容灾
    const [v1Settled, vertexSettled] = await Promise.allSettled([
      fetch(UPSTREAM_V1, { headers }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`v1: ${r.status}`)))),
      fetch(UPSTREAM_VERTEX, { headers }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`vertex: ${r.status}`)))),
    ]);

    const v1Data = (v1Settled.status === 'fulfilled' && v1Settled.value && v1Settled.value.data) || [];
    const vertexRawModels = (vertexSettled.status === 'fulfilled' && vertexSettled.value && vertexSettled.value.models) || [];

    // 标准化 Vertex AI 模型字段，使其与 v1 模式契合
    const vertexNormalized = vertexRawModels.map((m) => {
      const provider = m.name && m.name.includes('/') ? m.name.split('/')[0] : 'google';
      return {
        id: m.name,
        display_name: m.displayName || m.name,
        owned_by: provider,
        input_modalities: m.inputModalities || ['text'],
        output_modalities: m.outputModalities || ['image'],
        capabilities: {
          reasoning: !!m.thinking,
          image_generation: Array.isArray(m.outputModalities) && m.outputModalities.includes('image'),
        },
        context_length: m.inputTokenLimit || 0,
        pricings: m.pricings || {},
        protocol: 'vertex',
      };
    });

    // 以 v1 为基准合并，通过 Set 进行模型 ID 排重
    const merged = [...v1Data];
    const seenIds = new Set(v1Data.map((m) => m.id));

    vertexNormalized.forEach((vm) => {
      if (!seenIds.has(vm.id)) {
        seenIds.add(vm.id);
        merged.push(vm);
      }
    });

    return json({ data: merged }, 200);
  } catch (fatalErr) {
    return json({
      error: '获取模型列表异常',
      detail: String(fatalErr && fatalErr.message),
    }, 500);
  }
}
