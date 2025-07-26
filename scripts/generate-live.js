// scripts/generate-live.js
// Node ≥18 CLI: fully independent builder for public/live.json
// Includes UA header to avoid 451 on Binance endpoints

import { mkdir, writeFile } from 'fs/promises';

async function buildStaticPayload() {
  const SYMBOL = "BTCUSDT";
  const LIMIT  = 250;
  const out = {
    dataA:{}, dataB:null, dataC:{}, dataD:{}, dataE:null,
    dataF:null, dataG:null, dataH:null, errors:[]
  };

  const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/109.0";

  /** fetch JSON with UA header **/
  async function safeJson(url) {
    const res = await fetch(url, { headers:{ "User-Agent": UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} at ${url}`);
    return res.json();
  }

  const sma = (a,p)=>a.slice(-p).reduce((s,x)=>s+x,0)/p;
  const ema = (a,p)=>{ if(a.length<p) return 0; const k=2/(p+1); let e=sma(a.slice(0,p),p); for(let i=p;i<a.length;i++) e=a[i]*k+e*(1-k); return e; };
  const rsi = (a,p)=>{ if(a.length<p+1) return 0; let u=0,d=0; for(let i=1;i<=p;i++){const d=a[i]-a[i-1]; d>=0?u+=d:d-=d;} let au=u/p,ad=d/p; for(let i=p+1;i<a.length;i++){const d=a[i]-a[i-1]; au=(au*(p-1)+Math.max(d,0))/p; ad=(ad*(p-1)+Math.max(-d,0))/p;} return ad?100-100/(1+au/ad):100; };
  const atr = (h,l,c,p)=>{ if(h.length<p+1) return 0; const tr=[]; for(let i=1;i<h.length;i++) tr.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1]))); return sma(tr,p); };
  const roc = (a,n)=>a.length>=n+1?((a.at(-1)-a.at(-(n+1)))/a.at(-(n+1))*100):0;

  /* BLOCK A: indicators */
  for (const tf of ["15m","1h","4h","1d"]) {
    try {
      const kl = await safeJson(
        `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`
      );
      const closes = kl.map(r=>+r[4]),
            highs  = kl.map(r=>+r[2]),
            lows   = kl.map(r=>+r[3]);
      const last = closes.at(-1) || 1;
      const e50  = ema(closes,50), e200 = ema(closes,200);
      const macdA = [];
      for (let i=0;i<closes.length;i++){
        const sub = closes.slice(0,i+1);
        macdA.push(ema(sub,12)-ema(sub,26));
      }
      const macdHist = macdA.at(-1) - ema(macdA,9);
      out.dataA[tf] = {
        ema50: +e50.toFixed(2),
        ema200:+e200.toFixed(2),
        rsi14: +rsi(closes,14).toFixed(1),
        atrPct:+((atr(highs,lows,closes,14)/last)*100).toFixed(2),
        macdHist:+macdHist.toFixed(2)
      };
    } catch(e) {
      out.errors.push(`A[${tf}]: ${e.message}`);
    }
  }

  /* BLOCK B: derivatives + liquidations */
  try {
    const fr = await safeJson(
      `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=1000`
    );
    const rates = fr.slice(-42).map(d=>+d.fundingRate);
    const mean  = rates.reduce((s,x)=>s+x,0)/rates.length;
    const sd    = Math.sqrt(rates.reduce((s,x)=>s+(x-mean)**2,0)/rates.length);
    const fundingZ = sd?((rates.at(-1)-mean)/sd).toFixed(2):"0.00";
    const oiNow    = await safeJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${SYMBOL}`);
    const oiHist   = await safeJson(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${SYMBOL}&period=1h&limit=24`);
    const oiDelta24h = ((+oiNow.openInterest - +oiHist[0].sumOpenInterest)/+oiHist[0].sumOpenInterest*100).toFixed(1);

    const RAW = "https://raw.githubusercontent.com/Cydeee/Testliquidation/main/data/totalLiquidations.json";
    const lj  = await safeJson(RAW);
    const btc = (lj.data||[]).find(r=>r.symbol==="BTC")||{};
    out.dataB = {
      fundingZ, oiDelta24h,
      liquidations:{
        long1h:   btc.long1h   ?? 0,
        short1h:  btc.short1h  ?? 0,
        long4h:   btc.long4h   ?? 0,
        short4h:  btc.short4h  ?? 0,
        long24h:  btc.long24h  ?? 0,
        short24h: btc.short24h ?? 0
      }
    };
  } catch(e) {
    out.dataB = { fundingZ:null, oiDelta24h:null, liquidations:null };
    out.errors.push("B: "+e.message);
  }

  /* BLOCK C: ROC */
  for (const tf of ["15m","1h","4h","1d"]) {
    try {
      const kl = await safeJson(
        `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=21`
      );
      const closes = kl.map(r=>+r[4]);
      out.dataC[tf] = {
        roc10:+roc(closes,10).toFixed(2),
        roc20:+roc(closes,20).toFixed(2)
      };
    } catch(e) {
      out.errors.push(`C[${tf}]: ${e.message}`);
    }
  }

  /* BLOCK D: volume + CVD */
  try {
    const windows = { "15m":0.25, "1h":1, "4h":4, "24h":24 };
    out.dataD.cvd = {};
    for (const [lbl,hrs] of Object.entries(windows)) {
      const end   = Date.now(),
            start = end - hrs*3600000;
      const kl = await safeJson(
        `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1m&startTime=${start}&endTime=${end}&limit=1500`
      );
      let bull=0,bear=0;
      for (const k of kl) +k[4]>=+k[1]? bull+=+k[5]: bear+=+k[5];
      const trades = await safeJson(
        `https://api.binance.com/api/v3/aggTrades?symbol=${SYMBOL}&startTime=${start}&endTime=${end}&limit=1000`
      );
      let cvd = 0;
      for (const t of trades) cvd += t.m? -(+t.q): +(+t.q);
      out.dataD[lbl] = {
        bullVol:+bull.toFixed(2),
        bearVol:+bear.toFixed(2),
        totalVol:+(bull+bear).toFixed(2)
      };
      out.dataD.cvd[lbl] = +cvd.toFixed(2);
    }
    const tot24 = out.dataD["24h"].totalVol,
          base  = { "15m":tot24/96, "1h":tot24/24, "4h":tot24/6 };
    out.dataD.relative = {};
    for (const lbl of ["15m","1h","4h"]) {
      const r = out.dataD[lbl].totalVol/Math.max(base[lbl],1);
      out.dataD.relative[lbl] = r>2?"very high": r>1.2?"high": r<0.5?"low": "normal";
    }
  } catch(e) {
    out.errors.push("D: "+e.message);
  }

  /* BLOCK E: synthetic stress */
  try {
    const biasScore = Math.min(3,Math.abs(+out.dataB.fundingZ||0));
    const levScore  = Math.max(0,(+out.dataB.oiDelta24h||0)/5);
    const vf        = out.dataD.relative["15m"];
    const volScore  = vf==="very high"?2:vf==="high"?1:0;
    const liq       = out.dataB.liquidations||{};
    const imb       = Math.abs((liq.long24h||0)-(liq.short24h||0));
    const liqScore  = Math.min(2,imb/1e6);
    const stress    = biasScore + levScore + volScore + liqScore;
    out.dataE = {
      stressIndex:+stress.toFixed(2),
      highRisk: stress>=5,
      components:{ biasScore, levScore, volScore, liqScore },
      source:"synthetic"
    };
  } catch(e) {
    out.dataE = null;
    out.errors.push("E: "+e.message);
  }

  /* BLOCK F: structure + VPVR */
  try {
    const b4 = await safeJson(
      `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=4h&limit=96`
    );
    const b1 = await safeJson(
      `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1d&limit=30`
    );
    const b7 = await safeJson(
      `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1w&limit=12`
    );
    function vp(bars){
      const bk={};
      for(const x of bars){
        const px=(+x[2]+ +x[3]+ +x[4])/3, v=+x[5];
        const key=Math.round(px/100)*100;
        bk[key]=(bk[key]||0)+v;
      }
      const poc=+Object.entries(bk).sort((a,b)=>b[1]-a[1])[0][0];
      return { poc, buckets: bk };
    }
    out.dataF={ vpvr:{ "4h":vp(b4), "1d":vp(b1), "1w":vp(b7) } };
  } catch(e) {
    out.errors.push("F: "+e.message);
  }

  /* BLOCK G: macro */
  try {
    const gv = await safeJson("https://api.coingecko.com/api/v3/global");
    const gd = gv.data;
    out.dataG = {
      totalMcapT:+(gd.total_market_cap.usd/1e12).toFixed(2),
      mcap24hPct:+gd.market_cap_change_percentage_24h_usd.toFixed(2),
      btcDominance:+gd.market_cap_percentage.btc.toFixed(2),
      ethDominance:+gd.market_cap_percentage.eth.toFixed(2)
    };
  } catch(e) {
    out.errors.push("G: "+e.message);
  }

  /* BLOCK H: sentiment */
  try {
    const fg = await safeJson("https://api.alternative.me/fng/?limit=1");
    const f0 = fg.data?.[0]; if(!f0) throw new Error("FNG missing");
    out.dataH = { fearGreed:`${f0.value} · ${f0.value_classification}` };
  } catch(e) {
    out.errors.push("H: "+e.message);
  }

  return out;
}

(async()=>{
  const data = await buildStaticPayload();
  await mkdir("public",{recursive:true});
  await writeFile("public/live.json", JSON.stringify({timestamp:Date.now(),...data}, null, 2), "utf8");
  console.log("✅ public/live.json updated");
})().catch(err=>{
  console.error("❌ generate-live.js error:",err);
  process.exit(1);
});
