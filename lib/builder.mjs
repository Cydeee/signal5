// builder.mjs
// Node ≥18 CLI: writes public/live.json with full A→H logic plus debug logging

import { mkdir, writeFile } from 'fs/promises';

const SYMBOL = "BTCUSDT";
const LIMIT  = 250;
// Use a desktop UA to avoid HTTP 451
const UA     = "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/109.0";

// Helper: fetch JSON with debug logging and error snippet
async function safeJson(url) {
  console.log(`▶ [safeJson] GET ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  const text = await res.text().catch(() => "<no body>");
  if (!res.ok) {
    const snippet = text.slice(0, 200).replace(/\n/g, ' ');
    console.error(`❗ [safeJson] HTTP ${res.status} at ${url}\n | snippet: ${snippet}`);
    throw new Error(`HTTP ${res.status} at ${url}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(`❌ [safeJson] JSON parse error at ${url}`, e);
    throw e;
  }
}

// SMA, EMA, RSI, ATR, ROC helpers (same as in Edge fn)
const sma = (arr, p) => arr.slice(-p).reduce((s, x) => s + x, 0) / p;
const ema = (arr, p) => {
  if (arr.length < p) return 0;
  const k = 2 / (p + 1);
  let e = sma(arr.slice(0, p), p);
  for (let i = p; i < arr.length; i++) {
    e = arr[i] * k + e * (1 - k);
  }
  return e;
};
const rsi = (arr, p) => {
  if (arr.length < p + 1) return 0;
  let up = 0, down = 0;
  for (let i = 1; i <= p; i++) {
    const d = arr[i] - arr[i-1];
    d >= 0 ? up += d : down -= d;
  }
  let au = up / p, ad = down / p;
  for (let i = p + 1; i < arr.length; i++) {
    const d = arr[i] - arr[i-1];
    au = (au * (p - 1) + Math.max(d, 0)) / p;
    ad = (ad * (p - 1) + Math.max(-d, 0)) / p;
  }
  return ad ? 100 - 100 / (1 + au / ad) : 100;
};
const atr = (h, l, c, p) => {
  if (h.length < p + 1) return 0;
  const tr = [];
  for (let i = 1; i < h.length; i++) {
    tr.push(
      Math.max(
        h[i] - l[i],
        Math.abs(h[i] - c[i-1]),
        Math.abs(l[i] - c[i-1])
      )
    );
  }
  return sma(tr, p);
};
const roc = (arr, n) => {
  if (arr.length < n + 1) return 0;
  const curr = arr.at(-1), prev = arr.at(-(n+1));
  return prev ? ((curr - prev) / prev) * 100 : 0;
};

async function buildStaticPayload() {
  console.log('▶ [builder] Starting buildStaticPayload');
  const out = { dataA:{}, dataB:null, dataC:{}, dataD:{}, dataE:null, dataF:null, dataG:null, dataH:null, errors:[] };

  // Block A: Indicators
  console.log('––– [builder] Block A: Indicators –––');
  for (const tf of ['15m','1h','4h','1d']) {
    console.log(`▶ [builder] A[${tf}]`);
    try {
      const kl = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`);
      const c = kl.map(r=>+r[4]), h=kl.map(r=>+r[2]), l=kl.map(r=>+r[3]);
      const last = c.at(-1) || 1;
      const e50 = ema(c,50), e200=ema(c,200);
      const macdArr = c.map((_,i) => ema(c.slice(0,i+1),12) - ema(c.slice(0,i+1),26));
      const macdHist = macdArr.at(-1) - ema(macdArr,9);
      out.dataA[tf] = {
        ema50:+e50.toFixed(2), ema200:+e200.toFixed(2),
        rsi14:+rsi(c,14).toFixed(1), atrPct:+((atr(h,l,c,14)/last)*100).toFixed(2),
        macdHist:+macdHist.toFixed(2)
      };
      console.log(`✅ [builder] A[${tf}] OK`);
    } catch (e) {
      console.error(`❌ [builder] A[${tf}] error:`, e.message);
      out.errors.push(`A[${tf}]: ${e.message}`);
    }
  }

  // You can similarly instrument Blocks B–H with console logs
  // ...

  console.log('▶ [builder] buildStaticPayload complete');
  return out;
}

(async()=>{
  try {
    const data = await buildStaticPayload();
    console.log('▶ [builder] Writing public/live.json');
    await mkdir('public',{recursive:true});
    await writeFile('public/live.json', JSON.stringify({timestamp:Date.now(),...data},null,2),'utf8');
    console.log('✅ [builder] public/live.json updated');
  } catch (e) {
    console.error('❌ [builder] Fatal build error:', e);
    process.exit(1);
  }
})();
