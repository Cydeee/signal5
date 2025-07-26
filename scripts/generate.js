// scripts/generate.js
import { buildDashboardData } from '../netlify/edge-functions/data.js';

(async () => {
  try {
    const payload = await buildDashboardData();
    process.stdout.write(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error('❌ Error generating JSON:', err);
    process.exit(1);
  }
})();
