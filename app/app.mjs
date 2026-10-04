import {createGame,legalMoves,applyMove,publicState,inCheck} from './core/rules.mjs';
import {createGameAudio} from './audio.mjs';
import {createPositionAnalysis} from './analysis.mjs';
import {renderAnalysis} from './analysis-view.mjs';
const $=id=>document.getElementById(id);
const N={red:{k:'帅',a:'仕',b:'相',r:'车',n:'马',c:'炮',p:'兵'},black:{k:'将',a:'士',b:'象',r:'车',n:'马',c:'炮',p:'卒'}},SIDE={red:'红方',black:'黑方'};
const REASON={'checkmate':'将死','stalemate':'困毙，无合法走法','general-captured':'将帅被吃','no-legal-moves':'无合法走法','threefold-repetition':'同一公开局面出现三次','no-progress':'连续 120 手无吃子或揭子','move-limit':'达到本地 400 手上限','resignation':'认输'};
const LEVELS=[['easy','入门'],['medium','进阶'],['hard','困难'],['expert','全力 · 3秒'],['custom','自选用时']];
const ART={red:{k:0,a:1,b:2,r:3,n:4,c:5,p:6},black:{k:7,a:8,b:9,r:10,n:11,c:12,p:13}};
const saved=(()=>{try{return JSON.parse(localStorage.getItem('wild-chess-settings'))||{}}catch{return {}}})();
let config={variant:'standard',mode:'human-ai',humanSide:'red',redLevel:'expert',blackLevel:'expert',seconds:3,...saved};
if(!['standard','jieqi'].includes(config.variant))config.variant='standard';
if(!['human-ai','ai-ai','human-human'].includes(config.mode))config.mode='human-ai';
let game=createGame({variant:config.variant}),session={...config},states=[game];
let started=false,paused=false,thinking=false,flipped=false,selected=null,currentMoves=[],epoch=0,worker=null,timer=null;
let lastEngine=null,statusOverride='',thinkStarted=0,toastTimer,revealSquare=-1,cancelWorker=null;
let screen='home',resumePaused=false,navigationStop=Promise.resolve(),starting=false,navigationEpoch=0,undoing=false;
const audio=createGameAudio();
const analysis=createPositionAnalysis({api:window.chessAPI,onChange:s=>renderAnalysis(s,{started,paused,mode:session.mode}),formatMove:(state,move)=>{const m=typeof move==='string'?fromUci(move):move;const p=state.board[m.from];return p?notation({piece:p,move:m}):''}});
const modeName=mode=>({'human-ai':'人机对弈','ai-ai':'AI 观战','human-human':'同机双人'}[mode]);
const variantName=variant=>variant==='jieqi'?'混合揭棋':'普通象棋';
const squares=[];
for(const id of ['red-level','black-level'])$(id).innerHTML=LEVELS.map(([v,n])=>`<option value="${v}">${n}</option>`).join('');
$('human-side').value=config.humanSide;$('red-level').value=config.redLevel;$('black-level').value=config.blackLevel;$('seconds').value=String(config.seconds);
const gx=x=>81+x*92.25,gy=y=>80+y*93;
function line(x1,y1,x2,y2,outer=false){const l=document.createElementNS('http://www.w3.org/2000/svg','line');for(const [k,v]of Object.entries({x1,y1,x2,y2}))l.setAttribute(k,v);if(outer)l.classList.add('outer');$('board-lines').append(l)}
for(let y=0;y<10;y++)line(gx(0),gy(y),gx(8),gy(y),y===0||y===9);
for(let x=0;x<9;x++){if(x===0||x===8)line(gx(x),gy(0),gx(x),gy(9),true);else{line(gx(x),gy(0),gx(x),gy(4));line(gx(x),gy(5),gx(x),gy(9))}}
for(const y of [0,7]){line(gx(3),gy(y),gx(5),gy(y+2));line(gx(5),gy(y),gx(3),gy(y+2))}
for(const y of [2,3,6,7])for(const x of(y===2||y===7?[1,7]:[0,2,4,6,8]))for(const dx of [-1,1])for(const dy of [-1,1]){if((x===0&&dx<0)||(x===8&&dx>0))continue;const a=gx(x)+dx*7,b=gy(y)+dy*7;line(a,b,a+dx*9,b);line(a,b,a,b+dy*9)}
for(let i=0;i<90;i++){const b=document.createElement('button');b.className='square';b.dataset.square=i;b.onclick=()=>clickSquare(i);$('squares').append(b);squares.push(b)}
function location(i){let x=i%9,y=Math.floor(i/9);if(flipped){x=8-x;y=9-y}return{left:`${9+x*10.25}%`,top:`${8+y*9.3}%`}}
const squareName=i=>String.fromCharCode(65+i%9)+(10-Math.floor(i/9));
const name=p=>p?N[p.side][p.type]:'';
const isAI=side=>session.mode==='ai-ai'||(session.mode==='human-ai'&&side!==session.humanSide);
const level=side=>side==='red'?session.redLevel:session.blackLevel;
const toUci=m=>{const s=i=>String.fromCharCode(97+i%9)+(9-Math.floor(i/9));return s(m.from)+s(m.to)};
function fromUci(s){if(!/^[a-i][0-9][a-i][0-9]$/.test(s))throw new Error('引擎返回了无法识别的走法');return{from:(9-Number(s[1]))*9+s.charCodeAt(0)-97,to:(9-Number(s[3]))*9+s.charCodeAt(2)-97}}
function notation(h){const p=h.piece,fx=h.move.from%9,tx=h.move.to%9,fy=Math.floor(h.move.from/9),ty=Math.floor(h.move.to/9),cn='一二三四五六七八九';const digit=n=>p.side==='red'?cn[n-1]:String(n),file=x=>p.side==='red'?9-x:x+1;const verb=fy===ty?'平':((p.side==='red'?ty<fy:ty>fy)?'进':'退'),end=fy===ty||['n','b','a'].includes(p.type)?file(tx):Math.abs(ty-fy);return(p.covered?'暗':'')+name(p)+digit(file(fx))+verb+digit(end)}
function renderArt(p){const n=p.covered?14:ART[p.side][p.type],col=n%5,row=Math.floor(n/5),rows=[[0,347],[347,664],[664,971]],x=col*1619/5,w=1619/5,y=rows[row][0],h=rows[row][1]-y;const d=document.createElement('div');d.className='piece';d.style.setProperty('--anchor',row===0?'68%':row===1?'63%':'57%');const clip=document.createElement('div');clip.className='art';clip.style.backgroundImage='none';clip.style.overflow='hidden';const img=document.createElement('img');img.src='assets/characters.png';img.alt='';img.draggable=false;Object.assign(img.style,{position:'absolute',maxWidth:'none',width:`${1619/w*100}%`,height:`${971/h*100}%`,left:`${-x/w*100}%`,top:`${-y/h*100}%`});clip.append(img);d.append(clip);return d}
function renderBoard(){currentMoves=legalMoves(game);$('pieces').replaceChildren();const last=game.history.at(-1)?.move;for(let i=0;i<90;i++){const p=game.board[i],b=squares[i];Object.assign(b.style,location(i));b.className='square';if(last&&(last.from===i||last.to===i))b.classList.add('last');const dest=selected!==null&&currentMoves.some(m=>m.from===selected&&m.to===i);if(dest)b.classList.add(p?'capture':'legal');b.setAttribute('aria-label',`${squareName(i)} ${p?(p.covered?`${SIDE[p.side]}暗子，按${name(p)}走`:`${SIDE[p.side]}${name(p)}`):'空位'}${dest?'，可落子':''}`);b.title=p?.covered?`${SIDE[p.side]}暗子 · 第一手按${name(p)}走；真实身份未知`:b.getAttribute('aria-label');b.setAttribute('aria-pressed',String(selected===i));if(p){const d=renderArt(p);Object.assign(d.style,location(i));if(i===selected)d.classList.add('selected');if(i===revealSquare)d.classList.add('revealed');if(p.type==='k'&&!p.covered&&inCheck(game,p.side))d.classList.add('checked');$('pieces').append(d)}}$('game-over').hidden=game.result.status!=='ended';if(game.result.status==='ended'){$('result-title').textContent=game.result.winner?`${SIDE[game.result.winner]}获胜`:'和棋';$('result-reason').textContent=REASON[game.result.reason]||'对局结束'}}
const playerLabel=side=>isAI(side)?'AI':session.mode==='human-human'?'棋手':'你';
function renderStatus(){const top=flipped?'red':'black',bottom=flipped?'black':'red';for(const [at,side]of [['top',top],['bottom',bottom]]){$(at+'-name').textContent=`${SIDE[side]} · ${playerLabel(side)}`;$(at+'-sub').textContent=isAI(side)?`${session.variant==='standard'?'皮卡鱼':'混揭概率 AI'} · ${LEVELS.find(a=>a[0]===level(side))?.[1]||'进阶'}`:session.mode==='human-human'?'同机轮流执子':'由你执子';$(at+'-turn').className='turn-pill'+(started&&game.turn===side&&game.result.status!=='ended'?' active':'');$(at+'-turn').textContent=game.result.status==='ended'?'已结束':!started?'准备':game.turn!==side?'等待落子':paused?'已暂停':thinking?'正在思考':'轮到落子'}
  for(const [selector,side]of [['.player-strip .player-seal',top],['.bottom-strip .player-seal',bottom]]){document.querySelector(selector).className=`player-seal ${side}-seal`;document.querySelector(selector).textContent=side==='red'?'帅':'将'}
  $('live-dot').className='live-dot'+(thinking?' thinking':statusOverride?' error':'');let title='准备就绪',detail='选择玩法与对手，开始你的棋局。';if(started){title=game.result.status==='ended'?(game.result.winner?`${SIDE[game.result.winner]}获胜`:'本局和棋'):paused?'对弈已暂停':thinking?`${SIDE[game.turn]} AI 思考中`:`轮到${SIDE[game.turn]}落子`;detail=game.variant==='jieqi'?'暗子走后翻开，可能成为对方的棋子。':'点击己方棋子，再点击落点。';if(game.result.status==='ended')detail=REASON[game.result.reason]||'对局结束';else if(selected!==null){const p=game.board[selected];detail=p.covered?`已选暗子：第一手按${name(p)}走。揭开前不知道身份。`:`已选${SIDE[p.side]}${name(p)}，圆点标出合法落点。`}else if(paused)detail='可以继续对弈、悔棋，或让 AI 走一步。';else if(inCheck(game,game.turn))detail='将军！请应对将帅受到的攻击。'}if(statusOverride){title='需要处理';detail=statusOverride}$('status-title').textContent=title;$('status-detail').textContent=detail;
  $('engine-label').textContent=session.variant==='standard'?'Pikafish 2026-09-06':'本地混揭概率搜索';$('engine-stat').textContent=lastEngine?(lastEngine.iterations!==undefined?`${lastEngine.iterations.toLocaleString()} 次推演 · ${(lastEngine.timeMs/1000).toFixed(1)}s`:`深度 ${lastEngine.depth} · ${(lastEngine.timeMs/1000).toFixed(1)}s`):session.variant==='standard'?'8 线程 · 512 MB':'只读公开信息';$('footnote').textContent=session.variant==='jieqi'?'混揭 AI · 暂无正式棋力评级':'饥荒主题 · 角色徽章棋子';$('ply-count').textContent=`第 ${Math.ceil(game.ply/2)} 回合 · ${game.ply} 手`;$('undo').disabled=states.length<2;$('pause').disabled=!started||game.result.status==='ended';$('pause').textContent=paused?'继续对弈':'暂停对弈';$('step').hidden=session.mode!=='ai-ai';$('step').disabled=!started||!paused||thinking||game.result.status==='ended';$('resign').disabled=!started||session.mode==='ai-ai'||game.result.status==='ended';$('export').disabled=!game.ply;
  renderAnalysis(analysis.getState(),{started,paused,mode:session.mode});
}
function renderHistory(){const list=$('move-list');list.replaceChildren();if(!game.ply)list.innerHTML='<p class="empty">风过棋盘，静候第一手。</p>';else for(let i=0;i<game.history.length;i+=2){const row=document.createElement('div');row.className='move-row';const num=document.createElement('span');num.textContent=String(i/2+1);row.append(num);for(let j=0;j<2;j++){const h=game.history[i+j],s=document.createElement('span');s.className=j===0?'red-move':'black-move';if(h){s.textContent=notation(h);s.title=`${squareName(h.move.from)} → ${squareName(h.move.to)}`;if(h.revealed){const t=document.createElement('small');t.textContent=`揭为${SIDE[h.revealed.side]}${name(h.revealed)}`;s.append(t)}}row.append(s)}list.append(row)}list.scrollTop=list.scrollHeight;$('captured-list').replaceChildren();const cap=game.history.filter(h=>h.captured).map(h=>h.captured);if(!cap.length)$('captured-list').textContent='暂无';for(const p of cap){const s=document.createElement('span');s.className=p.side;s.textContent=name(p);s.title=SIDE[p.side]+name(p);$('captured-list').append(s)}}
function render(){renderBoard();renderStatus();renderHistory();analysis.update(publicState(game))}
function toast(t){clearTimeout(toastTimer);$('toast').textContent=t;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3200)}
function playResult(){audio.play(!game.result.winner?'draw':session.mode==='human-ai'&&game.result.winner!==session.humanSide?'lose':'win')}
function execute(move){game=applyMove(game,move);states.push(game);selected=null;const last=game.history.at(-1);revealSquare=last.revealed?move.to:-1;statusOverride='';if(game.result.status==='ended')playResult();else audio.play(inCheck(game,game.turn)?'check':last.captured?'capture':last.revealed?'reveal':'move');render();revealSquare=-1;if(game.result.status==='ended'){paused=false;renderStatus()}else scheduleAI()}
function clickSquare(i){if(!started||screen!=='game')return;if(paused||thinking||game.result.status==='ended'||isAI(game.turn))return;const p=game.board[i];if(selected!==null){const m=currentMoves.find(m=>m.from===selected&&m.to===i);if(m){execute(m);return}}if(p?.side===game.turn){selected=selected===i?null:i;if(selected!==null)audio.play('select');renderBoard();renderStatus()}else if(selected!==null){audio.play('invalid');toast('这个落点不能走，请选择标出的落点。')}}
async function stopSearch(){epoch++;clearTimeout(timer);timer=null;if(worker){worker.terminate();worker=null}if(cancelWorker){cancelWorker();cancelWorker=null}thinking=false;thinkStarted=0;$('thinking-time').textContent='';if(window.chessAPI)await window.chessAPI.engineStop().catch(()=>{})}
function scheduleAI(){clearTimeout(timer);if(screen==='game'&&started&&!paused&&!thinking&&game.result.status!=='ended'&&isAI(game.turn))timer=setTimeout(()=>runAI(),session.mode==='ai-ai'?350:180)}
async function runAI(single=false){if(screen!=='game'||thinking||!started||(!single&&paused)||game.result.status==='ended'||!isAI(game.turn))return;const id=epoch,turn=game.turn,analysisSnapshot=publicState(game);thinking=true;statusOverride='';thinkStarted=performance.now();renderStatus();try{const difficulty=level(turn);let move,analysisData;if(game.variant==='standard'){if(!window.chessAPI)throw new Error('请使用「启动象棋」打开桌面应用，本地皮卡鱼需要桌面运行环境。');const data=await window.chessAPI.engineMove({moves:game.history.map(h=>toUci(h.move)),difficulty,seconds:session.seconds});if(id!==epoch)return;analysisData=data;move=fromUci(data.move);lastEngine={depth:data.depth,timeMs:data.timeMs}}else{const data=await new Promise((resolve,reject)=>{worker=new Worker(new URL('./core/ai-worker.mjs',import.meta.url),{type:'module'});cancelWorker=()=>reject(Object.assign(new Error('已取消'),{code:'ENGINE_CANCELLED'}));worker.onmessage=e=>{if(e.data.id!==id)return;worker?.terminate();worker=null;cancelWorker=null;e.data.error?reject(new Error(e.data.error)):resolve(e.data.result)};worker.onerror=()=>{worker?.terminate();worker=null;cancelWorker=null;reject(new Error('揭棋 AI 启动失败，请重新开局。'))};const timeMs=difficulty==='custom'?session.seconds*1000:difficulty==='expert'?3000:({easy:150,medium:600,hard:1800}[difficulty]||600);worker.postMessage({id,state:publicState(game),options:{difficulty:['expert','custom'].includes(difficulty)?'hard':difficulty,timeMs,seed:crypto.getRandomValues(new Uint32Array(1))[0]}})});if(id!==epoch)return;analysisData=data;move=data.move;lastEngine={iterations:data.stats.iterations,timeMs:data.stats.elapsedMs}}if(!move||!legalMoves(game).some(m=>m.from===move.from&&m.to===move.to))throw new Error('AI 没有返回合法走法，已暂停。');analysis.ingest(analysisData,analysisSnapshot);thinking=false;thinkStarted=0;$('thinking-time').textContent='';execute(move)}catch(e){if(id!==epoch||e.code==='ENGINE_CANCELLED')return;thinking=false;paused=true;statusOverride=e.message;renderStatus()}}
function readConfig(){config.humanSide=$('human-side').value;config.redLevel=$('red-level').value;config.blackLevel=$('black-level').value;config.seconds=Number($('seconds').value);try{localStorage.setItem('wild-chess-settings',JSON.stringify(config))}catch{}}
function renderConfig(){
  document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('selected',b.dataset.mode===config.mode);b.setAttribute('aria-pressed',String(b.dataset.mode===config.mode))});
  const ha=config.mode==='human-ai',aa=config.mode==='ai-ai';
  $('human-side-field').hidden=!ha;
  $('red-level-field').hidden=!(aa||(ha&&config.humanSide==='black'));
  $('black-level-field').hidden=!(aa||(ha&&config.humanSide==='red'));
  $('seconds-field').hidden=!((!$('red-level-field').hidden&&config.redLevel==='custom')||(!$('black-level-field').hidden&&config.blackLevel==='custom'));
  $('setup-title').textContent=variantName(config.variant);
  $('variant-description').textContent=config.variant==='standard'?'明棋对弈，车马炮各展其长。':'将帅明置，红黑混洗，走后揭晓。';
  $('setup-rule-note').textContent=config.variant==='standard'?'遵循经典象棋走法。将死或困毙对手，即可赢下这一局。':'暗子先按原位置的棋种走。翻开后，棋子也可能归对方所有。';
  $('mode-description').textContent=ha?'选好执子方和对手难度，随时可以悔棋练习。':aa?'为红黑双方分别设置难度，入局后可暂停或逐步观战。':'两位棋手在同一台电脑轮流落子，红方先行。';
  $('options-title').textContent=config.mode==='human-human'?'双人对局':'对手与难度';
  $('difficulty-note').textContent=config.mode==='human-human'?'无需设置 AI 难度。邀请身边的朋友，准备好就开局。':config.variant==='standard'?'难度越高，AI 思考越充分。「全力」每步约 3 秒。':'难度决定推演时间，越高思考越充分。混揭 AI 暂无正式棋力评级。';
  $('start-summary').textContent=variantName(config.variant)+' · '+modeName(config.mode)+(ha?' · 你执'+SIDE[config.humanSide]:'');
  $('resume-setup').hidden=!started;
  const art=config.variant==='standard'?[{side:'red',type:'k'},{side:'black',type:'k'}]:[{covered:true},{side:'red',type:'k'}];
  $('setup-art').replaceChildren(...art.map(renderArt));
}
function showScreen(next,focus=true){
  navigationEpoch++;
  screen=next;
  analysis.setActive(next==='game');
  for(const name of ['home','setup','game'])$(name+'-screen').hidden=name!==next;
  $('menu-open').hidden=next!=='game';
  clearTimeout(toastTimer);$('toast').hidden=true;
  if(next==='home')renderHome();
  if(focus)$(next==='home'?'home-title':next==='setup'?'setup-title':'board').focus({preventScroll:true});
}
function renderSession(){
  $('session-variant').textContent=variantName(session.variant);
  $('session-mode').textContent=modeName(session.mode)+(session.mode==='human-ai'?' · 你执'+SIDE[session.humanSide]:'');
  $('session-detail').textContent=session.mode==='human-human'?'两位棋手在同一台电脑上轮流落子。':session.mode==='ai-ai'?'红黑双方轮流思考，可暂停或让 AI 走一步。':'难度 '+(LEVELS.find(l=>l[0]===level(session.humanSide==='red'?'black':'red'))?.[1]||'进阶')+' · 可悔棋练习';
}
function renderHome(){
  $('resume-panel').hidden=!started;
  if(!started)return;
  const ended=game.result.status==='ended';
  $('resume-title').textContent=ended?'上一局已结束，可以回看棋盘。':'棋局尚在，等你回来。';
  $('resume-detail').textContent=variantName(session.variant)+' · '+modeName(session.mode)+' · 已走 '+game.ply+' 手'+(ended?'':' · 暂停中');
  $('resume-game').textContent=ended?'查看棋局 →':'继续对局 →';
}
function openHome(){
  if(screen==='game'){
    resumePaused=paused;paused=true;selected=null;
    navigationStop=stopSearch();
    renderStatus();
  }
  showScreen('home');
}
async function resumeGame(){
  if(!started)return;
  const request=++navigationEpoch;
  await navigationStop;
  if(request!==navigationEpoch)return;
  paused=game.result.status==='ended'?false:resumePaused;
  showScreen('game');render();renderSession();scheduleAI();
}
$('menu-open').onclick=openHome;$('new-setup').onclick=openHome;$('home-back').onclick=openHome;
$('resume-game').onclick=resumeGame;$('resume-setup').onclick=resumeGame;
function confirmAction(title,text){$('confirm-title').textContent=title;$('confirm-text').textContent=text;$('confirm-dialog').showModal();return new Promise(resolve=>{const finish=v=>{$('confirm-dialog').close();$('confirm-ok').onclick=null;$('confirm-cancel').onclick=null;$('confirm-dialog').oncancel=null;resolve(v)};$('confirm-ok').onclick=()=>finish(true);$('confirm-cancel').onclick=()=>finish(false);$('confirm-dialog').oncancel=e=>{e.preventDefault();finish(false)}})}
async function newGame(force=false){
  if(starting)return;
  const request=++navigationEpoch;
  readConfig();const nextSession=force?{...session}:{...config};
  starting=true;$('start').disabled=true;
  try{
    if(!force&&started&&game.ply>0&&game.result.status!=='ended'&&!await confirmAction('开始新局','当前棋局将结束。可以取消并返回棋局，先导出棋谱保存。'))return;
    await navigationStop;
    if(request!==navigationEpoch)return;
    await stopSearch();
    if(request!==navigationEpoch)return;
    clearTimeout(toastTimer);$('toast').hidden=true;
    session=nextSession;
    analysis.reset();
    game=createGame({variant:session.variant});states=[game];started=true;paused=false;resumePaused=false;selected=null;lastEngine=null;statusOverride='';
    flipped=session.mode==='human-ai'&&session.humanSide==='black';
    showScreen('game');render();renderSession();audio.play('start');scheduleAI();
  }finally{starting=false;$('start').disabled=false}
}
async function undo(){
  if(undoing||states.length<2||screen!=='game')return;
  undoing=true;const before=game,navigation=navigationEpoch;
  try{
    await stopSearch();
    if(game!==before||navigation!==navigationEpoch||states.length<2)return;
    states.pop();game=states.at(-1);
    if(session.mode==='human-ai')while(states.length>1&&game.turn!==session.humanSide){states.pop();game=states.at(-1)}
    selected=null;statusOverride='';lastEngine=null;if(session.mode==='ai-ai')paused=true;
    audio.play('undo');render();scheduleAI();
  }finally{undoing=false}
}
document.querySelectorAll('[data-start-variant]').forEach(b=>b.onclick=()=>{config.variant=b.dataset.startVariant;readConfig();renderConfig();showScreen('setup')});
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{config.mode=b.dataset.mode;readConfig();renderConfig()});
for(const id of ['human-side','red-level','black-level','seconds'])$(id).onchange=()=>{readConfig();renderConfig();audio.play('click')};
$('start').onclick=()=>newGame();$('again').onclick=()=>newGame(true);$('undo').onclick=undo;$('flip').onclick=()=>{flipped=!flipped;renderBoard();renderStatus()};
$('pause').onclick=async()=>{if(paused){paused=false;statusOverride='';renderStatus();scheduleAI()}else{paused=true;await stopSearch();renderStatus()}};$('step').onclick=()=>runAI(true);
$('resign').onclick=async()=>{const side=session.mode==='human-ai'?session.humanSide:game.turn;if(!await confirmAction('认输',SIDE[side]+'确认认输并结束此局？'))return;await stopSearch();game={...game,result:{status:'ended',winner:side==='red'?'black':'red',reason:'resignation'}};states[states.length-1]=game;paused=false;playResult();render()};
function renderSound(){
  $('sound').textContent=audio.enabled?'音效开':'音效关';
  $('sound').setAttribute('aria-pressed',String(audio.enabled));
  $('sound').title=audio.enabled?'关闭游戏音效':'开启游戏音效';
  $('sound-volume').value=String(Math.round(audio.volume*100));
  $('sound-volume-value').textContent=Math.round(audio.volume*100)+'%';
  $('sound-setting-status').textContent=!audio.enabled?'当前已静音':audio.volume===0?'音量为 0':'轻柔单次落子';
  $('sound-dialog-toggle').textContent=audio.enabled?'关闭音效':'开启音效';
  $('sound-preview').disabled=!audio.enabled||audio.volume===0;
}
$('sound').onclick=()=>{audio.setEnabled(!audio.enabled);renderSound();if(audio.enabled)audio.play('move')};
$('sound-dialog-toggle').onclick=()=>{audio.setEnabled(!audio.enabled);renderSound()};
$('sound-volume').oninput=()=>{audio.setVolume(Number($('sound-volume').value)/100);renderSound()};
$('sound-preview').onclick=()=>audio.play('move');
$('analysis-toggle').onclick=()=>analysis.setEnabled(!analysis.getState().enabled);
$('analysis-deep').onclick=async()=>{
  const navigation=navigationEpoch,before=game;
  if(game.result.status==='ended')return;
  if(!paused&&session.mode!=='human-human'){paused=true;await stopSearch();renderStatus()}
  if(screen==='game'&&game===before&&navigation===navigationEpoch&&(paused||session.mode==='human-human'))analysis.deep();
};

