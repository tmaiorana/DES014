(function(){
const ROUND={1:'Round 1',2:'Round 2',3:'Round 3',4:'Semi Final',5:'Final'};
const BR={cat:'Cats',dog:'Dogs',final:'Cats vs Dogs'};
const VOTE_MS=10000, CLOSE_MS=1500, PER=16;
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let pass='';try{pass=localStorage.getItem('passcode')||'';}catch(e){}
let state=null,images=[],offset=0,loginErr='',unlocked=false,loaded=false;
let busy=null,errs=[],toast='',confirmClear=false,confirmReset=false,handOpen=false;
let closeSentFor='',acting=false,sig='';

const now=()=>Date.now()+offset;
const imgMap=()=>{const m={};images.forEach(i=>{m[i.id]=i;});return m;};
const ids=b=>images.filter(i=>i.bracket===b).sort((x,y)=>x.t-y.t).map(i=>i.id);
const imgUrl=id=>'/api/image/'+id;
const studentUrl=()=>location.origin+'/';

/* ---------- api ---------- */
async function api(path,opts={}){
  const headers=Object.assign({'x-passcode':pass},opts.headers||{});
  const r=await fetch('/api/'+path,Object.assign({cache:'no-store'},opts,{headers}));
  let data=null;try{data=await r.json();}catch(e){}
  return {status:r.status,data:data||{}};
}
function apply(d){
  if(d.state)state=d.state;
  if(d.images)images=d.images;
  if(d.serverNow)offset=d.serverNow-Date.now();
}
function explain(res){
  const e=res.data&&res.data.error;
  const map={bad_passcode:'Wrong passcode.',passcode_unset:'The site has no passcode yet. Add PRESENTER_PASSCODE in Netlify, then redeploy.',
    tournament_running:'Start over before changing images.',bracket_full:'That bracket already has '+PER+' images.',stale:'The screen was out of date and has been refreshed.',
    wrong_phase:'That step is not available right now.',need_images:'Add '+PER+' cats and '+PER+' dogs first.',server_error:'The server hit an error. Try again.'};
  return map[e]||('Something went wrong ('+(e||res.status)+').');
}

/* ---------- polling ---------- */
async function poll(){
  if(!unlocked){return;}
  if(!acting&&!busy){
    try{
      const res=await api('admin/state');
      if(res.status===200){apply(res.data);loaded=true;render();}
      else if(res.status===401){unlocked=false;loginErr='Wrong passcode.';render();return;}
    }catch(e){}
  }
  setTimeout(poll,state&&state.phase==='voting'?1000:2000);
}
async function unlock(p){
  pass=p;loginErr='';
  try{
    const res=await api('admin/state');
    if(res.status===200){
      unlocked=true;apply(res.data);loaded=true;
      try{localStorage.setItem('passcode',pass);}catch(e){}
      render();poll();return;
    }
    loginErr=explain(res);
  }catch(e){loginErr='Could not reach the server.';}
  unlocked=false;render();
}
async function doAction(type,extra){
  if(acting)return;
  acting=true;
  try{
    const res=await api('admin/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({type,v:state&&state.v},extra||{}))});
    if(res.status===200)apply(res.data);
    else{if(res.data&&res.data.state)state=res.data.state;toast=explain(res);}
  }catch(e){toast='Could not reach the server.';}
  acting=false;handOpen=false;render();
}
function primary(){
  if(!state||state.status!=='running')return;
  if(state.phase==='intro')doAction('begin');
  else if(state.phase==='ready')doAction('startVote');
  else if(state.phase==='result')doAction('next');
}

/* ---------- images ---------- */
async function processFile(file){
  const src=URL.createObjectURL(file);
  const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('decode'));i.src=src;});
  const sc=Math.min(1,960/img.naturalWidth),w=Math.round(img.naturalWidth*sc),h=Math.round(img.naturalHeight*sc);
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const x=c.getContext('2d');x.fillStyle='#000';x.fillRect(0,0,w,h);x.drawImage(img,0,0,w,h);
  URL.revokeObjectURL(src);
  for(let q=.88;q>=.5;q-=.1){
    const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',q));
    if(blob&&blob.size<400000)return blob;
  }
  throw new Error('size');
}
async function addFiles(b,files){
  const list=[...files];if(!list.length)return;
  errs=[];
  const room=Math.max(0,PER-ids(b).length),take=list.slice(0,room);
  if(list.length>take.length)errs.push((list.length-take.length)+' extra file(s) skipped, '+BR[b]+' holds '+PER);
  busy={n:0,total:take.length};render();
  for(const f of take){
    try{
      const blob=await processFile(f);
      const res=await api('admin/image?bracket='+b,{method:'POST',headers:{'content-type':'image/jpeg'},body:blob});
      if(res.status===200)apply(res.data);else errs.push(f.name+': '+explain(res));
    }catch(e){errs.push('Could not add '+f.name);}
    busy.n++;render();
  }
  busy=null;render();
}
async function removeImage(id){
  busy={n:0,total:1};render();
  const res=await api('admin/image/'+id,{method:'DELETE'});
  if(res.status===200)apply(res.data);else toast=explain(res);
  busy=null;render();
}
async function clearAll(){
  confirmClear=false;busy={n:0,total:1};render();
  const res=await api('admin/clear-images',{method:'POST'});
  if(res.status===200){images=[];state=null;const s=await api('admin/state');if(s.status===200)apply(s.data);}else toast=explain(res);
  busy=null;render();
}

