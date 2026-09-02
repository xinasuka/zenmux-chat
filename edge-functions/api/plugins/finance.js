// edge-functions/api/plugins/finance.js
// 在 EdgeOne Pages 边缘节点上代理全球金融市场行情（加密货币、全球外汇换算、美股/全球股票）。
// 加密货币（CoinGecko）与全球外汇（ExchangeRate-API）100% 免 Key 开箱即用；股票行情支持 Finnhub 免费 API Key。

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

    const query = (payload && payload.query) ? String(payload.query).trim() : '';
    if (!query) {
      return json({ error: '缺少金融查询 query 参数' }, 400);
    }

    const finnhubKey = env.FINNHUB_API_KEY ? String(env.FINNHUB_API_KEY).trim() : '';
    const cleanQ = query.toLowerCase().replace(/[\s\-_/]+/g, '');
    const cleanQUpper = query.toUpperCase().trim();

    // 2. 判定是否为外汇汇率请求 (例如 USD/CNY, EUR/USD, 汇率, forex)
    const isForexPair = (function() {
      if (/汇率|兑换|外汇|forex|exchangerate/i.test(query)) return true;
      const match = query.toUpperCase().match(/^([A-Z]{3})[\s/_]?([A-Z]{3})$/);
      if (match && FIAT_CODES.has(match[1]) && FIAT_CODES.has(match[2])) {
        return true;
      }
      return false;
    })();

    if (isForexPair) {
      // 提取基础货币代码 (默认为 USD 或检测出的首个代码)
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
          // 挑选核心主流货币
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

    // 3. 判定是否为加密货币 (例如 BTC, ETH, Solana, Bitcoin, 狗狗币)
    let cryptoCoinId = TOP_CRYPTO_MAP[cleanQ] || null;
    if (!cryptoCoinId) {
      // 尝试通过 CoinGecko 搜索匹配
      try {
        const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`, {
          headers: { 'User-Agent': 'ZenMux-Chat-FinancePlugin/2.7', 'Accept': 'application/json' }
        });
        if (searchRes.ok) {
          const sData = await searchRes.json();
          if (sData.coins && sData.coins.length > 0) {
            cryptoCoinId = sData.coins[0].id;
          }
        }
      } catch (e) { }
    }

    if (cryptoCoinId) {
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

    // 4. 股票/美股查询 (Finnhub API)
    if (finnhubKey) {
      // 先尝试直接作为股票代码查询 Quote (如 NVDA, AAPL, TSLA)
      let symbol = cleanQUpper.replace(/[^A-Z.]/g, '');
      let quoteData = null;

      if (symbol.length >= 1 && symbol.length <= 6) {
        try {
          const qRes = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${finnhubKey}`);
          if (qRes.ok) {
            const q = await qRes.json();
            if (q && q.c > 0) {
              quoteData = { symbol, ...q };
            }
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
              symbol = top.symbol;
              const qRes = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${finnhubKey}`);
              if (qRes.ok) {
                const q = await qRes.json();
                if (q && q.c > 0) {
                  quoteData = { symbol, name: top.description, ...q };
                }
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
          companyName: quoteData.name || quoteData.symbol,
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
