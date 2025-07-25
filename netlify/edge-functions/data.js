// netlify/edge-functions/data.js
// Lean build reordered: Derivatives → ROC → Volume → Stress
// Blocks: A indicators | B derivatives+liquidations | C ROC | D volume | E stress | F structure | G macro | H sentiment

export const config = { path: ['/data', '/data.json'], cache: 'manual' };

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
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
          'CDN-Cache-Control': 'public, s-maxage=60, must-revalidate',
        }
      : {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        };
    return new Response(body, { headers });
  } catch (err) {
    console.error('Edge Function error', err);
    return new Response('Service temporarily unavailable.', {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

async function buildDashboardData(request) {
  const SYMBOL = 'BTCUSDT';
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
  const safeJson = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
  const sma = (a,p) => a.slice(-p).reduce((s,x) => s + x, 0) / p;
  const ema = (a,p) => { if (a.length < p) return 0; const k = 2 / (p + 1); let e = sma(a.slice(0,p),p); for (let i = p; i < a.length; i++) e = a[i]*k + e*(1-k); return e; };
  const rsi = (a,p) => { if (a.length < p+1) return 0; let up=0,down=0; for (let i=1;i<=p;i++){const d=a[i]-a[i-1]; d>=0?up+=d:down-=d;} let au=up/p, ad=down/p; for(let i=p+1;i<a.length;i++){const d=a[i]-a[i-1]; au=(au*(p-1)+Math.max(d,0))/p; ad=(ad*(p-1)+Math.max(-d,0))/p;} return ad?100-100/(1+au/ad):100; };
  const atr = (h,l,c,p) => { if (h.length < p+1) return 0; const tr=[]; for (let i=1;i<h.length;i++) tr.push(Math.max(h[i]-l[i], Math.abs(h[i]-c[i-1]), Math.abs(l[i]-c[i-1]))); return sma(tr,p); };
  const roc = (a,n) => a.length>=n+1?((a.at(-1)-a.at(-(n+1)))/a.at(-(n+1)))*100:0;

  /* BLOCK A indicators */
  for (const tf of ['15m','1h','4h','1d']) {
    try {
      const kl = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`);
      const closes = kl.map(r=>+r[4]), highs = kl.map(r=>+r[2]), lows = kl.map(r=>+r[3]), last = closes.at(-1)||1;
      const e50 = ema(closes,50), e200 = ema(closes,200);
      const macd = closes.map((_,i)=>ema(closes.slice(0,i+1),12)-ema(closes.slice(0,i+1),26));
      const mh = macd.at(-1) - ema(macd,9);
      result.dataA[tf] = {
        ema50: +e50.toFixed(2), ema200: +e200.toFixed(2),
        rsi14: +rsi(closes,14).toFixed(1),
        atrPct: +((atr(highs,lows,closes,14)/last)*100).toFixed(2),
        macdHist: +mh.toFixed(2)
      };
    } catch (e) {
      result.errors.push(`A[${tf}]: ${e.message}`);
    }
  }

  /* BLOCK B derivatives + liquidations */
  try {
    const fr = await safeJson(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${SYMBOL}&limit=1000`);
    const rates = fr.slice(-42).map(d=>+d.fundingRate), mean = rates.reduce((s,x)=>s+x,0)/rates.length;
    const sd = Math.sqrt(rates.reduce((s,x)=>s+(x-mean)**2,0)/rates.length);
    const fundingZ = sd?((rates.at(-1)-mean)/sd).toFixed(2):'0.00';
    const oiNow = await safeJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${SYMBOL}`);
    const oiHist = await safeJson(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${SYMBOL}&period=1h&limit=24`);
    const oiDelta24h = ((+oiNow.openInterest-+oiHist[0].sumOpenInterest)/+oiHist[0].sumOpenInterest*100).toFixed(1);

    // fetch your scraped JSON from the other repo’s raw URL
    const RAW = 'https://raw.githubusercontent.com/Cydeee/Testliquidation/main/data/totalLiquidations.json';
    const liqJson = await safeJson(RAW);
    const btc = (liqJson.data||[]).find(r=>r.symbol==='BTC')||{};

    result.dataB = {
      fundingZ,
      oiDelta24h,
      liquidations: {
        long1h:  btc.long1h  ?? 0,
        short1h: btc.short1h ?? 0,
        long4h:  btc.long4h  ?? 0,
        short4h: btc.short4h ?? 0,
        long24h: btc.long24h ?? 0,
        short24h:btc.short24h ?? 0
      }
    };
  } catch (e) {
    result.dataB = { fundingZ:null, oiDelta24h:null, liquidations:null };
    result.errors.push(`B: ${e.message}`);
  }

  /* BLOCK C ROC */
  for (const tf of ['15m','1h','4h','1d']) {
    try {
      const kl = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=21`);
      const closes = kl.map(r=>+r[4]);
      result.dataC[tf] = { roc10:+roc(closes,10).toFixed(2), roc20:+roc(closes,20).toFixed(2) };
    } catch (e) {
      result.errors.push(`C[${tf}]: ${e.message}`);
    }
  }

  /* BLOCK D volume */
  try {
    const kl = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1m&limit=1500`);
    const now = Date.now(), wins = {'15m':0.25,'1h':1,'4h':4,'24h':24};
    for (const lbl in wins) {
      let bull=0, bear=0, cut=now-wins[lbl]*3600000;
      for (const k of kl) if (+k[0]>=cut) +k[4]>=+k[1]?bull+=+k[5]:bear+=+k[5];
      result.dataD[lbl] = { bullVol:+bull.toFixed(2), bearVol:+bear.toFixed(2), totalVol:+(bull+bear).toFixed(2) };
    }
    const tot24 = result.dataD['24h'].totalVol, base={'15m':tot24/96,'1h':tot24/24,'4h':tot24/6};
    result.dataD.relative = {};
    for (const l of ['15m','1h','4h']) {
      const r = result.dataD[l].totalVol/Math.max(base[l],1);
      result.dataD.relative[l] = r>2?'very high':r>1.2?'high':r<0.5?'low':'normal';
    }
  } catch (e) {
    result.errors.push(`D: ${e.message}`);
  }

  /* BLOCK E synthetic stress */
  try {
    const bs = Math.min(3,Math.abs(+result.dataB.fundingZ)),
          ls = Math.max(0,+result.dataB.oiDelta24h/5),
          vf = result.dataD.relative['15m'],
          vs = vf==='very high'?2:vf==='high'?1:0,
          stress = bs+ls+vs;
    result.dataE = {
      stressIndex:+stress.toFixed(2),
      highRisk: stress>=5,
      components:{biasScore:bs,levScore:ls,volScore:vs,divScore:0},
      source:'synthetic'
    };
  } catch (e) {
    result.dataE = null;
    result.errors.push(`E-synth: ${e.message}`);
  }

  /* BLOCK F market structure */
  try {
    const day = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1d&limit=2`);
    const [yH,yL,yC] = [+day[0][2],+day[0][3],+day[0][4]];
    const P = (yH+yL+yC)/3, R1 = 2*P-yL, S1 = 2*P-yH;
    const mins = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1m&limit=1500`);
    const start = Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),new Date().getUTCDate());
    let pv=0, vl=0, arr=[];
    for (const k of mins) if(+k[0]>=start){const tp=(+k[2]+ +k[3]+ +k[4])/3;pv+=tp*k[5];vl+=k[5];arr.push(tp);}
    const vwap = pv/vl, sd = arr.length>1?Math.sqrt(arr.reduce((s,x)=>s+(x-vwap)**2,0)/arr.length):0;
    const kl20 = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=15m&limit=20`);
    const c20 = kl20.map(r=>+r[4]);
    result.dataF = {
      pivot:{P:+P.toFixed(2),R1:+R1.toFixed(2),S1:+S1.toFixed(2)},
      vwap:{value:+vwap.toFixed(2),band:+sd.toFixed(2)},
      hhll20:{HH:+Math.max(...c20).toFixed(2),LL:+Math.min(...c20).toFixed(2)}
    };
  } catch (e) {
    result.errors.push(`F: ${e.message}`);
  }

  /* BLOCK G macro */
  try {
    const gg = await safeJson('https://api.coingecko.com/api/v3/global'), gd = gg.data;
    result.dataG = {
      totalMcapT:+(gd.total_market_cap.usd/1e12).toFixed(2),
      mcap24hPct:+gd.market_cap_change_percentage_24h_usd.toFixed(2),
      btcDominance:+gd.market_cap_percentage.btc.toFixed(2),
      ethDominance:+gd.market_cap_percentage.eth.toFixed(2)
    };
  } catch (e) {
    result.errors.push(`G: ${e.message}`);
  }

  /* BLOCK H sentiment */
  try {
    const fg = await safeJson('https://api.alternative.me/fng/?limit=1'), f0 = fg.data?.[0];
    if (!f0) throw new Error('FNG missing');
    result.dataH = { fearGreed:`${f0.value} · ${f0.value_classification}` };
  } catch (e) {
    result.errors.push(`H: ${e.message}`);
  }

  return result;
}
