#!/usr/bin/env node
// .github/scripts/alert-live.js
// Fetch dashboard JSON → score → Telegram alert if score ≥ THRESHOLD

// ---- env --------------------------------------------------------------
const LIVE_URL  = process.env.LIVE_URL  || "https://btcsignal.netlify.app/data.json";
const BOT_TOKEN = process.env.BOT_TOKEN || "8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw";
const CHAT_ID   = process.env.CHAT_ID   || "6038110897";
const THRESHOLD = 6;

if (!BOT_TOKEN || !CHAT_ID || !LIVE_URL) {
  console.error("❌ Missing env BOT_TOKEN, CHAT_ID, or LIVE_URL");
  process.exit(1);
}

// ---- network helpers --------------------------------------------------
async function fetchEdgeData(retries = 4) {
  const delays = [0, 2000, 5000, 10000];          // ms
  for (let i = 0; i < retries; i++) {
    const url = `${LIVE_URL}?bust=${Date.now()}`;
    try {
      const res  = await fetch(url, { cache: "no-store" });
      const text = await res.text();
      console.log(`◀ Attempt ${i + 1}: HTTP ${res.status} (${text.length} bytes)`);
      if (res.status === 200) return JSON.parse(text);
      if (i < retries - 1 && [502, 503, 504].includes(res.status)) {
        await new Promise(r => setTimeout(r, delays[i]));
        continue;
      }
      throw new Error(`Edge returned ${res.status}`);
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delays[i]));
    }
  }
}

async function tg(msg) {
  const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: msg,
      parse_mode: "Markdown",
      disable_web_page_preview: true
    })
  });
  const j = await resp.json();
  if (!j.ok) throw new Error(j.description);
}

// ---- scoring ----------------------------------------------------------
function score(raw) {
  const A = raw.dataA?.["1h"] || {};
  const B = raw.dataB        || {};
  const D = raw.dataD        || {};
  const F = raw.dataF        || {};
  const E = raw.dataE        || {};

  const rsi   = +A.rsi14   || 0;
  const macd  = +A.macdHist|| 0;
  const fund  = +B.fundingZ|| 0;
  const l24   = +B.liquidations?.long24h  || 0;
  const s24   = +B.liquidations?.short24h || 0;
  const cvd   = +D.cvd?.["1h"] || 0;
  const rel15 = D.relative?.["15m"] || "normal";
  const bull15= +D["15m"]?.bullVol || 0;
  const bear15= +D["15m"]?.bearVol || 0;
  const price = +A.ema50  || 0;
  const poc4h = +F.vpvr?.["4h"]?.poc || 0;
  const stress= +E.stressIndex || 0;

  let L = 0, S = 0;
  if (rsi < 35) L++; if (rsi > 65) S++;
  if (macd > 0) L++; else if (macd < 0) S++;
  if (fund < -1) L++; else if (fund > 1) S++;
  if (s24 > 2 * l24) L++; if (l24 > 2 * s24) S++;
  if (cvd > 1000 && ["high", "very high"].includes(rel15)) L += 2;
  if (cvd < -1000 && ["high", "very high"].includes(rel15)) S += 2;
  if (bull15 > bear15) L++; else if (bear15 > bull15) S++;
  if (price > poc4h) L++; else if (price < poc4h) S++;
  if (stress >= 3 && stress <= 5) { L++; S++; }

  return { long: L, short: S };
}

// ---- main -------------------------------------------------------------
(async () => {
  try {
    console.log(`🔍 Fetching dashboard data from Edge: ${LIVE_URL}`);
    const data   = await fetchEdgeData();
    const result = score(data);
    console.log("▶ Scores:", result);

    if (result.long >= THRESHOLD || result.short >= THRESHOLD) {
      const dir = result.long >= THRESHOLD ? "LONG" : "SHORT";
      const sc  = result.long >= THRESHOLD ? result.long : result.short;
      await tg(`🚀 *High‑Conviction ${dir}* (score ${sc})`);
      console.log("✅ Alert sent");
    } else {
      console.log(`🚫 No signal (long=${result.long}, short=${result.short})`);
    }
  } catch (err) {
    console.error("❌ Error fetching dashboard data:", err);
    process.exit(1);
  }
})();
