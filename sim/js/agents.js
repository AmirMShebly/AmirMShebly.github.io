/* ============================================================================
   AGENTS — Vehicle (cars, cyclists, the aggressive human driver) and
   Pedestrian.  Vehicles use the Intelligent Driver Model against the most
   restrictive "virtual obstacle" (lead car, red light, pedestrian, oncoming
   traffic); that binding constraint becomes the human-readable decision.
   ============================================================================ */

/* Intelligent Driver Model longitudinal acceleration. */
function idmAccel(v, v0, gap, approachRate, p) {
  const sStar = p.s0 + Math.max(0, v * p.T + (v * approachRate) / (2 * Math.sqrt(p.aMax * p.b)));
  return p.aMax * (1 - Math.pow(clamp(v / v0, 0, 2), p.delta) - Math.pow(sStar / Math.max(gap, 0.1), 2));
}

const MOVE_LABEL = { through: 'straight', left: 'left turn', right: 'right turn' };
const MOVE_RANK  = { through: 0, right: 1, left: 2 };

/* Exact oriented-bounding-box overlap (separating-axis theorem). `pad` inflates
   both boxes so vehicles keep a small clearance. Used by the hard no-overlap
   guarantee, so it must be the true rectangle test (a circle approximation lets
   cars clip corner-to-corner). */
function obbProject(box, ax, pad) {
  const c = box.pos.x * ax.x + box.pos.y * ax.y;
  const ux = V.fromAngle(box.heading), uy = { x: -Math.sin(box.heading), y: Math.cos(box.heading) };
  const r = (box.length * 0.5 + pad) * Math.abs(ux.x * ax.x + ux.y * ax.y) +
            (box.width * 0.5 + pad) * Math.abs(uy.x * ax.x + uy.y * ax.y);
  return [c - r, c + r];
}
function obbOverlap(a, b, pad) {
  const axes = [
    V.fromAngle(a.heading), { x: -Math.sin(a.heading), y: Math.cos(a.heading) },
    V.fromAngle(b.heading), { x: -Math.sin(b.heading), y: Math.cos(b.heading) },
  ];
  for (const ax of axes) {
    const pa = obbProject(a, ax, pad), pb = obbProject(b, ax, pad);
    if (pa[1] < pb[0] || pb[1] < pa[0]) return false;
  }
  return true;
}

/* STABLE total-order priority for two vehicles at a shared conflict point:
   through > right > left, then lower id. It does NOT depend on distance, so it
   never flips as the cars move — which is what stops two opposing left-turns
   from each thinking they have priority at different instants and both driving
   into the centre. Returns true iff A yields (B has priority). */
function stableYield(A, B) {
  if (MOVE_RANK[A.movement] !== MOVE_RANK[B.movement])
    return MOVE_RANK[B.movement] < MOVE_RANK[A.movement];
  return B.id < A.id;
}

/* ---------------------------------------------------------------------------
   VEHICLE
   --------------------------------------------------------------------------- */
class Vehicle {
  constructor(id, subtype, route) {
    this.id = id;
    this.kind = 'veh';
    this.subtype = subtype;              // 'AV' | 'HV' | 'CYC'
    this.route = route;
    this.movement = route.movement;
    this.from = route.from;
    this.dist = 0;
    this.crossHits = Road.crosswalkHits(route);

    const base = subtype === 'CYC' ? CFG.cyclist : (subtype === 'HV' ? CFG.aggressive : CFG.idm);
    this.params = { s0: base.s0, T: base.T, aMax: base.aMax, b: base.b, delta: base.delta };
    this.v0 = base.v0;
    this.aMax = base.aMax;
    this.length = subtype === 'CYC' ? CFG.cyclist.length : CFG.car.length;
    this.width  = subtype === 'CYC' ? CFG.cyclist.width  : CFG.car.width;
    this.radius = this.length * 0.5;

    this.speed = this.v0 * 0.85;
    this.aCmd = 0;
    this.decision = 'PROCEED';
    this.decisionReason = 'Proceed';
    this.bindingStop = Infinity;
    this.conflictOther = null;
    this.ttc = Infinity;
    this.occluded = false;
    this.alive = true;
    this.selected = false;

    const s = route.sample(0);
    this.pos = s.pos; this.heading = s.heading;
    this.vel = V.fromAngle(this.heading, this.speed);
  }

