import fetch from 'node-fetch';

const ENDPOINT = 'https://btcsignal.netlify.app/data.json';
const TOKEN    = '8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw';
const CHAT_ID  = '92192621';

// safe accessor
const get = (obj, path, def = undefined) => {
  return path.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : def), obj);
};

// ---------- alert logic ----------
function calcScore(d) {
  // Verify the key blocks exist
  const A = d.dataA, B = d.dataB, D = d.dataD, F = d.dataF, E = d.dataE;
  if (!A || !B || !D || !F || !E) {
    console.error('Missing one of dataA, dataB, dataD, dataF or dataE:', { dataA: A, dataB: B, dataD: D, dataF: F, dataE: E });
    return null;
  }

  const rsi1h    = get(A, '1h.rsi14', null);
  const macd1h   = get(A, '1h.macdHist', null);
  const ema1h    = get(A, '1h.ema50', null);
  const fundingZ = Number(get(B, 'fundingZ', 0));
  const liqs     = get(B, 'liquidations', {});
  const cvd1h    = Number(get(D, 'cvd.1h', 0));
  const volFlag  = get(D, 'relative.1h', null);
  const bull15   = Number(get(D, '15m.bullVol', 0));
  const bear15   = Number(get(D, '15m.bearVol', 0));
  const poc4h    = Number(get(F, 'vpvr.4h.poc', 0));
  const stress   = Number(get(E, 'stressIndex', 0));

  // If core metrics missing, bail and log the entire payload
  if ([rsi1h, macd1h, ema1h].some((x) => x === null)) {
    console.error('Core indicators missing:', { rsi1h, macd1h, ema1h });
    console.log('Full payload:', JSON.stringify(d, null, 2));
    return null;
  }

  const longPts = [], shortPts = [];

  // RSI 1h
  if (rsi1h < 35) longPts.push(1);
  if (rsi1h > 65) shortPts.push(1);

  // MACD Hist 1h
  if (macd1h > 0) longPts.push(1);
  if (macd1h < 0) shortPts.push(1);

  // Funding‑Z
  if (fundingZ < -1) longPts.push(1);
  if (fundingZ > 1)  shortPts.push(1);

  // 24h liquidation imbalance
  const long24 = Number(liqs.long24h || 0);
  const short24 = Number(liqs.short24h || 0);
  if (short24 > long24 * 2) longPts.push(1);
  if (long24 > short24 * 2) shortPts.push(1);

  // CVD + volume flag
  if (cvd1h > 1000 && ['high', 'very high'].includes(volFlag)) longPts.push(2);
  if (cvd1h < -1000 && ['high', 'very high'].includes(volFlag)) shortPts.push(2);

  // 15m bull/bear
  if (bull15 > bear15 * 2) longPts.push(1);
  if (bear15 > bull15 * 2) shortPts.push(1);

  // 4h VPVR PoC
  if (ema1h > poc4h) longPts.push(1);
  if (ema1h < poc4h) shortPts.push(1);

  // Stress gate/bonus
  if (stress > 7) return { long: 0, short: 0 };
  if (stress >= 3 && stress <= 5) {
    longPts.push(1);
    shortPts.push(1);
  }

  return {
    long:  longPts.reduce((s, x) => s + x, 0),
    short: shortPts.reduce((s, x) => s + x, 0)
  };
}

async function send(msg) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'Markdown' })
  });
}

(async () => {
  let data;
  try {
    const res = await fetch(ENDPOINT);
    data = await res.json();
  } catch (err) {
    console.error('Failed to fetch data.json:', err);
    return;
  }

  const scores = calcScore(data);
  if (!scores) {
    console.error('Score calculation aborted.');
    return;
  }

  const { long, short } = scores;
  const threshold = 6;
  let dir = null;
  if (long >= threshold)  dir = 'LONG';
  if (short >= threshold) dir = 'SHORT';

  if (!dir) {
    console.log(`No high‑conviction setup (long=${long}, short=${short}).`);
    return;
  }

  const price  = get(data, 'dataA.1h.ema50', 'n/a');
  const stress = get(data, 'dataE.stressIndex', 'n/a');
  const msg =
`🚨 *High‑Conviction ${dir} (score ${dir==="LONG"?long:short}/10)* 🚨

Price: \`${price}\`
Stress: \`${stress}\`
RSI 1h: \`${data.dataA['1h'].rsi14}\`
CVD 1h: \`${data.dataD.cvd['1h']}\`
Funding Z: \`${data.dataB.fundingZ}\`
Liq 24h: long \`${data.dataB.liquidations.long24h}\` | short \`${data.dataB.liquidations.short24h}\``;

  try {
    await send(msg);
    console.log(`Sent alert: ${dir} score=${dir==="LONG"?long:short}`);
  } catch (err) {
    console.error('Failed to send Telegram message:', err);
  }
})();
