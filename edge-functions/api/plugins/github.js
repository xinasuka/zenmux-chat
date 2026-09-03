// edge-functions/api/plugins/github.js
// 在 EdgeOne Pages 边缘节点上代理 GitHub REST API，提供开源仓库详情检索与热门项目关键词搜索探索。
// GITHUB_TOKEN 为可选 Secret 环境变量（配置后可获得 5,000 次/小时高配额）。

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
  try {
    const { request, env } = context;

  // 1. 门禁鉴权
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

  const query = (payload && (payload.query || payload.repo)) ? String(payload.query || payload.repo).trim() : '';
  if (!query) {
    return json({ error: '缺少 GitHub 检索 query 或 repo 参数' }, 400);
  }

  const headers = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ZenMux-Chat-GitHub-Plugin/2.5 (contact@zenmux.ai)',
  };

  const ghToken = env.GITHUB_TOKEN ? String(env.GITHUB_TOKEN).trim() : '';
  if (ghToken) {
    headers['Authorization'] = `Bearer ${ghToken}`;
  }

  // 2. 检查是否为指定仓库查询（例如 facebook/react 或 https://github.com/facebook/react）
  const match = query.match(/(?:https?:\/\/github\.com\/)?([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)/i);
  const isDirectRepo = !!match && !query.includes(' ') && !query.includes(':');

  if (isDirectRepo) {
    const repoPath = match[1].replace(/\.git$/i, '');
    try {
      const repoRes = await fetch(`${GITHUB_API_BASE}/repos/${repoPath}`, { headers });
      if (repoRes.ok) {
        const data = await repoRes.json();

        // 尝试拉取最新 Release
        let releaseTag = '暂无发布版本';
        try {
          const relRes = await fetch(`${GITHUB_API_BASE}/repos/${repoPath}/releases/latest`, { headers });
          if (relRes.ok) {
            const relData = await relRes.json();
            if (relData && relData.tag_name) {
              releaseTag = `${relData.tag_name}${relData.name ? ` (${relData.name})` : ''}`;
            }
          }
        } catch (e) { }

        return json({
          success: true,
          mode: 'repo',
          query,
          repo: {
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
          }
        }, 200);
      }
    } catch (e) { }
  }

  // 3. 通用搜索探索模式（Search & Discover Repositories）
  try {
    const limit = Math.min(Math.max(parseInt(payload.limit, 10) || 5, 1), 10);
    // 处理通用搜索词（支持自动补充 stars 排序）
    const searchUrl = `${GITHUB_API_BASE}/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${limit}`;

    const searchRes = await fetch(searchUrl, { headers });
    if (!searchRes.ok) {
      const detail = await searchRes.text().catch(() => '');
      if (searchRes.status === 403) {
        return json({
          error: 'GitHub API 访问速率超限。建议在 EdgeOne 控制台添加 GITHUB_TOKEN 环境变量提升至 5,000 次/小时配额。',
          rateLimited: true
        }, 429);
      }
      return json({ error: `GitHub 搜索返回 HTTP ${searchRes.status}`, detail: detail.slice(0, 300) }, searchRes.status || 502);
    }

    const searchData = await searchRes.json().catch(() => null);
    const items = (searchData && searchData.items) || [];

    const repos = items.map((item) => {
      return {
        fullName: item.full_name,
        description: item.description || '无描述',
        htmlUrl: item.html_url,
        stars: item.stargazers_count,
        forks: item.forks_count,
        language: item.language || '未知',
        topics: (item.topics || []).slice(0, 6),
        updatedAt: item.updated_at,
      };
    });

    return json({
      success: true,
      mode: 'search',
      query,
      totalCount: (searchData && searchData.total_count) || repos.length,
      repos
    }, 200);
  } catch (err) {
    return json({ error: '调用 GitHub 服务失败', detail: String(err && err.message) }, 502);
  }
} catch (fatalErr) {
  return json({
    error: 'GitHub 网关内部异常',
    detail: String(fatalErr && fatalErr.message)
  }, 500);
}
}
