import fetch from 'node-fetch';

const ENDPOINT = 'https://btcsignal.netlify.app/data.json';
const TOKEN    = '8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw';
const CHAT_ID  = '6038110897';

// safe getter, adjusted for top‐level "data" wrapper
const get = (obj, path, def = null) =>
  path.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : def), obj);

// send a Telegram message
async function send(msg) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'Markdown' }),
  });
}

(async function main() {
  console.log("⏳ Fetching dashboard JSON...");
  let raw;
  try {
    const res = await fetch(ENDPOINT);
    console.log(`HTTP ${res.status} ${res.statusText}`);
    raw = await res.json();
  } catch (err) {
    console.error("❌ Fetch error:", err);
    await send(`❌ Failed to fetch data.json: ${err.message}`);
    return;
  }

  // Drill into the "data" wrapper
  const d = raw.data || {};
  console.log("✅ Loaded .data with keys:", Object.keys(d).join(', '));

  // Extract every metric
  const metrics = {
    rsi1h:    get(d, 'dataA.1h.rsi14'),
    macd1h:   get(d, 'dataA.1h.macdHist'),
    price:    get(d, 'dataA.1h.ema50'),
    fundingZ: get(d, 'dataB.fundingZ'),
    long24:   get(d, 'dataB.liquidations.long24h'),
    short24:  get(d, 'dataB.liquidations.short24h'),
    cvd1h:    get(d, 'dataD.cvd.1h'),
    volFlag:  get(d, 'dataD.relative.1h', 'unknown'),
    bull15:   get(d, 'dataD.15m.bullVol'),
    bear15:   get(d, 'dataD.15m.bearVol'),
    poc4h:    get(d, 'dataF.vpvr.4h.poc'),
    stress:   get(d, 'dataE.stressIndex')
  };

  console.log("▶️ Raw metrics:");
  for (const [k,v] of Object.entries(metrics)) {
    console.log(`  ${k.padEnd(8)}: ${v}`);
  }

  // Define your rules
  const rules = [
    ["RSI < 35 → +1 long",            () => metrics.rsi1h < 35,       +1],
    ["RSI > 65 → +1 short",           () => metrics.rsi1h > 65,       -1],
    ["MACD > 0 → +1 long",            () => metrics.macd1h > 0,       +1],
    ["MACD < 0 → +1 short",           () => metrics.macd1h < 0,       -1],
    ["FundingZ < -1 → +1 long",       () => metrics.fundingZ < -1,    +1],
    ["FundingZ > 1 → +1 short",       () => metrics.fundingZ > 1,     -1],
    ["Short24h>2×Long24h → +1 long",  () => metrics.short24 > metrics.long24*2, +1],
    ["Long24h>2×Short24h → +1 short", () => metrics.long24  > metrics.short24*2,-1],
    ["CVD1h>1000 & vol high→+2 long", () => metrics.cvd1h>1000 && ['high','very high'].includes(metrics.volFlag), +2],
    ["CVD1h<−1000 & vol high→+2 short",() => metrics.cvd1h<-1000&& ['high','very high'].includes(metrics.volFlag),-2],
    ["15m bull>bear → +1 long",       () => metrics.bull15 > metrics.bear15, +1],
    ["15m bear>bull → +1 short",      () => metrics.bear15 > metrics.bull15, -1],
    ["Price>PoC4h → +1 long",         () => metrics.price > metrics.poc4h,    +1],
    ["Price<PoC4h → +1 short",        () => metrics.price < metrics.poc4h,    -1],
    ["Stress 3–5 → +1 both",          () => metrics.stress >=3 && metrics.stress<=5, +1],
  ];

  // Evaluate
  let longScore = 0, shortScore = 0;
  console.log("🧮 Evaluating rules:");
  for (const [desc,cond,pts] of rules) {
    if (cond()) {
      console.log(`   ✓ ${desc} (${pts>0? '+'+pts: pts} pts)`);
      if (pts>0) longScore += pts; else shortScore -= pts;
    } else {
      console.log(`   ✗ ${desc}`);
    }
  }

  // Stress gate
  if (metrics.stress > 7) {
    console.log(`⚠️ Stress ${metrics.stress} >7 → abort`);
    return;
  }

  console.log(`➡️ Total scores: long=${longScore}, short=${shortScore}`);
  const threshold = 6;
  let dir = null;
  if (longScore  >= threshold) dir = 'LONG';
  if (shortScore >= threshold) dir = 'SHORT';

  if (!dir) {
    console.log(`❌ Both scores below ${threshold}; no alert.`);
    return;
  }

  // Build and send
  const scoreVal = dir==="LONG" ? longScore : shortScore;
  const msg =
`🚨 *High‑Conviction ${dir} (score ${scoreVal}/10)* 🚨

Price:      \`${metrics.price}\`
Stress:     \`${metrics.stress}\`
RSI 1h:     \`${metrics.rsi1h}\`
CVD 1h:     \`${metrics.cvd1h}\`
Funding Z:  \`${metrics.fundingZ}\`
Liq 24h:    long \`${metrics.long24}\` | short \`${metrics.short24}\``

  console.log("📤 Sending alert:", msg.replace(/\n/g,' | '));
  await send(msg);
  console.log(`✅ Alert sent: ${dir}`);
})();
