// scripts/generate-live.js
// ----------------------------------------------
// Builds public/live.json every 15 minutes.
// • First tries direct EU‑mirror Binance fetches (3 retries each)
// • If ≥6 blocks still error out, falls back to your Edge payload
//   at https://btcsignal.netlify.app/data.json
// Always writes valid JSON to public/live.json.
// ----------------------------------------------

import { mkdir, writeFile } from "fs/promises";

const UA = "Mozilla/5.0 (GitHub Runner mirror)";
const SPOT = [
  "https://api.binance.me",
  "https://api1.binance.com",
  "https://api2.binance.com"
];
const FUT  = [
  "https://fapi.binance.me",
  "https://fapi.binance.com",
  "https://fapi2.binance.com"
];

// Fetch JSON with content‑type check & retry on failure
async function fetchJson(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        throw new Error(`Non‑JSON (${res.status})`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      await new Promise(r => setTimeout(r, 1200));
    }
  }
  throw lastErr;
}

// Round‑robin through hosts for spot/futures endpoints
async function bJson(path, futures = false) {
  const hosts = futures ? FUT : SPOT;
  let lastErr;
  for (const h of hosts) {
    try {
      return await fetchJson(h + path);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// Simple math helpers
const sma = (a,p) => a.slice(-p).reduce((s,x)=>s+x,0)/p;
const ema = (a,p) => {
  if (a.length < p) return 0;
  const k = 2/(p+1);
  let e = sma(a.slice(0,p),p);
  for (let i = p; i < a.length; i++) {
    e = a[i]*k + e*(1-k);
  }
  return e;
};
const rsi = (a,p) => {
  if (a.length < p+1) return 0;
  let up=0, down=0;
  for (let i=1; i<=p; i++){
    const d = a[i] - a[i-1];
    d>=0? up+=d : down-=d;
  }
  let au = up/p, ad = down/p;
  for (let i=p+1; i<a.length; i++){
    const d = a[i] - a[i-1];
    au = (au*(p-1) + Math.max(d,0))/p;
    ad = (ad*(p-1) + Math.max(-d,0))/p;
  }
  return ad ? 100 - 100/(1+au/ad) : 100;
};
const atr = (h,l,c,p) => {
  if (h.length < p+1) return 0;
  const tr = [];
  for (let i=1; i<h.length; i++){
    tr.push(Math.max(
      h[i]-l[i],
      Math.abs(h[i]-c[i-1]),
      Math.abs(l[i]-c[i-1])
    ));
  }
  return sma(tr,p);
};
const roc = (a,n) =>
  a.length >= n+1
    ? ((a.at(-1) - a.at(-(n+1))) / a.at(-(n+1))) * 100
    : 0;

// Core builder function
async function buildDashboard() {
  const S="BTCUSDT", LIMIT=250;
  const out = {
    dataA:{}, dataB:null, dataC:{}, dataD:{},
    dataE:null, dataF:null, dataG:null, dataH:null,
    errors:[]
  };

  // A: Indicators
  for (const tf of ["15m","1h","4h","1d"]) {
    try {
      const kl = await bJson(`/fapi/v1/klines?symbol=${S}&interval=${tf}&limit=${LIMIT}`, true);
      const c = kl.map(r=>+r[4]), h = kl.map(r=>+r[2]), l = kl.map(r=>+r[3]);
      const last = c.at(-1) || 1;
      const e50 = ema(c,50), e200 = ema(c,200);
      const macdArr = c.map((_,i) => ema(c.slice(0,i+1),12) - ema(c.slice(0,i+1),26));
      const macdHist = macdArr.at(-1) - ema(macdArr,9);
      out.dataA[tf] = {
        ema50:+e50.toFixed(2),
        ema200:+e200.toFixed(2),
        rsi14:+rsi(c,14).toFixed(1),
        atrPct:+((atr(h,l,c,14)/last)*100).toFixed(2),
        macdHist:+macdHist.toFixed(2)
      };
    } catch (e) {
      out.errors.push(`A[${tf}]: ${e.message}`);
    }
  }

  // B: Funding & Liquidations
  try {
    const fr = await bJson(`/fapi/v1/fundingRate?symbol=${S}&limit=1000`, true);
    const rates = fr.slice(-42).map(d=>+d.fundingRate);
    const mu = rates.reduce((a,b)=>a+b,0)/rates.length;
    const sd = Math.sqrt(rates.reduce((s,x)=>s+(x-mu)**2,0)/rates.length);
    const fundingZ = sd ? ((rates.at(-1)-mu)/sd).toFixed(2) : "0.00";

    const oiNow = await bJson(`/fapi/v1/openInterest?symbol=${S}`, true);
    const oiHist= await bJson(`/futures/data/openInterestHist?symbol=${S}&period=1h&limit=24`, true);
    const oiΔ  = (((+oiNow.openInterest - +oiHist[0].sumOpenInterest) / +oiHist[0].sumOpenInterest)*100).toFixed(1);

    const liqRaw = await fetchJson("https://raw.githubusercontent.com/Cydeee/Testliquidation/main/data/totalLiquidations.json");
    const btc    = (liqRaw.data||[]).find(r=>r.symbol==="BTC")||{};
    out.dataB = {
      fundingZ,
      oiDelta24h: oiΔ,
      liquidations: {
        long1h:   btc.long1h   || 0,
        short1h:  btc.short1h  || 0,
        long4h:   btc.long4h   || 0,
        short4h:  btc.short4h  || 0,
        long24h:  btc.long24h  || 0,
        short24h: btc.short24h || 0
      }
    };
  } catch (e) {
    out.dataB = { fundingZ:null, oiDelta24h:null, liquidations:null };
    out.errors.push("B: "+e.message);
  }

  // C: ROC
  for (const tf of ["15m","1h","4h","1d"]) {
    try {
      const kl = await bJson(`/fapi/v1/klines?symbol=${S}&interval=${tf}&limit=21`, true);
      const c  = kl.map(r=>+r[4]);
      out.dataC[tf] = { roc10:+roc(c,10).toFixed(2), roc20:+roc(c,20).toFixed(2) };
    } catch (e) {
      out.errors.push(`C[${tf}]: ${e.message}`);
    }
  }

  // D: Volume & CVD
  try {
    const wins = { "15m":0.25, "1h":1, "4h":4, "24h":24 };
    out.dataD.cvd = {};
    for (const [lbl,hrs] of Object.entries(wins)) {
      const end = Date.now(), start = end - hrs*3600000;
      const kl  = await bJson(`/fapi/v1/klines?symbol=${S}&interval=1m&startTime=${start}&endTime=${end}&limit=1500`, true);
      let bull=0, bear=0;
      kl.forEach(k=>+k[4]>=+k[1]?bull+=+k[5]:bear+=+k[5]);
      const ag  = await bJson(`/fapi/v1/aggTrades?symbol=${S}&startTime=${start}&endTime=${end}&limit=1000`, true);
      let cvd = 0;
      ag.forEach(t=>{ const q=+t.q; cvd += t.m? -q : q; });
      out.dataD[lbl] = { bullVol:+bull.toFixed(2), bearVol:+bear.toFixed(2), totalVol:+(bull+bear).toFixed(2) };
      out.dataD.cvd[lbl] = +cvd.toFixed(2);
    }
    const tot24 = out.dataD["24h"].totalVol;
    const base  = { "15m":tot24/96, "1h":tot24/24, "4h":tot24/6 };
    out.dataD.relative = {};
    for (const lbl of ["15m","1h","4h"]) {
      const r = out.dataD[lbl].totalVol / Math.max(base[lbl],1);
      out.dataD.relative[lbl] = r>2 ? "very high" : r>1.2 ? "high" : r<0.5 ? "low" : "normal";
    }
  } catch (e) {
    out.errors.push("D: "+e.message);
  }

  // E: Synthetic Stress
  try {
    const b = Math.min(3, Math.abs(+out.dataB.fundingZ||0));
    const l = Math.max(0, (+out.dataB.oiDelta24h||0)/5);
    const vf= out.dataD.relative["15m"];
    const v = vf==="very high"?2:vf==="high"?1:0;
    const liq = out.dataB.liquidations||{};
    const imb = Math.abs((liq.long24h||0)-(liq.short24h||0));
    const ls  = Math.min(2, imb/1e6);
    const s   = b + l + v + ls;
    out.dataE = { stressIndex:+s.toFixed(2), highRisk:s>=5, components:{biasScore:b,levScore:l,volScore:v,liqScore:ls}, source:"synthetic" };
  } catch (e) {
    out.dataE = null;
    out.errors.push("E: "+e.message);
  }

  // F: VPVR
  try {
    const h4 = await bJson(`/fapi/v1/klines?symbol=${S}&interval=4h&limit=96`, true);
    const d1 = await bJson(`/fapi/v1/klines?symbol=${S}&interval=1d&limit=30`, true);
    const w1 = await bJson(`/fapi/v1/klines?symbol=${S}&interval=1w&limit=12`, true);
    const vp = bars => {
      const bk = {};
      bars.forEach(b => {
        const px = (+b[2] + +b[3] + +b[4]) / 3;
        const v  = +b[5];
        const key= Math.round(px/100)*100;
        bk[key] = (bk[key]||0) + v;
      });
      const poc = +Object.entries(bk).sort((a,b)=>b[1]-a[1])[0][0];
      return { poc, buckets: bk };
    };
    out.dataF = { vpvr: { "4h": vp(h4), "1d": vp(d1), "1w": vp(w1) } };
  } catch (e) {
    out.errors.push("F: "+e.message);
  }

  // G: Macro
  try {
    const g = (await fetchJson("https://api.coingecko.com/api/v3/global")).data;
    out.dataG = {
      totalMcapT: +(g.total_market_cap.usd/1e12).toFixed(2),
      mcap24hPct: +g.market_cap_change_percentage_24h_usd.toFixed(2),
      btcDominance: +g.market_cap_percentage.btc.toFixed(2),
      ethDominance: +g.market_cap_percentage.eth.toFixed(2)
    };
  } catch (e) {
    out.errors.push("G: "+e.message);
  }

  // H: Sentiment
  try {
    const f0 = (await fetchJson("https://api.alternative.me/fng/?limit=1")).data?.[0];
    if (!f0) throw new Error("FNG missing");
    out.dataH = { fearGreed: `${f0.value} · ${f0.value_classification}` };
  } catch (e) {
    out.errors.push("H: "+e.message);
  }

  return out;
}

// Main entrypoint
(async () => {
  console.log("⏳ building live.json …");
  let payload, fallback = false;

  try {
    payload = await buildDashboard();
    payload.timestamp = Date.now();

    // If too many errors, fall back to Edge Function
    if (payload.errors.length >= 6) {
      console.warn("⚠️  too many errors, falling back to Edge JSON");
      fallback = true;
      const edgeRes = await fetch("https://btcsignal.netlify.app/data.json", { cache: "no-store" });
      payload = await edgeRes.json();
    }
  } catch (outerErr) {
    console.error("❌ buildDashboard failed:", outerErr);
    fallback = true;
    const edgeRes = await fetch("https://btcsignal.netlify.app/data.json", { cache: "no-store" });
    payload = await edgeRes.json();
  }

  if (!fallback) {
    if (payload.errors.length) {
      console.warn(`⚠️ build finished with ${payload.errors.length} errors:`);
      payload.errors.forEach(e => console.warn(" •", e));
    } else {
      console.log("✅ all fetches succeeded");
    }
  }

  await mkdir("public", { recursive: true });
  await writeFile("public/live.json", JSON.stringify(payload, null, 2), "utf8");
  console.log(`✅ public/live.json written (${JSON.stringify(payload).length} bytes)`);
})();