  get intent() { return MOVE_LABEL[this.movement]; }
  get label()  { return this.id; }

  freeAccel() { return this.aMax * (1 - Math.pow(clamp(this.speed / this.v0, 0, 2), this.params.delta)); }

  canStopForYellow() {
    const gap = this.route.stopDist - this.dist;
    const brakeDist = (this.speed * this.speed) / (2 * this.params.b);
    return gap > brakeDist * 0.85;
  }

  plan(sim, dt) {
    const p = this.params;
    const halfLen = this.length * 0.5;
    let best = { a: this.freeAccel(), reason: 'Proceed', decision: 'PROCEED', stop: Infinity, other: null, ttc: Infinity };
    const consider = (a, reason, decision, stop, other, ttc) => {
      if (a < best.a) best = { a, reason, decision, stop, other, ttc };
    };

    // 1) same-direction leader in my lane corridor — rear-end avoidance, queues
    //    and merges into a shared exit lane. Crossing (perpendicular) movers are
    //    NOT treated as leaders here; they go through the priority logic below,
    //    which is what prevents mutual-yield deadlock.
    for (const o of sim.vehicles) {
      if (o === this || !o.alive) continue;
      // BODY-AWARE: test o's front, centre and rear against my lane — a car
      // stopped mid-turn can have its centre outside my corridor while its rear
      // still sticks into my lane. Use whichever body point is nearest my path.
      const oh = V.fromAngle(o.heading);
      const bodyPts = [V.add(o.pos, V.mul(oh, o.length * 0.4)), o.pos, V.sub(o.pos, V.mul(oh, o.length * 0.4))];
      let pr = null, along = Infinity, lat = Infinity;
      for (const bp of bodyPts) {
        const q = this.route.project(bp);
        if (q.dist - this.dist <= this.length * 0.25) continue;   // that point is behind me
        if (q.lat < lat) { lat = q.lat; pr = q; along = q.dist - this.dist; }
      }
      if (!pr || along > 30) continue;
      if (lat > this.width * 0.5 + o.width * 0.5 + 0.4) continue;
      const cosd = Math.cos(o.heading - this.route.sample(pr.dist).heading);
      const sameDir = cosd > 0.55;
      // A non-aligned car in my corridor: from my SAME approach → always an
      // obstacle (shared lane); from a DIFFERENT approach → only if slow AND
      // close, so I don't freeze for a fast/far crosser the priority logic owns.
      if (!sameDir && o.from !== this.from && (o.speed > 1.2 || along > 9)) continue;
      const vAlong = Math.max(0, o.speed * cosd);
      const gap = along - halfLen - 0.4;                 // 'along' already reaches o's nearest body point
      const following = sameDir && o.speed > 1.0;
      const a = idmAccel(this.speed, this.v0, Math.max(gap, 0.05), this.speed - vAlong, p);
      consider(a, following ? `Following ${o.id}` : `Yield: ${o.id}`, following ? 'FOLLOW' : 'YIELD',
        following ? Infinity : Math.max(gap, 0), o, gap / Math.max(this.speed, 0.1));
    }

    // 2) traffic signal
    const sig = sim.lights.vehicle(this.from);
    const mustStop = sig === 'red' || (sig === 'yellow' && this.canStopForYellow());
    if (mustStop && this.dist < this.route.stopDist + 0.5) {
      const gap = this.route.stopDist - this.dist - halfLen;
      const a = idmAccel(this.speed, this.v0, Math.max(gap, 0.05), this.speed, p);
      consider(a, sig === 'red' ? 'Stop: red signal' : 'Stop: yellow signal', 'STOP', this.route.stopDist - this.dist, null, Infinity);
    }

    // 3) yield to pedestrians, ANTICIPATING where they will be: scan each
    //    pedestrian's naive roll-out for the first moment it enters my lane
    //    corridor ahead of me, and brake to stop short of that point. This is
    //    interaction-aware braking — the car reacts to the predicted crossing,
    //    not to the bumper contact. Occluded pedestrians are unseen until
    //    revealed (the whole point of the occlusion scenario).
    const buffer = halfLen + 2.2;
    for (const pd of sim.peds) {
      if (!pd.alive || pd.occluded) continue;
      if (!(pd.state === 'cross' || pd.imminentCross)) continue;   // ignore peds merely waiting
      const roll = pd.predNaive || [{ pos: pd.pos }];
      let entryDist = Infinity;
      for (const s of roll) {
        const pr = this.route.project(s.pos);
        if (pr.dist <= this.dist + halfLen) continue;
        if (pr.lat > CFG.laneWidth * 0.8 + pd.radius) continue;
        entryDist = pr.dist; break;
      }
      if (!isFinite(entryDist)) continue;
      let stopPoint = entryDist - buffer;
      // If the pedestrian crossing is INSIDE/after the intersection box (a
      // turning car's exit crosswalk), wait for it OUTSIDE the box rather than
      // stopping mid-turn — a car halted mid-turn blocks the box and collides
      // with opposing turners. Complete the turn in one motion once it's clear.
      if (entryDist > this.route.enterDist + 0.5) stopPoint = Math.min(stopPoint, this.route.enterDist - 1.0);
      const a = idmAccel(this.speed, this.v0, Math.max(stopPoint - this.dist, 0.05), this.speed, p);
      consider(a, `Yield: pedestrian ${pd.id}`, 'YIELD', Math.max(stopPoint - this.dist, 0), pd, (entryDist - this.dist) / Math.max(this.speed, 0.1));
    }

    // 4) crossing conflicts inside the intersection, resolved by strict
    //    priority so at most one car of any pair yields (deadlock-free). This
    //    subsumes the unprotected-left case (a left turn ranks below the
    //    oncoming through, so it gives way). The `occupies` term is a defensive
    //    net: never drive into a car already sitting on the conflict point,
    //    even one that should have yielded (e.g. a light-runner).
    const myCross = Road.crossings[this.route.id];
    if (myCross) {
      for (const o of sim.vehicles) {
        if (o === this || !o.alive) continue;
        const cx = myCross[o.route.id];
        if (!cx) continue;
        const dA = cx.arcA - this.dist;
        const dB = cx.arcB - o.dist;
        if (dA < -halfLen - 0.5) continue;                        // I've cleared it
        if (o.dist > cx.arcB + o.length * 0.5 + 0.5) continue;    // they've cleared it
        if (dA > 26) continue;                                    // still far off
        // Yield decision is TEMPORALLY STABLE: it depends only on who is already
        // committed into the box (can no longer stop short of the point) and, if
        // neither is, on stable priority. So exactly one car yields and stays
        // yielding until the other clears — no priority flip, no double-commit,
        // no mutual-yield deadlock. The 3.2 m stand-off keeps my nose out of the
        // crossing car's swept lane.
        // For a conflict INSIDE the intersection box, the yielder must wait
        // OUTSIDE the box (before the stop line), never creep in and block cross
        // traffic — otherwise one waiting left-turner gridlocks the whole junction.
        const inBox = Math.hypot(cx.point.x, cx.point.y) < CFG.box + 1;
        const yieldPointA = inBox ? Math.min(cx.arcA - (halfLen + 3.2), this.route.enterDist - 1.0)
                                  : cx.arcA - (halfLen + 3.2);
        const yieldPointB = inBox ? Math.min(cx.arcB - (o.length * 0.5 + 3.2), o.route.enterDist - 1.0)
                                  : cx.arcB - (o.length * 0.5 + 3.2);
        const aCommitted = this.dist > yieldPointA;
        const bCommitted = o.dist > yieldPointB;
        // Is B a genuine threat at this conflict?  Yes if it is NEAR the point on
        // a non-red approach (catches a slow car accelerating off the line), or
        // moving and arriving within the window. A car halted at its OWN red is
        // ignored — that was the starvation bug (yielding forever to oncoming
        // cars stopped at their red). "Near on non-red" also breaks the commit
        // race between two left-turners easing off the line together.
        const sigO = sim.lights.vehicle(o.from);
        // o is a LIVE conflicter if it's on a non-red approach and near the
        // conflict (approaching or already in the box). Gating STRICT stable
        // priority on this — rather than a tight time window — guarantees the
        // lower-priority car keeps waiting OUTSIDE the box the whole time o is
        // live, so two conflicting cars can never both commit into the centre
        // and mutually block. A car halted at its own red is excluded, so this
        // does NOT reintroduce the "yield forever to a stopped car" starvation.
        const oLive = sigO !== 'red' && dB > -0.5 && dB < 16;
        let iYield;
        if (aCommitted) iYield = false;                          // I'm past the point of no return → go
        else if (bCommitted) iYield = true;                      // B is in the box on my path → yield
        else if (oLive) iYield = stableYield(this, o);           // B genuinely coming → stable order decides
        else iYield = false;                                     // B stopped at red / cleared → go
        if (iYield) {
          const gap = yieldPointA - this.dist;
          const a = idmAccel(this.speed, this.v0, Math.max(gap, 0.05), this.speed, p);
          consider(a, `Yield: ${o.id}`, 'YIELD', Math.max(gap, 0), o, Math.max(dA, 0) / Math.max(this.speed, 0.1));
        }
      }
    }

    // 5) EMERGENCY collision-avoidance net — pure geometry, independent of lanes
    //    and right-of-way. If my body would contact another car's body within
    //    ~1.4 s (straight-line roll-out), brake to stop short of that point. It
    //    only fires on genuinely imminent contact, so it catches any residual
    //    conflict the rules above miss WITHOUT creating a standing deadlock.
    for (const o of sim.vehicles) {
      if (o === this || !o.alive) continue;
      if (o.id > this.id) continue;             // only the higher-id car of a pair brakes → exactly
                                                // one gives way, so this can never mutually dead-stall
                                                // (and for same-approach cars this is the follower)
      if (V.dist(this.pos, o.pos) > 16) continue;
      const tc = this._contactTime(o);
      if (tc < 1.4) {
        const stopDist = Math.max(0, this.speed * tc - 0.3);
        const a = idmAccel(this.speed, this.v0, Math.max(stopDist, 0.05), this.speed, p);
        consider(a, best.other === o && best.decision !== 'PROCEED' ? best.reason : `Avoiding ${o.id}`,
          'YIELD', Math.max(stopDist, 0), o, tc);
      }
    }

    this.aCmd = clamp(best.a, -p.b * 2.4, this.aMax);
    this.decision = best.decision;
    this.decisionReason = best.reason;
    this.bindingStop = best.stop;
    this.conflictOther = best.other ? best.other.id : null;
    this.ttc = best.ttc;
  }

