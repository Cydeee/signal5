// proxy-worker.js

addEventListener('fetch', event => {
  event.respondWith(handle(event.request));
});

async function handle(request) {
  const url = new URL(request.url);
  const target = url.searchParams.get('url');
  if (!target) {
    return new Response('Missing ?url= parameter', { status: 400 });
  }

  // Only allow Binance and your other endpoints, for safety
  if (!target.startsWith('https://api.binance.com/') &&
      !target.startsWith('https://fapi.binance.com/') &&
      !target.startsWith('https://api.coingecko.com/') &&
      !target.startsWith('https://api.alternative.me/')) {
    return new Response('Forbidden target', { status: 403 });
  }

  try {
    const res = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/109.0'
      }
    });
    // Mirror status & headers (especially Content-Type)
    const headers = new Headers(res.headers);
    const contentType = res.headers.get('content-type') || 'application/json';
    headers.set('Content-Type', contentType);
    const body = await res.arrayBuffer();
    return new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers
    });
  } catch (err) {
    return new Response(`Worker fetch error: ${err}`, { status: 502 });
  }
}
