// edge-functions/api/admin/users.js
// 管理员后台用户与访问口令管理接口
// 仅允许配置了正确 ADMIN_TOKEN 的请求进行管理操作（增删改查）

import {
  CORS,
  json,
  verifyAdminToken,
  generateToken,
  invalidateTokenCache
} from '../_auth.js';

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// 1. 获取所有用户与口令列表
export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    const auth = verifyAdminToken(request, env);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

    const kv = (env && env.ZENMUX_CHAT) || (env && env.ZENMUX_KV);
    if (!kv) {
      return json({ error: '服务端未绑定 ZENMUX_CHAT KV 命名空间' }, 500);
    }

    const index = (await kv.get('users:index', { type: 'json' })) || [];
    if (!Array.isArray(index) || index.length === 0) {
      return json({ success: true, users: [] });
    }

    // 并发拉取用户信息
    const userRecords = await Promise.all(
      index.map(async (token) => {
        try {
          return await kv.get(`user:${token}`, { type: 'json' });
        } catch (_) {
          return null;
        }
      })
    );

    const validUsers = userRecords
      .filter(Boolean)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return json({ success: true, users: validUsers });
  } catch (fatalErr) {
    return json({
      error: '获取用户列表失败',
      detail: String(fatalErr && fatalErr.message)
    }, 500);
  }
}

// 2. 创建新用户并生成 8 位访问口令
export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const auth = verifyAdminToken(request, env);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

    const kv = (env && env.ZENMUX_CHAT) || (env && env.ZENMUX_KV);
    if (!kv) {
      return json({ error: '服务端未绑定 ZENMUX_CHAT KV 命名空间' }, 500);
    }

    let payload = {};
    try {
      payload = await request.json();
    } catch (_) {
      return json({ error: '请求体必须是合法的 JSON' }, 400);
    }

    const name = String(payload.name || '').trim();
    if (!name) {
      return json({ error: '用户备注名称不能为空' }, 400);
    }
    if (name.length > 50) {
      return json({ error: '用户名称不能超过 50 个字符' }, 400);
    }

    // 生成 8 位无歧义小写字母与数字组合口令
    const token = generateToken(8);
    const user = {
      token,
      name,
      status: 'active',
      createdAt: Date.now()
    };

    // 存入 KV 并维护全局索引
    await kv.put(`user:${token}`, JSON.stringify(user));

    const index = (await kv.get('users:index', { type: 'json' })) || [];
    if (!index.includes(token)) {
      index.unshift(token);
      await kv.put('users:index', JSON.stringify(index));
    }

    return json({ success: true, user }, 201);
  } catch (fatalErr) {
    return json({
      error: '创建用户口令失败',
      detail: String(fatalErr && fatalErr.message)
    }, 500);
  }
}

// 3. 切换用户状态 (active <-> revoked)
export async function onRequestPatch(context) {
  try {
    const { request, env } = context;
    const auth = verifyAdminToken(request, env);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

    const kv = (env && env.ZENMUX_CHAT) || (env && env.ZENMUX_KV);
    if (!kv) {
      return json({ error: '服务端未绑定 ZENMUX_CHAT KV 命名空间' }, 500);
    }

    let payload = {};
    try {
      payload = await request.json();
    } catch (_) {
      return json({ error: '请求体必须是合法的 JSON' }, 400);
    }

    const token = String(payload.token || '').trim();
    const status = String(payload.status || '').trim();
    if (!token || !['active', 'revoked'].includes(status)) {
      return json({ error: '缺少有效的 token 或 status 参数' }, 400);
    }

    const user = await kv.get(`user:${token}`, { type: 'json' });
    if (!user) {
      return json({ error: '未找到该用户' }, 404);
    }

    user.status = status;
    user.updatedAt = Date.now();
    await kv.put(`user:${token}`, JSON.stringify(user));

    // 同步清除边缘隔离区只读缓存，确保立即生效
    invalidateTokenCache(token);

    return json({ success: true, user });
  } catch (fatalErr) {
    return json({
      error: '更新用户状态失败',
      detail: String(fatalErr && fatalErr.message)
    }, 500);
  }
}

// 4. 删除用户口令
export async function onRequestDelete(context) {
  try {
    const { request, env } = context;
    const auth = verifyAdminToken(request, env);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

    const kv = (env && env.ZENMUX_CHAT) || (env && env.ZENMUX_KV);
    if (!kv) {
      return json({ error: '服务端未绑定 ZENMUX_CHAT KV 命名空间' }, 500);
    }

    const reqUrl = new URL(request.url);
    const token = (reqUrl.searchParams.get('token') || '').trim();
    if (!token) {
      return json({ error: '缺少要删除的 token 参数' }, 400);
    }

    // 从 KV 删除并从索引中移除
    await kv.delete(`user:${token}`);

    let index = (await kv.get('users:index', { type: 'json' })) || [];
    if (Array.isArray(index)) {
      index = index.filter((t) => t !== token);
      await kv.put('users:index', JSON.stringify(index));
    }

    // 同步清除边缘隔离区只读缓存
    invalidateTokenCache(token);

    return json({ success: true, deleted: token });
  } catch (fatalErr) {
    return json({
      error: '删除用户口令失败',
      detail: String(fatalErr && fatalErr.message)
    }, 500);
  }
}

// 统一路由分发
export async function onRequest(context) {
  const method = (context.request.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return onRequestOptions(context);
  if (method === 'GET') return onRequestGet(context);
  if (method === 'POST') return onRequestPost(context);
  if (method === 'PATCH') return onRequestPatch(context);
  if (method === 'DELETE') return onRequestDelete(context);
  return json({ error: `Method ${method} not allowed` }, 405);
}
