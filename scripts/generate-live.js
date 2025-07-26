// scripts/generate-live.js
// Writes public/live.json every 15 min via GitHub Actions
import { mkdir, writeFile } from 'fs/promises';
import { buildDashboardData } from '../lib/builder.mjs';

(async () => {
  const data = await buildDashboardData();
  await mkdir('public', { recursive: true });
  await writeFile('public/live.json', JSON.stringify({ timestamp: Date.now(), ...data }, null, 2));
  console.log('✅  public/live.json updated');
})();