  /* Earliest time (s) my body would touch o's body, rolling both forward at
     current velocity. Each car is a 2-circle capsule along its length. */
  _contactTime(o) {
    const sum = this.width * 0.6 + o.width * 0.6;
    const offA = this.length * 0.28, offB = o.length * 0.28;
    const ha = V.fromAngle(this.heading), hb = V.fromAngle(o.heading);
    for (let t = 0.1; t <= 1.4; t += 0.13) {
      const pax = this.pos.x + this.vel.x * t, pay = this.pos.y + this.vel.y * t;
      const pbx = o.pos.x + o.vel.x * t, pby = o.pos.y + o.vel.y * t;
      const aC = [{ x: pax + ha.x * offA, y: pay + ha.y * offA }, { x: pax - ha.x * offA, y: pay - ha.y * offA }];
      const bC = [{ x: pbx + hb.x * offB, y: pby + hb.y * offB }, { x: pbx - hb.x * offB, y: pby - hb.y * offB }];
      for (const ca of aC) for (const cb of bC) {
        const dx = ca.x - cb.x, dy = ca.y - cb.y;
        if (dx * dx + dy * dy < sum * sum) return t;
      }
    }
    return Infinity;
  }

  step(sim, dt) {
    const newSpeed = clamp(this.speed + this.aCmd * dt, 0, this.v0 * 1.15);
    const newDist = this.dist + newSpeed * dt;
    if (newDist >= this.route.length - 0.2) { this.alive = false; return; }
    const s = this.route.sample(newDist);

    // HARD no-overlap guarantee: never advance into another vehicle's body.
    // The behavioural layer handles right-of-way and flow; this is the physics
    // floor that makes an actual collision impossible. (Only blocks when I'm
    // currently clear but WOULD overlap — so a car can always move to separate.)
    if (newSpeed * dt > 0.001 &&
        !this._overlaps(sim, this.pos, this.heading) &&
        this._overlaps(sim, s.pos, s.heading)) {
      this.speed = Math.min(this.speed, 0.2);          // hold position, bleed speed
      this.vel = V.fromAngle(this.heading, this.speed);
      return;
    }

    this.speed = newSpeed;
    this.dist = newDist;
    this.pos = s.pos; this.heading = s.heading;
    this.vel = V.fromAngle(this.heading, this.speed);
  }

