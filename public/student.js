(function(){
const ROUND={1:'Round 1',2:'Round 2',3:'Round 3',4:'Semi Final',5:'Final'};
const VOTE_MS=10000;
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let st=null,offline=false,offset=0,myVote=null,voteErr='',expiredKey='',sig='';
let chain=Promise.resolve();

function voterId(){
  let v='';
  try{v=localStorage.getItem('voter')||'';}catch(e){}
  if(!/^[a-z0-9]{8,40}$/.test(v)){
    v='';const a='abcdefghijklmnopqrstuvwxyz0123456789';
    const buf=new Uint32Array(16);(window.crypto||{getRandomValues:b=>b.map(()=>Math.random()*4e9)}).getRandomValues(buf);
    for(const n of buf)v+=a[n%a.length];
    try{localStorage.setItem('voter',v);}catch(e){}
  }
  return v;
}
const VOTER=voterId();
const now=()=>Date.now()+offset;

async function poll(){
  const t0=Date.now();
  try{
    const r=await fetch('/api/state',{cache:'no-store'});
    if(!r.ok)throw new Error('http');
    const d=await r.json(),t1=Date.now();
    offset=d.serverNow-(t0+t1)/2;
    st=d;offline=false;
  }catch(e){offline=true;}
  render();
  setTimeout(poll,st&&st.phase==='voting'?800:1500);
}

function castVote(c){
  if(!st||st.phase!=='voting'||now()>=st.endsAt||expiredKey===st.key)return;
  const key=st.key;
  myVote={key,choice:c};voteErr='';render();
  chain=chain.then(async()=>{
    try{
      const r=await fetch('/api/vote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key,choice:c,voter:VOTER})});
      if(r.status===409){expiredKey=key;}
      else if(!r.ok){throw new Error('http');}
    }catch(e){if(myVote&&myVote.key===key&&myVote.choice===c){voteErr='fail';myVote=null;}}
    render();
  });
}

const wait=(h,p)=>'<div class="wait"><h1>'+esc(h)+'</h1>'+(p?'<p>'+esc(p)+'</p>':'')+'</div>';
function view(){
  if(!st)return wait(offline?'Cannot connect':'Connecting',offline?'Check your internet connection. This page will keep trying.':'');
  if(st.status==='setup'||!st.phase)return wait('Not started yet','Keep this page open. Voting begins when your instructor starts the first round.');
  if(st.status==='complete'||st.phase==='done')return wait('That is the tournament','Thanks for voting.');
  const name=ROUND[st.round];
  if(st.phase==='intro')return wait(name,'Get ready. Look at the screen.');
  if(st.phase==='ready')return wait(name,(st.tie?'Tie. ':'')+'Matchup '+st.n+' of '+st.total+'. Voting opens in a moment.');
  if(st.phase==='voting'){
    const open=now()<st.endsAt&&expiredKey!==st.key;
    const sel=myVote&&myVote.key===st.key?myVote.choice:null;
    const word=sel==='a'?'Left':'Right';
    const msg=voteErr==='fail'?'Your vote did not go through. Tap again.'
      :!open?(sel?'Time is up. Your vote: '+word+'.':'Time is up.')
      :sel?'Your vote: '+word+'. You can change it until time runs out.':'Tap the image you want to win.';
    return '<div class="head"><span class="rname">'+name+'</span><div class="clock on"><b data-cd>'+Math.max(0,Math.ceil((st.endsAt-now())/1000))+'</b><span>sec</span></div></div>'+
      '<div class="prog"><i data-bar style="width:100%"></i></div>'+
      '<div class="choices"><button class="choice'+(sel==='a'?' on':'')+'" data-c="a"'+(open?'':' disabled')+'><span class="arrow">&larr;</span>Left</button>'+
      '<button class="choice'+(sel==='b'?' on':'')+'" data-c="b"'+(open?'':' disabled')+'>Right<span class="arrow">&rarr;</span></button></div>'+
      '<p class="hint" role="status">'+msg+'</p>';
  }
  return wait('Voting closed','Look up at the screen for the result.');
}
function render(){
  const html='<main class="phone">'+view()+(offline&&st?'<p class="hint">Connection lost. Retrying.</p>':'')+'</main>';
  const s=html.replace(/data-cd>\d+</,'data-cd><').replace(/width:[\d.]+%/,'');   // ignore ticking bits when comparing
  if(s===sig)return;
  sig=s;
  $('#app').innerHTML=html;
  tick();
}
function tick(){
  if(!st||st.phase!=='voting')return;
  const left=Math.max(0,st.endsAt-now());
  document.querySelectorAll('[data-cd]').forEach(e=>{e.textContent=Math.ceil(left/1000);});
  document.querySelectorAll('[data-bar]').forEach(e=>{e.style.width=(left/VOTE_MS*100)+'%';});
  if(left<=0&&expiredKey!==st.key){expiredKey=st.key;render();}
}
setInterval(tick,200);
$('#app').addEventListener('click',e=>{const b=e.target.closest('[data-c]');if(b&&!b.disabled)castVote(b.dataset.c);});
poll();
})();
