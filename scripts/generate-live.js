// scripts/generate-live.js
import { mkdir, writeFile } from 'fs/promises';

async function buildStaticPayload() {
  const SYMBOL = "BTCUSDT", LIMIT = 250;
  const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/109.0";

  const out = {
    dataA: {}, dataB: null, dataC: {}, dataD: {}, dataE: null,
    dataF: null, dataG: null, dataH: null, errors: []
  };

  // Enhanced safeJson with logging:
  const safeJson = async (u) => {
    console.log(`▶ fetch ${u}`);
    const r = await fetch(u, { headers: { "User-Agent": UA } });
    if (!r.ok) {
      const body = await r.text().catch(() => "<no body>");
      console.error(`❗ HTTP ${r.status} at ${u}\n  → response snippet: ${body.slice(0,200)}`);
      throw new Error(`HTTP ${r.status} at ${u}`);
    }
    return r.json();
  };

  /* A: Indicators */
  console.log("––– Block A: Indicators –––");
  for (const tf of ['15m','1h','4h','1d']) {
    console.log(`▶ A[${tf}] start`);
    try {
      const kl = await safeJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`);
      // …compute ema, rsi, atr, macd…
      // (same logic as before)
      console.log(`✅ A[${tf}] OK`);
    } catch (e) {
      console.error(`❌ A[${tf}]: ${e.message}`);
      out.errors.push(`A[${tf}]: ${e.message}`);
    }
  }

  /* B: Derivatives + Liquidations */
  console.log("––– Block B: Funding & Liquidations –––");
  try {
    // …funding, openInterest, liquidations fetches…
    console.log("✅ B OK");
  } catch (e) {
    console.error(`❌ B: ${e.message}`);
    out.errors.push(`B: ${e.message}`);
  }

  /* C: ROC */
  console.log("––– Block C: ROC –––");
  for (const tf of ['15m','1h','4h','1d']) {
    console.log(`▶ C[${tf}] start`);
    try {
      // …ROC logic…
      console.log(`✅ C[${tf}] OK`);
    } catch (e) {
      console.error(`❌ C[${tf}]: ${e.message}`);
      out.errors.push(`C[${tf}]: ${e.message}`);
    }
  }

  /* D: Volume + CVD */
  console.log("––– Block D: Volume & CVD –––");
  try {
    // …volume/CVD logic…
    console.log("✅ D OK");
  } catch (e) {
    console.error(`❌ D: ${e.message}`);
    out.errors.push(`D: ${e.message}`);
  }

  /* E: Synthetic Stress */
  console.log("––– Block E: Synthetic Stress –––");
  try {
    // …stress calculation…
    console.log("✅ E OK");
  } catch (e) {
    console.error(`❌ E: ${e.message}`);
    out.errors.push(`E: ${e.message}`);
  }

  /* F: Structure + VPVR */
  console.log("––– Block F: VPVR –––");
  try {
    // …VPVR logic…
    console.log("✅ F OK");
  } catch (e) {
    console.error(`❌ F: ${e.message}`);
    out.errors.push(`F: ${e.message}`);
  }

  /* G: Macro */
  console.log("––– Block G: Macro –––");
  try {
    // …Coingecko fetch…
    console.log("✅ G OK");
  } catch (e) {
    console.error(`❌ G: ${e.message}`);
    out.errors.push(`G: ${e.message}`);
  }

  /* H: Sentiment */
  console.log("––– Block H: Sentiment –––");
  try {
    // …Fear & Greed fetch…
    console.log("✅ H OK");
  } catch (e) {
    console.error(`❌ H: ${e.message}`);
    out.errors.push(`H: ${e.message}`);
  }

  return out;
}

(async () => {
  console.log("▶ buildStaticPayload start");
  const data = await buildStaticPayload();
  console.log("▶ write public/live.json");
  await mkdir("public", { recursive: true });
  await writeFile("public/live.json", JSON.stringify({ timestamp: Date.now(), ...data }, null, 2), "utf8");
  console.log("✅ public/live.json updated");
})();
