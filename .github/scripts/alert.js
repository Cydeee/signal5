import fetch from 'node-fetch';

const ENDPOINT = 'https://btcsignal.netlify.app/live.json';   // ← static file written by GH Action
const TOKEN    = '8417682763:AAGZ1Darr0BgISB9JAG3RzHCQi-uqMylcOw';
const CHAT_ID  = '6038110897';

const get = (o,p,d=null)=>p.split('.').reduce((x,k)=>x&&x[k]!=null?x[k]:d,o);

async function send(msg){
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id:CHAT_ID,text:msg,parse_mode:'Markdown'})
  });
}

(async()=>{
  console.log('⏳ Fetching',ENDPOINT);
  let j; try{
    const r=await fetch(ENDPOINT);
    console.log('HTTP',r.status,r.statusText);
    j=await r.json();
  }catch(e){
    console.error('❌ fetch',e); await send('❌ fetch '+e.message); return;
  }

  console.log('✅ keys:',Object.keys(j).join(', '));

  const m={
    rsi1h   : get(j,'dataA.1h.rsi14'),
    macd1h  : get(j,'dataA.1h.macdHist'),
    price   : get(j,'dataA.1h.ema50'),
    fundingZ: get(j,'dataB.fundingZ'),
    long24  : get(j,'dataB.liquidations.long24h'),
    short24 : get(j,'dataB.liquidations.short24h'),
    cvd1h   : get(j,'dataD.cvd.1h'),
    volFlag : get(j,'dataD.relative.1h','unknown'),
    bull15  : get(j,'dataD.15m.bullVol'),
    bear15  : get(j,'dataD.15m.bearVol'),
    poc4h   : get(j,'dataF.vpvr.4h.poc'),
    stress  : get(j,'dataE.stressIndex')
  };
  console.log('▶️',m);

  const rules=[
    ['RSI<35',()=>m.rsi1h<35,+1],       ['RSI>65',()=>m.rsi1h>65,-1],
    ['MACD>0',()=>m.macd1h>0,+1],       ['MACD<0',()=>m.macd1h<0,-1],
    ['FZ<-1',()=>m.fundingZ<-1,+1],     ['FZ>1',()=>m.fundingZ>1,-1],
    ['S24>2L24',()=>m.short24>m.long24*2,+1],
    ['L24>2S24',()=>m.long24>m.short24*2,-1],
    ['CVD>1k&hi',()=>m.cvd1h>1000&&['high','very high'].includes(m.volFlag),+2],
    ['CVD<-1k&hi',()=>m.cvd1h<-1000&&['high','very high'].includes(m.volFlag),-2],
    ['bull>bear',()=>m.bull15>m.bear15,+1],
    ['bear>bull',()=>m.bear15>m.bull15,-1],
    ['P>PoC',()=>m.price>m.poc4h,+1],   ['P<PoC',()=>m.price<m.poc4h,-1],
    ['Stress3‑5',()=>m.stress>=3&&m.stress<=5,+1]
  ];

  let long=0,short=0;
  console.log('🧮 Rules:');
  rules.forEach(([d,c,p])=>{
    if(c()){console.log(`  ✓ ${d} (${p>0? '+'+p:p})`); p>0?long+=p:short-=p;}
    else   console.log(`  ✗ ${d}`);
  });

  if(m.stress>7){console.log('⚠️ stress gate');return;}
  console.log(`➡️ scores L:${long} S:${short}`);

  const TH=6,dir=long>=TH?'LONG':short>=TH?'SHORT':null;
  if(!dir){console.log('No signal');return;}

  const score=dir==='LONG'?long:short;
  const msg=
`🚨 *High‑Conviction ${dir} (${score}/10)* 🚨
Price \`${m.price}\`  RSI1h \`${m.rsi1h}\`  CVD1h \`${m.cvd1h}\`
FundingZ \`${m.fundingZ}\`  Liq24 L/S \`${m.long24}/${m.short24}\`
Stress \`${m.stress}\``;

  await send(msg); console.log('✅ Alert sent');
})();
