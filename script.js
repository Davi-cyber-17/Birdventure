/* ================= CONFIG ================= */
const W=540,H=1000,SLOTS=9,SPIKE_D=38,SPK_H=40;   // mundo lógico fixo (igual para todos os jogadores)
const WIN=30;        // pontuação que encerra a partida
const R=22;          // distância mínima do centro do pássaro até a parede (quique)
const HIT=16;        // raio de colisão do pássaro com os espinhos laterais
const HIT_V=12;      // folga vertical para teto/chão
const COLORS=[
 {n:'Vermelho',c:'#ff3d6e'},{n:'Ciano',c:'#00e5ff'},{n:'Verde',c:'#39ff88'},
 {n:'Amarelo',c:'#ffd400'},{n:'Roxo',c:'#b388ff'},{n:'Rosa',c:'#ff6bf0'}];
const ICE={config:{iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'},{urls:'stun:global.stun.twilio.com:3478'}]}};
const KEYS=['Space','KeyW','KeyP','KeyZ','KeyH','KeyM'];
const KEYN=['Espaço','W','P','Z','H','M'];
const $=id=>document.getElementById(id);
const stage=$('stage'),cv=$('cv'),ctx=cv.getContext('2d');

/* ================= ESTADO ================= */
let mode='menu';          // menu | local | host | client
let G=null;               // estado do jogo
let myIdx=0, nLocal=2;
let peer=null, conns=[], names=[], conn=null, roomCode='', lobbyOpen=false;
let cacheReady=false,joinT=0, sendTick=0, overShown=false;
let vw=1,vh=1,dpr=1,gs=1,ox=0,oy=0;   // viewport, escala e posição do jogo na tela

/* ================= REGIÕES DE TOQUE ================= */
function rowsFor(n,portrait){
 const L={1:[1],2:[2],3:[3],4:[2,2],5:[3,2],6:[3,3]};
 const P={1:[1],2:[1,1],3:[1,1,1],4:[2,2],5:[2,2,1],6:[2,2,2]};
 return (portrait?P:L)[n];
}
function zoneRects(n){
 const rows=rowsFor(n,vh>vw),out=[];
 rows.forEach((c,r)=>{for(let i=0;i<c;i++)out.push({x:i*vw/c,y:r*vh/rows.length,w:vw/c,h:vh/rows.length})});
 return out;
}
function zoneOf(x,y,n){
 const rs=zoneRects(n);
 for(let i=0;i<rs.length;i++){const z=rs[i];if(x>=z.x&&x<z.x+z.w&&y>=z.y&&y<z.y+z.h)return i}
 return 0;
}
let _fine=null;const isFine=()=>_fine===null?(_fine=matchMedia('(pointer:fine)').matches):_fine;

/* ================= TELAS ================= */
function show(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('on'));if(id)$(id).classList.add('on')}
document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>show(b.dataset.go));
$('bLocal').onclick=()=>show('sLocal');
$('bOnline').onclick=()=>show('sOnline');

const pickN=$('pickN');
for(let i=1;i<=6;i++){const b=document.createElement('button');b.className='pick'+(i===2?' sel':'');b.textContent=i;
 b.onclick=()=>{nLocal=i;[...pickN.children].forEach(x=>x.classList.toggle('sel',x===b));hint()};pickN.appendChild(b)}
function buildPrev(){
 const el=$('zonePrev');if(!el)return;
 const p=vh>vw;el.innerHTML='';el.style.height=nLocal===1?'4em':(p?'14em':'7em');
 let k=0;
 rowsFor(nLocal,p).forEach(c=>{
  const row=document.createElement('div');row.className='zr';
  for(let i=0;i<c;i++,k++){const d=document.createElement('i');d.style.setProperty('--c',COLORS[k].c);d.textContent='J'+(k+1);row.appendChild(d)}
  el.appendChild(row);
 });
}
function hint(){
 $('keysHint').textContent=nLocal===1
  ?'Toque em qualquer lugar da tela (ou aperte Espaço) para voar.'
  :'Cada jogador toca na sua região colorida da tela. Teclado: '+KEYN.slice(0,nLocal).map((k,i)=>`J${i+1}=${k}`).join(' · ');
 buildPrev();
}

