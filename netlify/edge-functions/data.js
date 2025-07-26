// netlify/edge-functions/data.js —   Edge Function that serves /data and /data.json
// Blocks: A (indicators) | B (derivatives+liquidations) | C (ROC) | D (volume+CVD)
//         E (stress)     | F (structure + VPVR)         | G (macro) | H (sentiment)
// -----------------------------------------------------------------------------
// 2025‑07‑26 patch:  all Binance calls now go through a fallback host list that
// lives entirely in the EU / non‑US regions.  This eliminates HTTP 451 and 403
// geo‑blocks when the Edge POP is located in the US.
// -----------------------------------------------------------------------------

export const config = { path: ["/data", "/data.json"], cache: "manual" };

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }

  const wantJson = new URL(req.url).pathname.endsWith("/data.json");
  try {
    const payload = await buildDashboardData();
    payload.timestamp = Date.now();

    const body = wantJson
      ? JSON.stringify(payload)
      : `<!DOCTYPE html><html><body><pre id="dashboard-data">${JSON.stringify(payload, null, 2)}</pre></body></html>`;

    const hdrs = {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=0, must-revalidate",
      "CDN-Cache-Control": "public, s-maxage=60, must-revalidate",
      "Content-Type": wantJson ? "application/json; charset=utf-8" : "text/html; charset=utf-8"
    };
    return new Response(body, { headers: hdrs });
  } catch (err) {
    console.error("Edge Function error", err);
    return new Response("Service temporarily unavailable.", { status: 500 });
  }
}

// -----------------------------------------------------------------------------
// Helpers — math
// -----------------------------------------------------------------------------
const sma = (a, p) => a.slice(-p).reduce((s, x) => s + x, 0) / p;
const ema = (a, p) => {
  if (a.length < p) return 0;
  const k = 2 / (p + 1);
  let e = sma(a.slice(0, p), p);
  for (let i = p; i < a.length; i++) e = a[i] * k + e * (1 - k);
  return e;
};
const rsi = (a, p) => {
  if (a.length < p + 1) return 0;
  let up = 0, down = 0;
  for (let i = 1; i <= p; i++) {
    const d = a[i] - a[i - 1];
    d >= 0 ? (up += d) : (down -= d);
  }
  let au = up / p, ad = down / p;
  for (let i = p + 1; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    au = (au * (p - 1) + Math.max(d, 0)) / p;
    ad = (ad * (p - 1) + Math.max(-d, 0)) / p;
  }
  return ad ? 100 - 100 / (1 + au / ad) : 100;
};
const atr = (h, l, c, p) => {
  if (h.length < p + 1) return 0;
  const tr = [];
  for (let i = 1; i < h.length; i++)
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  return sma(tr, p);
};
const roc = (a, n) => (a.length >= n + 1 ? ((a.at(-1) - a.at(-(n + 1))) / a.at(-(n + 1))) * 100 : 0);

// -----------------------------------------------------------------------------
// Helpers — network
// -----------------------------------------------------------------------------
// Binance mirror list — all EU‑ or RoW‑hosted, avoids US geo‑blocks.
const BINANCE_HOSTS = [
  "https://api-gcp.binance.com",  // Google cloud, often EU POP
  "https://api1.binance.com",     // Asia‑Pacific
  "https://api2.binance.com",     // AWS‑EU Central
  "https://api3.binance.com"      // Misc (LatAm / EU fallback)
];

/**
 * Fetch Binance JSON with mirror fallback.
 * @param {string} path  "/api/v3/klines?..."  or "/fapi/v1/openInterest?..."
 */
async function binanceJson(path) {
  let lastErr;
  for (const host of BINANCE_HOSTS) {
    const url = host + path;
    const res = await fetch(url);
    if (res.ok) return res.json();
    lastErr = new Error(`HTTP ${res.status}`);
    if (![451, 403, 500, 502, 503].includes(res.status)) break; // unretryable
  }
  throw lastErr;
}

// Generic helper for non‑Binance endpoints
const safeJson = async url => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

