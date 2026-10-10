/* Browser + Node: gameplay has no DOM dependency. See README for rule provenance. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TrainGame = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const RULES = Object.freeze({
    traction: Object.freeze([-6, -5, -4, -1, 2, 3, 4]),
    heatPerShift: .25, cooling: .05, overheatSeconds: 3, overheatPenalty: 200,
    // User calibration: net acceleration ±0.5 means needle motion ±6 degrees/s.
    // Linear 180-degree gauge with 120 km/h display range: 12 * 120 / 180 = 8.
    needleDegreesPerAcceleration: 12,
    blueResponseFactor: .5,
    accelerationScale: 12 * 120 / 180, maxSpeed: 120, scoreStep: 5, pointsPerMeter: 1,
    dockingDistance: 300, dockingTolerance: 5, dockingPoints: 200,
    stopSpeed: .3, overshootDistance: 35, approachDistance: 80,
    scenePixelsPerMeter: 8
  });
  // Trial level, not recovered official level data. All environments are from the design table.
  const ROUTE = Object.freeze([
    { from: 0, to: 240, name: '车站出发', environment: 0, low: null, high: null },
    { from: 240, to: 640, name: '缓坡巡行', environment: -2.5, low: 53, high: 84, leadDistance: 180 },
    { from: 640, to: 1000, name: '提速准备', transition: true, environment: 4.5, low: null, high: null },
    { from: 1000, to: 1480, name: '下坡快行', environment: 4.5, low: 85, high: 108, leadDistance: 300 },
    { from: 1480, to: 1950, name: '减速准备', transition: true, environment: -2.5, low: null, high: null },
    { from: 1950, to: 2180, name: '缓坡慢行', environment: -2.5, low: 20, high: 52, leadDistance: 400 },
    { from: 2180, to: 2800, name: '坡道转场', transition: true, environment: -3.5, low: null, high: null },
    { from: 2800, to: 3320, name: '上坡巡行', environment: -3.5, low: 53, high: 84, leadDistance: 400 },
    { from: 3320, to: 3690, name: '站前减速', transition: true, environment: -2.5, low: null, high: null },
    { from: 3690, to: 3900, name: '站前慢行', environment: -2.5, low: 20, high: 52, leadDistance: 300 },
    { from: 3900, to: 4200, name: '进站停靠', transition: true, environment: 0, low: null, high: null }
  ].map(Object.freeze));
  const LENGTH = ROUTE[ROUTE.length - 1].to;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  // Shared display calibration: color arcs, needle and linear marker use these bounds.
  const SPEED_BANDS = Object.freeze([
    {from:0,to:53,color:'#74bec9'}, {from:53,to:85,color:'#98bfa4'},
    {from:85,to:109,color:'#d9a76a'}, {from:109,to:RULES.maxSpeed,color:'#d97b72'}
  ].map(Object.freeze));
  function speedFraction(speed) { return clamp(speed / RULES.maxSpeed, 0, 1); }
  function accelerationAt(speed, net) {
    const blue=speed<53||(speed===53&&net<0);
    return net*RULES.accelerationScale*(blue?RULES.blueResponseFactor:1);
  }
  function stoppingDistance(speed, net) {
    if(net>=0)return Infinity;
    const blueSpeed=Math.min(speed,53),normalBrake=-net*RULES.accelerationScale;
    return (speed*speed-blueSpeed*blueSpeed)/(2*normalBrake*3.6)
      +blueSpeed*blueSpeed/(2*normalBrake*RULES.blueResponseFactor*3.6);
  }
  function advanceMotion(speed, net, seconds) {
    let distance=0,remaining=seconds;
    // Split exactly at the blue boundary and at a stop; speed/position stay continuous.
    while(remaining>1e-10) {
      const acceleration=accelerationAt(speed,net);
      if(speed<=0&&acceleration<=0)break;
      let duration=remaining;
      if(acceleration>0&&speed<53)duration=Math.min(duration,(53-speed)/acceleration);
      else if(acceleration<0&&speed>53)duration=Math.min(duration,(53-speed)/acceleration);
      else if(acceleration<0)duration=Math.min(duration,-speed/acceleration);
      const next=Math.max(0,speed+acceleration*duration);
      distance+=(speed+next)/2/3.6*duration;
      speed=Math.abs(next-53)<1e-9?53:next;
      remaining-=duration;
    }
    return {speed,distance};
  }
  function speedStatus(speed, section) {
    return !isLimited(section)?'不限速':speed<section.low?'低于限速':speed>section.high?'超速':'速度合规';
  }
  function sectionAt(position) {
    return ROUTE.find(s => position < s.to) || ROUTE[ROUTE.length - 1];
  }
  function isLimited(section) { return Number.isFinite(section.low) && Number.isFinite(section.high); }
  function sectionColor(section) {
    return !isLimited(section)?'#99adb6':section.high<=52?'#74bec9':section.high<=84?'#98bfa4':section.high<=108?'#d9a76a':'#d97b72';
  }
  function approachAt(position) {
    const section=ROUTE.find(r=>isLimited(r)&&r.from>position);
    if(!section||section.from-position>(section.leadDistance||RULES.approachDistance))return null;
    return {section,distance:section.from-position,color:sectionColor(section)};
  }
  // Screen Y grows downward: a positive downhill force makes the track descend to the right.
  // Visual inclination is a calibration, not a claim about the original game's physical slope.
  function terrainSlope(section) {
    const e=section.environment;
    return Math.sign(e)*Math.min(.22,.12*Math.sqrt(Math.abs(e)));
  }
  function terrainAt(position) {
    let height=0;
    for(const section of ROUTE) {
      height+=Math.max(0,Math.min(position,section.to)-section.from)*terrainSlope(section)*RULES.scenePixelsPerMeter;
      if(position<section.to)break;
    }
    return {height,slope:terrainSlope(sectionAt(position))};
  }
  function createState() {
    return { phase: 'ready', gear: 0, speed: 0, position: 0, heat: 0, lock: 0,
      elapsed: 0, score: 0, distanceScore: 0, dockScore: 0, penalties: 0,
      legalDistance: 0, pendingDistance: 0, shifts: 0, overheats: 0,
      acceleration: 0, result: null, notice: '', noticeUntil: 0, routeIndex: 0, sectionHint: null };
  }
  function start(s) { Object.assign(s, createState(), { phase: 'running' }); }
  function notify(s, text, seconds = 3) { s.notice = text; s.noticeUntil = s.elapsed + seconds; }
  function shift(s, direction) {
    if (s.phase !== 'running' || s.lock > 0 || (direction !== 1 && direction !== -1)) return false;
    const next = clamp(s.gear + direction, -3, 3);
    if (next === s.gear) return false;
    s.gear = next; s.shifts++;
    s.heat = Math.min(1, s.heat + RULES.heatPerShift);
    if (s.heat >= 1 - 1e-9) {
      s.gear = 0; s.lock = RULES.overheatSeconds; s.overheats++;
      const deducted=Math.min(s.score,RULES.overheatPenalty);
      s.penalties += deducted; s.score -= deducted;
      notify(s, `轴温过热 · −${Math.round(deducted)} 分 · 空档冷却`);
    }
    return true;
  }
  function finish(s, missed = false) {
    s.phase = 'finished';
    // Flush the last incomplete distance quantum, so discretization never loses earned distance.
    s.distanceScore += s.pendingDistance * RULES.pointsPerMeter;
    s.score += s.pendingDistance * RULES.pointsPerMeter; s.pendingDistance = 0;
    const error = Math.abs(s.position - LENGTH);
    s.dockScore = missed ? 0 : Math.round(RULES.dockingPoints * clamp(1 - error / RULES.dockingTolerance, 0, 1));
    s.score += s.dockScore;
    s.result = { missed, error, inTarget: !missed && error <= RULES.dockingTolerance };
  }
  function addDistance(s, from, to, speed) {
    // Split at route boundaries; a transition cannot award the previous segment's speed band.
    let legal = 0;
    for (const section of ROUTE) {
      const metres = Math.max(0, Math.min(to, section.to) - Math.max(from, section.from));
      if (isLimited(section) && speed >= section.low && speed <= section.high) legal += metres;
    }
    s.legalDistance += legal; s.pendingDistance += legal;
    const points = Math.floor((s.pendingDistance + 1e-9) / RULES.scoreStep) * RULES.scoreStep;
    s.pendingDistance = Math.max(0, s.pendingDistance - points);
    s.distanceScore += points * RULES.pointsPerMeter; s.score += points * RULES.pointsPerMeter;
  }
  function integrate(s, dt) {
    const before = s.position, section = sectionAt(before), oldSpeed = s.speed;
    s.elapsed += dt;
    if (s.lock > 0) {
      s.lock = Math.max(0, s.lock - dt);
      s.heat = s.lock / RULES.overheatSeconds;
      if (s.lock < 1e-9) { s.lock = 0; s.heat = 0; notify(s, '冷却完成 · 可以换挡'); }
    } else s.heat = Math.max(0, s.heat - RULES.cooling * dt);
    const net=RULES.traction[s.gear + 3] + section.environment;
    // The gauge range is display calibration, not a physical speed restriction.
    const motion=advanceMotion(oldSpeed,net,dt);
    s.speed=motion.speed;s.position+=motion.distance;
    s.acceleration=accelerationAt(s.speed,net);
    addDistance(s, before, s.position, (oldSpeed + s.speed) / 2);
    const entered=sectionAt(s.position), index=ROUTE.indexOf(entered);
    if(index!==s.routeIndex) {
      s.routeIndex=index;
      s.sectionHint={ text:isLimited(entered)?`进入${entered.name}限速段 · ${entered.low}–${entered.high} km/h`:`${entered.name} · ${entered.to-entered.from} m 不限速`,
        color:sectionColor(entered), until:s.elapsed+4 };
    }
    // Evaluate only on an actual stop, never simply on entering the approach bar.
    if (s.position >= LENGTH - RULES.dockingTolerance && s.speed <= RULES.stopSpeed && s.acceleration <= 0) finish(s);
    else if (s.position >= LENGTH + RULES.overshootDistance) finish(s, true);
  }
  function update(s, dt) {
    if (s.phase !== 'running' || !Number.isFinite(dt) || dt <= 0) return;
    // Stable substeps, real elapsed seconds: no hidden 2x fast-forward.
    let remaining = dt;
    while (remaining > 1e-9 && s.phase === 'running') {
      const substep = Math.min(remaining, 1 / 120);
      integrate(s, substep); remaining -= substep;
    }
  }
  return { RULES, ROUTE, LENGTH, SPEED_BANDS, speedFraction, speedStatus, accelerationAt, stoppingDistance, advanceMotion, createState, start, shift, update, sectionAt, isLimited, sectionColor, approachAt, terrainAt, addDistance };
});
