// netlify/edge-functions/data.js
export const config = { path: ['/data','/data.json'], cache: 'manual' };

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }
  const wantJson = new URL(request.url).pathname.endsWith('/data.json');
  try {
    const payload = await buildDashboardData(request);
    payload.timestamp = Date.now();
    const body = wantJson
      ? JSON.stringify(payload)
      : `<!DOCTYPE html><html><body><pre id="dashboard-data">${JSON.stringify(payload)}</pre></body></html>`;
    const headers = wantJson
      ? {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=0, must-revalidate',
          'CDN-Cache-Control': 'public, s-maxage=60, must-revalidate'
        }
      : {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        };
    return new Response(body, { headers });
  } catch (err) {
    console.error('Edge Function error', err);
    return new Response('Service temporarily unavailable.', {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

async function buildDashboardData(request) {
  const SYMBOL = 'BTCUSDT', LIMIT = 250;
  const result = {
    dataA:{}, dataB:null, dataC:{}, dataD:{},
    dataE:null, dataF:null, dataG:null, dataH:null, errors:[]
  };

  // helpers
  const safeJson = async u => { const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
  const sma = (a,p) => a.slice(-p).reduce((s,x)=>s+x,0)/p;
  const ema = (a,p) => { if(a.length<p) return 0; const k=2/(p+1); let e=sma(a.slice(0,p),p); for(let i=p;i<a.length;i++) e=a[i]*k+e*(1-k); return e; };
  const rsi = (a,p) => { if(a.length<p+1) return 0; let up=0,down=0; for(let i=1;i<=p;i++){const d=a[i]-a[i-1]; d>=0?up+=d:down-=d;} let au=up/p,ad=down/p; for(let i=p+1;i<a.length;i++){const d=a[i]-a[i-1]; au=(au*(p-1)+Math.max(d,0))/p; ad=(ad*(p-1)+Math.max(-d,0))/p;} return ad?100-100/(1+au/ad):100; };
  const atr = (h,l,c,p) => { if(h.length<p+1) return 0; const tr=[]; for(let i=1;i<h.length;i++) tr.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1]))); return sma(tr,p); };
  const roc = (a,n) => a.length>=n+1?((a.at(-1)-a.at(-(n+1)))/a.at(-(n+1)))*100:0;

  /* BLOCK A indicators */
  for (const tf of ['15m','1h','4h','1d']) try {
    const kl = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`);
    const closes = kl.map(r=>+r[4]), highs = kl.map(r=>+r[2]), lows = kl.map(r=>+r[3]), last = closes.at(-1)||1;
    const e50 = ema(closes,50), e200 = ema(closes,200);
    const macd = closes.map((_,i)=>ema(closes.slice(0,i+1),12)-ema(closes.slice(0,i+1),26));
    const mh = macd.at(-1) - ema(macd,9);
    result.dataA[tf] = {
      ema50:+e50.toFixed(2), ema200:+e200.toFixed(2),
      rsi14:+rsi(closes,14).toFixed(1),
      atrPct:+((atr(highs,lows,closes,14)/last)*100).toFixed(2),
      macdHist:+mh.toFixed(2)
    };
  } catch(e) { result.errors.push(`A[${tf}]: ${e.message}`); }

  /* BLOCK B derivatives + liquidations */
  try {
    const fr = await safeJson(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=1000`);
    const rates = fr.slice(-42).map(d=>+d.fundingRate), mean=rates.reduce((s,x)=>s+x,0)/rates.length;
    const sd = Math.sqrt(rates.reduce((s,x)=>s+(x-mean)**2,0)/rates.length);
    const fundingZ = sd?((rates.at(-1)-mean)/sd).toFixed(2):'0.00';
    const oiNow = await safeJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${SYMBOL}`);
    const oiHist= await safeJson(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${SYMBOL}&period=1h&limit=24`);
    const oiDelta24h = ((+oiNow.openInterest - +oiHist[0].sumOpenInterest)/+oiHist[0].sumOpenInterest*100).toFixed(1);
    // fetch your scraped data
    const liq = await safeJson(new URL('/data/totalLiquidations.json',request.url).href);
    const btc = (liq.data||[]).find(r=>r.symbol==='BTC')||{};
    result.dataB = {
      fundingZ, oiDelta24h,
      liquidations:{
        long1h:btc.long1h||0, short1h:btc.short1h||0,
        long4h:btc.long4h||0, short4h:btc.short4h||0,
        long24h:btc.long24h||0, short24h:btc.short24h||0
      }
    };
  } catch(e) {
    result.dataB={fundingZ:null,oiDelta24h:null,liquidations:null};
    result.errors.push(`B: ${e.message}`);
  }

  /* BLOCK C ROC */
  for (const tf of ['15m','1h','4h','1d']) try {
    const kl = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=21`);
    const closes = kl.map(r=>+r[4]);
    result.dataC[tf] = { roc10:+roc(closes,10).toFixed(2), roc20:+roc(closes,20).toFixed(2) };
  } catch(e) { result.errors.push(`C[${tf}]: ${e.message}`); }

  /* BLOCK D volume */
  try {
    const kl = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1m&limit=1500`);
    const now=Date.now(), wins={'15m':.25,'1h':1,'4h':4,'24h':24};
    for (const lbl in wins) {
      let bull=0, bear=0, cut=now-wins[lbl]*3600000;
      for (const k of kl) if (+k[0]>=cut) +k[4]>=+k[1]?bull+=+k[5]:bear+=+k[5];
      result.dataD[lbl]={bullVol:+bull.toFixed(2),bearVol:+bear.toFixed(2),totalVol:+(bull+bear).toFixed(2)};
    }
    const t24 = result.dataD['24h'].totalVol, base={'15m':t24/96,'1h':t24/24,'4h':t24/6};
    result.dataD.relative={};
    for (const lbl of ['15m','1h','4h']) {
      const r = result.dataD[lbl].totalVol/Math.max(base[lbl],1);
      result.dataD.relative[lbl]=r>2?'very high':r>1.2?'high':r<0.5?'l
