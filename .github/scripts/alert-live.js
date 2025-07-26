#!/usr/bin/env node
// .github/scripts/alert-live.js  — debug build
// ➊ fetch dashboard (with retries) ➋ print audit summary ➌ score ➜ Telegram

/* ───── env ───── */
const LIVE_URL  = process.env.LIVE_URL  || "https://btcsignal.netlify.app/data.json";
const BOT_TOKEN = process.env.BOT_TOKEN || "8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw";
const CHAT_ID   = process.env.CHAT_ID   || "6038110897";
const THRESHOLD = 6;

/* ───── fetch helper (same as before) ───── */
async function fetchEdgeData(retries = 4) {
  const delays = [0, 2000, 5000, 10000];
  for (let i = 0; i < retries; i++) {
    const url = `${LIVE_URL}?bust=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    const txt = await res.text();
    console.log(`◀ ${i + 1}/${retries}  HTTP ${res.status} (${txt.length} bytes)`);
    if (res.status === 200) return JSON.parse(txt);
    if (i < retries - 1 && [502, 503, 504].includes(res.status))
      await new Promise(r => setTimeout(r, delays[i]));
    else throw new Error(`Edge returned ${res.status}`);
  }
}

/* ───── telegram helper ───── */
const tg = msg =>
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: msg,
      parse_mode: "Markdown",
      disable_web_page_preview: true
    })
  });

/* ───── scoring (unchanged) ───── */
function score(raw) {
  const A = raw.dataA?.["1h"] || {};
  const B = raw.dataB || {};
  const D = raw.dataD || {};
  const F = raw.dataF || {};
  const E = raw.dataE || {};

  const rsi = +A.rsi14 || 0;
  const macd = +A.macdHist || 0;
  const fund = +B.fundingZ || 0;
  const l24 = +B.liquidations?.long24h || 0;
  const s24 = +B.liquidations?.short24h || 0;
  const cvd = +D.cvd?.["1h"] || 0;
  const rel15 = D.relative?.["15m"] || "normal";
  const bull15 = +D["15m"]?.bullVol || 0;
  const bear15 = +D["15m"]?.bearVol || 0;
  const price = +A.ema50 || 0;
  const poc4h = +F.vpvr?.["4h"]?.poc || 0;
  const stress = +E.stressIndex || 0;

  let L = 0,
    S = 0;
  if (rsi < 35) L++;
  if (rsi > 65) S++;
  if (macd > 0) L++;
  else if (macd < 0) S++;
  if (fund < -1) L++;
  else if (fund > 1) S++;
  if (s24 > 2 * l24) L++;
  if (l24 > 2 * s24) S++;
  if (cvd > 1000 && ["high", "very high"].includes(rel15)) L += 2;
  if (cvd < -1000 && ["high", "very high"].includes(rel15)) S += 2;
  if (bull15 > bear15) L++;
  else if (bear15 > bull15) S++;
  if (price > poc4h) L++;
  else if (price < poc4h) S++;
  if (stress >= 3 && stress <= 5) {
    L++;
    S++;
  }
  return { long: L, short: S };
}

/* ───── audit helper ───── */
function audit(raw) {
  const lines = [
    ["A.ema50 (1h)", raw.dataA?.["1h"]?.ema50 ?? "–"],
    ["B.fundingZ", raw.dataB?.fundingZ ?? "–"],
    ["B.oiΔ24h", raw.dataB?.oiDelta24h ?? "–"],
    ["C.roc10 (1h)", raw.dataC?.["1h"]?.roc10 ?? "–"],
    ["D.totalVol (1h)", raw.dataD?.["1h"]?.totalVol ?? "–"],
    ["E.stress", raw.dataE?.stressIndex ?? "–"],
    ["F.poc (4h)", raw.dataF?.vpvr?.["4h"]?.poc ?? "–"]
  ];
  console.table(Object.fromEntries(lines));
}

/* ───── main ───── */
(async () => {
  try {
    console.log(`🔍 Fetching dashboard from: ${LIVE_URL}`);
    const raw = await fetchEdgeData();
    audit(raw); // <‑‑ print audit

    const s = score(raw);
    console.log("▶ Scores:", s);

    if (s.long >= THRESHOLD || s.short >= THRESHOLD) {
      const dir = s.long >= THRESHOLD ? "LONG" : "SHORT";
      const pts = s.long >= THRESHOLD ? s.long : s.short;
      await tg(`🚀 *High‑Conviction ${dir}* (score ${pts})`);
      console.log("✅ Alert sent");
    } else {
      console.log("🚫 No signal");
    }
  } catch (err) {
    console.error("❌ Failure:", err);
    process.exit(1);
  }
})();