/* ---------- views ---------- */
function qrSvg(text){
  if(typeof qrcode==='undefined'||!text)return '';
  try{
    const qr=qrcode(0,'M');qr.addData(text);qr.make();
    const n=qr.getModuleCount();let p='';
    for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(qr.isDark(r,c))p+='M'+c+' '+r+'h1v1h-1z';
    return '<svg viewBox="-2 -2 '+(n+4)+' '+(n+4)+'" shape-rendering="crispEdges" role="img" aria-label="QR code for the voting page"><rect x="-2" y="-2" width="'+(n+4)+'" height="'+(n+4)+'" fill="#fff"/><path d="'+p+'" fill="#000"/></svg>';
  }catch(e){return '';}
}
function loginHTML(){
  return '<div class="login"><p class="kick">Drawing class</p><h1>Cat vs Dog Tournament</h1><p class="sub">Enter the presenter passcode.</p>'+
    '<div class="field"><input id="pw" type="password" autocomplete="current-password" placeholder="Passcode" aria-label="Presenter passcode"><button class="btn" data-act="unlock">Unlock</button></div>'+
    (loginErr?'<p class="msg-err">'+esc(loginErr)+'</p>':'')+'</div>';
}
function colHTML(b){
  const list=ids(b),full=list.length>=PER,off=full||busy;
  return '<div class="col" style="--tint:var(--'+b+')"><div class="col-head"><h2>'+BR[b]+'</h2><span class="count">'+list.length+' / '+PER+'</span></div>'+
    '<div class="actions"><label class="btn ghost small" for="f-'+b+'"'+(off?' aria-disabled="true" style="opacity:.4;pointer-events:none"':'')+'>Add images</label>'+
    '<input type="file" id="f-'+b+'" accept="image/*" multiple hidden data-b="'+b+'"'+(off?' disabled':'')+'></div>'+
    (list.length?'<div class="thumbs">'+list.map(id=>'<div class="th"><img src="'+imgUrl(id)+'" alt="" loading="lazy"><button type="button" aria-label="Remove image" data-act="rm" data-id="'+id+'"'+(busy?' disabled':'')+'>&times;</button></div>').join('')+'</div>':'<div class="empty">No images yet. Select up to '+PER+' files at once.</div>')+'</div>';
}
function setupHTML(){
  const cats=ids('cat').length,dogs=ids('dog').length,ok=cats===PER&&dogs===PER&&!busy;
  return '<div class="setup"><header class="top"><p class="kick">Drawing class</p><h1>Cat vs Dog Tournament</h1><p class="sub">Add '+PER+' images to each bracket. They stay saved between sessions, so you can run it again or clear them and upload a new set.</p></header>'+
    '<section class="cols">'+colHTML('cat')+colHTML('dog')+'</section>'+
    (busy?'<p class="hint">Working: '+busy.n+' of '+busy.total+'</p>':'')+
    (errs.length?'<p class="msg-err">'+errs.map(esc).join('. ')+'.</p>':'')+
    '<section class="panel"><div class="qr">'+qrSvg(studentUrl())+'</div><div class="fields"><h2>Student link</h2><p class="hint">Students open this on their phones. It needs no login and shows as a QR code before Round 1.</p><code>'+esc(studentUrl())+'</code>'+
    '<div class="actions"><a class="btn ghost small" href="/" target="_blank" rel="noopener">Open phone page to test</a></div></div></section>'+
    '<div class="actions"><button class="btn big" data-act="start"'+(ok?'':' disabled')+'>Start tournament</button><span class="hint">'+(ok?'31 matchups, randomly paired.':'Needs '+PER+' cats and '+PER+' dogs ('+cats+' and '+dogs+' so far).')+'</span></div>'+
    '<div class="actions">'+(confirmClear?'<span class="hint">Delete all saved images?</span><button class="btn ghost small" data-act="clearyes">Yes, delete</button><button class="btn ghost small" data-act="clearno">Cancel</button>':'<button class="btn ghost small" data-act="clearall"'+((cats+dogs===0||busy)?' disabled':'')+'>Clear all images</button>')+'</div></div>';
}
function roundInfo(m){const rm=state.matches.filter(x=>x.round===m.round);return {n:rm.indexOf(m)+1,total:rm.length};}
function introHTML(){
  const s=state,m=s.matches[s.cur],cnt=s.matches.filter(x=>x.round===m.round).length;
  const lede=m.round===5?'The cat champion meets the dog champion.':cnt+' matchup'+(cnt>1?'s':'')+'. Cats face cats, dogs face dogs.';
  return '<div class="intro"><div class="intro-main"><p class="kick">Up next</p><h1>'+ROUND[m.round]+'</h1><p class="lede">'+lede+' '+(VOTE_MS/1000)+' seconds to vote.</p><button class="btn big" data-act="begin">Begin '+ROUND[m.round]+'</button><p class="hint">Space or Enter also works.</p></div>'+
    '<aside class="join"><div class="qr">'+qrSvg(studentUrl())+'</div><p class="kick">Scan to vote</p><code>'+esc(studentUrl())+'</code></aside></div>';
}
function doneHTML(){
  const s=state,m=s.matches[s.cur],w=imgMap()[m.w],dog=w&&w.bracket==='dog';
  return '<div class="done" style="--tint:var(--'+(dog?'dog':'cat')+')"><p class="kick">Champion</p><h1>'+(dog?'Dogs win':'Cats win')+'</h1><div class="champ">'+(m.w?'<img src="'+imgUrl(m.w)+'" alt="">':'')+'</div><button class="btn" data-act="resetyes">New tournament</button></div>';
}
function sideHTML(k,id){
  const s=state,m=s.matches[s.cur],info=imgMap()[id],show=s.phase==='result'&&s.result;
  const tint=info&&info.bracket==='dog'?'var(--dog)':'var(--cat)';
  const won=show&&m.w===id,lost=show&&m.w&&!won;
  const cnt=show?s.result[k]:0,tot=show?s.result.a+s.result.b:0;
  return '<div class="side'+(won?' win':'')+(lost?' lose':'')+'" style="--tint:'+tint+'"><div class="pic"><img src="'+imgUrl(id)+'" alt=""></div><div class="tally">'+(show?'<b>'+cnt+'</b><span>'+(tot?Math.round(cnt/tot*100):0)+'%</span>'+(won?'<em>Winner</em>':''):'')+'</div></div>';
}
function nextLabel(){
  const m=state.matches[state.cur];
  if(!m.w)return 'Revote';
  if(m.round===5)return 'Show the champion';
  if(state.cur===state.matches.length-1)return 'Next: '+ROUND[m.round+1];
  return 'Next matchup';
}
function stageHTML(){
  const s=state;
  if(s.phase==='done')return doneHTML();
  if(s.phase==='intro')return introHTML();
  const m=s.matches[s.cur],ri=roundInfo(m),voting=s.phase==='voting';
  const tint=m.bracket==='dog'?'var(--dog)':m.bracket==='cat'?'var(--cat)':'var(--fg)';
  const tied=(s.phase==='result'&&!m.w)||(s.phase==='ready'&&s.tie);
  let main='';
  if(s.phase==='ready')main='<button class="btn big" data-act="primary">'+(s.tie?'Revote':'Start voting')+'</button><span class="hint">Space or Enter</span>';
  else if(voting)main='<button class="btn ghost" data-act="end">End voting now</button>';
  else main='<button class="btn big" data-act="primary">'+nextLabel()+'</button><span class="hint">Space or Enter</span>';
  const hand=handOpen?'<div class="hand"><input id="hc-a" type="number" min="0" inputmode="numeric" aria-label="Left count" placeholder="Left"><input id="hc-b" type="number" min="0" inputmode="numeric" aria-label="Right count" placeholder="Right"><button class="btn small" data-act="handuse">Use counts</button></div>':'';
  return '<div class="stage"><div class="bar-top"><div class="who"><span class="rname">'+ROUND[m.round]+'</span><span class="chip" style="--tint:'+tint+'">'+BR[m.bracket]+'</span></div>'+
    '<div class="clock'+(voting?' on':'')+'"><b data-cd>'+(VOTE_MS/1000)+'</b><span>sec</span></div><div class="count-r">Matchup '+ri.n+' of '+ri.total+'</div></div>'+
    '<div class="prog"><i data-bar style="width:'+(voting?'100':'0')+'%"></i></div>'+
    '<div class="pair">'+sideHTML('a',m.a)+sideHTML('b',m.b)+'</div>'+
    '<p class="note">'+(tied?'Tie. Vote again.':'&nbsp;')+'</p>'+
    '<div class="foot"><div class="main">'+main+'</div><div class="minor">'+hand+
    ((voting||s.phase==='result')&&!handOpen?'<button class="btn ghost small" data-act="hand">Enter counts by hand</button>':'')+
    '<a class="btn ghost small" href="/" target="_blank" rel="noopener">Phone page</a>'+
    (confirmReset?'<span class="hint">Discard this tournament?</span><button class="btn ghost small" data-act="resetyes">Yes</button><button class="btn ghost small" data-act="resetno">No</button>':'<button class="btn ghost small" data-act="reset">Start over</button>')+'</div></div></div>';
}
function render(){
  const app=$('#app');
  let html;
  if(!unlocked)html=loginHTML();
  else if(!loaded)html='<div class="login"><p class="kick">Loading</p></div>';
  else html=(!state||state.status==='setup'||!state.matches)?setupHTML():stageHTML();
  const toastHtml=toast?'<div class="toast" role="alert">'+esc(toast)+'</div>':'';
  const s=html+'|'+toastHtml;
  // skip rebuilding when nothing visible changed, so typing and focus survive a poll
  const stable=s.replace(/data-cd>\d+</,'data-cd><').replace(/width:[\d.]+%/,'');
  if(stable===sig)return;
  sig=stable;
  app.innerHTML=html;
  $('#toast-slot').innerHTML=toastHtml;
  if(toast)setTimeout(()=>{toast='';render();},6000);
  tick();
}