/* ================= LÓGICA DO JOGO ================= */
function mkBird(i,n){
 return {x:W/2+(i-(n-1)/2)*34,y:H/2+(i%2?-30:30),vy:0,dir:i%2?-1:1,alive:true,score:0,ang:0};
}
function newGame(n){
 const g={n,birds:Array.from({length:n},(_,i)=>mkBird(i,n)),L:[],Rt:[],stars:[],cd:3,over:false,last:-1};
 genSpikes(g,'L');genSpikes(g,'Rt');
 spawnStar(g);spawnStar(g);
 return g;
}
const slotY=i=>150+i*((H-300)/(SLOTS-1));
function genSpikes(g,side){
 const top=Math.max(0,...g.birds.map(b=>b.score));
 const k=Math.min(2+Math.floor(top/3),6);
 // não cria espinho em cima de um pássaro que já está encostado nessa parede
 const blocked=new Set();
 for(const b of g.birds){
  if(!b.alive)continue;
  const near=side==='L'?b.x<SPIKE_D+HIT+40:b.x>W-SPIKE_D-HIT-40;
  if(!near)continue;
  for(let s=0;s<SLOTS;s++)if(Math.abs(slotY(s)-b.y)<SPK_H+HIT+30)blocked.add(s);
 }
 const free=[];for(let s=0;s<SLOTS;s++)if(!blocked.has(s))free.push(s);
 for(let i=free.length-1;i>0;i--){const j=(Math.random()*(i+1))|0;[free[i],free[j]]=[free[j],free[i]]}
 g[side]=free.slice(0,k);
}
function spawnStar(g){g.stars.push({x:110+Math.random()*(W-220),y:200+Math.random()*(H-400)})}

// colisão com o espinho triangular (mesma geometria que é desenhada)
function wallHit(arr,b,left){
 const edge=(left?b.x:W-b.x)-HIT;          // distância da borda do pássaro até a parede
 if(edge>=SPIKE_D)return false;
 const lim=SPK_H+HIT*.5;
 for(const s of arr){
  const dy=Math.abs(slotY(s)-b.y);
  if(dy>=lim)continue;
  if(edge<SPIKE_D*(1-dy/lim))return true;
 }
 return false;
}
// altura dos dentes do teto/chão na posição x
const TW=W/8;
function toothH(x){const t=Math.abs((((x%TW)+TW)%TW)-TW/2)/(TW/2);return 30+34*(1-t)}

function step(g,dt){
 if(g.over)return;
 if(g.cd>0){g.cd-=dt;return}
 for(let bi=0;bi<g.birds.length;bi++){
  const b=g.birds[bi];
  if(!b.alive)continue;
  b.vy+=1650*dt;b.y+=b.vy*dt;b.x+=b.dir*215*dt;
  b.ang=Math.max(-.6,Math.min(.8,b.vy/900));
  const th=toothH(b.x);
  if(b.y-HIT_V<th||b.y+HIT_V>H-th){b.alive=false;continue}
  // espinhos das duas paredes, olhando a posição real do pássaro (não a direção)
  if(wallHit(g.L,b,true)||wallHit(g.Rt,b,false)){b.alive=false;continue}
  if(b.x<R){b.x=R;b.dir=1;b.score++;g.last=bi;genSpikes(g,'Rt')}
  else if(b.x>W-R){b.x=W-R;b.dir=-1;b.score++;g.last=bi;genSpikes(g,'L')}
  for(let i=g.stars.length-1;i>=0;i--){
   const s=g.stars[i];
   if(Math.hypot(s.x-b.x,s.y-b.y)<46){b.score++;g.stars.splice(i,1);spawnStar(g)}
  }
 }
 // fim 1: algum jogador chegou a 30 pontos
 if(g.birds.some(b=>b.score>=WIN)){g.over=true;g.reason='score';return}
 // fim 2: todos os outros jogadores morreram (ou, sozinho, o pássaro morreu)
 const alive=g.birds.filter(b=>b.alive).length;
 if((g.n===1&&alive===0)||(g.n>1&&alive<=1)){
  if(g.n>1){const w=g.birds.find(b=>b.alive);if(w)w.score+=3}
  g.over=true;g.reason='dead';
 }
}
function flap(g,i){
 if(!g||g.over||g.cd>0)return;
 const b=g.birds[i];if(b&&b.alive)b.vy=-580;
}