document.addEventListener('click',e=>{const button=e.target.closest('button');if(button&&!button.disabled&&!button.classList.contains('square')&&!['sound','start','again','undo','step','confirm-ok'].includes(button.id))audio.play('click')},true);
for(const [open,dialog]of [['rules-open','rules-dialog'],['gallery-open','gallery-dialog'],['analysis-help','analysis-dialog'],['sound-settings-open','sound-dialog']])$(open).onclick=()=>$(dialog).showModal();
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
for(const id of ['rules-dialog','gallery-dialog','analysis-dialog','sound-dialog'])$(id).onclick=e=>{if(e.target===$(id)){const r=$(id).getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$(id).close()}};
function localDateStamp(date=new Date()){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-')}
$('export').onclick=()=>{const data={format:'wild-xiangqi-public-v1',savedAt:new Date().toISOString(),settings:session,rules:game.rules,result:game.result,moves:game.history.map(h=>({...h,notation:notation(h),uci:toUci(h.move)})),position:publicState(game)};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`荒野象棋-${game.variant}-${localDateStamp()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);toast('棋谱已导出，不包含尚未揭开的真实身份。')};
setInterval(()=>{if(thinking&&thinkStarted)$('thinking-time').textContent=((performance.now()-thinkStarted)/1000).toFixed(1)+'s'},200);
window.addEventListener('beforeunload',()=>{audio.dispose();analysis.dispose();worker?.terminate();window.chessAPI?.engineStop().catch(()=>{})});
for(const [id,pieces]of [
  ['home-standard-art',[{side:'red',type:'n'},{side:'red',type:'k'},{side:'black',type:'c'}]],
  ['home-jieqi-art',[{side:'black',type:'k'},{covered:true},{side:'red',type:'p'}]]
])$(id).replaceChildren(...pieces.map(renderArt));
$('board').tabIndex=-1;
renderConfig();render();renderSound();showScreen('home',false);
export const getPublicGame=()=>publicState(game);
export const getSessionInfo=()=>({started,paused,thinking,epoch,screen,session:{...session},audio:audio.getState()});
export const getAudioState=()=>audio.getState();
export const getAnalysisState=()=>analysis.getState();
