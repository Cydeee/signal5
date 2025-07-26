import fetch from 'node-fetch';

const ENDPOINT = 'https://btcsignal.netlify.app/data';
const TOKEN    = '8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw';
const CHAT_ID  = '6038110897';

// helper to get nested props
const get = (o, p, d=null) =>
  p.split('.').reduce((x,k)=>x && x[k]!=null ? x[k] : d, o);

// send Telegram
async function send(msg) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ chat_id:CHAT_ID, text:msg, parse_mode:'Markdown' })
  });
}

(async function main(){
  console.log(`⏳ Fetching live dashboard from ${ENDPOINT} …`);
  let payload;
  try {
    const res = await fetch(ENDPOINT);
    console.log(`HTTP ${res.status} ${res.statusText}`);
    try {
      // first try raw JSON
      payload = await res.clone().json();
    } catch {
      // fallback: extract JSON from your <pre> wrapper
      const html = await res.text();
      console.log('ℹ️ Received HTML; extracting JSON from <pre>…');
      const m = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
      if (!m) throw new Error('No <pre> block found in HTML');
      payload = JSON.parse(m[1]);
    }
  } catch (err) {
    console.error('❌ Error fetching/parsing payload:', err);
    await send(`❌ Fetch/parsing error: ${err.message}`);
    return;
  }

  console.log('✅ Top-level keys:', Object.keys(payload).join(', '));

  // extract metrics
  const m = {
    rsi1h:    get(payload, 'dataA.1h.rsi14'),
    macd1h:   get(payload, 'dataA.1h.macdHist'),
    price:    get(payload, 'dataA.1h.ema50'),
    fundingZ: get(payload, 'dataB.fundingZ'),
    long24:   get(payload, 'dataB.liquidations.long24h'),
    short24:  get(payload, 'dataB.liquidations.short24h'),
    cvd1h:    get(payload, 'dataD.cvd.1h'),
    volFlag:  get(payload, 'dataD.relative.1h','unknown'),
    bull15:   get(payload, 'dataD.15m.bullVol'),
    bear15:   get(payload, 'dataD.15m.bearVol'),
    poc4h:    get(payload, 'dataF.vpvr.4h.poc'),
    stress:   get(payload, 'dataE.stressIndex'),
  };

  console.log('▶️ Raw metrics:');
  Object.entries(m).forEach(([k,v])=> console.log(`  ${k.padEnd(8)}: ${v}`));

  // scoring rules
  const rules = [
    ['RSI<35 → +1 long',        ()=>m.rsi1h<35,     +1],
    ['RSI>65 → +1 short',       ()=>m.rsi1h>65,     -1],
    ['MACD>0 → +1 long',        ()=>m.macd1h>0,     +1],
    ['MACD<0 → +1 short',       ()=>m.macd1h<0,     -1],
    ['FundZ<-1 → +1 long',      ()=>m.fundingZ<-1,  +1],
    ['FundZ>1 → +1 short',      ()=>m.fundingZ>1,   -1],
    ['Short24>2×Long24 → +1 L', ()=>m.short24>m.long24*2, +1],
    ['Long24>2×Short24 → +1 S', ()=>m.long24>m.short24*2, -1],
    ['CVD>1000&volHigh→+2L',    ()=>m.cvd1h>1000 && ['high','very high'].includes(m.volFlag), +2],
    ['CVD<-1000&volHigh→+2S',   ()=>m.cvd1h<-1000&& ['high','very high'].includes(m.volFlag), -2],
    ['15m bull>bear → +1 L',    ()=>m.bull15>m.bear15, +1],
    ['15m bear>bull → +1 S',    ()=>m.bear15>m.bull15, -1],
    ['Price>PoC4h → +1 long',   ()=>m.price>m.poc4h, +1],
    ['Price<PoC4h → +1 short',  ()=>m.price<m.poc4h, -1],
    ['Stress 3–5 → +1 both',    ()=>m.stress>=3&&m.stress<=5, +1],
  ];

  let longScore=0, shortScore=0;
  console.log('🧮 Evaluating rules:');
  for (let [desc, cond, pts] of rules) {
    if (cond()) {
      console.log(`   ✓ ${desc} (${pts>0? '+'+pts:pts}pts)`);
      pts>0? longScore+=pts : shortScore-=pts;
    } else {
      console.log(`   ✗ ${desc}`);
    }
  }

  // stress gate
  if (m.stress>7) {
    console.log(`⚠️ Stress ${m.stress}>7 → abort`);
    return;
  }

  console.log(`➡️ Scores → long:${longScore}, short:${shortScore}`);
  const TH = 6;
  let dir = longScore>=TH?'LONG': shortScore>=TH?'SHORT': null;
  if (!dir) {
    console.log(`❌ Below threshold ${TH}; no alert.`);
    return;
  }

  const score = dir==='LONG'? longScore : shortScore;
  const msg =
`🚨 *High‑Conviction ${dir} (score ${score}/10)* 🚨

Price:      \`${m.price}\`
RSI 1h:     \`${m.rsi1h}\`
CVD 1h:     \`${m.cvd1h}\`
Funding Z:  \`${m.fundingZ}\`
Liq 24h:    long \`${m.long24}\` / short \`${m.short24}\`
Stress:     \`${m.stress}\``;

  console.log('📤 Sending alert:', msg.replace(/\n/g,' | '));
  await send(msg);
  console.log('✅ Alert sent.');
})();