/* ================= CONTROLES (toque na tela / teclado) ================= */
function input(pi){
 if(mode==='client'){if(conn&&conn.open)conn.send({t:'flap'})}
 else flap(G,pi);
}
addEventListener('keydown',e=>{
 if(!G||e.repeat)return;
 if(mode==='local'){const i=KEYS.indexOf(e.code);if(i>=0&&i<G.n){e.preventDefault();flap(G,i)}}
 else if(mode==='host'||mode==='client'){if(e.code==='Space'||e.code==='ArrowUp'){e.preventDefault();input(myIdx)}}
});
// o toque vale em qualquer ponto da tela; no modo local a tela é dividida em regiões por jogador
cv.addEventListener('pointerdown',e=>{
 if(!G||e.button>0)return;
 e.preventDefault();
 const r=cv.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
 if(mode==='local'){
  const z=G.n===1?0:zoneOf(x,y,G.n);
  input(z);
 }else if(mode==='host'||mode==='client'){
  input(myIdx);
 }
});

/* ================= INÍCIO / FIM ================= */
function startGame(g){
 G=g;overShown=false;show(null);$('quit').style.display='block';
}
$('bLocalGo').onclick=()=>{mode='local';startGame(newGame(nLocal))};

function showOver(){
 overShown=true;
 const order=G.birds.map((b,i)=>({i,s:b.score})).sort((a,b)=>b.s-a.s);
 $('overT').textContent=G.n===1?`Pontuação: ${order[0].s}`:`${pname(order[0].i)} venceu!`;
 $('rank').innerHTML=order.map((o,k)=>`<div class="pl" style="--c:${COLORS[o.i].c}"><i></i>${k+1}º ${esc(pname(o.i))}<b>${o.s}</b></div>`).join('');
 $('bAgain').style.display=mode==='client'?'none':'';
 const why=G.reason==='score'?`Alguém chegou a ${WIN} pontos!`:'';
 $('overMsg').textContent=mode==='client'?(why?why+' ':'')+'Aguardando o anfitrião...':why;
 show('sOver');
}
function pname(i){return mode==='local'||!names[i]?COLORS[i].n:names[i]}
$('bAgain').onclick=()=>{
 if(mode==='local')startGame(newGame(G.n));
 else if(mode==='host')hostStart();
};
$('bMenu').onclick=toMenu;
// sair exige dois toques para não sair sem querer durante o jogo
let quitT=0;
function quitReset(){clearTimeout(quitT);$('quit').classList.remove('arm');$('quit').textContent='✕'}
$('quit').onclick=()=>{
 if($('quit').classList.contains('arm')){quitReset();toMenu();return}
 $('quit').classList.add('arm');$('quit').textContent='Sair?';
 quitT=setTimeout(quitReset,2000);
};
function toMenu(){
 closeNet();mode='menu';G=null;
 quitReset();$('quit').style.display='none';show('sMenu');
}

