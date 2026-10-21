/* ============================================================================
   PREDICTION — forward trajectory roll-outs with growing uncertainty.

   The key idea (the demo's headline): a vehicle's predicted future DEPENDS on
   its decision.  If it yields, the roll-out decelerates to a stop at the
   crosswalk; if it proceeds, it accelerates to speed.  We can therefore render
   competing hypotheses ("proceed" vs "yield") for the same car and let the
   reasoning layer pick one.
   ============================================================================ */

const Predict = {
  /* Roll a route-following agent (car / cyclist) forward.
     stopDist = remaining metres until a hard stop, or Infinity for free-flow. */
  routeAgent(agent, stopDist) {
    const H = CFG.horizon, dt = CFG.predDt;
    const uL = CFG.unc.carLong, uT = CFG.unc.carLat;
    const occ = agent.occluded ? CFG.unc.occluded : 1;
    const v0 = agent.v0;
    let v = agent.speed;
    let travelled = 0;
    const samples = [];
    for (let t = 0; t <= H + 1e-6; t += dt) {
      const s = agent.route.sample(agent.dist + travelled);
      samples.push({
        t, pos: s.pos, heading: s.heading,
        sigA: (uL[0] + uL[1] * t + uL[2] * t * t) * occ,   // along heading
        sigB: (uT[0] + uT[1] * t + uT[2] * t * t) * occ,   // lateral
      });
      let a;
      if (isFinite(stopDist)) {
        const remaining = stopDist - travelled;
        if (remaining <= 0.08) { v = 0; a = 0; }
        else a = clamp(-(v * v) / (2 * Math.max(remaining, 0.12)), -CFG.idm.b * 1.8, agent.aMax);
      } else {
        a = agent.aMax * (1 - Math.pow(clamp(v / v0, 0, 2), 4));
      }
      v = clamp(v + a * dt, 0, v0 * 1.15);
      travelled += v * dt;
    }
    return samples;
  },

  /* Roll a pedestrian forward.  forceCross overrides intent (used for the
     "what if they step out" hypothesis). */
  pedestrian(ped, forceCross) {
    const H = CFG.horizon, dt = CFG.predDt;
    const uB = CFG.unc.pedBase;
    const occ = ped.occluded ? CFG.unc.occluded : 1;
    const moving = ped.state === 'cross' || forceCross;
    let vel;
    if (moving && ped.crossDir) vel = V.mul(ped.crossDir, ped.speed);
    else if (moving) vel = V.setMag(ped.vel, ped.speed);
    else vel = { x: 0, y: 0 };
    // A waiting pedestrian who MIGHT step out carries bimodal uncertainty.
    const intent = (ped.state !== 'cross') ? ped.pCross * CFG.unc.pedIntent : 0;
    let pos = V.clone(ped.pos);
    const samples = [];
    for (let t = 0; t <= H + 1e-6; t += dt) {
      const s = (uB[0] + uB[1] * t + uB[2] * t * t) * occ + intent * t * 0.35;
      samples.push({ t, pos: { x: pos.x, y: pos.y }, heading: V.angle(vel.x || vel.y ? vel : (ped.faceDir || { x: 1, y: 0 })), sigA: s, sigB: s });
      pos = { x: pos.x + vel.x * dt, y: pos.y + vel.y * dt };
    }
    return samples;
  },

  /* Constant-velocity roll-out — the "if nobody reacts" baseline. */
  routeConst(agent) {
    const H = CFG.horizon, dt = CFG.predDt;
    const uL = CFG.unc.carLong, uT = CFG.unc.carLat;
    const occ = agent.occluded ? CFG.unc.occluded : 1;
    const v = agent.speed;
    const samples = [];
    for (let t = 0; t <= H + 1e-6; t += dt) {
      const s = agent.route.sample(agent.dist + v * t);
      samples.push({
        t, pos: s.pos, heading: s.heading,
        sigA: (uL[0] + uL[1] * t + uL[2] * t * t) * occ,
        sigB: (uT[0] + uT[1] * t + uT[2] * t * t) * occ,
      });
    }
    return samples;
  },

  /* Fill agent.pred with its expected (decision-consistent) trajectory. */
  update(agent) {
    if (agent.kind === 'ped') agent.pred = this.pedestrian(agent);
    else agent.pred = this.routeAgent(agent, agent.bindingStop);
  },

  /* Fill agent.predNaive — used for conflict detection (raw interaction demand). */
  updateNaive(agent) {
    if (agent.kind === 'ped') agent.predNaive = this.pedestrian(agent, agent.state === 'cross' || agent.imminentCross);
    else agent.predNaive = this.routeConst(agent);
  },
};
