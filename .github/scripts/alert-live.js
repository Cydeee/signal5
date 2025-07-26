/**
 * Standalone High‑Conviction Alert via Netlify Edge Proxy
 *
 * 1) Fetches the full A→H JSON from your Edge Function.
 * 2) Parses dataA…dataH exactly as if it were local.
 * 3) Applies your long/short scoring logic.
 * 4) Sends a Telegram alert if threshold is met.
 */

const BOT_TOKEN = "8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw";
const CHAT_ID   = "6038110897";
const EDGE_URL  = "https://btcsignal.netlify.app/data.json";
const TEST_MODE = process.env.TEST_ALERT === "1";

async function fetchEdgeData() {
  console.log("🔍 Fetching dashboard from Edge:", EDGE_URL);
  const res = await fetch(EDGE_URL + "?bust=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Edge fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  console.log("✅ Received payload:", {
    hasA: !!data.dataA,
    hasB: !!data.dataB,
    hasC: !!data.dataC,
    hasD: !!data.dataD,
    hasE: !!data.dataE,
    hasF: !!data.dataF,
    hasG: !!data.dataG,
    hasH: !!data.dataH,
  });
  return data;
}

function score(raw) {
  // exactly same scoring logic you had
  const A1h = raw.dataA?.["1h"] || {};
  const B   = raw.dataB   || { liquidations: {} };
  const D   = raw.dataD   || { cvd:{}, relative:{} };
  const F4h = raw.dataF?.vpvr?.["4h"] || {};
  const E   = raw.dataE   || {};

  const rsi14   = +A1h.rsi14    || 0;
  const macd    = +A1h.macdHist || 0;
  const funding = +B.fundingZ  || 0;
  const long24  = +B.liquidations.long24h  || 0;
  const short24 = +B.liquidations.short24h || 0;
  const cvd1h   = +D.cvd["1h"]            || 0;
  const rel15   = D.relative["15m"]       || "normal";
  const bull15  = +raw.dataD["15m"]?.bullVol || 0;
  const bear15  = +raw.dataD["15m"]?.bearVol || 0;
  const price50 = +A1h.ema50               || 0;
  const poc4h   = +F4h.poc                 || 0;
  const stress  = +E.stressIndex           || 0;

  console.log("▶ Indicators:", { rsi14, macd, funding, long24, short24, cvd1h, rel15, bull15, bear15, price50, poc4h, stress });

  let L = 0, S = 0;
  if (rsi14 < 35) L++; else if (rsi14 > 65) S++;
  if (macd > 0) L++; else if (macd < 0) S++;
  if (funding < -1) L++; else if (funding > 1) S++;
  if (short24 > 2*long24) L++; if (long24 > 2*short24) S++;
  if (cvd1h > 1000 && (rel15==="high"||rel15==="very high")) L+=2;
  if (cvd1h < -1000 && (rel15==="high"||rel15==="very high")) S+=2;
  if (bull15 > bear15) L++; else if (bear15 > bull15) S++;
  if (price50 > poc4h) L++; else if (price50 < poc4h) S++;
  if (stress >= 3 && stress <= 5) { L++; S++; }

  console.log("▶ Scores:", { long:L, short:S });
  return { long:L, short:S };
}

async function sendTelegram(msg) {
  console.log("▶ Sending Telegram:", msg);
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: msg,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
  });
  const j = await res.json();
  console.log("◀ Telegram response:", j);
  if (!j.ok) throw new Error(`Telegram error: ${j.description}`);
}

(async () => {
  let raw;
  try {
    raw = await fetchEdgeData();
  } catch (err) {
    console.error("❌ Failed to load Edge data:", err);
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
    console.log("▶ Alert condition met:", msg);
    await sendTelegram(msg);
  } else {
    console.log("🚫 No signal — below threshold");
  }
})();