/* ================= ONLINE (PeerJS) ================= */
const CH='ABCDEFGHJKLMNPQRSTUVWXYZ';
const genCode=()=>Array.from({length:4},()=>CH[(Math.random()*CH.length)|0]).join('');
const myName=()=>($('nameIn').value.trim()||'Jogador').slice(0,12);
function closeNet(){
 try{conns.forEach(c=>c&&c.close())}catch(e){}
 try{conn&&conn.close()}catch(e){}
 try{peer&&peer.destroy()}catch(e){}
 peer=null;conns=[];conn=null;names=[];lobbyOpen=false;
}
function needPeer(){
 if(typeof Peer==='undefined'){$('onMsg').textContent='Não foi possível carregar a biblioteca online. Verifique a internet.';return false}
 return true;
}
function renderLobby(){
 $('plist').innerHTML=names.map((n,i)=>`<div class="pl" style="--c:${COLORS[i].c}"><i></i>${esc(n)}<b>${i===0?'HOST':i===myIdx?'VOCÊ':''}</b></div>`).join('');
 $('bStart').style.display=mode==='host'?'':'none';
 $('bCopy').style.display=mode==='host'?'':'none';
 $('lobbyInfo').textContent=mode==='host'?`Passe o código para seus amigos (${names.length}/6).`:'Aguardando o anfitrião iniciar...';
}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* --- anfitrião --- */
$('bCreate').onclick=()=>{
 if(!needPeer())return;
 $('onMsg').textContent='Criando sala...';
 roomCode=genCode();
 closeNet();
 peer=new Peer('happybirds-'+roomCode,ICE);
 peer.on('error',e=>{
  if(e.type==='unavailable-id'){$('bCreate').click();return}
  $('onMsg').textContent='Erro de conexão: '+e.type;
 });
 peer.on('disconnected',()=>{try{peer.reconnect()}catch(e){}});
 peer.on('open',()=>{
  mode='host';myIdx=0;names=[myName()];conns=[null];lobbyOpen=true;
  $('roomCode').textContent=roomCode;$('lbMsg').textContent='';
  renderLobby();show('sLobby');
 });
 peer.on('connection',c=>{
  c.on('open',()=>{
   if(!lobbyOpen||names.length>=6){c.send({t:'full'});setTimeout(()=>c.close(),300);return}
  });
  c.on('data',m=>{
   if(m.t==='hello'&&!c._idx&&c._idx!==0){
    if(!lobbyOpen||names.length>=6)return;
    const i=names.length;c._idx=i;conns[i]=c;names[i]=String(m.name||'Jogador').slice(0,12);
    c.send({t:'welcome',idx:i});broadcastLobby();renderLobby();
   }else if(m.t==='flap'&&c._idx>0)flap(G,c._idx);
  });
  c.on('close',()=>{
   const i=c._idx;if(!i)return;
   if(lobbyOpen){names.splice(i,1);conns.splice(i,1);conns.forEach((x,k)=>x&&(x._idx=k));
    conns.forEach((x,k)=>x&&x.send({t:'welcome',idx:k}));broadcastLobby();renderLobby()}
   else if(G&&G.birds[i])G.birds[i].alive=false;
  });
 });
};
function broadcastLobby(){conns.forEach(c=>c&&c.open&&c.send({t:'lobby',names}))}
$('bStart').onclick=hostStart;
function hostStart(){
 lobbyOpen=false;mode='host';
 const g=newGame(names.length);
 conns.forEach(c=>c&&c.open&&c.send({t:'start',names}));
 startGame(g);
}

/* --- convidado --- */
$('bJoin').onclick=()=>{
 if(!needPeer())return;
 const code=$('codeIn').value.trim().toUpperCase();
 if(code.length!==4){$('onMsg').textContent='Digite o código de 4 letras.';return}
 $('onMsg').textContent='Conectando...';
 closeNet();
 peer=new Peer(undefined,ICE);
 peer.on('error',e=>{$('onMsg').textContent=e.type==='peer-unavailable'?'Sala não encontrada.':'Erro de conexão: '+e.type});
 peer.on('open',()=>{
  conn=peer.connect('happybirds-'+code,{reliable:true});
  conn.on('open',()=>{clearTimeout(joinT);conn.send({t:'hello',name:myName()});roomCode=code});
  joinT=setTimeout(()=>{if(conn&&!conn.open){$('onMsg').textContent='Não foi possível conectar. Confira o código e a internet de vocês.';closeNet()}},12000);
  conn.on('data',onClientMsg);
  conn.on('close',()=>{if(mode!=='menu'){alert('A conexão com a sala foi encerrada.');toMenu()}});
 });
};
function onClientMsg(m){
 if(m.t==='full'){$('onMsg').textContent='Sala cheia ou partida já iniciada.';closeNet();return}
 if(m.t==='welcome'){myIdx=m.idx;mode='client'}
 if(m.t==='lobby'){names=m.names;mode='client';$('roomCode').textContent=roomCode;$('lbMsg').textContent='';renderLobby();show('sLobby')}
 if(m.t==='start'){names=m.names;mode='client';G=null;overShown=false;show(null);$('quit').style.display='block'}
 if(m.t==='state'){
  const first=!G||G.n!==m.g.n||(overShown&&!m.g.over);
  G=m.g;if(first){overShown=false;show(null);$('quit').style.display='block'}
 }
}
$('bLeave').onclick=toMenu;

