/* ============================================================================
   CONFLICT — finds predicted conflicts between agents.

   Conflicts are detected on the NAIVE (constant-velocity / intent) roll-outs,
   i.e. "what would happen if nobody reacted".  That surfaces the underlying
   interaction demand and gives the raw TTC that drives each decision.  The
   agents' actual (decision-consistent) predictions are rendered separately, so
   you can literally see a yield remove a conflict.
   ============================================================================ */

const Conflict = {
  MARGIN: 2.0,                    // metres of miss-distance under which a crossing counts

  /* closest space-time approach of two naive roll-outs */
  closestApproach(A, B) {
    const pa = A.predNaive, pb = B.predNaive;
    const n = Math.min(pa.length, pb.length);
    const rr = A.radius + B.radius;
    let minGap = Infinity, tAt = 0, pt = null, hitT = Infinity;
    for (let k = 0; k < n; k++) {
      const gap = V.dist(pa[k].pos, pb[k].pos) - rr;
      if (gap < minGap) { minGap = gap; tAt = pa[k].t; pt = V.mid(pa[k].pos, pb[k].pos); }
      if (gap < 0.5 && hitT === Infinity) hitT = pa[k].t;   // first time they'd be in contact
    }
    return { minGap, tAt, point: pt, ttc: hitT === Infinity ? tAt : hitT };
  },

  detect(sim) {
    const conflicts = [];
    const agents = sim.conflictAgents();
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const A = agents[i], B = agents[j];
        // two vehicles in the same lane are a follow pair, not a crossing conflict
        if (A.kind === 'veh' && B.kind === 'veh' && A.route && B.route &&
            A.route.id === B.route.id) continue;
        const ca = this.closestApproach(A, B);
        if (ca.minGap > this.MARGIN || ca.tAt > CFG.horizon + 0.01) continue;

        const close = ca.minGap < 0 ? 1 : clamp(1 - ca.minGap / this.MARGIN, 0, 1);
        const urgency = clamp(1 - ca.ttc / CFG.horizon, 0, 1);
        let risk = clamp(0.4 * close + 0.6 * urgency, 0, 1);
        if (ca.ttc < CFG.ttcHazard) risk = Math.max(risk, 0.55 + 0.4 * urgency);
        // extra weight when an occluded / darting pedestrian is involved
        if ((A.occluded || B.occluded)) risk = Math.min(1, risk + 0.12);

        if (risk < 0.22) continue;
        conflicts.push({
          a: A, b: B, point: ca.point, ttc: ca.ttc, minGap: ca.minGap, risk,
          high: risk >= CFG.riskHigh,
        });
      }
    }
    conflicts.sort((x, y) => y.risk - x.risk);
    return conflicts;
  },

  /* Coarse spatial risk field for the heatmap overlay. */
  heatmap(conflicts) {
    const cell = 2.4;
    const R = CFG.viewRadius + 6;
    const n = Math.ceil((2 * R) / cell);
    const grid = new Float32Array(n * n);
    const sig2 = 2 * 4.5 * 4.5;
    for (const c of conflicts) {
      const cx = Math.round((c.point.x + R) / cell);
      const cy = Math.round((c.point.y + R) / cell);
      const rad = 3;
      for (let gy = cy - rad; gy <= cy + rad; gy++) {
        for (let gx = cx - rad; gx <= cx + rad; gx++) {
          if (gx < 0 || gy < 0 || gx >= n || gy >= n) continue;
          const wx = gx * cell - R, wy = gy * cell - R;
          const d2 = (wx - c.point.x) ** 2 + (wy - c.point.y) ** 2;
          grid[gy * n + gx] += c.risk * Math.exp(-d2 / sig2);
        }
      }
    }
    return { grid, n, cell, R };
  },
};
