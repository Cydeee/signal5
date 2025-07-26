import fetch from 'node-fetch';

const ENDPOINT = 'https://btcsignal.netlify.app/data.json';
const TOKEN    = '8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw';
const CHAT_ID  = '6038110897';

// safe getter with default
const get = (obj, path, def = 0) =>
  path.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : def), obj);

// send to Telegram
async function send(msg) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'Markdown' })
  });
}

async function main() {
  console.log("⏳ Fetching dashboard JSON...");
  let data;
  try {
    const res = await fetch(ENDPOINT);
    console.log(`HTTP ${res.status} ${res.statusText}`);
    data = await res.json();
  } catch (err) {
    console.error("❌ Fetch error:", err);
    await send(`❌ Failed to fetch data.json: ${err.message}`);
    return;
  }

  // extract metrics
  const metrics = {
    rsi1h:    get(data,'dataA.1h.rsi14',null),
    macd1h:   get(data,'dataA.1h.macdHist',null),
    price:    get(data,'dataA.1h.ema50',null),
    fundingZ: get(data,'dataB.fundingZ',null),
    long24:   get(data,'dataB.liquidations.long24h',null),
    short24:  get(data,'dataB.liquidations.short24h',null),
    cvd1h:    get(data,'dataD.cvd.1h',null),
    volFlag:  get(data,'dataD.relative.1h','unknown'),
    bull15:   get(data,'dataD.15m.bullVol',null),
    bear15:   get(data,'dataD.15m.bearVol',null),
    poc4h:    get(data,'dataF.vpvr.4h.poc',null),
    stress:   get(data,'dataE.stressIndex',null)
  };

  console.log("▶️ Raw metrics:");
  Object.entries(metrics).forEach(([k,v]) => console.log(`  ${k.padEnd(8)}: ${v}`));

  // define rules: [ description, condition, points (positive for long, negative for short) ]
  const rules = [
    ["RSI1h < 35 (long)",                 () => metrics.rsi1h < 35,       +1],
    ["RSI1h > 65 (short)",                () => metrics.rsi1h > 65,       -1],
    ["MACD1h > 0 (long)",                 () => metrics.macd1h > 0,       +1],
    ["MACD1h < 0 (short)",                () => metrics.macd1h < 0,       -1],
    ["FundingZ < -1 (long)",              () => metrics.fundingZ < -1,    +1],
    ["FundingZ > 1 (short)",              () => metrics.fundingZ > 1,     -1],
    ["Short24h > 2×Long24h (long)",       () => metrics.short24 > metrics.long24*2, +1],
    ["Long24h > 2×Short24h (short)",      () => metrics.long24  > metrics.short24*2, -1],
    ["CVD1h>1000 & vol high (long)",      () => metrics.cvd1h > 1000 && ["high","very high"].includes(metrics.volFlag), +2],
    ["CVD1h<-1000 & vol high (short)",    () => metrics.cvd1h < -1000 && ["high","very high"].includes(metrics.volFlag), -2],
    ["15m bull>bear (long)",              () => metrics.bull15 > metrics.bear15, +1],
    ["15m bear>bull (short)",             () => metrics.bear15 > metrics.bull15, -1],
    ["Price>PoC4h (long)",                () => metrics.price > metrics.poc4h, +1],
    ["Price<PoC4h (short)",               () => metrics.price < metrics.poc4h, -1],
    ["Stress 3–5 bonus",                  () => metrics.stress>=3 && metrics.stress<=5, +1],  // adds +1 long & short
  ];

  // scoring
  let longScore = 0, shortScore = 0;
  console.log("🧮 Evaluating rules:");
  rules.forEach(([desc,fn,pts]) => {
    if (fn()) {
      console.log(`   ✓ ${desc} (pts ${pts})`);
      if (pts>0) longScore += pts;
      else shortScore -= pts; // pts negative for short
    } else {
      console.log(`   ✗ ${desc}`);
    }
  });

  // Stress gate
  if (metrics.stress > 7) {
    console.log(`⚠️ Stress ${metrics.stress} >7 → abort`);
    return;
  }

  console.log(`➡️ Total longScore=${longScore}, shortScore=${shortScore}`);
  const threshold = 6;
  let direction = null;
  if (longScore >= threshold)   direction = "LONG";
  if (shortScore >= threshold)  direction = "SHORT";

  if (!direction) {
    console.log(`❌ Scores below threshold ${threshold}. No alert.`);
    return;
  }

  // build & send
  const scoreVal = direction==="LONG" ? longScore : shortScore;
  const msg =
`🚨 *High‑Conviction ${direction} (score ${scoreVal}/10)* 🚨

Price:      \`${metrics.price}\`
Stress:     \`${metrics.stress}\`
RSI 1h:     \`${metrics.rsi1h}\`
CVD 1h:     \`${metrics.cvd1h}\`
Funding Z:  \`${metrics.fundingZ}\`
Liq 24h:    long \`${metrics.long24}\` | short \`${metrics.short24}\``

  console.log("📤 Sending alert:", msg.replace(/\n/g," | "));
  await send(msg);
  console.log(`✅ Alert sent: ${direction}`);
}

main().catch(err => console.error("❗️ Unexpected error:", err));
