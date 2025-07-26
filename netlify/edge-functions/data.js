// netlify/edge-functions/data.js
import fs from 'fs';
import fetch from 'node-fetch';

/* -----------------------------------------------------------------------
   buildDashboardData — exported for scripts/generate.js and CLI fallback
   --------------------------------------------------------------------- */
export async function buildDashboardData () {
  const SYMBOL = 'BTCUSDT';
  const LIMIT  = 250;

  const out = {
    dataA:{}, dataB:null, dataC:{}, dataD:{}, dataE:null,
    dataF:null, dataG:null, dataH:null, errors:[]
  };

  /* helper shortcuts --------------------------------------------------- */
  const safeJson = async (u)=>{
    const r = await fetch(u);
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  const sma = (a,p)=>a.slice(-p).reduce((s,x)=>s+x,0)/p;
  const ema = (a,p)=>{
    if(a.length<p) return 0;
    const k=2/(p+1); let e=sma(a.slice(0,p),p);
    for(let i=p;i<a.length;i++) e=a[i]*k+e*(1-k);
    return e;
  };
  const rsi = (a,p)=>{
    if(a.length<p+1) return 0;
    let u=0,d=0;
    for(let i=1;i<=p;i++){const diff=a[i]-a[i-1]; diff>=0?u+=diff:d-=diff;}
    let au=u/p, ad=d/p;
    for(let i=p+1;i<a.length;i++){
      const diff=a[i]-a[i-1];
      au=(au*(p-1)+Math.max(diff,0))/p;
      ad=(ad*(p-1)+Math.max(-diff,0))/p;
    }
    return ad?100-100/(1+au/ad):100;
  };
  const atr = (h,l,c,p)=>{
    if(h.length<p+1) return 0;
    const tr=[];
    for(let i=1;i<h.length;i++)
      tr.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));
    return sma(tr,p);
  };
  const roc = (a,n)=>a.length>=n+1?((a.at(-1)-a.at(-(n+1)))/a.at(-(n+1))*100):0;

  /* BLOCK A — indicators ---------------------------------------------- */
  for(const tf of ['15m','1h','4h','1d']){
    try{
      const kl=await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`);
      const closes=kl.map(r=>+r[4]), highs=kl.map(r=>+r[2]), lows=kl.map(r=>+r[3]), last=closes.at(-1)||1;

      const ema50=ema(closes,50), ema200=ema(closes,200);
      const macd = closes.map((_,i)=>ema(closes.slice(0,i+1),12)-ema(closes.slice(0,i+1),26));
      const macdHist = macd.at(-1)-ema(macd,9);

      out.dataA[tf] = {
        ema50:+ema50.toFixed(2),
        ema200:+ema200.toFixed(2),
        rsi14:+rsi(closes,14).toFixed(1),
        atrPct:+((atr(highs,lows,closes,14)/last)*100).toFixed(2),
        macdHist:+macdHist.toFixed(2)
      };
    }catch(e){ out.errors.push(`A[${tf}]: ${e.message}`); }
  }

  /* BLOCK B — derivatives --------------------------------------------- */
  try{
    const fr=await safeJson(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=1000`);
    const rates=fr.slice(-42).map(d=>+d.fundingRate);
    const mean=rates.reduce((s,x)=>s+x,0)/rates.length;
    const sd=Math.sqrt(rates.reduce((s,x)=>s+(x-mean)**2,0)/rates.length);
    const fundingZ = sd?((rates.at(-1)-mean)/sd).toFixed(2):'0.00';

    const oiNow = await safeJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${SYMBOL}`);
    const oiHist= await safeJson(`https://api.binance.com/api/v3/futures/data/openInterestHist?symbol=${SYMBOL}&period=1h&limit=24`);
    const oiDelta24h = ((+oiNow.openInterest-+oiHist[0].sumOpenInterest) / +oiHist[0].sumOpenInterest * 100).toFixed(1);

    out.dataB = { fundingZ, oiDelta24h };
  }catch(e){
    out.dataB = { fundingZ:null, oiDelta24h:null };
    out.errors.push('B: '+e.message);
  }

  /* BLOCK C — ROC ------------------------------------------------------ */
  for(const tf of ['15m','1h','4h','1d']){
    try{
      const kl=await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=21`);
      const closes=kl.map(r=>+r[4]);
      out.dataC[tf] = { roc10:+roc(closes,10).toFixed(2), roc20:+roc(closes,20).toFixed(2) };
    }catch(e){ out.errors.push(`C[${tf}]: ${e.message}`); }
  }

  /* BLOCK D — volume --------------------------------------------------- */
  try{
    const kl=await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1m&limit=1500`);
    const now=Date.now(), win={'15m':0.25,'1h':1,'4h':4,'24h':24};
    for(const [lbl,hrs] of Object.entries(win)){
      const cutoff=now-hrs*3600000;
      let bull=0,bear=0;
      for(const k of kl){
        if(+k[0]<cutoff) continue;
        if(+k[4]>=+k[1]) bull+=+k[5]; else bear+=+k[5];
      }
      out.dataD[lbl] = { bullVol:+bull.toFixed(2), bearVol:+bear.toFixed(2), totalVol:+(bull+bear).toFixed(2) };
    }
    const tot24=out.dataD['24h'].totalVol, base={'15m':tot24/96,'1h':tot24/24,'4h':tot24/6};
    out.dataD.relative={};
    for(const lbl of ['15m','1h','4h']){
      const r=out.dataD[lbl].totalVol/Math.max(base[lbl],1);
      out.dataD.relative[lbl] = r>2?'very high':r>1.2?'high':r<0.5?'low':'normal';
    }
  }catch(e){ out.errors.push('D: '+e.message); }

  /* BLOCK E — synthetic stress ---------------------------------------- */
  try{
    const bias=Math.min(3,Math.abs(+out.dataB.fundingZ||0));
    const lev =Math.max(0,(+out.dataB.oiDelta24h||0)/5);
    const vf  = out.dataD.relative['15m']; const vol = vf==='very high'?2:vf==='high'?1:0;
    const stress=bias+lev+vol;
    out.dataE = { stressIndex:+stress.toFixed(2), highRisk:stress>=5, components:{bias,lev,vol}, source:'synthetic' };
  }catch(e){ out.dataE=null; out.errors.push('E: '+e.message); }

  /* BLOCK F — market structure ---------------------------------------- */
  try{
    const d=await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1d&limit=2`);
    const [yH,yL,yC]=[+d[0][2],+d[0][3],+d[0][4]];
    const P=(yH+yL+yC)/3, R1=2*P-yL, S1=2*P-yH;

    const min=await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1m&limit=1500`);
    const utc0 = Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),new Date().getUTCDate());
    let pv=0,vol=0,prices=[];
    for(const k of min){
      if(+k[0]<utc0) continue;
      const tp=(+k[2]+ +k[3]+ +k[4])/3, v=+k[5]; pv+=tp*v; vol+=v; prices.push(tp);
    }
    const vwap=pv/vol, sd=Math.sqrt(prices.reduce((s,x)=>s+(x-vwap)**2,0)/prices.length);

    const kl20=await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=15m&limit=20`);
    const cls20=kl20.map(r=>+r[4]);
    out.dataF={
      pivot:{P:+P.toFixed(2),R1:+R1.toFixed(2),S1:+S1.toFixed(2)},
      vwap:{value:+vwap.toFixed(2),band:+sd.toFixed(2)},
      hhll20:{HH:+Math.max(...cls20).toFixed(2), LL:+Math.min(...cls

::contentReference[oaicite:0]{index=0}
