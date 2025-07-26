// netlify/edge-functions/data.js  (full working version)
// Deploys at /data and /data.json.
// All Binance requests retry EU‑friendly mirrors so dataA‑F populate even when US POPs are blocked.

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
      : `<!doctype html><html><body><pre>${JSON.stringify(payload, null, 2)}</pre></body></html>`;

    return new Response(body, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Content-Type": wantJson ? "application/json" : "text/html"
      }
    });
  } catch (err) {
    console.error("Edge function crash", err);
    return new Response("Error", { status: 500 });
  }
}

// ───────── helpers (math) ─────────
const sma = (a, p) => a.slice(-p).reduce((s, x) => s + x, 0) / p;
const ema = (a, p) => { if (a.length < p) return 0; const k = 2 / (p + 1); let e = sma(a.slice(0, p), p); for (let i = p; i < a.length; i++) e = a[i] * k + e * (1 - k); return e; };
const rsi = (a, p) => { if (a.length < p + 1) return 0; let up = 0, dn = 0; for (let i = 1; i <= p; i++) { const d = a[i] - a[i - 1]; d >= 0 ? (up += d) : (dn -= d); } let au = up / p, ad = dn / p; for (let i = p + 1; i < a.length; i++) { const d = a[i] - a[i - 1]; au = (au * (p - 1) + Math.max(d, 0)) / p; ad = (ad * (p - 1) + Math.max(-d, 0)) / p; } return ad ? 100 - 100 / (1 + au / ad) : 100; };
const atr = (h, l, c, p) => { if (h.length < p + 1) return 0; const t = []; for (let i = 1; i < h.length; i++) t.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))); return sma(t, p); };
const roc = (a, n) => a.length >= n + 1 ? ((a.at(-1) - a.at(-(n + 1))) / a.at(-(n + 1))) * 100 : 0;

// ───────── helpers (network) ─────────
const SPOT_HOSTS = ["https://api-gcp.binance.com", "https://api1.binance.com", "https://api2.binance.com", "https://api3.binance.com"];
const FUTURE_HOSTS = ["https://fapi.binance.com", "https://fapi1.binance.com", "https://fapi2.binance.com", "https://fapi3.binance.com"];

const binanceJson = async path => {
  const hosts = path.startsWith("/fapi") || path.startsWith("/futures") ? FUTURE_HOSTS : SPOT_HOSTS;
  let last;
  for (const h of hosts) {
    const r = await fetch(h + path);
    if (r.ok) return r.json();
    last = new Error(`HTTP ${r.status}`);
    if (![451, 403, 500, 502, 503].includes(r.status)) break;
  }
  throw last;
};
const safeJson = async u => { const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };

// ───────── builder ─────────
async function buildDashboardData() {
  const SYMBOL = "BTCUSDT", LIMIT = 250;
  const out = { dataA: {}, dataB: null, dataC: {}, dataD: {}, dataE: null, dataF: null, dataG: null, dataH: null, errors: [] };

  // A
  for (const tf of ["15m", "1h", "4h", "1d"]) try {
    const kl = await binanceJson(`/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`);
    const c = kl.map(r => +r[4]), h = kl.map(r => +r[2]), l = kl.map(r => +r[3]);
    const last = c.at(-1) || 1;
    const e50 = ema(c, 50), e200 = ema(c, 200);
    const macdArr = c.map((_, i) => ema(c.slice(0, i + 1), 12) - ema(c.slice(0, i + 1), 26));
    const macdHist = macdArr.at(-1) - ema(macdArr, 9);
    out.dataA[tf] = { ema50: +e50.toFixed(2), ema200: +e200.toFixed(2), rsi14: +rsi(c, 14).toFixed(1), atrPct: +((atr(h, l, c, 14) / last) * 100).toFixed(2), macdHist: +macdHist.toFixed(2) };
  } catch (e) { out.errors.push(`A[${tf}]: ${e.message}`); }

  // B
  try {
    const fr = await binanceJson(`/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=1000`);
    const rates = fr.slice(-42).map(d => +d.fundingRate);
    const mean = rates.reduce((s, x) => s + x, 0) / rates.length;
    const sd = Math.sqrt(rates.reduce((s, x) => s + (x - mean) ** 2, 0) / rates.length);
    const fundingZ = sd ? ((rates.at(-1) - mean) / sd).toFixed(2) : "0.00";

    const oiNow = await binanceJson(`/fapi/v1/openInterest?symbol=${SYMBOL}`);
    const oiHist = await binanceJson(`/futures/data/openInterestHist?symbol=${SYMBOL}&period=1h&limit=24`);
    const oiDelta24h = (((+oiNow.openInterest - +oiHist[0].sumOpenInterest) / +oiHist[0].sumOpenInterest) * 100).toFixed(1);

    const liq = await safeJson("https://raw.githubusercontent.com/Cydeee/Testliquidation/main/data/totalLiquidations.json");
    const btc = (liq.data || []).find(r => r.symbol === "BTC") || {};

    out.dataB = {
      fundingZ,
      oiDelta24h,
      liquidations: {
        long1h: btc.long1h || 0, short1h: btc.short1h || 0,
        long4h: btc.long4h || 0, short4h: btc.short4h || 0,
        long24h: btc.long24h || 0, short24h: btc.short24h || 0
      }
    };
  } catch (e) { out.dataB = { fundingZ: null, oiDelta24h: null, liquidations: null }; out.errors.push("B: " + e.message); }

  // C
  for (const tf of ["15m", "1h", "4h", "1d"]) try {
    const kl = await binanceJson(`/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=21`);
    const c = kl.map(r => +r[4]);
    out.dataC[tf] = { roc10: +roc(c, 10).toFixed(2), roc20: +roc(c, 20).toFixed(2) };
  } catch (e) { out.errors.push(`C[${tf}]: ${e.message}`); }

  // D
  try {
    const wins = { "15m": 0.25, "1h": 1, "4h": 4, "24h": 24 };
    out.dataD.cvd = {};
    for (const [lbl, hrs] of Object.entries(wins)) {
      const end = Date.now(), start = end - hrs * 3600000;
      const kl = await binanceJson(`/api/v3/klines?symbol=${SYMBOL}&interval=1m&startTime=${start}&endTime=${end}&limit=1500`);
      let bull = 0, bear = 0; kl.forEach(k => (+k[4] >= +k[1] ? (bull += +k[5]) : (bear += +
