// edge-functions/api/plugins/github.js
// 在 EdgeOne Pages 边缘节点上代理 GitHub REST API，提供开源仓库详情、Star 数、Release 及 Issue 检索。
// GITHUB_TOKEN 为可选 Secret 环境变量（未配置时可使用官方匿名 60 次/小时配额）。

const GITHUB_API_BASE = 'https://api.github.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
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
  const { request, env } = context;

  // 1. 门禁鉴权
  const accessToken = env.ACCESS_TOKEN;
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

  const rawRepo = (payload && (payload.repo || payload.query)) ? String(payload.repo || payload.query).trim() : '';
  if (!rawRepo) {
    return json({ error: '缺少 repo 参数（格式为 owner/repo 或仓库名）' }, 400);
  }

  // 清洗 repo 参数（支持输入完整 github url 如 https://github.com/facebook/react）
  const match = rawRepo.match(/(?:github\.com\/)?([^/\s]+\/[^/\s#?]+)/i);
  const repoPath = match ? match[1] : rawRepo;

  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'ZenMux-Chat-GitHub-Plugin/2.3',
  };
  if (env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${env.GITHUB_TOKEN}`;
  }

  let repoRes;
  try {
    repoRes = await fetch(`${GITHUB_API_BASE}/repos/${repoPath}`, { headers });
  } catch (e) {
    return json({ error: '连接 GitHub API 失败', detail: String(e && e.message) }, 502);
  }

  if (!repoRes.ok) {
    if (repoRes.status === 404) {
      return json({ error: `未找到 GitHub 仓库【${repoPath}】，请检查名称是否正确或仓库是否为 Private。` }, 404);
    }
    const detail = await repoRes.text().catch(() => '');
    return json({ error: `GitHub API 返回 HTTP ${repoRes.status}`, detail: detail.slice(0, 500) }, repoRes.status || 502);
  }

  const data = await repoRes.json().catch(() => null);
  if (!data) return json({ error: '解析 GitHub 响应失败' }, 502);

  // 尝试拉取最新 Release
  let releaseTag = '暂无发布版本';
  try {
    const relRes = await fetch(`${GITHUB_API_BASE}/repos/${repoPath}/releases/latest`, { headers });
    if (relRes.ok) {
      const relData = await relRes.json();
      if (relData && relData.tag_name) {
        releaseTag = `${relData.tag_name} (${relData.name || ''})`;
      }
    }
  } catch (e) { }

  return json({
    success: true,
    fullName: data.full_name,
    description: data.description || '无描述',
    htmlUrl: data.html_url,
    stars: data.stargazers_count,
    forks: data.forks_count,
    openIssues: data.open_issues_count,
    language: data.language || '未知',
    license: (data.license && data.license.name) || '无 License',
    topics: (data.topics || []).slice(0, 8),
    latestRelease: releaseTag,
    updatedAt: data.updated_at,
    defaultBranch: data.default_branch,
  }, 200);
}
