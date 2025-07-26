// scripts/generate-live.js
// Node ≥18 CLI: writes public/live.json with full A→H logic,
// proxying Binance and other calls via AllOrigins to bypass regional blocks.

import { mkdir, writeFile } from 'fs/promises';

async function buildStaticPayload() {
  const SYMBOL = "BTCUSDT";
  const LIMIT  = 250;
  const UA     = "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/109.0";

  // Proxy fetch → JSON via AllOrigins
  async function proxyFetchJson(url) {
    console.log(`▶ proxyFetchJson: ${url}`);
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl, { headers: { "User-Agent": UA } });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      const snippet = text.slice(0,200).replace(/\n/g,' ');
      console.error(`❗ HTTP ${res.status} at ${url}\n   snippet: ${snippet}`);
      throw new Error(`HTTP ${res.status} at ${url}`);
    }
    return JSON.parse(text);
  }

  // Indicator helpers (same as Edge)
  const sma = (a,p) => a.slice(-p).reduce((s,x)=>s+x,0)/p;
  const ema = (a,p) => {
    if (a.length < p) return 0;
    const k = 2/(p+1);
    let e = sma(a.slice(0,p),p);
    for (let i = p; i < a.length; i++) e = a[i]*k + e*(1-k);
    return e;
  };
  const rsi = (a,p) => {
    if (a.length < p+1) return 0;
    let up=0, down=0;
    for (let i=1; i<=p; i++){
      const d = a[i]-a[i-1];
      d>=0? up+=d : down-=d;
    }
    let au = up/p, ad = down/p;
    for (let i=p+1; i<a.length; i++){
      const d = a[i]-a[i-1];
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
      ? ((a.at(-1) - a.at(-(n+1))) / a.at(-(n+1)) * 100)
      : 0;

  const out = {
    dataA:{}, dataB:null, dataC:{}, dataD:{},
    dataE:null, dataF:null, dataG:null, dataH:null,
    errors:[]
  };

  // A: Indicators
  console.log("––– Block A: Indicators –––");
  for (const tf of ["15m","1h","4h","1d"]) {
    console.log(`▶ A[${tf}]`);
    try {
      const kl = await proxyFetchJson(
        `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`
      );
      const c = kl.map(r=>+r[4]), h = kl.map(r=>+r[2]), l = kl.map(r=>+r[3]);
      const last = c.at(-1)||1;
      const e50  = ema(c,50), e200 = ema(c,200);
      const macdArr = c.map((_,i)=>ema(c.slice(0,i+1),12) - ema(c.slice(0,i+1),26));
      const macdHist = macdArr.at(-1) - ema(macdArr,9);
      out.dataA[tf] = {
        ema50:+e50.toFixed(2),
        ema200:+e200.toFixed(2),
        rsi14:+rsi(c,14).toFixed(1),
        atrPct:+((atr(h,l,c,14)/last)*100).toFixed(2),
        macdHist:+macdHist.toFixed(2)
      };
      console.log(`✅ A[${tf}] OK`);
    } catch (e) {
      console.error(`❌ A[${tf}]: ${e.message}`);
      out.errors.push(`A[${tf}]: ${e.message}`);
    }
  }

  // B: Derivatives + Liquidations
  console.log("––– Block B: Funding & Liquidations –––");
  try {
    const fr = await proxyFetchJson(
      `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=1000`
    );
    const rates = fr.slice(-42).map(d=>+d.fundingRate);
    const mean  = rates.reduce((s,x)=>s+x,0)/rates.length;
    const sd    = Math.sqrt(rates.reduce((s,x)=>s+(x-mean)**2,0)/rates.length);
    const fundingZ = sd ? ((rates.at(-1)-mean)/sd).toFixed(2) : "0.00";

    const oiNow  = await proxyFetchJson(
      `https://fapi.binance.com/fapi/v1/openInterest?symbol=${SYMBOL}`
    );
    const oiHist = await proxyFetchJson(
      `https://api.binance.com/futures/data/openInterestHist?symbol=${SYMBOL}&period=1h&limit=24`
    );
    const oiDelta24h = ((+oiNow.openInterest - +oiHist[0].sumOpenInterest)
      / +oiHist[0].sumOpenInterest * 100).toFixed(1);

    const RAW = "https://raw.githubusercontent.com/Cydeee/Testliquidation/main/data/totalLiquidations.json";
    const L   = await proxyFetchJson(RAW);
    const btc = (L.data||[]).find(r=>r.symbol==="BTC")||{};
    out.dataB = {
      fundingZ,
      oiDelta24h,
      liquidations: {
        long1h:   btc.long1h   || 0,
        short1h:  btc.short1h  || 0,
        long4h:   btc.long4h   || 0,
        short4h:  btc.short4h  || 0,
        long24h:  btc.long24h  || 0,
        short24h: btc.short24h || 0
      }
    };
    console.log("✅ B OK");
  } catch (e) {
    console.error(`❌ B: ${e.message}`);
    out.dataB = { fundingZ:null, oiDelta24h:null, liquidations:null };
    out.errors.push(`B: ${e.message}`);
  }

  // C: ROC
  console.log("––– Block C: ROC –––");
  for (const tf of ["15m","1h","4h","1d"]) {
    console.log(`▶ C[${tf}]`);
    try {
      const kl = await proxyFetchJson(
        `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=21`
      );
      const c = kl.map(r=>+r[4]);
      out.dataC[tf] = {
        roc10:+roc(c,10).toFixed(2),
        roc20:+roc(c,20).toFixed(2)
      };
      console.log(`✅ C[${tf}] OK`);
    } catch (e) {
      console.error(`❌ C[${tf}]: ${e.message}`);
      out.errors.push(`C[${tf}]: ${e.message}`);
    }
  }

  // D: Volume + CVD
  console.log("––– Block D: Volume & CVD –––");
  try {
    const windows = {"15m":0.25,"1h":1,"4h":4,"24h":24};
    out.dataD.cvd = {};
    for (const [lbl,hrs] of Object.entries(windows)) {
      const end   = Date.now();
      const start = end - hrs*3600000;
      const kl    = await proxyFetchJson(
        `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1m&startTime=${start}&endTime=${end}&limit=1500`
      );
      let bull=0, bear=0;
      for (const k of kl) +k[4]>=+k[1]? bull+=+k[5] : bear+=+k[5];
      const trades = await proxyFetchJson(
        `https://api.binance.com/api/v3/aggTrades?symbol=${SYMBOL}&startTime=${start}&endTime=${end}&limit=1000`
      );
      let cvd=0;
      for (const t of trades) cvd += t.m?-(+t.q):+(+t.q);

      out.dataD[lbl] = {
        bullVol:+bull.toFixed(2),
        bearVol:+bear.toFixed(2),
        totalVol:+(bull+bear).toFixed(2)
      };
      out.dataD.cvd[lbl] = +cvd.toFixed(2);
    }
    const tot24 = out.dataD["24h"].totalVol;
    const base = {"15m":tot24/96,"1h":tot24/24,"4h":tot24/6};
    out.dataD.relative = {};
    for (const lbl of ["15m","1h","4h"]) {
      const r = out.dataD[lbl].totalVol/Math.max(base[lbl],1);
      out.dataD.relative[lbl] = r>2?"very high":r>1.2?"high":r<0.5?"low":"normal";
    }
    console.log("✅ D OK");
  } catch (e) {
    console.error(`❌ D: ${e.message}`);
    out.errors.push(`D: ${e.message}`);
  }

  // E: Synthetic Stress
  console.log("––– Block E: Synthetic Stress –––");
  try {
    const b = Math.min(3, Math.abs(+out.dataB.fundingZ||0));
    const l = Math.max(0, (+out.dataB.oiDelta24h||0)/5);
    const vf= out.dataD.relative["15m"];
    const v = vf==="very high"?2:vf==="high"?1:0;
    const liq= out.dataB.liquidations||{};
    const imb= Math.abs((liq.long24h||0)-(liq.short24h||0));
    const ls = Math.min(2, imb/1e6);
    const s  = b+l+v+ls;
    out.dataE = {
      stressIndex:+s.toFixed(2),
      highRisk: s>=5,
      components:{ biasScore:b, levScore:l, volScore:v, liqScore:ls },
      source:"synthetic"
    };
    console.log("✅ E OK");
  } catch (e) {
    console.error(`❌ E: ${e.message}`);
    out.dataE = null;
    out.errors.push(`E: ${e.message}`);
  }

  // F: VPVR
  console.log("––– Block F: VPVR –––");
  try {
    const b4 = await proxyFetchJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=4h&limit=96`);
    const b1 = await proxyFetchJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1d&limit=30`);
    const b7 = await proxyFetchJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1w&limit=12`);
    function vp(bars) {
      const bk = {};
      for (const x of bars) {
        const px = (+x[2]+ +x[3]+ +x[4])/3, v=+x[5];
        const k = Math.round(px/100)*100;
        bk[k] = (bk[k]||0) + v;
      }
      const poc = +Object.entries(bk).sort((a,b)=>b[1]-a[1])[0][0];
      return { poc, buckets:bk };
    }
    out.dataF = { vpvr:{ "4h":vp(b4), "1d":vp(b1), "1w":vp(b7) } };
    console.log("✅ F OK");
  } catch (e) {
    console.error(`❌ F: ${e.message}`);
    out.errors.push(`F: ${e.message}`);
  }

  // G: Macro
  console.log("––– Block G: Macro –––");
  try {
    const gv = await proxyFetchJson("https://api.coingecko.com/api/v3/global");
    const g  = gv.data;
    out.dataG = {
      totalMcapT:+(g.total_market_cap.usd/1e12).toFixed(2),
      mcap24hPct:+g.market_cap_change_percentage_24h_usd.toFixed(2),
      btcDominance:+g.market_cap_percentage.btc.toFixed(2),
      ethDominance:+g.market_cap_percentage.eth.toFixed(2)
    };
    console.log("✅ G OK");
  } catch (e) {
    console.error(`❌ G: ${e.message}`);
    out.errors.push(`G: ${e.message}`);
  }

  // H: Sentiment
  console.log("––– Block H: Sentiment –––");
  try {
    const fg = await proxyFetchJson("https://api.alternative.me/fng/?limit=1");
    const f0 = fg.data?.[0];
    if (!f0) throw new Error("FNG missing");
    out.dataH = { fearGreed:`${f0.value} · ${f0.value_classification}` };
    console.log("✅ H OK");
  } catch (e) {
    console.error(`❌ H: ${e.message}`);
    out.errors.push(`H: ${e.message}`);
  }

  return out;
}

(async()=>{
  const ts = Date.now();
  console.log(`▶ buildStaticPayload @ ${new Date(ts).toISOString()}`);
  const data = await buildStaticPayload();
  console.log("▶ writing public/live.json");
  await mkdir("public",{recursive:true});
  await writeFile("public/live.json", JSON.stringify({ timestamp:ts, ...data }, null, 2), 'utf8');
  console.log("✅ public/live.json updated");
})();
