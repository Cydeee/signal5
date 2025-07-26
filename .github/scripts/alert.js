import fetch from 'node-fetch';

const ENDPOINT = 'https://btcsignal.netlify.app/data';  // still hitting /data
const TOKEN    = '8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw';
const CHAT_ID  = '6038110897';

// send to Telegram
async function send(msg) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'Markdown' }),
  });
}

// safe getter
const get = (obj, path, def = null) =>
  path.split('.').reduce((o,k) => (o && o[k] != null ? o[k] : def), obj);

(async function main() {
  console.log("⏳ Fetching", ENDPOINT);
  let raw;
  let text;
  try {
    const res = await fetch(ENDPOINT);
    console.log(`HTTP ${res.status} ${res.statusText}`);
    // try JSON
    try {
      raw = await res.clone().json();
    } catch {
      // fallback: HTML wrapper → extract JSON inside <pre id="dashboard-data">
      text = await res.text();
      console.log("ℹ️ Received HTML; extracting <pre> payload…");
      const m = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
      if (!m) throw new Error("No <pre> block found in HTML");
      raw = JSON.parse(m[1]);
    }
  } catch (err) {
    console.error("❌ Fetch/parse error:", err);
    await send(`❌ Could not load data: ${err.message}`);
    return;
  }

  console.log("✅ Top‑level keys:", Object.keys(raw).join(', '));

  // extract metrics
  const metrics = {
    rsi1h:    get(raw, 'dataA.1h.rsi14'),
    macd1h:   get(raw, 'dataA.1h.macdHist'),
    price:    get(raw, 'dataA.1h.ema50'),
    fundingZ: get(raw, 'dataB.fundingZ'),
    long24:   get(raw, 'dataB.liquidations.long24h'),
    short24:  get(raw, 'dataB.liquidations.short24h'),
    cvd1h:    get(raw, 'dataD.cvd.1h'),
    volFlag:  get(raw, 'dataD.relative.1h', 'unknown'),
    bull15:   get(raw, 'dataD.15m.bullVol'),
    bear15:   get(raw, 'dataD.15m.bearVol'),
    poc4h:    get(raw, 'dataF.vpvr.4h.poc'),
    stress:   get(raw, 'dataE.stressIndex'),
  };

  console.log("▶️ Raw metrics:");
  for (const [k, v] of Object.entries(metrics)) {
    console.log(`  ${k.padEnd(8)}: ${v}`);
  }

  // scoring rules
  const rules = [
    ["RSI < 35 → +1 long",           () => metrics.rsi1h < 35,    +1],
    ["RSI > 65 → +1 short",          () => metrics.rsi1h > 65,    -1],
    ["MACD > 0 → +1 long",           () => metrics.macd1h > 0,     +1],
    ["MACD < 0 → +1 short",          () => metrics.macd1h < 0,     -1],
    ["FundingZ < -1 → +1 long",      () => metrics.fundingZ < -1,  +1],
    ["FundingZ > 1 → +1 short",      () => metrics.fundingZ > 1,   -1],
    ["Short24h>2×Long24h → +1 long", () => metrics.short24 > metrics.long24*2, +1],
    ["Long24h>2×Short24h → +1 short",() => metrics.long24 > metrics.short24*2, -1],
    ["CVD1h>1000 & vol high→+2 long",() => metrics.cvd1h > 1000 && ['high','very high'].includes(metrics.volFlag), +2],
    ["CVD1h<-1000 & vol high→+2 short",() => metrics.cvd1h < -1000 && ['high','very high'].includes(metrics.volFlag), -2],
    ["15m bull>bear → +1 long",      () => metrics.bull15 > metrics.bear15, +1],
    ["15m bear>bull → +1 short",     () => metrics.bear15 > metrics.bull15, -1],
    ["Price>PoC4h → +1 long",        () => metrics.price > metrics.poc4h,  +1],
    ["Price<PoC4h → +1 short",       () => metrics.price < metrics.poc4h,  -1],
    ["Stress 3–5 → +1 both",         () => metrics.stress >= 3 && metrics.stress <= 5, +1],
  ];

  // evaluate
  let longScore = 0, shortScore = 0;
  console.log("🧮 Evaluating rules:");
  for (const [desc, cond, pts] of rules) {
    if (cond()) {
      console.log(`   ✓ ${desc} (${pts > 0 ? '+'+pts : pts} pts)`);
      pts > 0 ? longScore += pts : shortScore -= pts;
    } else {
      console.log(`   ✗ ${desc}`);
    }
  }

  // stress gate
  if (metrics.stress > 7) {
    console.log(`⚠️ Stress ${metrics.stress} > 7 → abort`);
    return;
  }

  console.log(`➡️ Totals → long:${longScore}, short:${shortScore}`);
  const threshold = 6;
  let direction = null;
  if (longScore >= threshold)  direction = 'LONG';
  if (shortScore >= threshold) direction = 'SHORT';

  if (!direction) {
    console.log(`❌ Below threshold ${threshold}; no alert.`);
    return;
  }

  // build & send alert
  const scoreVal = direction === 'LONG' ? longScore : shortScore;
  const msg =
`🚨 *High‑Conviction ${direction} (score ${scoreVal}/10)* 🚨

Price:      \`${metrics.price}\`
Stress:     \`${metrics.stress}\`
RSI 1h:     \`${metrics.rsi1h}\`
CVD 1h:     \`${metrics.cvd1h}\`
Funding Z:  \`${metrics.fundingZ}\`
Liq 24h:    long \`${metrics.long24}\` | short \`${metrics.short24}\``;

  console.log("📤 Sending:", msg.replace(/\n/g,' | '));
  await send(msg);
  console.log(`✅ Alert sent (${direction})`);
})();
