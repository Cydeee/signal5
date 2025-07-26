import fetch from 'node-fetch';

const ENDPOINT = 'https://btcsignal.netlify.app/data.json';

(async function debugFetch() {
  try {
    console.log(`Fetching ${ENDPOINT} …`);
    const res = await fetch(ENDPOINT);
    console.log('HTTP status:', res.status, res.statusText);
    const text = await res.text();
    console.log(
      'Body preview (first 500 chars):\n',
      text.slice(0, 500).replace(/\n/g, '\\n')
    );
    try {
      const data = JSON.parse(text);
      console.log('Parsed JSON top‑level keys:', Object.keys(data));
    } catch (parseErr) {
      console.error('❌ JSON.parse failed:', parseErr.message);
    }
  } catch (err) {
    console.error('Fetch error:', err);
  }
})();