  _overlaps(sim, pos, heading) {
    const me = { pos, heading, length: this.length, width: this.width };
    for (const o of sim.vehicles) {
      if (o === this || !o.alive) continue;
      if (V.dist2(pos, o.pos) > 81) continue;          // >9m apart, skip
      if (obbOverlap(me, o, 0.18)) return true;         // exact rectangles + small clearance
    }
    return false;
  }
}

/* ---------------------------------------------------------------------------
   PEDESTRIAN
   --------------------------------------------------------------------------- */
class Pedestrian {
  constructor(id, cwId, fromEnd, personality, custom) {
    this.id = id;
    this.kind = 'ped';
    this.subtype = 'PED';
    this.crosswalk = cwId;               // null for a jaywalker crossing mid-block
    this.personality = personality;      // 'cautious' | 'assertive' | 'hesitant' | 'jay'
    let start, goal;
    if (cwId) {
      const cw = Road.crosswalks[cwId];
      start = fromEnd === 'a' ? cw.a : cw.b;
      goal  = fromEnd === 'a' ? cw.b : cw.a;
    } else {
      start = custom.start; goal = custom.goal;
    }
    this.curb = V.clone(start);
    this.goal = V.clone(goal);
    this.crossDir = V.norm(V.sub(goal, start));
    // spawn a little back on the sidewalk, off the road
    this.pos = V.add(start, V.mul(V.norm(V.sub(start, goal)), 2.4));
    this.faceDir = V.clone(this.crossDir);

    this.radius = CFG.ped.radius;
    this.speed = personality === 'jay' ? CFG.ped.speedJay
              : personality === 'hesitant' ? CFG.ped.speedHesitant : CFG.ped.speed;
    this.baseSpeed = this.speed;
    this.vel = { x: 0, y: 0 };
    this.state = 'approach';             // approach | wait | cross | done
    this.pCross = 0;
    this.waitTime = 0;
    this.hesitatePauses = personality === 'hesitant' ? 1 : 0;
    this.hesitateTimer = 0;
    this.imminentCross = false;          // crossing now, or about to step off the curb
    this.occluded = false;
    this.alive = true;
    this.selected = false;
    this.decision = 'walking to curb';
    this.ttc = Infinity;
    this.conflictOther = null;
  }

