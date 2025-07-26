// .github/scripts/alert-live.js
// Standalone High-Conviction Telegram Alert
// Fetches full A→H payload from your Netlify Edge Function, logs key data,
// scores long/short, and sends alerts when threshold is met.

const BOT_TOKEN = "8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw";
const CHAT_ID   = "6038110897";
const EDGE_URL  = "https://btcsignal.netlify.app/data.json";
const TEST_MODE = process.env.TEST_ALERT === "1";

// Fetch JSON from Edge Function with cache-bust, log status
async function fetchEdgeData() {
  const url = `${EDGE_URL}?bust=${Date.now()}`;
  console.log("🔍 Fetching dashboard data from Edge:", url);
  const res = await fetch(url, { cache: "no-store" });
  console.log(`◀ HTTP status: ${res.status}`);
  const text = await res.text();
  console.log(`⏱ Payload size: ${text.length} bytes`);
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    console.error("❌ Failed to parse JSON:", err);
    throw err;
  }
  // Log presence of each block
  console.log("🔍 Payload blocks:", {
    A: !!data.dataA && Object.keys(data.dataA).length,
    B: !!data.dataB,
    C: !!data.dataC && Object.keys(data.dataC).length,
    D: !!data.dataD,
    E: !!data.dataE,
    F: !!data.dataF,
    G: !!data.dataG,
    H: !!data.dataH
  });
  return data;
}

// Scoring function with default fallbacks, logs indicators
function score(raw) {
  console.log("🔑 Raw data preview:", {
    dataA_1h: raw.dataA?.["1h"],
    dataB: raw.dataB,
    dataD_1h: raw.dataD?.cvd?.["1h"],
    dataF_4h: raw.dataF?.vpvr?.["4h"],
    dataE: raw.dataE
  });

  const A1h = raw.dataA?.["1h"] || {};
  const B   = raw.dataB          || {};
  const D   = raw.dataD          || {};
  const F4h = raw.dataF?.vpvr?.["4h"] || {};
  const E   = raw.dataE          || {};

  const liqs    = B.liquidations || {};
  const long24  = +liqs.long24h  || 0;
  const short24 = +liqs.short24h || 0;
  const rsi14   = +A1h.rsi14     || 0;
  const macd    = +A1h.macdHist  || 0;
  const funding = +B.fundingZ    || 0;
  const cvd1h   = +D.cvd?.["1h"]     || 0;
  const rel15   = D.relative?.["15m"] || "normal";
  const bull15  = +raw.dataD["15m"]?.bullVol || 0;
  const bear15  = +raw.dataD["15m"]?.bearVol || 0;
  const price50 = +A1h.ema50     || 0;
  const poc4h   = +F4h.poc       || 0;
  const stress  = +E.stressIndex || 0;

  console.log("▶ Indicators values:", { rsi14, macd, funding, long24, short24, cvd1h, rel15, bull15, bear15, price50, poc4h, stress });

  let L = 0, S = 0;
  if (rsi14 < 35) L++; else if (rsi14 > 65) S++;
  if (macd > 0)    L++; else if (macd < 0)    S++;
  if (funding < -1) L++; else if (funding > 1) S++;
  if (short24 > 2*long24) L++;
  if (long24 > 2*short24) S++;
  if (cvd1h > 1000 && (rel15 === "high" || rel15 === "very high")) L += 2;
  if (cvd1h < -1000 && (rel15 === "high" || rel15 === "very high")) S += 2;
  if (bull15 > bear15)   L++; else if (bear15 > bull15)   S++;
  if (price50 > poc4h)   L++; else if (price50 < poc4h)   S++;
  if (stress >= 3 && stress <= 5) { L++; S++; }

  console.log("▶ Computed scores:", { long: L, short: S });
  return { long: L, short: S };
}

// Send Telegram message
async function sendTelegram(msg) {
  console.log("▶ Sending Telegram message:", msg);
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: "Markdown", disable_web_page_preview: true })
  });
  const j = await res.json();
  console.log("◀ Telegram API response:", j);
  if (!j.ok) throw new Error(`Telegram error: ${j.description}`);
}

// Main execution
(async () => {
  let raw;
  try {
    raw = await fetchEdgeData();
  } catch (err) {
    console.error("❌ Error fetching dashboard data:", err);
    process.exit(1);
  }

  const { long, short } = score(raw);

  if (TEST_MODE) {
    console.log("💡 TEST mode — sending test alert");
    await sendTelegram("✅ *TEST ALERT* — bot online");
    return;
  }

  const THRESHOLD = 6;
  if (long >= THRESHOLD || short >= THRESHOLD) {
    const dir = long >= THRESHOLD ? "LONG" : "SHORT";
    const sc  = Math.max(long, short);
    const msg = `🚀 *High-Conviction ${dir}* (score ${sc})`;
    await sendTelegram(msg);
    console.log("✅ Alert sent");
  } else {
    console.log(`🚫 No high-conviction signal (long=${long}, short=${short})`);
  }
})();
