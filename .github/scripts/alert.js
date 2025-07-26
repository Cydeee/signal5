import fetch from 'node-fetch';

const ENDPOINT = 'https://btcsignal.netlify.app/data';
const TOKEN    = '8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw';
const CHAT_ID  = '6038110897';

async function send(msg) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'Markdown' }),
  });
}

(async function main() {
  console.log("⏳ Fetching", ENDPOINT);
  let raw, text;
  try {
    const res = await fetch(ENDPOINT);
    console.log(`HTTP ${res.status} ${res.statusText}`);
    try {
      raw = await res.clone().json();
    } catch {
      text = await res.text();
      const m = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
      if (!m) throw new Error("No <pre> block");
      raw = JSON.parse(m[1]);
    }
  } catch (err) {
    console.error("❌ Fetch/parsing error:", err);
    await send(`❌ Couldn’t load data: ${err.message}`);
    return;
  }

  console.log("✅ Top-level keys:", Object.keys(raw).join(', '));
  console.log("ℹ️ raw.dataA keys:", raw.dataA ? Object.keys(raw.dataA).join(', ') : 'dataA missing');
  console.log("ℹ️ raw.dataA['1h']:", JSON.stringify(raw.dataA?.['1h'], null, 2));

  // At this point we’ll stop so you can paste the above into here.
})();
