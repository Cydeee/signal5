import fetch from 'node-fetch';

const ENDPOINT = 'https://btcsignal.netlify.app/data.json';
const TOKEN    = '8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw';
const CHAT_ID  = '6038110897';

(async function debug() {
  console.log("⏳ Fetching", ENDPOINT);
  let raw;
  try {
    const res = await fetch(ENDPOINT);
    console.log("HTTP", res.status, res.statusText);
    raw = await res.json();
  } catch (e) {
    console.error("❌ Fetch error", e);
    return;
  }

  // 1) Top‑level:
  console.log("✅ Top keys:", Object.keys(raw));

  // 2) Entire dataA object:
  console.log("ℹ️ raw.dataA =", JSON.stringify(raw.dataA, null, 2));

  // 3) The 1h bucket inside dataA:
  console.log("ℹ️ raw.dataA['1h'] =", JSON.stringify(raw.dataA?.["1h"], null, 2));

  // 4) Now explicitly log the rsi14 value:
  console.log("ℹ️ raw.dataA['1h'].rsi14 =", raw.dataA?.["1h"]?.rsi14);

  // Done.
})();