/* ---------- clock ---------- */
function tick(){
  const s=state;
  if(!unlocked||!s||s.phase!=='voting')return;
  const left=Math.max(0,s.endsAt-now());
  document.querySelectorAll('[data-cd]').forEach(e=>{e.textContent=Math.ceil(left/1000);});
  document.querySelectorAll('[data-bar]').forEach(e=>{e.style.width=(left/VOTE_MS*100)+'%';});
  if(now()>=s.endsAt+CLOSE_MS&&closeSentFor!==s.key&&!acting){
    closeSentFor=s.key;
    api('admin/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'close'})}).then(res=>{if(res.status===200){apply(res.data);render();}});
  }
}
setInterval(tick,200);

/* ---------- events ---------- */
function act(a,t){
  switch(a){
    case 'unlock':unlock((($('#pw')||{}).value||'').trim());break;
    case 'start':doAction('start');break;
    case 'begin':doAction('begin');break;
    case 'primary':primary();break;
    case 'end':doAction('endEarly');break;
    case 'rm':removeImage(t.dataset.id);break;
    case 'clearall':confirmClear=true;sig='';render();break;
    case 'clearno':confirmClear=false;sig='';render();break;
    case 'clearyes':clearAll();break;
    case 'reset':confirmReset=true;sig='';render();break;
    case 'resetno':confirmReset=false;sig='';render();break;
    case 'resetyes':confirmReset=false;doAction('reset');break;
    case 'hand':handOpen=true;sig='';render();break;
    case 'handuse':{
      const a1=parseInt(($('#hc-a')||{}).value,10)||0,b1=parseInt(($('#hc-b')||{}).value,10)||0;
      doAction('hand',{a:a1,b:b1});break;
    }
  }
}
$('#app').addEventListener('click',e=>{const t=e.target.closest('[data-act]');if(!t||t.disabled)return;act(t.dataset.act,t);});
$('#app').addEventListener('change',e=>{const t=e.target;if(t&&t.type==='file'&&t.dataset.b){addFiles(t.dataset.b,t.files);}});
$('#app').addEventListener('keydown',e=>{if(e.target.id==='pw'&&e.key==='Enter'){act('unlock');}});
document.addEventListener('keydown',e=>{
  if(e.target!==document.body||!unlocked)return;
  if(e.code==='Space'||e.key==='Enter'){e.preventDefault();primary();}
});

/* ---------- boot ---------- */
render();
if(pass)unlock(pass);
})();