  get intent() {
    return this.state === 'cross' ? 'crossing' : this.state === 'wait' ? 'waiting to cross' : 'approaching curb';
  }
  get label() { return this.id; }
  get subtypeName() { return this.personality; }

  gapNeed() {
    return { cautious: 4.2, assertive: 2.6, hesitant: 3.6, jay: 0.4 }[this.personality];
  }

  /* Smallest time-to-arrival of any vehicle whose lane my crossing point sits in. */
  nearestVehTTC(sim) {
    let best = Infinity, other = null;
    const probe = this.state === 'cross' ? this.pos : this.curb;
    for (const v of sim.vehicles) {
      if (!v.alive) continue;
      const pr = v.route.project(probe);
      if (pr.lat > CFG.laneWidth * 0.95) continue;
      if (pr.dist <= v.dist) continue;                 // vehicle already past the crossing
      if (V.dist(v.pos, probe) > 30) continue;
      const ttc = (pr.dist - v.dist) / Math.max(v.speed, 0.2);
      if (ttc < best) { best = ttc; other = v; }
    }
    this.conflictOther = other ? other.id : null;
    this.ttc = best;
    return best;
  }

  carYielding(sim) {
    for (const v of sim.vehicles) {
      if (!v.alive || v.speed > 1.3) continue;
      const pr = v.route.project(this.curb);
      if (pr.lat < CFG.laneWidth && pr.dist > v.dist && V.dist(v.pos, this.curb) < 17) return true;
    }
    return false;
  }

