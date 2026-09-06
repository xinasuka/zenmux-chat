// edge-functions/api/plugins/finance.js
// 在 EdgeOne Pages 边缘节点上代理全球金融市场行情（加密货币、全球外汇换算、美股/全球股票）。
// 加密货币（CoinGecko）与全球外汇（ExchangeRate-API）100% 免 Key 开箱即用；股票行情支持 Finnhub 免费 API Key。

import { CORS, json, verifyUserToken } from '../_auth.js';

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// 常见代币符号快速映射表
const TOP_CRYPTO_MAP = {
  btc: 'bitcoin',
  bitcoin: 'bitcoin',
  eth: 'ethereum',
  ethereum: 'ethereum',
  sol: 'solana',
  solana: 'solana',
  bnb: 'binancecoin',
  xrp: 'ripple',
  doge: 'dogecoin',
  dogecoin: 'dogecoin',
  ada: 'cardano',
  ton: 'the-open-network',
  avax: 'avalanche-2',
  dot: 'polkadot',
  link: 'chainlink',
  sui: 'sui',
  shib: 'shiba-inu',
  near: 'near',
  trx: 'tron',
  ltc: 'litecoin',
  bch: 'bitcoin-cash',
  apt: 'aptos',
  pepe: 'pepe',
  uniswap: 'uniswap',
  uni: 'uniswap'
};

// 常见法定货币代码
const FIAT_CODES = new Set([
  'USD', 'CNY', 'EUR', 'JPY', 'GBP', 'HKD', 'AUD', 'CAD', 'SGD', 'CHF',
  'KRW', 'NZD', 'INR', 'BRL', 'RUB', 'THB', 'TWD', 'MYR', 'VND', 'MXN'
]);

