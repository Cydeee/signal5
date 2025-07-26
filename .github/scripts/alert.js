// .github/scripts/alert.js
import fetch from 'node-fetch';

// —— Configuration —— 
const TOKEN   = '8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw';
const CHAT_ID = '6038110897';
const SYMBOL  = 'BTCUSDT';

// —— Helpers ——
// Fetch JSON with a browser User‑Agent
async function safeJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                    "AppleWebKit/537.36 (KHTML, like Gecko) " +
                    "Chrome/115.0.0.0 Safari/537.36"
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} at ${url}`);
  return res.json();
}

// Send Telegram message
async function send(msg) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: msg,
      parse_mode: 'Markdown'
    }),
  });
}

// Simple “if-not‑found, default” getter
function get(o, path, d=null) {
  return path.split('.').reduce((x,k)=>(x?.[k]!=null?x[k]:d), o);
}

// EMA, RSI, CVD, etc. (same as in data.js)
const sma = (a,p)=> a.slice(-p).reduce((s,x)=>s+x,0)/p;
const ema = (a,p)=>{ if(a.length<p) return 0; const k=2/(p+1); let e=sma(a.slice(0,p),p); for(let i=p;i<a.length;i++) e=a[i]*k+e*(1-k); return e; };
const rsi = (a,p)=>{ if(a.length<p+1)return 0; let u=0,d=0; for(let i=1;i<=p;i++){const diff=a[i]-a[i-1]; diff>0?u+=diff:d-=diff;} let au=u/p,ad=d/p; for(let i=p+1;i<a.length;i++){const diff=a[i]-a[i-1]; au=(au*(p-1)+Math.max(diff,0))/p; ad=(ad*(p-1)+Math.max(-diff,0))/p;} return ad?100-100/(1+au/ad):100; };

// —— Main —— 
(async()=>{
  try {
    console.log("🔄 Fetching market data…");

    // 1) A: Indicators (1h)
    const kl1h = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1h&limit=250`);
    const closes1h = kl1h.map(r=>+r[4]), highs1h = kl1h.map(r=>+r[2]), lows1h = kl1h.map(r=>+r[3]);
    const ema50_1h = ema(closes1h,50), ema200_1h = ema(closes1h,200), rsi14_1h = rsi(closes1h,14);
    // build MACD hist
    const macdArr1h = []; for(let i=0;i<closes1h.length;i++){
      const sub=closes1h.slice(0,i+1); macdArr1h.push(ema(sub,12)-ema(sub,26));
    }
    const macdHist1h = macdArr1h.at(-1)-ema(macdArr1h,9);

    // 2) B: Derivatives & Liquidations
    const fr = await safeJson(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=1000`);
    const rates = fr.slice(-42).map(d=>+d.fundingRate);
    const mean = rates.reduce((s,x)=>s+x,0)/rates.length;
    const sd   = Math.sqrt(rates.reduce((s,x)=>(s+(x-mean)**2),0)/rates.length);
    const fundingZ = sd?((rates.at(-1)-mean)/sd).toFixed(2):"0.00";

    const oiNow  = await safeJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${SYMBOL}`);
    const oiHist = await safeJson(`https://api.binance.com/api/v3/openInterestHist?symbol=${SYMBOL}&period=1h&limit=24`);
    const oiDelta24h = (((+oiNow.openInterest)-(+oiHist[0].sumOpenInterest))/+oiHist[0].sumOpenInterest*100).toFixed(1);

    // CoinGlass liquidations
    const CG = await safeJson('https://raw.githubusercontent.com/Cydeee/Testliquidation/main/data/totalLiquidations.json');
    const btcLiq = (CG.data||[]).find(r=>r.symbol==='BTC')||{};
    const liq = { long24h:btcLiq.long24h||0, short24h:btcLiq.short24h||0 };

    // 3) D: CVD & volume (1h & 15m)
    const now = Date.now(), oneHrAgo = now-3600000, fifteenMinAgo = now-15*60000;
    const trades1h = await safeJson(`https://api.binance.com/api/v3/aggTrades?symbol=${SYMBOL}&startTime=${oneHrAgo}&limit=1000`);
    let cvd1h=0; trades1h.forEach(t=>cvd1h += t.m? -t.q:+t.q);

    // 15m volume
    const kl15 = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1m&startTime=${fifteenMinAgo}&limit=1000`);
    let bull15=0,bear15=0; kl15.forEach(k=>+k[4]>=+k[1]?bull15+=+k[5]:bear15+=+k[5]);

    // 4) F: VPVR 4h PoC
    const kl4h = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=4h&limit=96`);
    const bucket = {};
    kl4h.forEach(b=>{
      const price=(+b[2]+ +b[3]+ +b[4])/3, vol=+b[5], bin = Math.round(price/100)*100;
      bucket[bin] = (bucket[bin]||0) + vol;
    });
    const poc4h = +Object.entries(bucket).sort((a,b)=>b[1]-a[1])[0][0];

    // 5) E: Stress (use liq)
    const biasScore = Math.min(3, Math.abs(+fundingZ||0));
    const levScore  = Math.max(0, (+oiDelta24h||0)/5);
    const volFlag   = bull15 > bear15*1.2? 'high' : 'normal';
    const volScore  = volFlag==='high'?1:0;
    const imbScore  = Math.min(2, Math.abs(liq.long24h - liq.short24h)/1e6);
    const stress    = +(biasScore + levScore + volScore + imbScore).toFixed(2);

    // —— Log all raw metrics
    console.log(`
▶️ Raw metrics:
  EMA50_1h:      ${ema50_1h.toFixed(2)}
  EMA200_1h:     ${ema200_1h.toFixed(2)}
  RSI14_1h:      ${rsi14_1h.toFixed(1)}
  MACDHist1h:    ${macdHist1h.toFixed(2)}
  Funding Z:     ${fundingZ}
  OIΔ24h:        ${oiDelta24h}%
  Liq24h L/S:    ${liq.long24h}/${liq.short24h}
  CVD 1h:        ${cvd1h.toFixed(2)}
  Vol 15m B/S:   ${bull15.toFixed(2)}/${bear15.toFixed(2)}
  PoC 4h:        ${poc4h}
  StressIndex:   ${stress}`);

    // —— Scoring
    let longScore=0, shortScore=0;
    const rule = (desc, cond, pts) => {
      if (cond()) {
        console.log(`   ✓ ${desc} (${pts>0? '+'+pts:pts}pts)`);
        pts>0? longScore+=pts : shortScore-=pts;
      } else console.log(`   ✗ ${desc}`);
    };

    console.log("🧮 Rules:");
    rule("RSI<35",    ()=>rsi14_1h<35, +1);
    rule("RSI>65",    ()=>rsi14_1h>65, -1);
    rule("MACD>0",    ()=>macdHist1h>0, +1);
    rule("MACD<0",    ()=>macdHist1h<0, -1);
    rule("Fund<−1",   ()=>fundingZ< -1, +1);
    rule("Fund>1",    ()=>fundingZ> 1,  -1);
    rule("Short>2×Long", ()=>liq.short24h>liq.long24h*2, +1);
    rule("Long>2×Short", ()=>liq.long24h>liq.short24h*2, -1);
    rule("CVD>1k",    ()=>cvd1h>1000, +2);
    rule("CVD<−1k",   ()=>cvd1h< -1000, -2);
    rule("15m bull>bear", ()=>bull15>bear15, +1);
    rule("4h PoC>price", ()=>poc4h<ema50_1h, +1); // example
    rule("Stress 8+", ()=>stress>7, -100); // gate

    console.log(`➡️ Scores: long=${longScore}, short=${shortScore}`);
    if (stress>7) { console.log("⚠️ High stress, abort."); return; }
    const threshold=6;
    const dir = longScore>=threshold? 'LONG' : shortScore>=threshold? 'SHORT': null;
    if (!dir) { console.log("❌ No signal."); return; }

    const msg =
`🚨 *High‑Conviction ${dir} (score ${dir==='LONG'?longScore:shortScore}/10)* 🚨

Price:    \`${ema50_1h.toFixed(2)}\`
RSI 1h:   \`${rsi14_1h.toFixed(1)}\`
MACD 1h:  \`${macdHist1h.toFixed(2)}\`
Stress:   \`${stress}\``;
    console.log("📤 Alert:",msg.replace(/\n/g,' | '));
    await send(msg);
    console.log("✅ Sent.");
  }
  catch(err){
    console.error("❌ Fatal:",err);
    await send(`❌ Alert script error: ${err.message}`);
  }
})();
