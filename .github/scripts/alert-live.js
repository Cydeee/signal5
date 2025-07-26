/**
 * Standalone High‑Conviction Alert
 * Re‑implements A→H logic in Node.js with desktop UA,
 * then scores & sends Telegram if threshold met.
 */

const BOT_TOKEN = "8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw";
const CHAT_ID   = "6038110897";
const TEST_MODE = process.env.TEST_ALERT === "1";
const UA        = "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/109.0";

// safeJson: fetch JSON with desktop UA, error on non-ok
async function safeJson(url) {
  console.log(`▶ GET ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  const text = await res.text();
  if (!res.ok) {
    console.error(`❗ HTTP ${res.status} @ ${url}`, text.slice(0,200));
    throw new Error(`HTTP ${res.status}`);
  }
  return JSON.parse(text);
}

// Math helpers
const sma = (a,p)=>a.slice(-p).reduce((s,x)=>s+x,0)/p;
const ema = (a,p)=> {
  if (a.length < p) return 0;
  const k = 2/(p+1);
  let e = sma(a.slice(0,p),p);
  for (let i=p;i<a.length;i++) e = a[i]*k + e*(1-k);
  return e;
};
const rsi = (a,p)=> {
  if (a.length < p+1) return 0;
  let up=0, down=0;
  for (let i=1;i<=p;i++){ const d=a[i]-a[i-1]; d>=0?up+=d:down+=-d; }
  let au=up/p, ad=down/p;
  for (let i=p+1;i<a.length;i++){ const d=a[i]-a[i-1]; au=(au*(p-1)+Math.max(d,0))/p; ad=(ad*(p-1)+Math.max(-d,0))/p; }
  return ad?100-100/(1+au/ad):100;
};
const atr = (h,l,c,p)=> {
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
const roc = (a,n)=>
  a.length>=n+1
    ? ((a.at(-1) - a.at(-(n+1))) / a.at(-(n+1))) * 100
    : 0;

// Builds entire dashboard payload A→H
async function buildDashboardData() {
  const SYMBOL = "BTCUSDT", LIMIT = 250;
  const out = {
    dataA:{}, dataB:null, dataC:{}, dataD:{}, dataE:null,
    dataF:null, dataG:null, dataH:null, errors:[]
  };

  // A: Indicators
  for (const tf of ["15m","1h","4h","1d"]) {
    try {
      const kl = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`);
      const closes=kl.map(r=>+r[4]), highs=kl.map(r=>+r[2]), lows=kl.map(r=>+r[3]);
      const last = closes.at(-1)||1;
      const e50=ema(closes,50), e200=ema(closes,200);
      const macdArr=closes.map((_,i)=>ema(closes.slice(0,i+1),12)-ema(closes.slice(0,i+1),26));
      const macdHist=macdArr.at(-1)-ema(macdArr,9);
      out.dataA[tf] = {
        ema50:+e50.toFixed(2),
        ema200:+e200.toFixed(2),
        rsi14:+rsi(closes,14).toFixed(1),
        atrPct:+((atr(highs,lows,closes,14)/last)*100).toFixed(2),
        macdHist:+macdHist.toFixed(2)
      };
    } catch(e) {
      out.errors.push(`A[${tf}]: ${e.message}`);
    }
  }

  // B: Derivatives + Liquidations
  try {
    const fr = await safeJson(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=1000`);
    const rates=fr.slice(-42).map(d=>+d.fundingRate);
    const mean=rates.reduce((s,x)=>s+x,0)/rates.length;
    const sd=Math.sqrt(rates.reduce((s,x)=>s+(x-mean)**2,0)/rates.length);
    const fundingZ = sd?((rates.at(-1)-mean)/sd).toFixed(2):"0.00";
    const oiNow=await safeJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${SYMBOL}`);
    const oiHist=await safeJson(`https://api.binance.com/futures/data/openInterestHist?symbol=${SYMBOL}&period=1h&limit=24`);
    const oiDelta24h=((+oiNow.openInterest - +oiHist[0].sumOpenInterest)/+oiHist[0].sumOpenInterest*100).toFixed(1);
    const L=await safeJson("https://raw.githubusercontent.com/Cydeee/Testliquidation/main/data/totalLiquidations.json");
    const btc=(L.data||[]).find(r=>r.symbol==="BTC")||{};
    out.dataB = {
      fundingZ, oiDelta24h,
      liquidations:{
        long1h:btc.long1h||0, short1h:btc.short1h||0,
        long4h:btc.long4h||0, short4h:btc.short4h||0,
        long24h:btc.long24h||0, short24h:btc.short24h||0
      }
    };
  } catch(e) {
    out.dataB={fundingZ:null,oiDelta24h:null,liquidations:null};
    out.errors.push(`B: ${e.message}`);
  }

  // C: ROC
  for (const tf of ["15m","1h","4h","1d"]) {
    try {
      const kl = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=21`);
      const closes=kl.map(r=>+r[4]);
      out.dataC[tf] = { roc10:+roc(closes,10).toFixed(2), roc20:+roc(closes,20).toFixed(2) };
    } catch(e) {
      out.errors.push(`C[${tf}]: ${e.message}`);
    }
  }

  // D: Volume + CVD
  try {
    const wins={"15m":0.25,"1h":1,"4h":4,"24h":24};
    out.dataD.cvd={};
    for (const [lbl,hrs] of Object.entries(wins)) {
      const end=Date.now(), start=end-hrs*3600000;
      const kl=await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1m&startTime=${start}&endTime=${end}&limit=1500`);
      let bull=0,bear=0;
      kl.forEach(k=> +k[4]>=+k[1]? bull+=+k[5]: bear+=+k[5]);
      const trades=await safeJson(`https://api.binance.com/api/v3/aggTrades?symbol=${SYMBOL}&startTime=${start}&endTime=${end}&limit=1000`);
      let cvd=0; trades.forEach(t=> cvd += t.m?-(+t.q):+t.q);
      out.dataD[lbl]={ bullVol:+bull.toFixed(2), bearVol:+bear.toFixed(2), totalVol:+(bull+bear).toFixed(2) };
      out.dataD.cvd[lbl]=+cvd.toFixed(2);
    }
    const tot24=out.dataD["24h"].totalVol;
    const base={"15m":tot24/96,"1h":tot24/24,"4h":tot24/6};
    out.dataD.relative={};
    for (const lbl of ["15m","1h","4h"]) {
      const r=out.dataD[lbl].totalVol/Math.max(base[lbl],1);
      out.dataD.relative[lbl]=r>2?"very high":r>1.2?"high":r<0.5?"low":"normal";
    }
  } catch(e) {
    out.errors.push(`D: ${e.message}`);
  }

  // E: Synthetic Stress
  try {
    const b=Math.min(3,Math.abs(+out.dataB.fundingZ||0));
    const l=Math.max(0,(+out.dataB.oiDelta24h||0)/5);
    const vf=out.dataD.relative["15m"], v=vf==="very high"?2:vf==="high"?1:0;
    const liq=out.dataB.liquidations||{}, imb=Math.abs((liq.long24h||0)-(liq.short24h||0));
    const ls=Math.min(2,imb/1e6), s=b+l+v+ls;
    out.dataE={ stressIndex:+s.toFixed(2), highRisk:s>=5, components:{biasScore:b,levScore:l,volScore:v,liqScore:ls}, source:"synthetic" };
  } catch(e) {
    out.dataE=null;
    out.errors.push(`E: ${e.message}`);
  }

  // F: VPVR
  try {
    const b4=await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=4h&limit=96`);
    const b1=await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1d&limit=30`);
    const b7=await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1w&limit=12`);
    const vp=bars=>{
      const bk={};
      bars.forEach(b=>{ const px=(+b[2]+ +b[3]+ +b[4])/3, v=+b[5], k=Math.round(px/100)*100; bk[k]=(bk[k]||0)+v; });
      const poc=+Object.entries(bk).sort((a,b)=>b[1]-a[1])[0][0];
      return { poc,buckets:bk };
    };
    out.dataF={ vpvr:{ "4h":vp(b4), "1d":vp(b1), "1w":vp(b7) } };
  } catch(e) {
    out.errors.push(`F: ${e.message}`);
  }

  // G: Macro
  try {
    const gv=await safeJson("https://api.coingecko.com/api/v3/global"); const g=gv.data;
    out.dataG={ totalMcapT:+(g.total_market_cap.usd/1e12).toFixed(2), mcap24hPct:+g.market_cap_change_percentage_24h_usd.toFixed(2), btcDominance:+g.market_cap_percentage.btc.toFixed(2), ethDominance:+g.market_cap_percentage.eth.toFixed(2) };
  } catch(e) {
    out.errors.push(`G: ${e.message}`);
  }

  // H: Sentiment
  try {
    const fg=await safeJson("https://api.alternative.me/fng/?limit=1"); const f0=fg.data?.[0]; if(!f0) throw new Error("FNG missing");
    out.dataH={ fearGreed:`${f0.value} · ${f0.value_classification}` };
  } catch(e) {
    out.errors.push(`H: ${e.message}`);
  }

  return out;
}

// Scoring & Telegram
async function sendTelegram(msg) {
  console.log("▶ Sending Telegram:", msg);
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ chat_id:CHAT_ID, text:msg, parse_mode:"Markdown", disable_web_page_preview:true })
  });
  const j = await res.json();
  console.log("◀ Telegram response:", j);
  if (!j.ok) throw new Error(j.description);
}

(async()=>{
  console.log("🔍 Building dashboard data…");
  let data;
  try {
    data = await buildDashboardData();
    console.log("✅ Dashboard data ready");
  } catch(err) {
    console.error("❌ Error building data:", err);
    process.exit(1);
  }

  console.log("▶ Scoring…");
  const { long, short } = (() => {
    const A1h = data.dataA["1h"]||{};
    const B   = data.dataB||{};
    const D   = data.dataD||{};
    const F4h = data.dataF?.vpvr?.["4h"]||{};
    const E   = data.dataE||{};
    let L=0, S=0;
    if (A1h.rsi14 < 35) L++; else if (A1h.rsi14 > 65) S++;
    if (A1h.macdHist > 0) L++; else if (A1h.macdHist < 0) S++;
    if (B.fundingZ < -1) L++; else if (B.fundingZ > 1) S++;
    if (B.liquidations.short24h > 2*B.liquidations.long24h) L++;
    if (B.liquidations.long24h > 2*B.liquidations.short24h) S++;
    if (D.cvd["1h"] > 1000 && (D.relative["15m"]==="high"||D.relative["15m"]==="very high")) L+=2;
    if (D.cvd["1h"] < -1000 && (D.relative["15m"]==="high"||D.relative["15m"]==="very high")) S+=2;
    if (data.dataD["15m"].bullVol > data.dataD["15m"].bearVol) L++; else if (data.dataD["15m"].bearVol > data.dataD["15m"].bullVol) S++;
    if (A1h.ema50 > F4h.poc) L++; else if (A1h.ema50 < F4h.poc) S++;
    if (E.stressIndex >=3 && E.stressIndex <=5) { L++; S++; }
    return { long:L, short:S };
  })();
  console.log("▶ Scores:", { long, short });

  if (TEST_MODE) {
    console.log("✅ TEST alert");
    await sendTelegram("✅ *TEST ALERT* — bot online");
    return;
  }

  const THRESHOLD = 6;
  if (long >= THRESHOLD || short >= THRESHOLD) {
    const dir = long >= THRESHOLD ? "LONG" : "SHORT";
    const sc  = Math.max(long, short);
    const msg = `🚀 *High-Conviction ${dir}* (score ${sc})`;
    await sendTelegram(msg);
    console.log("✅ Alert sent:", msg);
  } else {
    console.log("🚫 No high-conviction signal this run");
  }
})();
