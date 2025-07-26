// netlify/edge-functions/data.js
import fs from 'fs';
import fetch from 'node-fetch';

// —— Exported function to generate the dashboard payload ——
export async function buildDashboardData() {
  const SYMBOL = "BTCUSDT";
  const LIMIT  = 250;
  const result = {
    dataA: {}, dataB: null, dataC: {}, dataD: {}, dataE: null,
    dataF: null, dataG: null, dataH: null, errors: []
  };

  /* helpers */
  const safeJson = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  const sma = (arr, p) =>
    arr.slice(-p).reduce((sum, x) => sum + x, 0) / p;
  const ema = (arr, p) => {
    if (arr.length < p) return 0;
    const k = 2/(p+1);
    let val = sma(arr.slice(0,p), p);
    for (let i = p; i < arr.length; i++) {
      val = arr[i] * k + val * (1 - k);
    }
    return val;
  };
  const rsi = (arr, p) => {
    if (arr.length < p+1) return 0;
    let up=0, down=0;
    for (let i = 1; i <= p; i++) {
      const d = arr[i] - arr[i-1];
      if (d >= 0) up += d; else down -= d;
    }
    let avgU = up/p, avgD = down/p;
    for (let i = p+1; i < arr.length; i++) {
      const d = arr[i] - arr[i-1];
      avgU = (avgU*(p-1) + Math.max(d,0)) / p;
      avgD = (avgD*(p-1) + Math.max(-d,0)) / p;
    }
    return avgD ? 100 - 100/(1 + avgU/avgD) : 100;
  };
  const atr = (H, L, C, p) => {
    if (H.length < p+1) return 0;
    const tr = [];
    for (let i = 1; i < H.length; i++) {
      tr.push(Math.max(
        H[i] - L[i],
        Math.abs(H[i] - C[i-1]),
        Math.abs(L[i] - C[i-1])
      ));
    }
    return sma(tr, p);
  };
  const roc = (arr, n) =>
    arr.length >= n+1
      ? ((arr.at(-1) - arr.at(-(n+1))) / arr.at(-(n+1))) * 100
      : 0;

  /* BLOCK A: indicators */
  for (const tf of ["15m","1h","4h","1d"]) {
    try {
      const kl     = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`);
      const closes = kl.map(r => +r[4]);
      const highs  = kl.map(r => +r[2]);
      const lows   = kl.map(r => +r[3]);
      const last   = closes.at(-1) || 1;

      const e50 = ema(closes,50), e200 = ema(closes,200);
      const macdArr = closes.map((_,i) => {
        const slice = closes.slice(0,i+1);
        return ema(slice,12) - ema(slice,26);
      });
      const macdHist = macdArr.at(-1) - ema(macdArr,9);

      result.dataA[tf] = {
        ema50:    +e50.toFixed(2),
        ema200:   +e200.toFixed(2),
        rsi14:    +rsi(closes,14).toFixed(1),
        atrPct:   +((atr(highs,lows,closes,14)/last)*100).toFixed(2),
        macdHist: +macdHist.toFixed(2)
      };
    } catch (e) {
      result.errors.push(`A[${tf}]: ${e.message}`);
    }
  }

  /* BLOCK B: derivatives */
  try {
    const fr    = await safeJson(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=1000`);
    const rates = fr.slice(-42).map(d => +d.fundingRate);
    const mean  = rates.reduce((s,x) => s + x, 0) / rates.length;
    const sd    = Math.sqrt(rates.reduce((s,x) => s + (x-mean)**2, 0) / rates.length);
    const fundingZ = sd ? ((rates.at(-1)-mean)/sd).toFixed(2) : "0.00";

    const oiNow   = await safeJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${SYMBOL}`);
    const oiHist  = await safeJson(`https://api.binance.com/api/v3/futures/data/openInterestHist?symbol=${SYMBOL}&period=1h&limit=24`);
    const oiDelta24h = ((+oiNow.openInterest - +oiHist[0].sumOpenInterest) / +oiHist[0].sumOpenInterest * 100).toFixed(1);

    result.dataB = { fundingZ, oiDelta24h };
  } catch (e) {
    result.dataB = { fundingZ:null, oiDelta24h:null };
    result.errors.push("B: " + e.message);
  }

  /* BLOCK C: ROC */
  for (const tf of ["15m","1h","4h","1d"]) {
    try {
      const kl     = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=21`);
      const closes = kl.map(r => +r[4]);
      result.dataC[tf] = {
        roc10: +roc(closes,10).toFixed(2),
        roc20: +roc(closes,20).toFixed(2)
      };
    } catch (e) {
      result.errors.push(`C[${tf}]: ${e.message}`);
    }
  }

  /* BLOCK D: volume */
  try {
    const kl      = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1m&limit=1500`);
    const now     = Date.now();
    const windows = { "15m":0.25, "1h":1, "4h":4, "24h":24 };

    for (const [lbl, hrs] of Object.entries(windows)) {
      const cutoff = now - hrs * 3600000;
      let bull = 0, bear = 0;
      for (const k of kl) {
        if (+k[0] < cutoff) continue;
        if (+k[4] >= +k[1]) {
          bull += +k[5];
        } else {
          bear += +k[5];
        }
      }
      result.dataD[lbl] = {
        bullVol:  +bull.toFixed(2),
        bearVol:  +bear.toFixed(2),
        totalVol: +(bull + bear).toFixed(2)
      };
    }

    const tot24 = result.dataD["24h"].totalVol;
    const base  = { "15m": tot24/96, "1h": tot24/24, "4h": tot24/6 };
    result.dataD.relative = {};
    for (const lbl of ["15m","1h","4h"]) {
      const ratio = result.dataD[lbl].totalVol / Math.max(base[lbl],1);
      result.dataD.relative[lbl] =
        ratio > 2 ? "very high" :
        ratio > 1.2 ? "high" :
        ratio < 0.5 ? "low" :
        "normal";
    }
  } catch (e) {
    result.errors.push("D: " + e.message);
  }

  /* BLOCK E, F, G, H… your existing blocks continue unchanged */

  return result;
}

// If run directly, write out the scraped JSON:
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    
::contentReference[oaicite:0]{index=0}
