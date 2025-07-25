// netlify/edge-functions/data.js
// Lean build reordered: Derivatives → ROC → Volume → Stress
// Blocks: A indicators | B derivatives+liquidations | C ROC | D volume | E stress | F structure | G macro | H sentiment

export const config = { path: ["/data", "/data.json"], cache: "manual" };

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  const wantJson = new URL(request.url).pathname.endsWith("/data.json");
  try {
    const payload = await buildDashboardData(request);
    payload.timestamp = Date.now();

    if (wantJson) {
      return new Response(JSON.stringify(payload), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=0, must-revalidate",
          "CDN-Cache-Control": "public, s-maxage=60, must-revalidate",
        },
      });
    }
    return new Response(
      `<!DOCTYPE html><html><body><pre id="dashboard-data">${JSON.stringify(
        payload
      )}</pre></body></html>`,
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err) {
    console.error("Edge Function error", err);
    return new Response("Service temporarily unavailable.", {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

async function buildDashboardData(request) {
  const SYMBOL = "BTCUSDT";
  const LIMIT = 250;
  const result = {
    dataA: {},   // indicators
    dataB: null, // derivatives + liquidations
    dataC: {},   // ROC
    dataD: {},   // volume
    dataE: null, // stress
    dataF: null, // structure
    dataG: null, // macro
    dataH: null, // sentiment
    errors: [],
  };

  /* helpers */
  const safeJson = async (u) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
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
    for (let i = 1; i < h.length; i++) {
      tr.push(
        Math.max(
          h[i] - l[i],
          Math.abs(h[i] - c[i - 1]),
          Math.abs(l[i] - c[i - 1])
        )
      );
    }
    return sma(tr, p);
  };
  const roc = (a, n) =>
    a.length >= n + 1
      ? ((a.at(-1) - a.at(-(n + 1))) / a.at(-(n + 1))) * 100
      : 0;

  /* BLOCK A indicators */
  for (const tf of ["15m", "1h", "4h", "1d"]) {
    try {
      const kl = await safeJson(
        `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`
      );
      const closes = kl.map((r) => +r[4]),
        highs = kl.map((r) => +r[2]),
        lows = kl.map((r) => +r[3]),
        last = closes.at(-1) || 1;
      const e50 = ema(closes, 50),
        e200 = ema(closes, 200);
      const macdArr = [];
      for (let i = 0; i < closes.length; i++) {
        const sub = closes.slice(0, i + 1);
        macdArr.push(ema(sub, 12) - ema(sub, 26));
      }
      const macdHist = macdArr.at(-1) - ema(macdArr, 9);
      result.dataA[tf] = {
        ema50: +e50.toFixed(2),
        ema200: +e200.toFixed(2),
        rsi14: +rsi(closes, 14).toFixed(1),
        atrPct: +((atr(highs, lows, closes, 14) / last) * 100).toFixed(2),
        macdHist: +macdHist.toFixed(2),
      };
    } catch (e) {
      result.errors.push(`A[${tf}]: ${e.message}`);
    }
  }

  /* BLOCK B derivatives + liquidations */
  try {
    const fr = await safeJson(
      `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=1000`
    );
    const rates = fr.slice(-42).map((d) => +d.fundingRate),
      mean = rates.reduce((s, x) => s + x, 0) / rates.length,
      sd = Math.sqrt(
        rates.reduce((s, x) => s + (x - mean) ** 2, 0) / rates.length
      ),
      fundingZ = sd ? ((rates.at(-1) - mean) / sd).toFixed(2) : "0.00";
    const oiNow = await safeJson(