/* ================= TAMANHO / RESPONSIVIDADE ================= */
// o jogo (540x1000) é desenhado centralizado e ajustado à tela inteira, em qualquer aparelho/orientação
function resize(){
 const nw=Math.max(1,stage.clientWidth),nh=Math.max(1,stage.clientHeight),nd=Math.min(devicePixelRatio||1,1.5);
 if(cacheReady&&nw===vw&&nh===vh&&nd===dpr)return;
 vw=nw;vh=nh;dpr=nd;
 cv.width=Math.round(vw*dpr);cv.height=Math.round(vh*dpr);
 gs=Math.min(vw/W,vh/H);ox=(vw-W*gs)/2;oy=(vh-H*gs)/2;
 stage.style.fontSize=Math.max(12,Math.min(22,Math.min(vw,vh*.62)/28))+'px';
 buildCache();cacheReady=true;
 buildPrev();
}
addEventListener('resize',resize);
addEventListener('orientationchange',()=>{setTimeout(resize,150);setTimeout(resize,500)});
if(window.visualViewport)visualViewport.addEventListener('resize',resize);
if(window.ResizeObserver)new ResizeObserver(resize).observe(stage);

/* ================= RENDER ================= */
function glow(c,b){ctx.shadowColor=c;ctx.shadowBlur=b}
function noGlow(){ctx.shadowBlur=0}
function star(x,y,r,col,rot=0,fill=true){
 ctx.beginPath();
 for(let i=0;i<10;i++){const a=rot-Math.PI/2+i*Math.PI/5,rr=i%2?r*.45:r;ctx.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr)}
 ctx.closePath();ctx.lineJoin='round';ctx.lineWidth=3;ctx.strokeStyle=col;ctx.stroke();
 if(fill){ctx.fillStyle=col;ctx.fill()}
}
function drawBird(b,col,alpha){
 ctx.save();ctx.globalAlpha=alpha;
 ctx.translate(b.x,b.y);ctx.scale(b.dir,1);ctx.rotate(b.ang);
 if(alpha>.5){ctx.globalAlpha=alpha*.2;ctx.fillStyle=col;ctx.beginPath();ctx.arc(0,0,38,0,7);ctx.fill();ctx.globalAlpha=alpha}
 ctx.lineJoin='round';ctx.lineWidth=4;ctx.strokeStyle='#05070f';ctx.fillStyle=col;
 ctx.beginPath();ctx.moveTo(-14,-4);ctx.lineTo(-38,-14);ctx.lineTo(-34,6);ctx.closePath();ctx.stroke();ctx.fill();
 ctx.beginPath();ctx.ellipse(0,0,25,21,0,0,7);ctx.stroke();ctx.fill();
 noGlow();
 ctx.beginPath();ctx.moveTo(20,-6);ctx.lineTo(36,2);ctx.lineTo(20,8);ctx.closePath();ctx.fillStyle='#fff';ctx.stroke();ctx.fill();
 const fl=b.vy<-150?-12:6;
 ctx.beginPath();ctx.moveTo(-14,2);ctx.lineTo(4,fl+14);ctx.lineTo(8,0);ctx.closePath();ctx.fillStyle='rgba(255,255,255,.6)';ctx.lineWidth=3;ctx.stroke();ctx.fill();
 ctx.beginPath();ctx.arc(10,-7,4,0,7);ctx.fillStyle='#05070f';ctx.fill();
 ctx.restore();
}
function spikePath(pts,col,c=ctx,halo=false){
 c.beginPath();pts.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));c.closePath();
 c.lineJoin='round';c.strokeStyle=col;
 if(halo){c.globalAlpha=.22;c.lineWidth=9;c.stroke();c.globalAlpha=1}
 c.fillStyle='#1a0b2e';c.fill();c.lineWidth=3;c.stroke();
}
function worldBegin(){ctx.save();ctx.translate(ox,oy);ctx.scale(gs,gs);ctx.beginPath();ctx.rect(0,0,W,H);ctx.clip()}
const bgC=document.createElement('canvas'),tC=document.createElement('canvas');
function buildCache(){
 bgC.width=tC.width=cv.width;bgC.height=tC.height=cv.height;
 let c=bgC.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);
 c.save();c.shadowColor='rgba(0,229,255,.5)';c.shadowBlur=28;c.fillStyle='#050816';c.fillRect(ox,oy,W*gs,H*gs);c.restore();
 c.save();c.translate(ox,oy);c.scale(gs,gs);c.beginPath();c.rect(0,0,W,H);c.clip();
 const bg=c.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#0a1230');bg.addColorStop(1,'#050816');
 c.fillStyle=bg;c.fillRect(0,0,W,H);c.restore();
 c=tC.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);
 c.save();c.translate(ox,oy);c.scale(gs,gs);c.beginPath();c.rect(0,0,W,H);c.clip();
 const M='#ff2fd0',n=8,w=W/n;let top=[[0,0]],bot=[[0,H]];
 for(let i=0;i<n;i++){top.push([i*w,30],[i*w+w/2,64],[(i+1)*w,30]);bot.push([i*w,H-30],[i*w+w/2,H-64],[(i+1)*w,H-30])}
 top.push([W,0]);bot.push([W,H]);
 c.shadowColor=M;c.shadowBlur=14;spikePath(top,M,c);spikePath(bot,M,c);c.restore();
}
function drawGrid(){
 ctx.strokeStyle='rgba(0,229,255,.07)';ctx.lineWidth=1;ctx.beginPath();
 const off=(performance.now()/60)%50;
 for(let x=0;x<=W;x+=50){ctx.moveTo(x,0);ctx.lineTo(x,H)}
 for(let y=off-50;y<=H;y+=50){ctx.moveTo(0,y);ctx.lineTo(W,y)}
 ctx.stroke();
}
function hintText(){
 if(mode==='local'&&G.n>1)return 'Cada um toca na sua região colorida';
 return isFine()?'Clique, toque ou aperte Espaço para voar':'Toque na tela para voar';
}
function drawWorld(){
 if(G.last>=0){ctx.globalAlpha=.12;star(W/2,H/2,200,COLORS[G.last].c);ctx.globalAlpha=1}
 const M='#ff2fd0';
 for(const s of G.L){const y=slotY(s);spikePath([[0,y-SPK_H],[SPIKE_D,y],[0,y+SPK_H]],M,ctx,true)}
 for(const s of G.Rt){const y=slotY(s);spikePath([[W,y-SPK_H],[W-SPIKE_D,y],[W,y+SPK_H]],M,ctx,true)}

 // pontuação grande e discreta (1 jogador / online); no local com vários jogadores ela fica em cada região
 const me=mode==='local'?(G.n===1?0:-1):myIdx;
 if(me>=0&&G.birds[me]&&G.cd<=0){
  ctx.globalAlpha=.14;ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font='900 170px Orbitron,sans-serif';ctx.fillText(G.birds[me].score,W/2,330);ctx.globalAlpha=1;
 }
 const t=performance.now()/600;
 G.stars.forEach(s=>{
  ctx.globalAlpha=.2;ctx.fillStyle='#ffd400';ctx.beginPath();ctx.arc(s.x,s.y,34,0,7);ctx.fill();ctx.globalAlpha=1;
  star(s.x,s.y,28,'#ffd400',Math.sin(t)*.2,false);ctx.beginPath();ctx.arc(s.x,s.y,8,0,7);ctx.fillStyle='#ffd400';ctx.fill()});
 G.birds.forEach((b,i)=>{if(!b.alive)drawBird({...b,ang:0,vy:0},COLORS[i].c,.2)});
 G.birds.forEach((b,i)=>{if(b.alive)drawBird(b,COLORS[i].c,1)});
 if(mode!=='local'&&G.birds[myIdx]&&G.birds[myIdx].alive){
  const b=G.birds[myIdx];ctx.fillStyle=COLORS[myIdx].c;
  ctx.beginPath();ctx.moveTo(b.x-9,b.y-48);ctx.lineTo(b.x+9,b.y-48);ctx.lineTo(b.x,b.y-36);ctx.closePath();ctx.fill();
 }
 // placar compacto no online
 if(mode!=='local'&&G.n>1){
  ctx.textBaseline='middle';ctx.textAlign='left';ctx.font='700 24px Orbitron,sans-serif';
  G.birds.forEach((b,i)=>{
   const cx=W/2+(i-(G.n-1)/2)*84;ctx.globalAlpha=b.alive?1:.35;
   ctx.fillStyle=COLORS[i].c;ctx.beginPath();ctx.arc(cx-20,118,8,0,7);ctx.fill();
   ctx.fillStyle='#fff';ctx.fillText(b.score,cx-6,119);
  });
  ctx.globalAlpha=1;
 }
 // contagem regressiva
 if(G.cd>0){
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font='900 190px Orbitron,sans-serif';ctx.fillStyle='#fff';ctx.fillText(Math.ceil(G.cd),W/2,H*.36);
  ctx.font='700 26px Rajdhani,sans-serif';ctx.fillStyle='#00e5ff';ctx.fillText(hintText(),W/2,H*.5);
 }
}
// regiões de toque de cada jogador (modo local com 2+ jogadores)
function drawZones(){
 const rs=zoneRects(G.n),fine=isFine();
 ctx.textAlign='center';ctx.textBaseline='middle';
 rs.forEach((z,i)=>{
  const c=COLORS[i].c,b=G.birds[i],alive=b&&b.alive,s=Math.min(z.w,z.h);
  ctx.fillStyle=c;ctx.globalAlpha=alive?.06:.02;ctx.fillRect(z.x,z.y,z.w,z.h);
  ctx.globalAlpha=alive?.4:.15;ctx.strokeStyle=c;ctx.lineWidth=2;ctx.setLineDash([10,8]);ctx.strokeRect(z.x+1,z.y+1,z.w-2,z.h-2);ctx.setLineDash([]);
  ctx.fillStyle=c;
  ctx.globalAlpha=alive?.22:.08;ctx.font=`900 ${s*.32}px Orbitron,sans-serif`;ctx.fillText(String(b?b.score:0),z.x+z.w/2,z.y+z.h/2);
  const fs=Math.max(12,Math.min(20,s*.07));
  ctx.globalAlpha=alive?.85:.35;ctx.font=`700 ${fs}px Rajdhani,sans-serif`;
  ctx.fillText(`${COLORS[i].n}${fine?' · '+KEYN[i]:''}${alive?'':' ✕'}`,z.x+z.w/2,z.y+z.h-fs-8);
 });
 ctx.globalAlpha=1;
}
function render(){
 ctx.setTransform(dpr,0,0,dpr,0,0);
 ctx.clearRect(0,0,vw,vh);
 ctx.drawImage(bgC,0,0,vw,vh);
 worldBegin();drawGrid();ctx.restore();
 ctx.drawImage(tC,0,0,vw,vh);
 if(G&&mode==='local'&&G.n>1)drawZones();
 if(G){worldBegin();drawWorld();ctx.restore()}
 ctx.strokeStyle='rgba(0,229,255,.45)';ctx.lineWidth=1;ctx.strokeRect(ox+.5,oy+.5,W*gs-1,H*gs-1);
}