  plan(sim, dt) {
    if (this.state === 'approach') {
      this.imminentCross = false;
      const d = V.dist(this.pos, this.curb);
      if (d < 0.4) { this.state = 'wait'; this.vel = { x: 0, y: 0 }; this.decision = 'assessing gap'; }
      else { this.vel = V.setMag(V.sub(this.curb, this.pos), this.baseSpeed); this.decision = 'walking to curb'; }
      return;
    }

    if (this.state === 'wait') {
      this.waitTime += dt;
      const sig = sim.lights.pedestrian(this.crosswalk);
      const ttc = this.nearestVehTTC(sim);
      const safe = ttc > this.gapNeed();
      let d = this.pCross;
      if (this.personality === 'jay') d += 0.03;              // jaywalker just wants to go
      else d += (sig === 'walk' ? 0.075 : sig === 'flash' ? -0.01 : -0.04);
      d += safe ? 0.05 : -0.07;
      if (this.carYielding(sim)) d += 0.09;
      d += CFG.pedImpatience * dt * 4;                        // slowly loses patience
      this.pCross = clamp(d, 0, 1);
      this.vel = { x: 0, y: 0 };
      // Non-jaywalkers obey the WALK signal — they only step off the curb when
      // their crosswalk shows WALK. Otherwise a stopped car makes them feel
      // "safe", they stream across during the vehicles' green phase, and they
      // starve the traffic forever (the deadlock). Jaywalkers ignore the signal.
      // Don't start a crossing that can't finish before WALK ends — this both
      // matches real behaviour and clears the crosswalk in the last seconds of
      // each phase, giving turning vehicles a gap (prevents ped-stream starvation).
      const crossTime = V.dist(this.curb, this.goal) / this.baseSpeed;
      const enough = sim.lights.timeLeft > crossTime * 0.5;
      const mayGo = this.personality === 'jay' || (sig === 'walk' && enough);
      this.imminentCross = this.pCross > 0.5 && mayGo;
      this.decision = mayGo ? 'accepting gap' : sig === 'walk' ? 'clearing (walk ending)' : 'waiting for WALK';
      if (this.pCross > 0.6 && mayGo) {
        this.state = 'cross'; this.decision = 'crossing';
      }
      return;
    }

    if (this.state === 'cross') {
      this.imminentCross = true;
      let spd = this.baseSpeed;
      const ttc = this.nearestVehTTC(sim);
      // dart: an assertive / jaywalking ped speeds up when a car is close
      if ((this.personality === 'assertive' || this.personality === 'jay') && ttc < 2.2) spd = this.baseSpeed * 1.35;
      // hesitation: a hesitant ped may freeze mid-crossing when a car nears
      if (this.hesitateTimer > 0) { this.hesitateTimer -= dt; spd = 0; }
      else if (this.hesitatePauses > 0 && ttc < 2.6 && this._crossFrac() > 0.25 && this._crossFrac() < 0.7) {
        this.hesitateTimer = 1.1; this.hesitatePauses--; spd = 0;
      }
      this.speed = spd;
      this.vel = V.mul(this.crossDir, spd);
      this.pCross = 1;
      if (V.dist(this.pos, this.goal) < 0.4) { this.state = 'done'; this.alive = false; }
      return;
    }
  }

  _crossFrac() {
    const total = V.dist(this.curb, this.goal);
    return clamp(V.dist(this.curb, this.pos) / total, 0, 1);
  }

  step(dt) {
    this.pos = { x: this.pos.x + this.vel.x * dt, y: this.pos.y + this.vel.y * dt };
    if (this.vel.x || this.vel.y) this.faceDir = V.norm(this.vel);
  }
}
