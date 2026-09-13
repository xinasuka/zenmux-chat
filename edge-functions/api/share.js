// edge-functions/api/share.js
// Session Save & Share Gateway: Integrates with here.now static hosting API
// Features: Zero-client credential exposure, EdgeOne KV user authentication,
// proactive FIFO quota rotation (500 sites ceiling), and 3-step atomic publishing.

import { CORS, json, verifyUserToken } from './_auth.js';

const HERENOW_API_BASE = 'https://here.now/api/v1';
const USER_AGENT = 'ZenMux-Chat-Share/2.22 (contact@zenmux.ai)';
const CLIENT_IDENTIFIER = 'zenmux-chat/edgeone';
const HIGH_WATER_MARK = 480; // Safe threshold below here.now 500-site quota limit

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * Proactively prune oldest sites if active sites count approaches the 500-site quota ceiling.
 */
async function enforceFifoEviction(apiKey) {
  try {
    const listRes = await fetch(`${HERENOW_API_BASE}/publishes`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': USER_AGENT,
        'X-HereNow-Client': CLIENT_IDENTIFIER,
      },
    });

    if (!listRes.ok) return;

    const data = await listRes.json();
    const publishes = data && Array.isArray(data.publishes) ? data.publishes : [];

    if (publishes.length >= HIGH_WATER_MARK) {
      // Sort oldest first (ascending by updatedAt or createdAt)
      const sorted = [...publishes].sort((a, b) => {
        const timeA = new Date(a.updatedAt || a.contentUpdatedAt || 0).getTime();
        const timeB = new Date(b.updatedAt || b.contentUpdatedAt || 0).getTime();
        return timeA - timeB;
      });

      const evictCount = (publishes.length - HIGH_WATER_MARK) + 1;
      const targets = sorted.slice(0, evictCount);

      await Promise.allSettled(
        targets.map((item) =>
          fetch(`${HERENOW_API_BASE}/publish/${encodeURIComponent(item.slug)}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'User-Agent': USER_AGENT,
              'X-HereNow-Client': CLIENT_IDENTIFIER,
            },
          })
        )
      );
    }
  } catch (err) {
    // Non-blocking catch to ensure publication is not blocked by quota inspection glitch
    console.warn('[Share] FIFO eviction check encountered non-fatal notice:', err);
  }
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    // 1. Edge Gatekeeper: Verify user access token via EdgeOne KV
    const auth = await verifyUserToken(request, env, context);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

    // 2. Extract & sanitize here.now API credentials
    const apiKey = env.HERENOW_API_KEY ? String(env.HERENOW_API_KEY).trim() : '';
    if (!apiKey) {
      return json({
        error: '服务端未配置 HERENOW_API_KEY 环境变量，请在 EdgeOne 控制台添加配置',
      }, 500);
    }

    // 3. Parse & validate request payload
    let body = null;
    try {
      body = await request.json();
    } catch (_) {
      return json({ error: '无效的 JSON 请求体' }, 400);
    }

    const { title, html, ttlDays, slug: incomingSlug } = body || {};
    if (!html || typeof html !== 'string' || !html.trim()) {
      return json({ error: '缺少必需的 html 快照内容' }, 400);
    }

    const targetSlug = (typeof incomingSlug === 'string' && incomingSlug.trim().length > 0) ? incomingSlug.trim() : null;
    const isUpdate = Boolean(targetSlug);

    const encoder = new TextEncoder();
    const htmlBytes = encoder.encode(html);
    const htmlSize = htmlBytes.byteLength;

    // Calculate TTL in seconds if requested
    let ttlSeconds = null;
    if (ttlDays && Number(ttlDays) > 0) {
      ttlSeconds = Math.min(365, parseInt(ttlDays, 10)) * 86400;
    }

    // 4. Quota management: FIFO eviction is only executed when creating brand new sites
    if (!isUpdate) {
      await enforceFifoEviction(apiKey);
    }

    // 5. Phase 1: Stage Publish Manifest (POST for new site, PUT for in-place version update)
    const displayName = title ? `ZenMux - ${String(title).trim().slice(0, 70)}` : 'ZenMux Chat Session';
    const publishPayload = {
      displayName,
      displayDescription: 'Exported conversational snapshot from ZenMux Chat',
      ttlSeconds,
      files: [
        {
          path: 'index.html',
          size: htmlSize,
          contentType: 'text/html; charset=utf-8',
        },
      ],
    };

    const stageEndpoint = isUpdate
      ? `${HERENOW_API_BASE}/publish/${encodeURIComponent(targetSlug)}`
      : `${HERENOW_API_BASE}/publish`;
    const stageMethod = isUpdate ? 'PUT' : 'POST';

    const stageRes = await fetch(stageEndpoint, {
      method: stageMethod,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'X-HereNow-Client': CLIENT_IDENTIFIER,
      },
      body: JSON.stringify(publishPayload),
    });

    if (!stageRes.ok) {
      const errText = await stageRes.text();
      return json({
        error: isUpdate ? 'here.now 更新站点快照版本失败' : 'here.now 创建站点清单失败',
        status: stageRes.status,
        detail: errText,
      }, 502);
    }

    const stageData = await stageRes.json();
    const slug = stageData.slug || targetSlug;
    const siteUrl = stageData.siteUrl;
    const uploadInfo = stageData.upload;

    if (!uploadInfo || !uploadInfo.uploads || !uploadInfo.uploads[0] || !uploadInfo.uploads[0].url) {
      return json({
        error: 'here.now 未返回预签名上传地址',
        detail: stageData,
      }, 502);
    }

    const targetUpload = uploadInfo.uploads[0];

    // 6. Phase 2: Binary Transmission to Presigned Storage (PUT targetUpload.url)
    const putHeaders = new Headers(targetUpload.headers || {});
    if (!putHeaders.has('Content-Type')) {
      putHeaders.set('Content-Type', 'text/html; charset=utf-8');
    }

    const uploadRes = await fetch(targetUpload.url, {
      method: 'PUT',
      headers: putHeaders,
      body: htmlBytes,
    });

    if (!uploadRes.ok) {
      const uploadErr = await uploadRes.text();
      return json({
        error: '上传快照 HTML 二进制内容至存储节点失败',
        status: uploadRes.status,
        detail: uploadErr,
      }, 502);
    }

    // 7. Phase 3: Atomic Finalization (POST finalizeUrl)
    const finalizeUrl = uploadInfo.finalizeUrl || `${HERENOW_API_BASE}/publish/${encodeURIComponent(slug)}/finalize`;
    const finalizeRes = await fetch(finalizeUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'X-HereNow-Client': CLIENT_IDENTIFIER,
      },
      body: JSON.stringify({
        versionId: uploadInfo.versionId,
      }),
    });

    let finalData = {};
    if (finalizeRes.ok) {
      try {
        finalData = await finalizeRes.json();
      } catch (_) {}
    } else {
      const finalizeErr = await finalizeRes.text();
      return json({
        error: 'here.now 站点版本生效确认失败',
        status: finalizeRes.status,
        detail: finalizeErr,
      }, 502);
    }

    return json({
      ok: true,
      slug,
      siteUrl: finalData.siteUrl || siteUrl,
      expiresAt: finalData.expiresAt || stageData.expiresAt || null,
      ttlDays: ttlDays || null,
      updated: isUpdate,
      createdAt: new Date().toISOString(),
    }, 200);

  } catch (fatalErr) {
    // Master exception boundary prevents EdgeOne HTTP 545 crashes
    return json({
      error: '会话分享处理异常',
      detail: String(fatalErr && fatalErr.message ? fatalErr.message : fatalErr),
    }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const { request, env } = context;
    const auth = await verifyUserToken(request, env, context);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

    const apiKey = env.HERENOW_API_KEY ? String(env.HERENOW_API_KEY).trim() : '';
    if (!apiKey) {
      return json({ error: '未配置 HERENOW_API_KEY' }, 500);
    }

    const url = new URL(request.url);
    const slug = url.searchParams.get('slug');
    if (!slug) {
      return json({ error: '缺少必需的 slug 参数' }, 400);
    }

    const delRes = await fetch(`${HERENOW_API_BASE}/publish/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': USER_AGENT,
        'X-HereNow-Client': CLIENT_IDENTIFIER,
      },
    });

    if (!delRes.ok) {
      const err = await delRes.text();
      return json({ error: '删除分享站点失败', detail: err }, delRes.status);
    }

    return json({ ok: true, slug });
  } catch (fatalErr) {
    return json({
      error: '删除分享站点异常',
      detail: String(fatalErr && fatalErr.message ? fatalErr.message : fatalErr),
    }, 500);
  }
}
