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

    // 1. Edge Gatekeeper: Verify user access token via EdgeOne KV for publishing actions
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

    const { action } = body || {};

    // ----------------------------------------------------
    // Protocol Action 1: Prepare (Stage publish manifest)
    // ----------------------------------------------------
    if (action === 'prepare') {
      const { title, ttlDays, htmlSize, slug: incomingSlug } = body;
      const validSize = parseInt(htmlSize, 10);
      if (isNaN(validSize) || validSize <= 0) {
        return json({ error: '缺少有效的快照字节大小 (htmlSize)' }, 400);
      }

      const targetSlug = (typeof incomingSlug === 'string' && incomingSlug.trim().length > 0) ? incomingSlug.trim() : null;
      const isUpdate = Boolean(targetSlug);

      // Calculate TTL in seconds if requested
      let ttlSeconds = null;
      const parsedTtlDays = parseInt(ttlDays, 10);
      if (!isNaN(parsedTtlDays) && parsedTtlDays > 0) {
        ttlSeconds = Math.min(365, parsedTtlDays) * 86400;
      }

      // Proactive FIFO quota management when provisioning brand new sites
      if (!isUpdate) {
        await enforceFifoEviction(apiKey);
      }

      // Stage Publish Manifest with here.now control plane
      const displayName = title ? `${String(title).trim().slice(0, 70)} · ZenChat` : 'ZenChat Shared Conversation';
      const publishPayload = {
        displayName,
        displayDescription: 'Shared Conversation from ZenChat',
        ttlSeconds,
        files: [
          {
            path: 'index.html',
            size: validSize,
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

      return json({
        ok: true,
        slug,
        siteUrl,
        uploadUrl: targetUpload.url,
        uploadHeaders: targetUpload.headers || {},
        versionId: uploadInfo.versionId,
        ttlSeconds,
        isUpdate,
      }, 200);
    }

    // ----------------------------------------------------
    // Protocol Action 2: Finalize (Confirm snapshot activation)
    // ----------------------------------------------------
    if (action === 'finalize') {
      const { slug, versionId, ttlSeconds, ttlDays, isUpdate } = body;
      if (!slug || typeof slug !== 'string' || !slug.trim()) {
        return json({ error: '缺少必需的站点标识 (slug)' }, 400);
      }
      if (!versionId || typeof versionId !== 'string' || !versionId.trim()) {
        return json({ error: '缺少必需的快照版本标识 (versionId)' }, 400);
      }

      const finalizeUrl = `${HERENOW_API_BASE}/publish/${encodeURIComponent(slug.trim())}/finalize`;
      const finalizeRes = await fetch(finalizeUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          'X-HereNow-Client': CLIENT_IDENTIFIER,
        },
        body: JSON.stringify({
          versionId: versionId.trim(),
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

      const parsedTtlDays = parseInt(ttlDays, 10);
      const parsedTtlSeconds = parseInt(ttlSeconds, 10);
      const effectiveTtlSec = (!isNaN(parsedTtlSeconds) && parsedTtlSeconds > 0)
        ? parsedTtlSeconds
        : ((!isNaN(parsedTtlDays) && parsedTtlDays > 0) ? parsedTtlDays * 86400 : null);

      const computedExpiresAt = (effectiveTtlSec && effectiveTtlSec > 0)
        ? (finalData.expiresAt || finalData.expires_at || new Date(Date.now() + effectiveTtlSec * 1000).toISOString())
        : null;

      return json({
        ok: true,
        slug: slug.trim(),
        siteUrl: finalData.siteUrl || `https://${slug.trim()}.here.now/`,
        expiresAt: computedExpiresAt,
        ttlDays: (!isNaN(parsedTtlDays) && parsedTtlDays > 0) ? parsedTtlDays : 0,
        updated: Boolean(isUpdate),
        createdAt: new Date().toISOString(),
      }, 200);
    }

    return json({
      error: '无效的操作指令 (必需 action: "prepare" 或 "finalize")',
    }, 400);

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
