// netlify/edge-functions/data.js
import { buildDashboardData } from '../../lib/builder.mjs';

export default async function handler(req) {
  const wantJson = new URL(req.url).pathname.endsWith('/data.json');
  let payload;
  try { payload = await buildDashboardData(); }
  catch { return new Response('Internal error', { status: 500 }); }

  const baseHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=0, must-revalidate'
  };

  if (wantJson) {
    return new Response(JSON.stringify(payload), {
      headers: { ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
  return new Response(
    `<!doctype html><html><body><pre>${JSON.stringify(payload, null, 2)}</pre></body></html>`,
    { headers: { ...baseHeaders, 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
