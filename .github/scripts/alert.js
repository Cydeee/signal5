// .github/scripts/alert.js
// NOTE: hard-coded secrets – be sure repo is private!
const BOT  = '8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw';
const CHAT = '6038110897';          // your private-chat id

const LIVE_URL  = 'https://btcsignal.netlify.app/live.json';
const THRESHOLD = 6;
const TEST      = process.env.TEST_ALERT === '1';

/* helpers ------------------------------------------------------------ */
function calcScore(raw){
  const A = raw.dataA?.['1h'] ?? {};
  const B = raw.dataB        ?? {};
  const D = raw.dataD        ?? {};
  const F = raw.dataF        ?? {};
  const E = raw.dataE        ?? {};

  const rsi   = +A.rsi14   || 0;
  const macd  = +A.macdHist|| 0;
  const fundZ = +B.fundingZ|| 0;
  const long24= +B.liquidations?.long24h  || 0;
  const short24=+B.liquidations?.short24h || 0;
  const cvd1h = +D.cvd?.['1h']            || 0;
  const volFlag=D.relative?.['15m'] || 'unknown';
  const bull15= +D['15m']?.bullVol || 0;
  const bear15= +D['15m']?.bearVol || 0;
  const price = +A.ema50 || 0;
  const poc4h = +F.vpvr?.['4h']?.poc || 0;
  const stress= +E.stressIndex || 0;

  let long=0, short=0;
  if (rsi < 35) long++;        if (rsi > 65) short++;
  if (macd>0) long++;          if (macd<0) short++;
  if (fundZ<-1) long++;        if (fundZ>1) short++;
  if (short24>2*long24) long++;if (long24>2*short24) short++;
  if (cvd1h>1000 && (volFlag==='high'||volFlag==='very high')) long+=2;
  if (cvd1h<-1000&& (volFlag==='high'||volFlag==='very high')) short+=2;
  if (bull15>bear15) long++;   if (bear15>bull15) short++;
  if (price>poc4h) long++;     if (price<poc4h) short++;
  if (stress>=3 && stress<=5){ long++; short++; }

  return { long, short, metrics:{rsi,macd,fundZ,long24,short24,cvd1h,volFlag,bull15,bear15,poc4h,stress} };
}

async function tg(msg){
  const url=`https://api.telegram.org/bot${BOT}/sendMessage`;
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
         body:JSON.stringify({chat_id:CHAT,text:msg,parse_mode:'Markdown',disable_web_page_preview:true})});
  const j=await r.json(); if(!j.ok) throw new Error(j.description);
}

(async()=>{
  console.log('⏳ Fetching live.json …');
  const res=await fetch(LIVE_URL,{cache:'no-store'}); if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw=await res.json();
  const { long, short } = calcScore(raw);
  console.log('Scores', { long, short });

  if(TEST){
    await tg('✅ *TEST ALERT* – bot online');
    console.log('Test alert sent'); return;
  }
  if(long>=THRESHOLD || short>=THRESHOLD){
    const dir=long>=THRESHOLD ? 'LONG':'SHORT';
    const score = long>=THRESHOLD ? long : short;
    await tg(`🚀 *High-Conviction ${dir}*  (score ${score})`);
    console.log('Alert sent');
  }else{
    console.log('No signal');
  }
})().catch(e=>{ console.error(e); process.exit(1); });
