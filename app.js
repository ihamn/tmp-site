'use strict';
(() => {
  const G = TrainGame, s = G.createState(), $ = id => document.getElementById(id);
  const ctx = $('scene').getContext('2d'), art = $('train-art');
  const svgNS = 'http://www.w3.org/2000/svg';
  for(let i=0;i<=4;i++) {
    const a=(165+i*52.5)*Math.PI/180,line=document.createElementNS(svgNS,'line');
    for(const [key,value] of Object.entries({x1:56+39*Math.cos(a),y1:56+39*Math.sin(a),x2:56+49*Math.cos(a),y2:56+49*Math.sin(a),stroke:'#b7ccd0','stroke-width':1.5}))line.setAttribute(key,value);
    $('heat-ticks').append(line);
  }
  const polar = (deg,radius=110) => [130 + radius * Math.cos(deg * Math.PI / 180), 132 - radius * Math.sin(deg * Math.PI / 180)];
  for (const band of G.SPEED_BANDS) {
    const from = polar(180*(1-G.speedFraction(band.from))), to = polar(180*(1-G.speedFraction(band.to))), p = document.createElementNS(svgNS, 'path');
    p.setAttribute('d', `M ${from.join(' ')} A 110 110 0 0 1 ${to.join(' ')}`);
    p.setAttribute('stroke', band.color); p.setAttribute('stroke-width', '9'); p.setAttribute('fill', 'none');
    $('dial-bands').append(p);
  }
  for (let i=0;i<=12;i++) {
    const a=Math.PI-i*Math.PI/12, line=document.createElementNS(svgNS,'line');
    for(const [key,value] of Object.entries({x1:130+99*Math.cos(a),y1:132-99*Math.sin(a),x2:130+94*Math.cos(a),y2:132-94*Math.sin(a),stroke:'#a4b6bf','stroke-width':1})) line.setAttribute(key,value);
    $('dial-ticks').append(line);
  }
  for (const r of G.ROUTE) {
    const el=document.createElement('div'); el.className=`route-segment ${G.isLimited(r)?'limited':'unlimited'}${r.transition?' transition':''}`;
    el.style.left=`${r.from/G.LENGTH*100}%`;el.style.width=`${(r.to-r.from)/G.LENGTH*100}%`;
    el.style.setProperty('--segment-color',G.sectionColor(r));
    const speedLabel=G.isLimited(r)?`${r.low}–${r.high}`:'不限速';
    el.title=`${r.name} · ${r.from}–${r.to} m · ${speedLabel}${G.isLimited(r)?' km/h':''}`;
    el.setAttribute('aria-label',el.title);
    const label=document.createElement('span');label.textContent=r.transition?'':speedLabel;el.append(label);
    $('route-line').insertBefore(el,$('route-cursor'));
  }
  const clock = seconds => `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
  const signed = n => n>0?`+${n}`:String(n).replace('-','−');
  let last = performance.now(), paintedAt=0, shownPhase='ready', pauseText='';
  $('route-length').textContent=`雪原试行 · ${G.LENGTH} M`;
  function showOverlay() {
    $('overlay').hidden=false;
    $('intro').hidden=s.phase!=='ready'; $('results').hidden=s.phase!=='finished';
    $('brief-kicker').textContent=s.phase==='finished'?'行驶记录':'雪原试行';
    $('brief-title').textContent=s.phase==='paused'?'行驶已暂停':s.phase==='finished'?(s.result.inTarget?'列车已稳稳停靠':s.result.missed?'已驶过停车范围':'列车已停下'):'把列车稳稳开到站';
    $('start').textContent=s.phase==='paused'?'继续行驶 →':s.phase==='finished'?'再跑一次 →':'开始行驶 →';
    $('brief-footnote').textContent=s.phase==='paused'?pauseText:'触屏点按升降档 · 键盘 ↑ / ↓ 或 W / S';
    if(s.phase==='finished') {
      $('results').replaceChildren();
      const rows=[['总得分',Math.round(s.score)],['合规距离',`${Math.round(s.legalDistance)} m`],['完美通过',`${s.perfectSections} 段 · +${s.perfectScore} 分`],['停靠得分',s.dockScore],['过热扣分',`−${s.penalties}`],['停靠偏差',s.result.missed?'驶过范围':`${s.result.error.toFixed(1)} m`],['行驶时间',clock(s.elapsed)]];
      const grid=document.createElement('div');grid.className='results';
      for(const [label,value] of rows) { const cell=document.createElement('div'),small=document.createElement('small'),strong=document.createElement('strong');small.textContent=label;strong.textContent=value;cell.append(small,strong);grid.append(cell); }
      $('results').append(grid);
    }
  }
  function renderHUD() {
    const section=G.sectionAt(s.position), index=G.ROUTE.indexOf(section), next=G.ROUTE[index+1];
    $('score').textContent=Math.round(s.score);$('time').textContent=clock(s.elapsed);
    $('speed').textContent=s.speed.toFixed(1);$('heat').textContent=Math.round(s.heat*100);
    $('gear').textContent=signed(s.gear);$('gear-description').textContent=s.lock>0?'冷却锁档':s.gear<0?'制动':s.gear>0?'牵引':'空档';
    const limited=G.isLimited(section);
    $('section-name').textContent=`当前 · ${section.name}`;
    $('target-speed').textContent=limited?`${section.low}–${section.high}`:'不限速';
    $('target-unit').hidden=!limited;$('target-range').toggleAttribute('hidden',!limited);
    if(limited){
      const low=180*(1-G.speedFraction(section.low)),high=180*(1-G.speedFraction(section.high));
      const outerLow=polar(low,119),outerHigh=polar(high,119),innerHigh=polar(high,101),innerLow=polar(low,101);
      $('target-range').setAttribute('d',`M ${outerLow.join(' ')} A 119 119 0 0 1 ${outerHigh.join(' ')} L ${innerHigh.join(' ')} A 101 101 0 0 0 ${innerLow.join(' ')} Z`);
    }
    const upcoming=section.transition?next:G.ROUTE.slice(index+1).find(r=>!r.transition);
    $('upcoming').textContent=upcoming?`${Math.max(0,Math.ceil(upcoming.from-s.position))} m 后 · ${upcoming.name} ${G.isLimited(upcoming)?`${upcoming.low}–${upcoming.high}`:'不限速'}`:'终点 · 停稳对位';
    const hint=s.sectionHint, showHint=s.phase!=='finished'&&(limited||(hint&&hint.until>s.elapsed));
    $('section-hint').hidden=!showHint;
    if(showHint){
      const label=limited?`${section.high<=52?'低速':section.high<=84?'中速':section.high<=108?'高速':'最高速'}限速区间 · ${section.low}–${section.high} km/h`:hint.text;
      if($('section-hint').textContent!==label)$('section-hint').textContent=label;
      $('section-hint').style.setProperty('--hint-color',G.sectionColor(section));
    }
    const approach=G.approachAt(s.position), showApproach=s.phase==='running'&&approach;
    $('approach-warning').hidden=!showApproach;
    if(showApproach){
      $('approach-word').style.color=approach.color;
      $('approach-distance').textContent=`${Math.ceil(approach.distance)} m · ${approach.section.low}–${approach.section.high} km/h`;
    }
    [...document.querySelectorAll('.route-segment')].forEach((el,i)=>el.classList.toggle('current',i===index));
    $('route-line').style.setProperty('--route-progress',`${Math.max(0,Math.min(100,s.position/G.LENGTH*100))}%`);
    const environment=G.environmentAt(s.position);
    $('scene-caption').textContent=`雪原线路 / ${section.name} · 环境贡献 ${signed(Number(environment.toFixed(1)))}`;
    const heatState=s.lock>0?'overheated':s.heat>=.75?'warning':'normal';
    $('heat-panel').dataset.state=heatState;
    $('heat-status').textContent=s.lock>0?`冷却锁档 ${s.lock.toFixed(1)} s`:s.heat>=.75?'温度偏高':'核心温度';
    $('heat-fill').setAttribute('stroke-dashoffset',(44*Math.PI*210/180)*(1-s.heat));
    $('heat-dial').setAttribute('aria-label',`核心温度 ${Math.round(s.heat*100)}%，${heatState==='normal'?'正常':heatState==='warning'?'偏高':'过热冷却'}`);
    $('game').classList.toggle('overheated',s.lock>0);
    const a=Math.PI*(1-G.speedFraction(s.speed));
    $('needle').setAttribute('x2',130+94*Math.cos(a));$('needle').setAttribute('y2',132-94*Math.sin(a));
    const net=G.accelerationAt(s.speed,G.RULES.traction[s.gear+3]+environment);
    const motion=s.phase==='paused'?'行驶暂停':s.phase!=='running'||s.speed<=0&&net<=0?'列车静止':net>0?'速度上升 ↗':net<0?'速度下降 ↘':s.speed>=G.RULES.maxSpeed?'已达最高速度':'速度持平';
    $('acceleration').textContent=`${G.speedStatus(s.speed,section)} · ${motion}`;
    $('needle').closest('svg').setAttribute('aria-label',`实际速度 ${s.speed.toFixed(1)} km/h，${G.speedStatus(s.speed,section)}，表盘量程 0–${G.RULES.maxSpeed} km/h`);
    $('distance').textContent=`${Math.floor(s.position)} / ${G.LENGTH} m`;$('route-cursor').style.left=`${Math.min(100,s.position/G.LENGTH*100)}%`;
    const active=s.phase==='running'&&s.lock===0;
    $('up').disabled=!active||s.gear===3;$('down').disabled=!active||s.gear===-3;$('pause').disabled=s.phase!=='running';
    $('docking').classList.toggle('visible',s.position>=G.LENGTH-G.RULES.dockingDistance&&s.phase!=='finished');
    const dist=G.LENGTH-s.position;
    $('dock-distance').textContent=dist>=0?`距停车点 ${Math.ceil(dist)} m`:`超过停车点 ${Math.floor(-dist)} m`;
    const dockSpan=G.RULES.dockingDistance+G.RULES.overshootDistance;
    $('dock-marker').style.left=`${Math.max(0,Math.min(100,(s.position-G.LENGTH+G.RULES.dockingDistance)/dockSpan*100))}%`;
    const dockTarget=document.querySelector('.dock-target');
    dockTarget.style.left=`${(G.RULES.dockingDistance-G.RULES.dockingTolerance)/dockSpan*100}%`;
    dockTarget.style.width=`${G.RULES.dockingTolerance*2/dockSpan*100}%`;
    $('notice').textContent=s.noticeUntil>s.elapsed?s.notice:s.phase==='running'&&s.speed<.3&&s.position<G.LENGTH-5?'升至正档牵引，让列车起步':s.phase==='running'&&dist<=G.RULES.dockingDistance&&dist>5?'提前减速，停在金框内':'';
    if(shownPhase!==s.phase) { shownPhase=s.phase; if(s.phase!=='running') showOverlay(); }
  }
  function begin() {
    if(s.phase==='paused') s.phase='running'; else G.start(s);
    shownPhase='running';$('overlay').hidden=true;last=performance.now();renderHUD();$('pause').focus({preventScroll:true});
  }
  function pause(reason='暂停期间，列车与计时均停止。') {
    if(s.phase!=='running')return;s.phase='paused';pauseText=reason;renderHUD();$('start').focus({preventScroll:true});
  }
  $('start').addEventListener('click',begin);
  $('up').addEventListener('click',()=>{G.shift(s,1);renderHUD();});
  $('down').addEventListener('click',()=>{G.shift(s,-1);renderHUD();});
  $('pause').addEventListener('click',()=>pause());
  addEventListener('keydown',e=>{
    const k=e.key.toLowerCase();
    if(['arrowup','arrowdown','w','s'].includes(k)) {e.preventDefault();if(!e.repeat){G.shift(s,k==='arrowup'||k==='w'?1:-1);renderHUD();}}
    else if(k==='escape'&&!e.repeat) { if(s.phase==='paused')begin();else pause(); }
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause('页面已切到后台，行驶自动暂停。');});
  function frame(now) {
    const dt=(now-last)/1000;last=now;
    // Long suspension must not silently drive past a station.
    if(dt>1&&s.phase==='running')pause('页面暂时停止响应，行驶已暂停。');
    else G.update(s,dt);
    if(now-paintedAt>=1000/30) {drawTrainScene(ctx,s,art.complete&&art.naturalWidth?art:null);renderHUD();paintedAt=now;}
    requestAnimationFrame(frame);
  }
  function resizeScene() {
    const bounds=$('scene').parentElement.getBoundingClientRect();
    if(bounds.width>0&&bounds.height>0){$('scene').width=960;$('scene').height=Math.max(120,Math.round(960*bounds.height/bounds.width));}
    drawTrainScene(ctx,s,art.complete&&art.naturalWidth?art:null);
  }
  if(typeof ResizeObserver==='function')new ResizeObserver(resizeScene).observe($('scene').parentElement);
  addEventListener('resize',resizeScene);
  art.addEventListener('load',resizeScene);
  art.addEventListener('error',()=>{$('notice').textContent='列车素材加载失败，请刷新页面';});
  resizeScene();renderHUD();requestAnimationFrame(frame);
})();
