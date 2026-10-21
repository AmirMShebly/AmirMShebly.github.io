/* ============================================================================
   SIMULATION — owns the world: agents, traffic light, prediction, conflict
   detection, the interaction graph, statistics, selection and spawning.
   ============================================================================ */

class Simulation {
  constructor() {
    Road.build();
    this.lights = new TrafficLight();
    this.vehicles = [];
    this.peds = [];
    this.bus = null;
    this.conflicts = [];
    this.heat = null;
    this.time = 0;
    this.paused = false;
    this.selectedId = null;
    this.hoverId = null;

    this.ids = { AV: 0, HV: 0, CYC: 0, P: 0 };
    this.scenario = SCENARIOS[0];
    this.stats = { active: 0, conflicts: 0, highRisk: 0, avgTTC: 0, yields: 0 };

    this.setScenario('nominal');
  }

  /* ------------------------------------------------------------------ setup */
  setScenario(id) {
    this.scenario = SCENARIOS.find(s => s.id === id) || SCENARIOS[0];
    this.reset();
  }

  reset() {
    this.lights.reset();
    this.vehicles = [];
    this.peds = [];
    this.conflicts = [];
    this.heat = null;
    this.time = 0;
    this.selectedId = null;
    this.ids = { AV: 0, HV: 0, CYC: 0, P: 0 };
    this.vehTimer = 0;
    this.pedTimer = 0;
    this.cycTimer = 2.5;
    this.hasHV = false;
    this.jayTimer = 6;
    this.occTimer = 4;

    const sc = this.scenario;
    this.bus = sc.hard ? { pos: { x: CFG.box + 1.9, y: CFG.stopLine + 5.5 }, len: 11, wid: 3.0, angle: Math.PI / 2 } : null;

    // seed a few agents so the scene starts populated
    for (let i = 0; i < Math.min(sc.cars, 3); i++) this.spawnVehicle();
    for (let i = 0; i < Math.min(sc.peds, 4); i++) this.spawnPed();
  }

  /* --------------------------------------------------------------- spawning */
  _clearApproach(from) {
    for (const v of this.vehicles) if (v.alive && v.from === from && v.dist < 11) return false;
    return true;
  }

  spawnVehicle() {
    const sc = this.scenario;
    if (this.vehicles.filter(v => v.alive && v.subtype !== 'CYC').length >= sc.cars) return;
    const froms = ['S', 'N', 'W', 'E'].filter(f => this._clearApproach(f));
    if (!froms.length) return;
    const from = pick(froms);

    // bias movement to create interesting interactions
    let movement = pick(['through', 'through', 'left', 'right']);
    if (sc.hard && Math.random() < 0.4) movement = 'left';         // more unprotected lefts
    const route = Road.routesByFrom[from].find(r => r.movement === movement);

    let subtype = 'AV';
    if (sc.hard && !this.hasHV && Math.random() < 0.6) { subtype = 'HV'; this.hasHV = true; }
    const idn = ++this.ids[subtype];
    const v = new Vehicle(`${subtype}-${String(idn).padStart(2, '0')}`, subtype, route);
    v.speed = v.v0 * 0.65;
    this.vehicles.push(v);
  }

  spawnCyclist() {
    if (this.vehicles.filter(v => v.alive && v.subtype === 'CYC').length >= this.scenario.cyclists) return;
    const froms = ['S', 'N', 'W', 'E'].filter(f => this._clearApproach(f));
    if (!froms.length) return;
    const route = Road.routesByFrom[pick(froms)].find(r => r.movement === 'through');
    const idn = ++this.ids.CYC;
    const c = new Vehicle(`C-${String(idn).padStart(2, '0')}`, 'CYC', route);
    c.speed = c.v0 * 0.7;
    this.vehicles.push(c);
  }

  spawnPed(personality, cwId, fromEnd) {
    if (this.peds.filter(p => p.alive).length >= this.scenario.peds) return;
    const cw = cwId || pick(['S', 'N', 'E', 'W']);
    // keep each crosswalk from becoming a continuous stream (leaves gaps for turns)
    if (this.peds.filter(p => p.alive && p.crosswalk === cw).length >= 2) return;
    const end = fromEnd || pick(['a', 'b']);
    let per = personality;
    if (!per) {
      per = this.scenario.hard ? pick(['cautious', 'assertive', 'assertive', 'hesitant'])
                               : pick(['cautious', 'cautious', 'assertive']);
    }
    const p = new Pedestrian(`P-${String(++this.ids.P).padStart(2, '0')}`, cw, end, per);
    this.peds.push(p);
  }

  spawnJaywalker() {
    // crosses the south leg mid-block, away from any crosswalk
    const y = CFG.stopLine + rand(6, 12);
    const dir = Math.random() < 0.5 ? 1 : -1;
    const start = { x: dir * (CFG.box + 2.5), y };
    const goal  = { x: -dir * (CFG.box + 2.5), y };
    const p = new Pedestrian(`P-${String(++this.ids.P).padStart(2, '0')}`, null, null, 'jay', { start, goal });
    p.pCross = 0.7;
    this.peds.push(p);
  }

