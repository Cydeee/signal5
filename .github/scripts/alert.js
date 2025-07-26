import fetch from 'node-fetch';

const ENDPOINT = 'https://btcsignal.netlify.app/.netlify/edge-functions/data';
const TOKEN    = '8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw';
const CHAT_ID  = '6038110897';

/* ------------- helpers (unchanged) ------------- */
const get = (o,p,d=null)=>p.split('.').reduce((x,k)=>x&&x[k]!=null?x[k]:d,o);
async function send(t){await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`,
  {method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({chat_id:CHAT_ID,text:t,parse_mode:'Markdown'})});}

/* ------------- main ------------- */
(async()=>{
  console.log(`⏳ Fetching ${ENDPOINT}`);
  let payload; try{
    const res=await fetch(ENDPOINT); console.log(`HTTP ${res.status} ${res.statusText}`);
    try{payload=await res.clone().json();}
    catch{const html=await res.text();const m=html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
      if(!m)throw new Error('No <pre> block');payload=JSON.parse(m[1]);}
  }catch(e){console.error('❌',e);await send(`❌ Fetch error: ${e.message}`);return;}

  console.log('✅ keys:',Object.keys(payload).join(', '));

  const m={
    rsi1h:get(payload,'dataA.1h.rsi14'),
    macd1h:get(payload,'dataA.1h.macdHist'),
    price:get(payload,'dataA.1h.ema50'),
    fundingZ:get(payload,'dataB.fundingZ'),
    long24:get(payload,'dataB.liquidations.long24h'),
    short24:get(payload,'dataB.liquidations.short24h'),
    cvd1h:get(payload,'dataD.cvd.1h'),
    volFlag:get(payload,'dataD.relative.1h','unknown'),
    bull15:get(payload,'dataD.15m.bullVol'),
    bear15:get(payload,'dataD.15m.bearVol'),
    poc4h:get(payload,'dataF.vpvr.4h.poc'),
    stress:get(payload,'dataE.stressIndex')
  };

  console.log('▶️ metrics:',m);

  const rules=[
    ['RSI<35',()=>m.rsi1h<35,+1],['RSI>65',()=>m.rsi1h>65,-1],
    ['MACD>0',()=>m.macd1h>0,+1],['MACD<0',()=>m.macd1h<0,-1],
    ['Fund<-1',()=>m.fundingZ<-1,+1],['Fund>1',()=>m.fundingZ>1,-1],
    ['Short>2×Long',()=>m.short24>m.long24*2,+1],
    ['Long>2×Short',()=>m.long24>m.short24*2,-1],
    ['CVD>1k&highVol',()=>m.cvd1h>1000&&['high','very high'].includes(m.volFlag),+2],
    ['CVD<-1k&highVol',()=>m.cvd1h<-1000&&['high','very high'].includes(m.volFlag),-2],
    ['bull>bear',()=>m.bull15>m.bear15,+1],
    ['bear>bull',()=>m.bear15>m.bull15,-1],
    ['Price>PoC',()=>m.price>m.poc4h,+1],
    ['Price<PoC',()=>m.price<m.poc4h,-1],
    ['Stress3‑5',()=>m.stress>=3&&m.stress<=5,+1]
  ];

  let long=0,short=0;
  rules.forEach(([d,c,p])=>c()&&(p>0?long+=p:short-=p));
  if(m.stress>7){console.log('⚠️ Stress gate');return;}

  console.log(`➡️ scores long:${long} short:${short}`);
  const TH=6,dir=long>=TH?'LONG':short>=TH?'SHORT':null;
  if(!dir){console.log('No alert');return;}

  const msg=
`🚨 *High‑Conviction ${dir} (${dir==='LONG'?long:short}/10)* 🚨
Price \`${m.price}\`  RSI1h \`${m.rsi1h}\`  CVD1h \`${m.cvd1h}\`
Funding \`${m.fundingZ}\`  Liq24 L/S \`${m.long24}/${m.short24}\`
Stress \`${m.stress}\``;
  await send(msg);console.log('✅ Alert sent');
})();
