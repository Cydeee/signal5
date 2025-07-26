import fetch from 'node-fetch';

const ENDPOINT = 'https://<YOUR_NETLIFY_SITE>/data.json';
const TOKEN    = process.env.TG_BOT_TOKEN;
const CHAT_ID  = process.env.TG_CHAT_ID;

// ---------- scoring helpers ----------
const z = (val, mean, sd) => sd ? (val - mean) / sd : 0;   // simple z‑score
const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const weight = (raw, max) => clip(raw, -max, max);         // limit points

function calcScore(d) {
  const A = d.dataA, B = d.dataB, D = d.dataD, F = d.dataF, stress = d.dataE?.stressIndex ?? 0;
  const nowPrice = Object.values(A['1h'])?.[0] ? A['1h'].ema50 : 0; // fallback price proxy

  // --- individual metrics -------------------------------------------------
  const longPts = [];
  const shortPts = [];

  // RSI 1h
  if (A['1h'].rsi14 < 35) longPts.push(1);
  if (A['1h'].rsi14 > 65) shortPts.push(1);

  // MACD Hist 1h sign
  if (A['1h'].macdHist > 0) longPts.push(1);
  if (A['1h'].macdHist < 0) shortPts.push(1);

  // Funding‑Z
  if (+B.fundingZ < -1) longPts.push(1);
  if (+B.fundingZ >  1) shortPts.push(1);

  // 24h liquidation imbalance
  const liq = B.liquidations || {};
  if ((liq.short24h ?? 0) > (liq.long24h ?? 0) * 2) longPts.push(1);
  if ((liq.long24h  ?? 0) > (liq.short24h ?? 0) * 2) shortPts.push(1);

  // CVD + volume
  const volFlag = D.relative['1h'];
  if (D.cvd['1h'] >  1000 && (volFlag === 'high' || volFlag === 'very high')) longPts.push(2);
  if (D.cvd['1h'] < -1000 && (volFlag === 'high' || volFlag === 'very high')) shortPts.push(2);

  // Bull/Bear 15m
  if (D['15m'].bullVol > D['15m'].bearVol * 2) longPts.push(1);
  if (D['15m'].bearVol > D['15m'].bullVol * 2) shortPts.push(1);

  // VPVR PoC reclaim (4h)
  const poc4h = F.vpvr['4h'].poc;
  if (nowPrice > poc4h) longPts.push(1);
  if (nowPrice < poc4h) shortPts.push(1);

  // Stress gate / bonus
  if (stress > 7) return { long:0, short:0, reasons:[] }; // overcrowded → ignore
  if (stress >= 3 && stress <= 5) { longPts.push(1); shortPts.push(1); }

  // ------------------------------------------------------------------------
  const longScore  = longPts.reduce((s,x)=>s+x,0);
  const shortScore = shortPts.reduce((s,x)=>s+x,0);
  const reasons    = { long: longPts.length, short: shortPts.length };

  return { long: longScore, short: shortScore, reasons };
}

// ---------- telegram -----------
async function send(msg) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'Markdown' })
  });
}

// ---------- main ---------------
(async () => {
  const res = await fetch(ENDPOINT);
  if (!res.ok) throw new Error(`Dashboard HTTP ${res.status}`);
  const data = await res.json();

  const { long, short } = calcScore(data);
  const threshold = 6;            // >=6 pts  → alert
  let direction = null;
  if (long  >= threshold) direction = 'LONG';
  if (short >= threshold) direction = 'SHORT';

  if (direction) {
    const price = data.dataA['1h'].ema50;
    const stress = data.dataE?.stressIndex ?? 'n/a';
    const msg =
`*High‑Conviction ${direction} (score ${direction==="LONG"?long:short}/10)*

Price: \`${price.toFixed(2)}\`
Stress: \`${stress}\`
RSI 1h:  *${data.dataA['1h'].rsi14}*
CVD 1h:  *${data.dataD.cvd['1h']}*
Funding Z: *${data.dataB.fundingZ}*
Liq 24h: long ${data.dataB.liquidations.long24h} | short ${data.dataB.liquidations.short24h}`;

    await send(msg);
  } else {
    console.log('No high‑conviction setup.');
  }
})();