  spawnOccludedPed() {
    // steps onto the south crosswalk from behind the parked bus (east end)
    const p = new Pedestrian(`P-${String(++this.ids.P).padStart(2, '0')}`, 'S', 'b', 'assertive');
    p.occluded = true;
    this.peds.push(p);
  }

  /* ------------------------------------------------------------------- step */
  step(dt) {
    if (this.paused) return;
    this.time += dt;
    this.lights.update(dt);

    this._spawnLoop(dt);
    this._updateOcclusion();

    // 1) decide
    for (const v of this.vehicles) if (v.alive) v.plan(this, dt);
    for (const p of this.peds) if (p.alive) p.plan(this, dt);

    // 2) predict (decision-consistent + naive)
    for (const a of this.allAgents()) { Predict.update(a); Predict.updateNaive(a); }

    // 3) conflicts + heatmap
    this.conflicts = Conflict.detect(this);
    this.heat = OVERLAYS.heatmap ? Conflict.heatmap(this.conflicts) : null;
    this._tagConflicts();

    // 4) move
    for (const v of this.vehicles) if (v.alive) v.step(this, dt);
    for (const p of this.peds) if (p.alive) p.step(dt);

    // 5) cull + stats
    this.vehicles = this.vehicles.filter(v => v.alive);
    this.peds = this.peds.filter(p => p.alive);
    this._updateStats();
  }

  _spawnLoop(dt) {
    const sc = this.scenario;
    this.vehTimer -= dt; this.pedTimer -= dt; this.cycTimer -= dt;
    if (this.vehTimer <= 0) { this.spawnVehicle(); this.vehTimer = rand(1.6, 3.4); }
    // Thin pedestrian arrivals so a turning car always eventually gets a gap in
    // the crosswalk (dense continuous streams otherwise starve turns for minutes).
    if (this.pedTimer <= 0) { this.spawnPed(); this.pedTimer = rand(2.8, 5.2); }
    if (sc.cyclists && this.cycTimer <= 0) { this.spawnCyclist(); this.cycTimer = rand(6, 11); }

    if (sc.hard) {
      this.jayTimer -= dt; this.occTimer -= dt;
      if (this.jayTimer <= 0 && !this.peds.some(p => p.personality === 'jay' && p.alive)) {
        this.spawnJaywalker(); this.jayTimer = rand(11, 16);
      }
      if (this.occTimer <= 0 && !this.peds.some(p => p.occluded && p.alive)) {
        this.spawnOccludedPed(); this.occTimer = rand(12, 18);
      }
    }
  }

  /* A pedestrian hidden behind the parked bus is invisible to vehicles until
     it steps clear — modelled by proximity + how far into the crossing it is. */
  _updateOcclusion() {
    if (!this.bus) return;
    for (const p of this.peds) {
      if (p.personality === 'jay') continue;
      const near = V.dist(p.pos, this.bus.pos) < this.bus.len * 0.5 + 2.2;
      const emerged = p._crossFrac ? p._crossFrac() > 0.18 : false;
      if (p.occluded) p.occluded = near && !emerged;
    }
  }

  _tagConflicts() {
    for (const a of this.allAgents()) { a.inConflict = false; a.topRisk = 0; a.confOther = null; a.confTTC = Infinity; }
    for (const c of this.conflicts) {
      c.a.inConflict = c.b.inConflict = true;
      if (c.risk > c.a.topRisk) { c.a.topRisk = c.risk; c.a.confOther = c.b.id; c.a.confTTC = c.ttc; }
      if (c.risk > c.b.topRisk) { c.b.topRisk = c.risk; c.b.confOther = c.a.id; c.b.confTTC = c.ttc; }
    }
  }

  _updateStats() {
    const active = this.vehicles.length + this.peds.length;
    let ttcSum = 0, ttcN = 0, high = 0;
    for (const c of this.conflicts) { if (isFinite(c.ttc)) { ttcSum += c.ttc; ttcN++; } if (c.high) high++; }
    const yields = this.vehicles.filter(v => v.decision === 'YIELD').length;
    this.stats = {
      active,
      conflicts: this.conflicts.length,
      highRisk: high,
      avgTTC: ttcN ? ttcSum / ttcN : 0,
      yields,
    };
  }

  /* ------------------------------------------------------------- accessors */
  allAgents() { return [...this.vehicles, ...this.peds]; }
  conflictAgents() { return this.allAgents(); }
  byId(id) { return this.allAgents().find(a => a.id === id) || null; }

  select(id) {
    this.selectedId = id;
    for (const a of this.allAgents()) a.selected = (a.id === id);
  }

  pick(world, minR = 0) {
    let best = null, bestD = Infinity;
    for (const a of this.allAgents()) {
      const r = Math.max(minR, a.kind === 'ped' ? a.radius + 0.8 : a.radius + 0.4);
      const d = V.dist(a.pos, world);
      if (d < r && d < bestD) { bestD = d; best = a; }
    }
    return best;
  }
}
