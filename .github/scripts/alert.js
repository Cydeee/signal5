import fetch from 'node-fetch';

const ENDPOINT = 'https://btcsignal.netlify.app/data.json';
const TOKEN    = '8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw';
const CHAT_ID  = '6038110897';
const TEST_ALERT = true;  // <-- still forcing test on every run

// safe getter
const get = (obj, path, def = 0) =>
  path.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : def), obj);

// send to Telegram and log response
async function send(msg) {
  console.log(`→ Sending to chat_id=${CHAT_ID}: ${msg}`);
  const resp = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'Markdown' }),
  });
  let body;
  try { body = await resp.json(); }
  catch(e) { body = await resp.text(); }
  console.log('← Telegram API response:', resp.status, body);
}

async function main() {
  if (TEST_ALERT) {
    // removed the trailing asterisk to make valid Markdown
    await send('✅ *TEST ALERT*: bot is online and this payload works');
    return;
  }

  // ...rest of your scoring logic unchanged...
}

main().catch(err => console.error('Unexpected error:', err));
