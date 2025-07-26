import fetch from 'node-fetch';

// ——— Configuration ———
const ENDPOINT = 'https://btcsignal.netlify.app/data';  // 👉 hit the Edge Function
const TOKEN    = '8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw';
const CHAT_ID  = '6038110897';

// —— Utilities ——
// safe getter
const get = (obj, path, def = null) =>
  path.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : def), obj);

// send to Telegram
async function send(msg) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'Markdown' }),
  });
}

(async function main() {
  console.log(`⏳ Fetching live dashboard from ${ENDPOINT} …`);
  let payload;
  try {
    const res = await fetch(ENDPOINT);
    console.log(`HTTP ${res.status} ${res.statusText}`);
    payload = await res.json();
  } catch (err) {
    console.error('❌ Error fetching live data:', err);
    await send(`❌ Fetch error: ${err.message}`);
    return;
  }

  // Show that we actually got the full JSON
  console.log('✅ Received keys:', Object.keys(payload).join(', '));

  // — Extract your metrics from payload.dataA…payload.dataH —
  const m = {
    rsi1h:    get(payload, 'dataA.1h.rsi14'),
    macd1h:   get(payload, 'dataA.1h.macdHist'),
    price:    get(payload, 'dataA.1h.ema50'),
    fundingZ: get(payload, 'dataB.fundingZ'),
    long24:   get(payload, 'dataB.liquidations.long24h'),
    short24:  get(payload, 'dataB.liquidations.short24h'),
    cvd1h:    get(payload, 'dataD.cvd.1h'),
    volFlag:  get(payload, 'dataD.relative.1h', 'unknown'),
    bull15:   get(payload, 'dataD.15m.bullVol'),
    bear15:   get(payload, 'dataD.15m.bearVol'),
    poc4h:    get(payload, 'dataF.vpvr.4h.poc'),
    stress:   get(payload, 'dataE.stressIndex'),
  };

  console.log('▶️ Raw metrics:');
  Object.entries(m).forEach(([k,v]) => console.log(`   ${k.padEnd(8)}: ${v}`));

  // — Scoring rules —
  const rules = [
    ['RSI < 35 → +1 long',      () => m.rsi1h   < 35,     +1],
    ['RSI > 65 → +1 short',     () => m.rsi1h   > 65,     -1],
    ['MACD > 0 → +1 long',      () => m.macd1h  > 0,      +1],
    ['MACD < 0 → +1 short',     () => m.macd1h  < 0,      -1],
    ['Fund<−1 → +1 long',       () => m.fundingZ < -1,     +1],
    ['Fund>1 → +1 short',       () => m.fundingZ > 1,      -1],
    ['Short24>2×Long24 → +1 long', () => m.short24 > m.long24*2, +1],
    ['Long24>2×Short24 → +1 short',()=> m.long24  > m.short24*2,-1],
    ['CVD>1000&vol high→+2L',   () => m.cvd1h   > 1000 && ['high','very high'].includes(m.volFlag), +2],
    ['CVD<-1000&vol high→+2S',  () => m.cvd1h   < -1000&& ['high','very high'].includes(m.volFlag), -2],
    ['15m bull>bear → +1 long', () => m.bull15  > m.bear15, +1],
    ['15m bear>bull→ +1 short', () => m.bear15  > m.bull15, -1],
    ['Price>PoC4h → +1 long',   () => m.price   > m.poc4h,  +1],
    ['Price<PoC4h → +1 short',  () => m.price   < m.poc4h,  -1],
    ['Stress 3–5 → +1 both',    () => m.stress  >=3 && m.stress<=5, +1],
  ];

  let longScore = 0, shortScore = 0;
  console.log('🧮 Evaluating rules:');
  for (let [desc, cond, pts] of rules) {
    if (cond()) {
      console.log(`   ✓ ${desc} (${pts>0? '+'+pts:pts})`);
      if (pts > 0) longScore += pts; else shortScore -= pts;
    } else {
      console.log(`   ✗ ${desc}`);
    }
  }

  // Stress gate
  if (m.stress > 7) {
    console.log(`⚠️ Stress ${m.stress} >7 → abort`);
    return;
  }

  console.log(`➡️ Scores → long:${longScore}, short:${shortScore}`);
  const TH = 6;
  let dir = longScore >= TH ? 'LONG' : shortScore >= TH ? 'SHORT' : null;
  if (!dir) {
    console.log(`❌ Below threshold ${TH}; no alert.`);
    return;
  }

  // Build & send
  const score = dir==='LONG'? longScore : shortScore;
  const msg =
`🚨 *High‑Conviction ${dir} (score ${score}/10)* 🚨

Price:    \`${m.price}\`
RSI 1h:   \`${m.rsi1h}\`
CVD 1h:   \`${m.cvd1h}\`
Funding:  \`${m.fundingZ}\`
Liq 24h:  long \`${m.long24}\` / short \`${m.short24}\`
Stress:   \`${m.stress}\``

  console.log('📤 Sending:', msg.replace(/\n/g,' | '));
  await send(msg);
  console.log('✅ Alert sent.');
})().catch(e=>{
  console.error('❌ Unhandled error:', e);
});
