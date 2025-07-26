// scripts/generate-live.js
// Node ≥18 CLI: writes public/live.json by proxying Binance+others through your Worker

import { mkdir, writeFile } from 'fs/promises';

const WORKER_URL = process.env.WORKER_URL 
  || 'https://my-binance-proxy.workers.dev/?url=';

async function proxyFetchJson(targetUrl) {
  const url = WORKER_URL + encodeURIComponent(targetUrl);
  console.log(`▶ proxyFetchJson → ${targetUrl}`);
  const res = await fetch(url);
  const text = await res.text().catch(()=>'');
  if (!res.ok) {
    console.error(`❗ HTTP ${res.status} from Worker for ${targetUrl}`);
    console.error(`   snippet: ${text.slice(0,200).replace(/\n/g,' ')}`);
    throw new Error(`Worker proxy error ${res.status}`);
  }
  return JSON.parse(text);
}

async function buildStaticPayload() {
  const SYMBOL = "BTCUSDT", LIMIT = 250;

  const out = { dataA:{}, dataB:null, dataC:{}, dataD:{}, dataE:null, dataF:null, dataG:null, dataH:null, errors:[] };

  // A: Indicators
  console.log("––– Block A: Indicators –––");
  for (const tf of ["15m","1h","4h","1d"]) {
    console.log(`▶ A[${tf}]`);
    try {
      const kl = await proxyFetchJson(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${tf}&limit=${LIMIT}`);
      // ... same close/high/low/ema/rsi/atr/macd logic as before ...
      out.dataA[tf] = /* your computed object */;
      console.log(`✅ A[${tf}] OK`);
    } catch (e) {
      console.error(`❌ A[${tf}]: ${e.message}`);
      out.errors.push(`A[${tf}]: ${e.message}`);
    }
  }

  // B…H: repeat proxyFetchJson for each Binance/Coingecko/FNG URL, same pattern

  return out;
}

(async()=>{
  console.log("▶ buildStaticPayload");
  const data = await buildStaticPayload();
  console.log("▶ write public/live.json");
  await mkdir("public",{recursive:true});
  await writeFile("public/live.json", JSON.stringify({ timestamp:Date.now(), ...data },null,2),'utf8');
  console.log("✅ public/live.json updated");
})();
