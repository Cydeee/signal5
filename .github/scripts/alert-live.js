#!/usr/bin/env node
/**
 * Standalone High‑Conviction Alert
 * Re-implements the entire A→H pipeline in Node.js using built‑in fetch.
 */

const BOT_TOKEN = "8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw";
const CHAT_ID   = "6038110897";
const TEST_MODE = process.env.TEST_ALERT === "1";
const UA_DESKTOP= "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/109.0";

// Simple fetch‑wrapper to add UA and error on non‑OK
async function safeJson(url) {
  console.log(`▶ GET ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": UA_DESKTOP } });
  const text = await res.text();
  if (!res.ok) {
    console.error(`❗ HTTP ${res.status} at ${url}`, text.slice(0,200));
    throw new Error(`HTTP ${res.status}`);
  }
  return JSON.parse(text);
}

/* Helpers */
const sma = (arr,p) => arr.slice(-p).reduce((s,x)=>s+x,0)/p;
const ema = (arr,p) => {
  if (arr.length < p) return 0;
  const k = 2/(p+1);
  let e = sma(arr.slice(0,p), p);
  for (let i=p; i<arr.length; i++) e = arr[i]*k + e*(1-k);
  return e;
};
const rsi = (arr,p) => {
  if (arr.length < p+1) return 0;
  let up=0, down=0;
  for (let i=1;i<=p;i++){ const d=arr[i]-arr[i-1]; d>=0?up+=d:down+=-d; }
  let au=up/p, ad=down/p;
  for (let i=p+1;i<arr.length;i++){ const d=arr[i]-arr[i-1]; au=(au*(p-1)+Math.max(d,0))/p; ad=(ad*(p-1)+Math.max(-d,0))/p; }
  return ad?100 - 100/(1+au/ad) : 100;
};
const atr = (h,l,c,p) => {
  if (h.length < p+1) return 0;
  const tr = [];
  for (let i=1;i<h.length;i++){
    tr.push(Math.max(
      h[i]-l[i],
      Math.abs(h[i]-c[i-1]),
      Math.abs(l[i]-c[i-1])
    ));
  }
  return sma(tr,p);
};
const roc = (arr,n) =>
  arr.length >= n+1
    ? ((arr.at(-1) - arr.at(-(n+1))) / arr.at(-(n+1))) * 100
    : 0;

/* Build the full dashboard A→H */
async function buildDashboardData() {
  const SYMBOL = "BTCUSDT", LIMIT = 250;
  const out = { dataA:{}, dataB:null, dataC:{}, dataD:{}, dataE:null, dataF:null, dataG:null, dataH:null, errors:[] };

  // A: Indicators
  for (const tf of ["15m","1h","4h","1d"]) {
    try {
      const kl = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`);
      const closes=kl.map(r=>+r[4]), highs=kl.map(r=>+r[2]), lows=kl.map(r=>+r[3]), last=closes.at(-1)||1;
      const e50=ema(closes,50), e200=ema(closes,200);
      const macdArr=closes.map((_,i)=>ema(closes.slice(0,i+1),12)-ema(closes.slice(0,i+1),26));
      const macdHist=macdArr.at(-1)-ema(macdArr,9);
      out.dataA[tf]={ ema50:+e50.toFixed(2), ema200:+e200.toFixed(2), rsi14:+rsi(closes,14).toFixed(1), atrPct:+((atr(highs,lows,closes,14)/last)*100).toFixed(2), macdHist:+macdHist.toFixed(2) };
    } catch(e){ out.errors.push(`A[${tf}]: ${e.message}`); }
  }

  // B: Funding & Liquidations
  try {
    const fr = await safeJson(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=1000`);
    const rates=fr.slice(-42).map(d=>+d.fundingRate), mean=rates.reduce((s,x)=>s+x,0)/rates.length;
    const sd = Math.sqrt(rates.reduce((s,x)=>s+(x-mean)**2,0)/rates.length);
    const fundingZ = sd?((rates.at(-1)-mean)/sd).toFixed(2):"0.00";
    const oiNow = await safeJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${SYMBOL}`);
    const oiHist= await safeJson(`https://api.binance.com/futures/data/openInterestHist?symbol=${SYMBOL}&period=1h&limit=24`);
    const oiDelta24h = ((+oiNow.openInterest - +oiHist[0].sumOpenInterest)/+oiHist[0].sumOpenInterest*100).toFixed(1);
    const L = await safeJson("https://raw.githubusercontent.com/Cydeee/Testliquidation/main/data/totalLiquidations.json");
    const btc = (L.data||[]).find(r=>r.symbol==="BTC")||{};
    out.dataB = { fundingZ, oiDelta24h, liquidations:{
      long1h:btc.long1h||0, short1h:btc.short1h||0,
      long4h:btc.long4h||0, short4h:btc.short4h||0,
      long24h:btc.long24h||0, short24h:btc.short24h||0
    }};
  } catch(e){ out.dataB={fundingZ:null,oiDelta24h:null,liquidations:null}; out.errors.push(`B: ${e.message}`); }

  // C: ROC
  for (const tf of ["15m","1h","4h","1d"]) {
    try {
      const kl = await safeJson(`https://api.binance.com/api/v