// -----------------------------------------------------------------------------
// Main builder
// -----------------------------------------------------------------------------
async function buildDashboardData() {
  const SYMBOL = "BTCUSDT", LIMIT = 250;
  const out = {
    dataA: {}, dataB: null, dataC: {}, dataD: {},
    dataE: null, dataF: null, dataG: null, dataH: null, errors: []
  };

  /* BLOCK A — indicators */
  for (const tf of ["15m", "1h", "4h", "1d"]) {
    try {
      const kl = await binanceJson(`/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`);
      const c = kl.map(r => +r[4]), h = kl.map(r => +r[2]), l = kl.map(r => +r[3]);
      const last = c.at(-1) || 1;
      const e50 = ema(c, 50), e200 = ema(c, 200);
      const macdArr = c.map((_, i) => ema(c.slice(0, i + 1), 12) - ema(c.slice(0, i + 1), 26));
      const macdHist = macdArr.at(-1) - ema(macdArr, 9);
      out.dataA[tf] = {
        ema50: +e50.toFixed(2),
        ema200: +e200.toFixed(2),
        rsi14: +rsi(c, 14).toFixed(1),
        atrPct: +((atr(h, l, c, 14) / last) * 100).toFixed(2),
        macdHist: +macdHist.toFixed(2)
      };
    } catch (e) {
      out.errors.push(`A[${tf}]: ${e.message}`);
    }
  }

  /* BLOCK B — derivatives + liquidations */
  try {
    const fr = await binanceJson(`/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=1000`);
    const rates = fr.slice(-42).map(d => +d.fundingRate);
    const mean = rates.reduce((s, x) => s + x, 0) / rates.length;
    const sd = Math.sqrt(rates.reduce((s, x) => s + (x - mean) ** 2, 0) / rates.length);
    const fundingZ = sd ? ((rates.at(-1) - mean) / sd).toFixed(2) : "0.00";

    const oiNow  = await binanceJson(`/fapi/v1/openInterest?symbol=${SYMBOL}`);
    const oiHist = await binanceJson(`/futures/data/openInterestHist?symbol=${SYMBOL}&period=1h&limit=24`);
    const oiDelta24h = ((+oiNow.openInterest - +oiHist[0].sumOpenInterest) / +oiHist[0].sumOpenInterest * 100).toFixed(1);

    const liqRaw = await safeJson("https://raw.githubusercontent.com/Cydeee/Testliquidation/main/data/totalLiquidations.json");
    const btcLiq = (liqRaw.data || []).find(r => r.symbol === "BTC") || {};

    out.dataB = {
      fundingZ,
      oiDelta24h,
      liquidations: {
        long1h:   btcLiq.long1h   || 0,
        short1h:  btcLiq.short1h  || 0,
        long4h:   btcLiq.long4h   || 0,
        short4h:  btcLiq.short4h  || 0,
        long24h:  btcLiq.long24h  || 0,
        short24h: btcLiq.short24h || 0
      }
    };
  } catch (e) {
    out.dataB = { fundingZ: null, oiDelta24h: null, liquidations: null };
    out.errors.push("B: " + e.message);
  }

  /* BLOCK C — ROC */
  for (const tf of ["15m", "1h", "4h", "1d"]) {
    try {
      const kl = await binanceJson(`/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=21`);
      const c = kl.map(r => +r[4]);
      out.dataC[tf] = { roc10: +roc(c, 10).toFixed(2), roc20: +roc(c, 20).toFixed(2) };
    } catch (e) {
      out.errors.push(`C[${tf}]: ${e.message}`);
    }
  }

  /* BLOCK D — volume + CVD */
  try {
    const windows = { "15m": 0.25, "1h": 1, "4h": 4, "24h": 24 };
    out.dataD.cvd = {};
    for (const [lbl, hrs] of Object.entries(windows)) {
      const end = Date.now(), start = end - hrs * 3600000;
      const kl = await binanceJson(`/api/v3/klines?symbol=${SYMBOL}&interval=1m&startTime=${start}&endTime=${end}&limit=1500`);
      let bull = 0, bear = 0;
      for (const k of kl) (+k[4] >= +k[1] ? (bull += +k[5]) : (bear += +k[5]));
      const trades = await binanceJson(`/api/v3/aggTrades?symbol=${SYMBOL}&startTime=${start}&endTime=${end}&limit=1000`);
      let cvd = 0;
      for (const t of trades) cvd += t.m ? -(+t.q) : +(+t.q);
      out.dataD[lbl] = { bullVol: +bull.toFixed(2), bearVol: +bear.toFixed(2), totalVol: +(bull + bear).toFixed(2) };
      out.dataD.cvd[lbl] = +cvd.toFixed(2);
    }
    const tot24 = out.dataD["24h"].totalVol;
    const base = { "15m": tot24 / 96, "1h": tot24 / 24, "4h": tot24 / 6 };
    out.dataD.relative = {};
    for (const lbl of ["15m", "1h", "4h"]) {
      const r = out.dataD[lbl].totalVol / Math.max(base[lbl], 1);
      out.dataD.relative[lbl] = r > 2 ? "very high" : r > 1.2 ? "high" : r < 0.5 ? "low" : "normal";
    }
  } catch (e) {
    out.errors.push("D: " + e.message);
  }

  /* BLOCK E — synthetic stress */
  try {
    const b = Math.min(
