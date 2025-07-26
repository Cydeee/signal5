import fetch from 'node-fetch';

const ENDPOINT = 'https://btcsignal.netlify.app/data.json';
const TOKEN    = '8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw';
// Make sure this is the negative group ID you saw in getUpdates:
const CHAT_ID  = '-92192621';

const TEST_ALERT = true;  // still force test alert every run

// safe getter
const get = (o, p, def = 0) =>
  p.split('.').reduce((a,k)=> (a && a[k] != null ? a[k] : def), o);

// send a Telegram message and log the raw response
async function send(msg) {
  console.log(`→ Sending to chat_id=${CHAT_ID}: ${msg}`);
  const resp = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: msg,
      parse_mode: 'Markdown'
    }),
  });
  let body;
  try { body = await resp.json(); }
  catch(e) { body = await resp.text(); }
  console.log('← Telegram API response:', resp.status, body);
}

async function main() {
  if (TEST_ALERT) {
    await send('✅ *TEST ALERT*: bot is online and this payload works*');
    return;
  }

  let data;
  try {
    const r = await fetch(ENDPOINT);
    data = await r.json();
  } catch (err) {
    console.error('Fetch error:', err);
    await send(`❌ Failed to fetch data.json: ${err.message}`);
    return;
  }

  // ... scoring logic unchanged ...
  const score = { long:0, short:0 };
  // For brevity, we skip to the test fallback
  await send(`🧪 Scores → long:${score.long}, short:${score.short}`);
}

main().catch(err=>{
  console.error('Unexpected error:', err);
});
