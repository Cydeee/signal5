// scripts/generate-live.js
// Node ≥18 CLI: fetch exact payload from your Netlify Edge and write public/live.json

import { mkdir, writeFile } from 'fs/promises';

async function main() {
  const EDGE_URL = process.env.EDGE_URL || 'https://btcsignal.netlify.app/data.json';
  console.log(`▶ Fetching payload from Edge Function at ${EDGE_URL}`);

  let res;
  try {
    res = await fetch(EDGE_URL, { cache: 'no-store' });
  } catch (err) {
    console.error('❌ Network error fetching Edge URL:', err);
    process.exit(1);
  }

  const body = await res.text();
  if (!res.ok) {
    const snippet = body.slice(0, 200).replace(/\n/g, ' ');
    console.error(`❗ HTTP ${res.status} from Edge Function\n   snippet: ${snippet}`);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch (err) {
    console.error('❌ Failed to parse JSON from Edge Function:', err);
    process.exit(1);
  }

  console.log('✅ Successfully fetched & parsed JSON from Edge');
  await mkdir('public', { recursive: true });
  await writeFile('public/live.json', JSON.stringify(data, null, 2), 'utf8');
  console.log('✅ public/live.json written');
}

main().catch(err => {
  console.error('❌ Uncaught error in generate-live.js:', err);
  process.exit(1);
});
