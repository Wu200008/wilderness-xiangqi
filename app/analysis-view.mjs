const $=id=>document.getElementById(id);
const pct=n=>(n/10).toFixed(1)+'%';
const side=n=>n>0?'红方':'黑方';
const signed=n=>(n>0?'+':'')+n.toFixed(1);
function verdict(value){const v=Math.abs(value);return v<4?'局势接近':side(value)+(v<15?'略优':v<60?'占优':'明显占优')}
function trend(points,kind){
  const svg=$('analysis-trend');svg.replaceChildren();
  const make=(tag,attrs)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);svg.append(node);return node};
  make('line',{x1:3,y1:22,x2:277,y2:22,class:'midline'});
  const label=make('text',{x:3,y:19});label.textContent=kind==='jieqi'?'0':'50';
  const values=points.filter(p=>Number.isFinite(p.trend));
  const max=Math.max(1,...points.map(p=>p.ply));
  const xy=p=>[7+p.ply/max*266,40-p.trend/100*36];
  if(values.length){
    make('polyline',{points:values.map(p=>xy(p).join(',')).join(' '),class:'trend-line'});
    for(const p of values){const [cx,cy]=xy(p);const dot=make('circle',{cx,cy,r:values.length<30?2:1.2,class:'trend-dot'});const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=`第 ${p.ply} 手：${kind==='jieqi'?signed((p.trend-50)*2):p.trend.toFixed(1)+'%'}`;dot.append(title)}
  }
  svg.setAttribute('aria-label',values.length?`${kind==='jieqi'?'红方优势指数':'红方预期得分'}走势，${values.length} 个已分析局面`:'尚无分析走势');
}
export function renderAnalysis(state,{started=false,paused=false,mode='human-ai'}={}){
  const r=state.enabled?state.current:null,hidden=state.variant==='jieqi',wdl=r?.wdl;
  document.querySelector('.analysis-panel').classList.toggle('is-off',!state.enabled);
  $('analysis-toggle').textContent=state.enabled?'分析开':'分析关';
  $('analysis-toggle').setAttribute('aria-pressed',String(state.enabled));
  $('analysis-deep').disabled=!started||Boolean(r?.terminal);
  $('analysis-deep').textContent=mode==='human-human'||paused?'深入分析':'暂停并深入';
  $('analysis-deep').title='对当前局面分析约 3 秒';
  let headline=state.enabled?(state.busy?'正在分析…':'等待分析'):'分析已关闭';
  if(r?.terminal)headline=r.winner?(r.winner==='red'?'红方获胜':'黑方获胜'):'本局和棋';
  else if(wdl)headline=verdict((wdl.red-wdl.black)/10);
  else if(hidden&&r?.advantage!==null&&r?.advantage!==undefined)headline=verdict(r.advantage);
  else if(r?.score)headline=r.score.type==='mate'?'引擎发现杀棋':verdict(Math.tanh(r.score.value/300)*100);
  else if(state.error)headline='分析暂不可用';
  $('analysis-summary').textContent=headline;
  $('analysis-position').textContent=r?(r.ply?`第 ${r.ply} 手`:'初始局面')+(r.ply<state.currentPly?' · 较早局面':''):(state.busy?'请稍候':'');
  let widths=[0,0,0];
  if(wdl)widths=[wdl.red/10,wdl.draw/10,wdl.black/10];
  else if(hidden&&Number.isFinite(r?.advantage))widths=[50+r.advantage/2,0,50-r.advantage/2];
  ['red','draw','black'].forEach((key,i)=>{$('analysis-'+key).style.width=widths[i]+'%'});
  $('analysis-wdl').hidden=hidden&&!r?.terminal;
  $('analysis-index').hidden=!hidden||Boolean(r?.terminal);
  $('analysis-index').textContent=r&&Number.isFinite(r.advantage)?`红方优势指数 ${signed(r.advantage)} / 100`:'优势指数等待推演';
  for(const key of ['red','draw','black'])$('analysis-'+key+'-value').textContent=wdl?pct(wdl[key]):'—';
  $('analysis-bar').setAttribute('aria-label',wdl?`红胜 ${pct(wdl.red)}，和棋 ${pct(wdl.draw)}，黑胜 ${pct(wdl.black)}`:hidden&&Number.isFinite(r?.advantage)?`红方优势指数 ${signed(r.advantage)}，不是胜率`:'尚无胜和负数据');
  let score='';
  if(r?.score){const s=r.score;score=s.type==='mate'?`红方视角 M${s.value>0?'+':''}${s.value}`:`红方评估 ${s.value>0?'+':''}${(s.value/100).toFixed(2)}`;if(s.bound)score+='（界限）'}
  $('analysis-score').textContent=score;
  $('analysis-advice').textContent=r?.suggestionText?'参考 '+r.suggestionText:'';
  $('analysis-trend-label').textContent=hidden?'红方优势指数走势':'红方预期得分走势';
  trend(state.enabled?state.history:[],state.variant);
  let detail=!state.enabled?'已关闭分析，不再额外计算。':!started?'开始对局后自动分析。':state.error?state.error:r?.terminal?'本局实际结果。':hidden?'公开信息推演 · 指数不是胜率':'引擎胜和负估计 · 非个人实战胜率';
  if(state.enabled&&!state.error&&!r?.terminal&&started){
    if(state.busy)detail+=` · 正在分析第 ${state.requestPly} 手`;
    else if(r)detail+=hidden?` · ${r.iterations.toLocaleString()} 次推演`:` · 深度 ${r.depth}`;
    if(r&&!hidden&&!wdl)detail+=' · 暂无概率数据';
  }
  $('analysis-detail').textContent=detail;
}
