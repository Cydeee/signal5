// scripts/generate-live.js
// --------------------------------------------------
// Simply mirror your Netlify Edge’s /data.json into public/live.json
// (so GH Actions never calls Binance APIs directly)
// --------------------------------------------------

import { mkdir, writeFile } from 'fs/promises';

async function main() {
  const EDGE_URL = process.env.EDGE_URL
    || 'https://btcsignal.netlify.app/data.json';

  console.log(`▶ Fetching payload from Edge Function → ${EDGE_URL}`);
  let res;
  try {
    res = await fetch(EDGE_URL, { cache: 'no-store' });
  } catch (err) {
    console.error('❌ Network error fetching Edge URL:', err);
    process.exit(1);
  }

  const body = await res.text();
  if (!res.ok) {
    console.error(`❗ HTTP ${res.status} from Edge:`, body.slice(0,200).replace(/\n/g,' '));
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch (err) {
    console.error('❌ Invalid JSON from Edge Function:', err);
    process.exit(1);
  }

  console.log('✅ Successfully fetched and parsed from Edge');
  await mkdir('public', { recursive: true });
  await writeFile('public/live.json', JSON.stringify(data, null, 2), 'utf8');
  console.log('✅ Wrote public/live.json');
}

main().catch(err => {
  console.error('❌ generate-live.js uncaught error:', err);
  process.exit(1);
});
