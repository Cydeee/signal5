// .github/scripts/alert.js
/**
 * Fetch fresh dashboard data from your Netlify Edge Function
 * then calculate and send the Telegram alert.
 */

const BOT       = process.env.BOT_TOKEN  || "8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw";
const CHAT      = process.env.CHAT_ID    || "6038110897";
const LIVE_URL  = process.env.LIVE_URL   || "https://btcsignal.netlify.app/data.json";
const TEST      = process.env.TEST_ALERT === "1";

async function tg(msg) {
  const res = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT,
      text: msg,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(`Telegram error: ${j.description}`);
}

function calc(raw) {
  const A = raw.dataA?.["1h"] || {};
  const B = raw.dataB || {};
  const D = raw.dataD || {};
  const F = raw.dataF || {};
  const E = raw.dataE || {};

  const rsi    = +A.rsi14    || 0;
  const macd   = +A.macdHist || 0;
  const fund   = +B.fundingZ || 0;
  const l24    = +B.liquidations?.long24h  || 0;
  const s24    = +B.liquidations?.short24h || 0;
  const cvd    = +D.cvd?.["1h"]            || 0;
  const vf     = D.relative?.["15m"]       || "unknown";
  const b15    = +D["15m"]?.bullVol        || 0;
  const br15   = +D["15m"]?.bearVol        || 0;
  const price  = +A.ema50                  || 0;
  const poc4   = +F.vpvr?.["4h"]?.poc      || 0;
  const stress = +E.stressIndex            || 0;

  let L = 0, S = 0;
  if (rsi < 35) L++; if (rsi > 65) S++;
  if (macd > 0) L++; else if (macd < 0) S++;
  if (fund < -1) L++; else if (fund > 1) S++;
  if (s24 > 2 * l24) L++; if (l24 > 2 * s24) S++;
  if (cvd > 1000 && (vf==="high"||vf==="very high")) L += 2;
  if (cvd < -1000 && (vf==="high"||vf==="very high")) S += 2;
  if (b15 > br15) L++; else if (br15 > b15) S++;
  if (price > poc4) L++; else if (price < poc4) S++;
  if (stress >= 3 && stress <= 5) { L++; S++; }

  return { long: L, short: S };
}

(async () => {
  console.log("🔍 Fetching data from:", LIVE_URL);
  let raw;
  try {
    const res = await fetch(LIVE_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
  } catch (err) {
    console.error("❌ Failed to fetch/parse JSON:", err);
    process.exit(1);
  }

  const { long, short } = calc(raw);

  if (TEST) {
    console.log("💡 TEST mode — sending test alert");
    await tg("✅ *TEST ALERT* — bot online");
    return;
  }

  const THRESHOLD = 6;
  if (long >= THRESHOLD || short >= THRESHOLD) {
    const dir = long >= THRESHOLD ? "LONG" : "SHORT";
    const sc  = long >= THRESHOLD ? long : short;
    console.log(`🚀 Sending alert: ${dir} (${sc})`);
    await tg(`🚀 *High-Conviction ${dir}* (score ${sc})`);
  } else {
    console.log(`🚫 No signal (long=${long}, short=${short})`);
  }
})().catch(err => {
  console.error("❌ Unhandled error:", err);
  process.exit(1);
});