// 热门中英文股票/指数别名快速映射
const STOCK_CN_ALIASES = {
  '英伟达': 'NVDA', 'nvda': 'NVDA',
  '苹果': 'AAPL', 'aapl': 'AAPL',
  '特斯拉': 'TSLA', 'tsla': 'TSLA',
  '微软': 'MSFT', 'msft': 'MSFT',
  '谷歌': 'GOOGL', 'googl': 'GOOGL', 'google': 'GOOGL', 'alphabet': 'GOOGL',
  '亚马逊': 'AMZN', 'amzn': 'AMZN', 'amazon': 'AMZN',
  '脸书': 'META', 'meta': 'META', 'facebook': 'META',
  '台积电': 'TSM', 'tsm': 'TSM', 'tsmc': 'TSM',
  '阿里巴巴': 'BABA', '阿里': 'BABA', 'baba': 'BABA',
  '拼多多': 'PDD', 'pdd': 'PDD',
  '百度': 'BIDU', 'bidu': 'BIDU',
  '京东': 'JD', 'jd': 'JD',
  '网易': 'NTES', 'ntes': 'NTES',
  '蔚来': 'NIO', 'nio': 'NIO',
  '小鹏': 'XPEV', 'xpev': 'XPEV',
  '理想汽车': 'LI', '理想': 'LI', 'li': 'LI',
  '标普500': 'SPY', '标普': 'SPY', 'spy': 'SPY',
  '纳指': 'QQQ', '纳斯达克': 'QQQ', 'qqq': 'QQQ',
  '道指': 'DIA', '道琼斯': 'DIA', 'dia': 'DIA'
};

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    // 1. 统一门禁鉴权：通过 EdgeOne KV (ZENMUX_CHAT) 校验用户口令
    const auth = await verifyUserToken(request, env);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return json({ error: '请求体不是合法 JSON' }, 400);
    }

    const query = (payload && payload.query) ? String(payload.query).trim() : '';
    if (!query) {
      return json({ error: '缺少金融查询 query 参数' }, 400);
    }

    const finnhubKey = env.FINNHUB_API_KEY ? String(env.FINNHUB_API_KEY).trim() : '';
    const requestedType = (payload && payload.asset_type) ? String(payload.asset_type).toLowerCase() : 'auto';
    const cleanQ = query.toLowerCase().replace(/[\s\-_/]+/g, '');
    const cleanQUpper = query.toUpperCase().trim();

    // 2. 判定是否为外汇汇率请求 (例如 USD/CNY, EUR/USD, 汇率, forex)
    const isForexPair = requestedType === 'forex' || (function() {
      if (requestedType === 'stock' || requestedType === 'crypto') return false;
      if (/汇率|兑换|外汇|forex|exchangerate/i.test(query)) return true;
      const match = query.toUpperCase().match(/^([A-Z]{3})[\s/_]?([A-Z]{3})$/);
      if (match && FIAT_CODES.has(match[1]) && FIAT_CODES.has(match[2])) {
        return true;
      }
      return false;
    })();

    if (isForexPair && requestedType !== 'stock' && requestedType !== 'crypto') {
      let base = 'USD';
      const codes = query.toUpperCase().match(/[A-Z]{3}/g) || [];
      if (codes.length > 0 && FIAT_CODES.has(codes[0])) {
        base = codes[0];
      }

      try {
        const erRes = await fetch(`https://open.er-api.com/v6/latest/${base}`, {
          headers: { 'User-Agent': 'ZenMux-Chat-FinancePlugin/2.7' }
        });
        if (erRes.ok) {
          const erData = await erRes.json();
          const rates = erData.rates || {};
          const targetCurrencies = ['USD', 'CNY', 'EUR', 'JPY', 'GBP', 'HKD', 'SGD', 'CAD', 'AUD', 'KRW'];
          const filteredRates = {};
          for (const c of targetCurrencies) {
            if (rates[c] !== undefined && c !== base) {
              filteredRates[c] = rates[c];
            }
          }

          return json({
            success: true,
            assetType: 'forex',
            query,
            baseCurrency: base,
            lastUpdated: erData.time_last_update_utc || new Date().toUTCString(),
            rates: filteredRates,
            allRates: codes.length > 1 && rates[codes[1]] ? { [codes[1]]: rates[codes[1]] } : filteredRates
          }, 200);
        }
      } catch (e) { }
    }

    // 3. 明确为加密货币或高置信度主流加密代币 (BTC, ETH, SOL, 或带有 "币/crypto" 关键词)
    const isExplicitCrypto = requestedType === 'crypto' || /币|coin|crypto|token|区块链|以太坊|比特币|狗狗币/i.test(query);
    const topCryptoId = TOP_CRYPTO_MAP[cleanQ];

    if ((isExplicitCrypto || topCryptoId) && requestedType !== 'stock') {
      const cryptoCoinId = topCryptoId || TOP_CRYPTO_MAP[cleanQ] || 'bitcoin';
      try {
        const priceUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${cryptoCoinId}&vs_currencies=usd,cny&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
        const pRes = await fetch(priceUrl, {
          headers: { 'User-Agent': 'ZenMux-Chat-FinancePlugin/2.7', 'Accept': 'application/json' }
        });
        if (pRes.ok) {
          const pData = await pRes.json();
          const info = pData[cryptoCoinId];
          if (info) {
            return json({
              success: true,
              assetType: 'crypto',
              query,
              coinId: cryptoCoinId,
              priceUsd: info.usd,
              priceCny: info.cny,
              change24hUsd: info.usd_24h_change,
              change24hCny: info.cny_24h_change,
              marketCapUsd: info.usd_market_cap,
              volume24hUsd: info.usd_24h_vol,
              url: `https://www.coingecko.com/en/coins/${cryptoCoinId}`
            }, 200);
          }
        }
      } catch (e) { }
    }

    // 4. 股票/美股查询 (Finnhub API 优先解析股票代码与公司名称)
    if (finnhubKey && requestedType !== 'crypto' && requestedType !== 'forex') {
      let targetSymbol = cleanQUpper.replace(/[^A-Z.]/g, '');
      for (const [cn, sym] of Object.entries(STOCK_CN_ALIASES)) {
        if (query.toLowerCase().includes(cn.toLowerCase())) {
          targetSymbol = sym;
          break;
        }
      }

      let quoteData = null;
      let profileData = null;

      if (targetSymbol.length >= 1 && targetSymbol.length <= 6) {
        try {
          const [qRes, pRes] = await Promise.all([
            fetch(`https://finnhub.io/api/v1/quote?symbol=${targetSymbol}&token=${finnhubKey}`),
            fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${targetSymbol}&token=${finnhubKey}`)
          ]);

          if (qRes.ok) {
            const q = await qRes.json();
            if (q && q.c > 0) {
              quoteData = { symbol: targetSymbol, ...q };
            }
          }
          if (pRes.ok) {
            profileData = await pRes.json();
          }
        } catch (e) { }
      }

      // 若未直接匹配，使用 Finnhub Search 搜索公司名称
      if (!quoteData) {
        try {
          const sRes = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${finnhubKey}`);
          if (sRes.ok) {
            const s = await sRes.json();
            const top = (s.result || []).find((item) => item.type === 'Common Stock' || !item.symbol.includes('.'));
            if (top && top.symbol) {
              targetSymbol = top.symbol;
              const [qRes, pRes] = await Promise.all([
                fetch(`https://finnhub.io/api/v1/quote?symbol=${targetSymbol}&token=${finnhubKey}`),
                fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${targetSymbol}&token=${finnhubKey}`)
              ]);
              if (qRes.ok) {
                const q = await qRes.json();
                if (q && q.c > 0) {
                  quoteData = { symbol: targetSymbol, name: top.description, ...q };
                }
              }
              if (pRes.ok) {
                profileData = await pRes.json();
              }
            }
          }
        } catch (e) { }
      }

      if (quoteData) {
        return json({
          success: true,
          assetType: 'stock',
          query,
          symbol: quoteData.symbol,
          companyName: profileData?.name || quoteData.name || quoteData.symbol,
          industry: profileData?.finnhubIndustry || 'N/A',
          exchange: profileData?.exchange || 'US',
          marketCap: profileData?.marketCapitalization ? `$${(profileData.marketCapitalization / 1000).toFixed(2)}B` : 'N/A',
          currentPrice: quoteData.c,
          change: quoteData.d,
          percentChange: quoteData.dp,
          highPrice: quoteData.h,
          lowPrice: quoteData.l,
          openPrice: quoteData.o,
          prevClose: quoteData.pc,
          url: `https://finance.yahoo.com/quote/${quoteData.symbol}`
        }, 200);
      }
    }

    // 5. 非股票匹配时的严格加密货币搜索（精确符号匹配，排除 nvidia-xstock 等包装代币假阳性）
    if (requestedType !== 'stock') {
      try {
        const sRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`, {
          headers: { 'User-Agent': 'ZenMux-Chat-FinancePlugin/2.7', 'Accept': 'application/json' }
        });
        if (sRes.ok) {
          const sData = await sRes.json();
          // 仅允许符号完全匹配或 ID 完全匹配，严禁子串模糊匹配股票名
          const match = (sData.coins || []).find((c) => c.symbol.toLowerCase() === cleanQ || c.id.toLowerCase() === cleanQ);
          if (match) {
            const pUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${match.id}&vs_currencies=usd,cny&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
            const pRes = await fetch(pUrl, {
              headers: { 'User-Agent': 'ZenMux-Chat-FinancePlugin/2.7', 'Accept': 'application/json' }
            });
            if (pRes.ok) {
              const pData = await pRes.json();
              const info = pData[match.id];
              if (info) {
                return json({
                  success: true,
                  assetType: 'crypto',
                  query,
                  coinId: match.id,
                  priceUsd: info.usd,
                  priceCny: info.cny,
                  change24hUsd: info.usd_24h_change,
                  change24hCny: info.cny_24h_change,
                  marketCapUsd: info.usd_market_cap,
                  volume24hUsd: info.usd_24h_vol,
                  url: `https://www.coingecko.com/en/coins/${match.id}`
                }, 200);
              }
            }
          }
        }
      } catch (e) { }
    }

    // 5. 兜底查询：若未匹配特定资产，返回全球核心大盘资产速览 (BTC, ETH, 美元兑人民币)
    try {
      const [cryptoRes, erRes] = await Promise.all([
        fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd,cny&include_24hr_change=true', {
          headers: { 'User-Agent': 'ZenMux-Chat-FinancePlugin/2.7' }
        }).then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch('https://open.er-api.com/v6/latest/USD', {
          headers: { 'User-Agent': 'ZenMux-Chat-FinancePlugin/2.7' }
        }).then((r) => r.ok ? r.json() : null).catch(() => null)
      ]);

      return json({
        success: true,
        assetType: 'overview',
        query,
        note: finnhubKey ? '未找到精确匹配的标的，提供主流核心市场行情参考。' : '未配置 FINNHUB_API_KEY（美股股票），已提供主流加密与外汇行情。',
        crypto: cryptoRes || {},
        forex: (erRes && erRes.rates) ? { CNY: erRes.rates.CNY, EUR: erRes.rates.EUR, JPY: erRes.rates.JPY, HKD: erRes.rates.HKD } : {}
      }, 200);
    } catch (e) {
      return json({ error: '未能获取金融市场行情', detail: String(e && e.message) }, 502);
    }
  } catch (fatalErr) {
    return json({
      error: '金融市场边缘函数内部异常',
      detail: String(fatalErr && fatalErr.message)
    }, 500);
  }
}
