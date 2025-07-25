// netlify/edge-functions/data.js
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

    const body = wantJson
      ? JSON.stringify(payload)
      : `<!DOCTYPE html><html><body><pre id="dashboard-data">${JSON.stringify(payload)}</pre></body></html>`;

    return new Response(body, {
      headers: wantJson
        ? {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=0, must-revalidate",
            "CDN-Cache-Control": "public, s-maxage=60, must-revalidate",
          }
        : {
            "Content-Type": "text/html; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          },
    });
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
  // … sma, ema, rsi, atr, roc as before …

  /* BLOCK A indicators */
  // … unchanged …

  /* BLOCK B derivatives + BTC liquidations */
  try {
    // – Derivatives (fundingZ, oiDelta24h) as before –
    const fr = await safeJson(
      `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=1000`
    );
    const rates = fr.slice(-42).map((d) => +d.fundingRate);
    const mean = rates.reduce((s, x) => s + x, 0) / rates.length;
    const sd = Math.sqrt(
      rates.reduce((s, x) => s + (x - mean) ** 2, 0) / rates.length
    );
    const fundingZ = sd
      ? ((rates.at(-1) - mean) / sd).toFixed(2)
      : "0.00";

    const oiNow = await safeJson(
      `https://fapi.binance.com/fapi/v1/openInterest?symbol=${SYMBOL}`
    );
    const oiHist = await safeJson(
      `https://fapi.binance.com/futures/data/openInterestHist?symbol=${SYMBOL}&period=1h&limit=24`
    );
    const oiDelta24h = (
      (+oiNow.openInterest - +oiHist[0].sumOpenInterest) /
      +oiHist[0].sumOpenInterest *
      100
    ).toFixed(1);

    // – Fetch your pre‑scraped liquidations JSON from GitHub Pages –
    const liqUrl = new URL("/data/totalLiquidations.json", request.url).href;
    const liqJson = await safeJson(liqUrl);
    const btcLiq = (liqJson.data || []).find((r) => r.symbol === "BTC") || {};

    result.dataB = {
      fundingZ,
      oiDelta24h,
      liquidations: {
        long1h:  btcLiq.long1h   ?? null,
        short1h: btcLiq.short1h  ?? null,
        long4h:  btcLiq.long4h   ?? null,
        short4h: btcLiq.short4h  ?? null,
        long24h: btcLiq.long24h  ?? null,
        short24h:btcLiq.short24h ?? null,
      },
    };
  } catch (e) {
    result.dataB = { fundingZ: null, oiDelta24h: null, liquidations: null };
    result.errors.push("B: " + e.message);
  }

  /* BLOCK C ROC */
  // … unchanged …

  /* BLOCK D volume */
  // … unchanged …

  /* BLOCK E stress */
  // … unchanged …

  /* BLOCK F market structure */
  // … unchanged …

  /* BLOCK G macro */
  // … unchanged …

  /* BLOCK H sentiment */
  // … unchanged …

  return result;
}