/* ================= LOOP ================= */
let lt=performance.now();
function loop(now){
 const dt=Math.min(.05,(now-lt)/1000);lt=now;
 if(G){
  if(mode==='local'||mode==='host'){
   step(G,dt);
   if(mode==='host'&&++sendTick%2===0){const m={t:'state',g:G};conns.forEach(c=>c&&c.open&&c.send(m))}
  }else if(mode==='client')predict(G,dt);
  if(G.over&&!overShown)showOver();
 }
 render();
 requestAnimationFrame(loop);
}

/* ================= EXTRAS ================= */
// previsão local no convidado: suaviza o movimento entre pacotes do anfitrião
function predict(g,dt){
 if(g.cd>0){g.cd-=dt;return}
 if(g.over)return;
 for(const b of g.birds){
  if(!b.alive)continue;
  b.vy+=1650*dt;b.y+=b.vy*dt;b.x+=b.dir*215*dt;
  b.ang=Math.max(-.6,Math.min(.8,b.vy/900));
  b.x=Math.max(R,Math.min(W-R,b.x));
 }
}
// link de convite
const roomLink=()=>location.protocol==='file:'?roomCode:`${location.origin}${location.pathname}?sala=${roomCode}`;
$('bCopy').onclick=async()=>{
 const t=roomLink();
 try{await navigator.clipboard.writeText(t);$('lbMsg').className='msg ok';$('lbMsg').textContent='Link copiado! Envie para seus amigos.'}
 catch(e){prompt('Copie o link da sala:',t)}
};
const qRoom=new URLSearchParams(location.search).get('sala');
if(qRoom){$('codeIn').value=qRoom.toUpperCase().slice(0,4);show('sOnline')}
addEventListener('contextmenu',e=>e.preventDefault());

resize();hint();
requestAnimationFrame(loop);
