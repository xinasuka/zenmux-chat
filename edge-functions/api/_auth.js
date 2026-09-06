// edge-functions/api/_auth.js
// 统一鉴权模块：基于腾讯云 EdgeOne 边缘键值存储 (KV: ZENMUX_CHAT) 与 V8 隔离区内存缓存
// 提供 8 位用户访问口令验证、管理员口令安全校验与高频只读缓存加速。

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, X-Access-Token, X-Admin-Token, Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// V8 Isolate 内存缓存：60 秒极速放行，避免高频请求击穿 EdgeOne KV 读配额
const TOKEN_CACHE = new Map();
const CACHE_TTL_MS = 60 * 1000;

// 常量时间字符串比较（防御侧信道时序攻击）
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

// 生成无歧义易读的 8 位随机访问口令
export function generateToken(length = 8) {
  const chars = '23456789abcdefghijkmnpqrstuvwxyz';
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

// 缓存主动失效（管理员禁用或删除口令时触发）
export function invalidateTokenCache(token) {
  if (token) {
    TOKEN_CACHE.delete(String(token).trim());
  } else {
    TOKEN_CACHE.clear();
  }
}

// 管理员身份鉴权：必须提供 X-Admin-Token 且严格匹配环境变量 ADMIN_TOKEN
export function verifyAdminToken(request, env) {
  const adminToken = env && env.ADMIN_TOKEN ? String(env.ADMIN_TOKEN).trim() : '';
  if (!adminToken) {
    return { ok: false, status: 500, error: '服务端未配置 ADMIN_TOKEN 环境变量' };
  }
  const auth = request.headers.get('X-Admin-Token') || '';
  if (!timingSafeEqual(auth.trim(), adminToken)) {
    return { ok: false, status: 401, error: '管理员身份认证失败，口令无效' };
  }
  return { ok: true };
}

// 用户访问口令鉴权：从请求头 X-Access-Token 获取，并在 EdgeOne KV 中校验状态
export async function verifyUserToken(request, env) {
  const token = (request.headers.get('X-Access-Token') || '').trim();
  if (!token) {
    return { ok: false, status: 401, error: '未提供访问口令 (X-Access-Token)' };
  }

  // 1. 优先查验 V8 Isolate 本地内存缓存（0ms 命中）
  const cached = TOKEN_CACHE.get(token);
  if (cached && cached.exp > Date.now()) {
    return cached.result;
  }

  // 2. 查验 EdgeOne 绑定的 KV 命名空间
  const kv = (env && env.ZENMUX_CHAT) || (env && env.ZENMUX_KV);
  if (!kv) {
    return { ok: false, status: 500, error: '服务端未绑定 ZENMUX_CHAT KV 命名空间' };
  }

  try {
    const user = await kv.get(`user:${token}`, { type: 'json' });
    if (user && user.status === 'active') {
      const successRes = { ok: true, user };
      TOKEN_CACHE.set(token, { result: successRes, exp: Date.now() + CACHE_TTL_MS });
      return successRes;
    }

    const failRes = { ok: false, status: 401, error: '访问口令无效或已被禁用' };
    TOKEN_CACHE.set(token, { result: failRes, exp: Date.now() + 10000 }); // 10秒短缓存防御暴力轮询
    return failRes;
  } catch (err) {
    return { ok: false, status: 500, error: 'KV 数据库查询异常', detail: String(err && err.message) };
  }
}
