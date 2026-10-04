// Analysis is independent of the playing engine and only receives public boards.
const STORAGE_KEY = 'wild-chess-analysis-enabled';
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const uciMove = move => {
  const square = i => String.fromCharCode(97 + i % 9) + (9 - Math.floor(i / 9));
  return square(move.from) + square(move.to);
};
const pathOf = state => state.history.map(h => JSON.stringify({move:h.move,revealed:h.revealed,captured:h.captured}));

export function normalizeStandard(data, state) {
  const sign = state.turn === 'red' ? 1 : -1;
  const raw = data.wdl;
  const validWdl = raw && raw.perspective === 'sideToMove' && raw.scale === 1000 &&
    [raw.win,raw.draw,raw.loss].every(n => Number.isFinite(n) && n >= 0 && n <= 1000) &&
    raw.win + raw.draw + raw.loss === 1000;
  const wdl = validWdl ? {red:state.turn==='red'?raw.win:raw.loss,draw:raw.draw,black:state.turn==='red'?raw.loss:raw.win,scale:1000} : null;
  const score = data.score?.perspective === 'sideToMove' && ['cp','mate'].includes(data.score.type) && Number.isFinite(data.score.value)
    ? {...data.score,value:data.score.value*sign,perspective:'red',...(data.score.bound&&sign<0?{bound:data.score.bound==='lowerbound'?'upperbound':'lowerbound'}:{})} : null;
  // No substitute probability formula when the engine supplies no WDL.
  return {kind:'standard',ply:state.ply,turn:state.turn,wdl,score,rawScore:data.score??null,rawWdl:raw??null,
    trend:wdl?(wdl.red+wdl.draw/2)/10:null,depth:data.depth??0,timeMs:data.timeMs??0,
    suggestion:data.pv?.[0]??data.move??null,source:'Pikafish WDL',terminal:false};
}

export function normalizeJieqi(data,state) {
  const score = Number.isFinite(data.score) ? clamp(data.score,-1,1)*(state.turn==='red'?1:-1) : null;
  return {kind:'jieqi',ply:state.ply,turn:state.turn,wdl:null,score:null,rawScore:data.score??null,
    advantage:score===null?null:score*100,trend:score===null?null:50+score*50,
    iterations:data.stats?.iterations??0,timeMs:data.stats?.elapsedMs??0,
    suggestion:data.move??null,source:'公开信息概率推演',terminal:false};
}

function terminalRecord(state) {
  const winner=state.result.winner;
  return {kind:state.variant,ply:state.ply,turn:state.turn,terminal:true,winner,
    wdl:{red:winner==='red'?1000:0,draw:winner?0:1000,black:winner==='black'?1000:0,scale:1000},
    trend:winner==='red'?100:winner==='black'?0:50,source:'实际结果',suggestion:null};
}

