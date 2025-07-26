import fetch from 'node-fetch';

const ENDPOINT = 'https://btcsignal.netlify.app/live.json';
const TOKEN    = '8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw';
const CHAT_ID  = '6038110897';

const get = (obj, path, def = null) =>
  path.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : def), obj);

async function send(text) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' }),
  });
}

(async function main() {
  console.log('⏳ Fetching', ENDPOINT);
  let data;
  try {
    const res = await fetch(ENDPOINT);
    console.log('HTTP', res.status, res.statusText);
    data = await res.json();
  } catch (err) {
    console.error('❌ fetch error', err);
    await send(`❌ Fetch error: ${err.message}`);
    return;
  }

  console.log('✅ Keys:', Object.keys(data).join(', '));

  const m = {
    rsi1h:    get(data, 'dataA.1h.rsi14'),
    macd1h:   get(data, 'dataA.1h.macdHist'),
    price:    get(data, 'dataA.1h.ema50'),
    fundingZ: get(data, 'dataB.fundingZ'),
    long24:   get(data, 'dataB.liquidations.long24h'),
    short24:  get(data, 'dataB.liquidations.short24h'),
    cvd1h:    get(data, 'dataD.cvd.1h'),
    volFlag:  get(data, 'dataD.relative.1h', 'unknown'),
    bull15:   get(data, 'dataD.15m.bullVol'),
    bear15:   get(data, 'dataD.15m.bearVol'),
    poc4h:    get(data, 'dataF.vpvr.4h.poc'),
    stress:   get(data, 'dataE.stressIndex'),
  };

  console.log('▶️ Metrics:', m);

  const rules = [
    ['RSI<35 → +1 long',   () => m.rsi1h < 35, +1],
    ['RSI>65 → +1 short',  () => m.rsi1h > 65, -1],
    ['MACD>0 → +1 long',   () => m.macd1h > 0,  +1],
    ['MACD<0 → +1 short',  () => m.macd1h < 0,  -1],
    ['FundZ<-1 → +1 long', () => m.fundingZ < -1, +1],
    ['FundZ>1 → +1 short', () => m.fundingZ > 1,  -1],
    ['S24>2×L24 → +1 L',   () => m.short24 > m.long24 * 2, +1],
    ['L24>2×S24 → +1 S',   () => m.long24  > m.short24 * 2, -1],
    ['CVD>1k & highVol → +2 L',  
                           () => m.cvd1h > 1000 && ['high','very high'].includes(m.volFlag), +2],
    ['CVD<-1k & highVol → +2 S', 
                           () => m.cvd1h < -1000 && ['high','very high'].includes(m.volFlag), -2],
    ['15m bull>bear → +1 L',() => m.bull15 > m.bear15, +1],
    ['15m bear>bull → +1 S',() => m.bear15 > m.bull15, -1],
    ['Price>PoC4h → +1 L',  () => m.price > m.poc4h, +1],
    ['Price<PoC4h → +1 S',  () => m.price < m.poc4h, -1],
    ['Stress3–5 → +1 both', () => m.stress >= 3 && m.stress <= 5, +1],
  ];

  let longScore = 0, shortScore = 0;
  console.log('🧮 Evaluating rules…');
  for (const [desc, cond, pts] of rules) {
    if (cond()) {
      console.log(`   ✓ ${desc} (${pts > 0 ? '+'+pts : pts} pts)`);
      pts > 0 ? (longScore += pts) : (shortScore -= pts);
    } else {
      console.log(`   ✗ ${desc}`);
    }
  }

  if (m.stress > 7) {
    console.log(`⚠️ Stress ${m.stress} > 7 → abort`);
    return;
  }

  console.log(`➡️ Scores → long: ${longScore}, short: ${shortScore}`);
  const threshold = 6;
  const direction = longScore >= threshold
    ? 'LONG'
    : shortScore >= threshold
      ? 'SHORT'
      : null;

  if (!direction) {
    console.log('❌ Below threshold; no alert.');
    return;
  }

  const score = direction === 'LONG' ? longScore : shortScore;
  const msg =
`🚨 *High‑Conviction ${direction} (score ${score}/10)* 🚨

Price:      \`${m.price}\`
RSI 1h:     \`${m.rsi1h}\`
MACD Hist 1h: \`${m.macd1h}\`
Funding Z:  \`${m.fundingZ}\`
Liq 24h:    long \`${m.long24}\` | short \`${m.short24}\`
Stress:     \`${m.stress}\``;

  console.log('📤 Sending alert…');
  await send(msg);
  console.log('✅ Alert sent.');
})();
