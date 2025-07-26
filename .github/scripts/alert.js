import fetch from 'node-fetch';

const ENDPOINT = 'https://btcsignal.netlify.app/data.json';
const TOKEN    = '8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw';
const CHAT_ID  = '6038110897';  // your private‑chat ID

// safe getter with default
const get = (obj, path, def = 0) =>
  path.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : def), obj);

// send a Telegram message
async function send(msg) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: msg,
      parse_mode: 'Markdown'
    }),
  });
}

async function main() {
  // 1) fetch dashboard JSON
  let data;
  try {
    const res = await fetch(ENDPOINT);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.error('Fetch error:', err);
    await send(`❌ Failed to fetch data.json: ${err.message}`);
    return;
  }

  // 2) extract all metrics
  const rsi1h    = get(data, 'dataA.1h.rsi14', 50);
  const macd1h   = get(data, 'dataA.1h.macdHist', 0);
  const price    = get(data, 'dataA.1h.ema50', 0);
  const fundingZ = get(data, 'dataB.fundingZ', 0);
  const long24   = get(data, 'dataB.liquidations.long24h', 0);
  const short24  = get(data, 'dataB.liquidations.short24h', 0);
  const cvd1h    = get(data, 'dataD.cvd.1h', 0);
  const volFlag  = get(data, 'dataD.relative.1h', 'normal');
  const bull15   = get(data, 'dataD.15m.bullVol', 0);
  const bear15   = get(data, 'dataD.15m.bearVol', 0);
  const poc4h    = get(data, 'dataF.vpvr.4h.poc', 0);
  const stress   = get(data, 'dataE.stressIndex', 0);

  // 3) scoring
  const longPts = [], shortPts = [];

  if (rsi1h < 35) longPts.push(1);
  if (rsi1h > 65) shortPts.push(1);

  if (macd1h > 0) longPts.push(1);
  if (macd1h < 0) shortPts.push(1);

  if (fundingZ < -1) longPts.push(1);
  if (fundingZ >  1) shortPts.push(1);

  if (short24 > long24 * 2) longPts.push(1);
  if (long24  > short24 * 2) shortPts.push(1);

  if (cvd1h >  1000 && ['high','very high'].includes(volFlag)) longPts.push(2);
  if (cvd1h < -1000 && ['high','very high'].includes(volFlag)) shortPts.push(2);

  if (bull15 > bear15 * 2) longPts.push(1);
  if (bear15 > bull15 * 2) shortPts.push(1);

  if (price > poc4h) longPts.push(1);
  if (price < poc4h) shortPts.push(1);

  // stress gate/bonus
  if (stress > 7) {
    console.log(`Stress ${stress} > 7; skipping alerts.`);
    return;
  }
  if (stress >= 3 && stress <= 5) {
    longPts.push(1);
    shortPts.push(1);
  }

  const longScore  = longPts.reduce((s,x)=>s+x,0);
  const shortScore = shortPts.reduce((s,x)=>s+x,0);
  console.log(`Scores → long:${longScore}, short:${shortScore}, stress:${stress}`);

  // 4) threshold check
  const threshold = 6;
  let direction = null;
  if (longScore  >= threshold) direction = 'LONG';
  if (shortScore >= threshold) direction = 'SHORT';

  if (!direction) {
    console.log('No high‑conviction signal this run.');
    return;
  }

  // 5) build & send alert
  const msg =
`🚨 *High‑Conviction ${direction} (score ${direction==="LONG"?longScore:shortScore}/10)* 🚨

Price:      \`${price.toFixed(2)}\`
Stress:     \`${stress}\`
RSI 1h:     \`${rsi1h}\`
CVD 1h:     \`${cvd1h}\`
Funding Z:  \`${fundingZ}\`
Liq 24h:    long \`${long24}\` | short \`${short24}\``

  await send(msg);
  console.log(`Sent alert: ${direction}`);
}

main().catch(err => {
  console.error('Unexpected error in alert.js:', err);
});
