import fetch from 'node-fetch';

const ENDPOINT = 'https://btcsignal.netlify.app/data.json';
const TOKEN    = '8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw';
const CHAT_ID  = '92192621';

// ---------- scoring helpers ----------
const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ---------- alert logic ----------
function calcScore(d) {
  const A = d.dataA, B = d.dataB, D = d.dataD, F = d.dataF, stress = d.dataE?.stressIndex || 0;
  const price = A['1h'].ema50;

  const longPts = [], shortPts = [];

  // RSI 1h
  if (A['1h'].rsi14 < 35) longPts.push(1);
  if (A['1h'].rsi14 > 65) shortPts.push(1);

  // MACD Hist 1h
  if (A['1h'].macdHist > 0) longPts.push(1);
  if (A['1h'].macdHist < 0) shortPts.push(1);

  // Funding‑Z
  if (+B.fundingZ < -1) longPts.push(1);
  if (+B.fundingZ > 1)  shortPts.push(1);

  // 24h liquidations imbalance
  const liq = B.liquidations || {};
  if ((liq.short24h || 0) > (liq.long24h || 0) * 2) longPts.push(1);
  if ((liq.long24h  || 0) > (liq.short24h || 0) * 2) shortPts.push(1);

  // CVD + volume flag
  const volFlag = D.relative['1h'];
  if (D.cvd['1h'] > 1000 && (volFlag === 'high' || volFlag === 'very high'))  longPts.push(2);
  if (D.cvd['1h'] < -1000 && (volFlag === 'high' || volFlag === 'very high')) shortPts.push(2);

  // 15m bull/bear
  if (D['15m'].bullVol > D['15m'].bearVol * 2) longPts.push(1);
  if (D['15m'].bearVol > D['15m'].bullVol * 2) shortPts.push(1);

  // 4h VPVR PoC
  const poc4h = F.vpvr['4h'].poc;
  if (price > poc4h)  longPts.push(1);
  if (price < poc4h) shortPts.push(1);

  // Stress gate/bonus
  if (stress > 7) return { long:0, short:0 };
  if (stress >=3 && stress <=5) { longPts.push(1); shortPts.push(1); }

  return {
    long:  longPts.reduce((s,x)=>s+x,0),
    short: shortPts.reduce((s,x)=>s+x,0)
  };
}

async function send(msg) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'Markdown' })
  });
}

(async()=>{
  const res = await fetch(ENDPOINT);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const { long, short } = calcScore(data);
  const threshold = 6;

  let dir = null;
  if (long  >= threshold) dir = 'LONG';
  if (short >= threshold) dir = 'SHORT';

  if (dir) {
    const price  = data.dataA['1h'].ema50.toFixed(2);
    const stress = data.dataE.stressIndex.toFixed(2);
    const msg =
`🚨 *High‑Conviction ${dir} (score ${dir==="LONG"?long:short}/10)* 🚨

Price: \`${price}\`
Stress: \`${stress}\`
RSI 1h: \`${data.dataA['1h'].rsi14}\`
CVD 1h: \`${data.dataD.cvd['1h']}\`
Funding Z: \`${data.dataB.fundingZ}\`
Liq 24h: long \`${data.dataB.liquidations.long24h}\` | short \`${data.dataB.liquidations.short24h}\``;

    await send(msg);
  } else {
    console.log('No high‑conviction setup.');
  }
})();