export function createPositionAnalysis({api,onChange=()=>{},formatMove=()=>'',storage=globalThis.localStorage}={}) {
  let enabled=true;
  try{enabled=storage?.getItem(STORAGE_KEY)!=='false'}catch{}
  let active=false,position=null,path=[],generation=0,requestId=0,busy=false,error='',requestPly=null;
  let worker=null,cancelWorker=null,timer=null,stopBarrier=Promise.resolve(),disposed=false;
  const history=new Map();
  const emit=()=>onChange(getState());
  function getState(){
    const points=[...history.values()].sort((a,b)=>a.ply-b.ply);
    const current=points.at(-1)??null;
    return structuredClone({enabled,active,busy,generation,requestPly,currentPly:position?.ply??0,
      variant:position?.variant??'standard',current,history:points,error});
  }
  function cancel(){
    requestId++;clearTimeout(timer);timer=null;
    if(worker){worker.terminate();worker=null}
    if(cancelWorker){cancelWorker();cancelWorker=null}
    busy=false;requestPly=null;
    // Stop requests are serialized so one cannot arrive after a newer search.
    stopBarrier=stopBarrier.then(()=>api?.analysisStop?.()).catch(()=>{});
  }
  function addRecord(record,snapshot){
    if(record.suggestion){try{record.suggestionText=formatMove(snapshot,record.suggestion)}catch{record.suggestionText=''}}
    history.set(record.ply,record);
  }
  function queue(delay=180){
    clearTimeout(timer);timer=null;
    if(disposed||!active||!enabled||!position||busy||position.result.status==='ended'||history.has(position.ply))return;
    timer=setTimeout(()=>{timer=null;void run(1)},delay);
  }
  async function run(seconds=1){
    if(disposed||!active||!enabled||!position||busy||position.result.status==='ended')return;
    const id=++requestId,gen=generation,snapshot=position;
    busy=true;error='';requestPly=snapshot.ply;emit();
    try{
      await stopBarrier;
      if(id!==requestId||gen!==generation||!active||!enabled)return;
      let data;
      if(snapshot.variant==='standard'){
        if(!api?.analysisEvaluate)throw new Error('本地分析引擎不可用，请重新打开桌面应用。');
        data=await api.analysisEvaluate({moves:snapshot.history.map(h=>uciMove(h.move)),seconds});
      }else{
        data=await new Promise((resolve,reject)=>{
          const running=new Worker(new URL('./core/ai-worker.mjs',import.meta.url),{type:'module'});worker=running;
          cancelWorker=()=>reject(Object.assign(new Error('分析已取消'),{code:'ENGINE_CANCELLED'}));
          running.onmessage=e=>{if(e.data.id!==id)return;running.terminate();if(worker===running){worker=null;cancelWorker=null}e.data.error?reject(new Error(e.data.error)):resolve(e.data.result)};
          running.onerror=()=>{running.terminate();if(worker===running){worker=null;cancelWorker=null}reject(new Error('揭棋分析启动失败。'))};
          running.postMessage({id,state:snapshot,options:{difficulty:'hard',timeMs:seconds===3?3000:700,seed:0xA11CE+snapshot.ply}});
        });
      }
      if(id!==requestId||gen!==generation||!active||!enabled)return;
      const record=snapshot.variant==='standard'?normalizeStandard(data,snapshot):normalizeJieqi(data,snapshot);
      const existing=history.get(snapshot.ply);
      if(!existing||record.depth===undefined||record.depth>=existing.depth)addRecord(record,snapshot);
    }catch(e){
      if(id!==requestId||gen!==generation||e.code==='ENGINE_CANCELLED')return;
      error=e.message||'本次分析失败，可以点击深入分析重试。';
    }finally{
      if(id===requestId&&gen===generation){
        busy=false;requestPly=null;emit();
        // Fast selfplay may have advanced. Finish a valid old snapshot, then
        // analyze the newest position; do not cancel every 350 ms forever.
        if(position?.ply!==snapshot.ply)queue(100);
      }
    }
  }
  function update(next){
    const nextPath=pathOf(next);
    const rewind=next.ply<path.length||path.some((step,i)=>nextPath[i]!==step);
    if(rewind){
      generation++;cancel();
      let common=0;while(common<path.length&&common<nextPath.length&&path[common]===nextPath[common])common++;
      for(const ply of history.keys())if(ply>common)history.delete(ply);
    }
    position=next;path=nextPath;error='';
    if(next.result.status==='ended'){cancel();addRecord(terminalRecord(next),next)}
    else if(history.get(next.ply)?.terminal)history.delete(next.ply);
    emit();queue();
  }
  function ingest(data,snapshot){
    if(!enabled||!active||!position||snapshot.variant!==position.variant||snapshot.ply>position.ply)return;
    const prefix=pathOf(snapshot);
    if(prefix.some((step,i)=>path[i]!==step))return;
    const record=snapshot.variant==='standard'?normalizeStandard(data,snapshot):normalizeJieqi(data,snapshot);
    const existing=history.get(record.ply);
    if(!existing||(!existing.terminal&&(record.depth??0)>(existing.depth??0)))addRecord(record,snapshot);
    emit();
  }
  function reset(){generation++;cancel();history.clear();position=null;path=[];error='';emit()}
  function setActive(value){active=Boolean(value);if(!active)cancel();emit();queue()}
  function setEnabled(value){enabled=Boolean(value);try{storage?.setItem(STORAGE_KEY,String(enabled))}catch{}if(!enabled)cancel();emit();queue()}
  function deep(){if(!enabled)setEnabled(true);cancel();void run(3)}
  function dispose(){disposed=true;active=false;cancel()}
  return {update,ingest,reset,setActive,setEnabled,deep,getState,dispose};
}
