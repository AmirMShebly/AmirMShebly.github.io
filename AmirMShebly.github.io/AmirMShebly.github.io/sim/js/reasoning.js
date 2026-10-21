/* ============================================================================
   REASONING — turns an agent's decision into an explainable narrative and a
   set of competing "what-if" prediction ghosts (the explainable-AI view).

   For a car interacting with a pedestrian it produces two joint hypotheses:
     H1 (baseline):  pedestrian waits   → AV proceeds
     H2 (reactive):  pedestrian crosses → AV yields
   and marks which one the policy selected, and why (P(cross), TTC, risk).
   ============================================================================ */

const Reason = {
  pairRisk(sim, a, b) {
    for (const c of sim.conflicts) {
      if ((c.a === a && c.b === b) || (c.a === b && c.b === a)) return c;
    }
    return null;
  },

  fmt(n, d = 1) { return (isFinite(n) ? n.toFixed(d) : '∞'); },

  explain(agent, sim) {
    if (agent.kind === 'ped') return this._ped(agent, sim);
    return this._vehicle(agent, sim);
  },

  _vehicle(v, sim) {
    const out = {
      id: v.id, type: v.subtype, intent: v.intent,
      speed: v.speed, decision: v.decision, reason: v.decisionReason,
      rows: [], hypotheses: [], ghosts: [], because: '', nearest: v.conflictOther || '—',
      ttc: v.ttc,
    };

    // decision-consistent ghost (what it will actually do)
    out.ghosts.push({ pts: v.pred.map(s => s.pos), color: CFG.col.riskLow, label: 'selected', dashed: false, selected: true });

    const other = v.conflictOther ? sim.byId(v.conflictOther) : null;

    if (other && other.kind === 'ped' && (v.decision === 'YIELD' || v.decision === 'STOP')) {
      const pCross = other.pCross;
      const risk = this.pairRisk(sim, v, other);
      const riskV = risk ? risk.risk : clamp(pCross, 0, 1);
      const ttc = risk ? risk.ttc : (isFinite(v.confTTC) ? v.confTTC : v.ttc);

      out.rows = [
        ['Detects', `${other.id} (${other.personality})`],
        ['P(cross)', pCross.toFixed(2)],
        ['TTC', this.fmt(ttc) + ' s'],
        ['Conflict risk', riskV.toFixed(2)],
      ];
      out.hypotheses = [
        { label: 'H1 · baseline', desc: `${other.id} waits → ${v.id} proceeds`, prob: clamp(1 - pCross, 0, 1), selected: false },
        { label: 'H2 · reactive', desc: `${other.id} crosses → ${v.id} yields`, prob: clamp(pCross, 0, 1), selected: true },
      ];
      out.because = riskV >= CFG.riskHigh
        ? `P(cross)=${pCross.toFixed(2)}, TTC=${this.fmt(ttc)}s → conflict risk ${riskV.toFixed(2)} (high). Decision: YIELD.`
        : `${other.id} is committing to the crosswalk (P(cross)=${pCross.toFixed(2)}); pedestrian has right of way. Decision: YIELD.`;

      // competing ghosts: the rejected "proceed" future vs the ped's "cross" future
      const proceed = Predict.routeAgent(v, this._lightStop(v, sim));
      out.ghosts.push({ pts: proceed.map(s => s.pos), color: CFG.col.riskHigh, label: `${v.id} proceeds (rejected)`, dashed: true, selected: false });
      const cross = Predict.pedestrian(other, true);
      out.ghosts.push({ pts: cross.map(s => s.pos), color: CFG.col.ped, label: `${other.id} crosses`, dashed: true, selected: false, thin: true });

    } else if (other && other.kind === 'veh' && v.decision === 'YIELD') {
      const risk = this.pairRisk(sim, v, other);
      out.rows = [
        ['Detects', `${other.id} (oncoming)`],
        ['TTC', this.fmt(v.ttc) + ' s'],
        ['Conflict risk', (risk ? risk.risk : 0.6).toFixed(2)],
      ];
      out.hypotheses = [
        { label: 'H1 · assertive', desc: `turn before ${other.id}`, prob: 0.25, selected: false },
        { label: 'H2 · cautious', desc: `wait for ${other.id} to clear`, prob: 0.75, selected: true },
      ];
      out.because = `Unprotected left: oncoming ${other.id} arrives in ${this.fmt(v.ttc)}s → give way.`;
      const proceed = Predict.routeAgent(v, Infinity);
      out.ghosts.push({ pts: proceed.map(s => s.pos), color: CFG.col.riskHigh, label: 'turn now (rejected)', dashed: true, selected: false });

    } else if (v.decision === 'STOP') {
      out.rows = [['Constraint', v.decisionReason], ['Speed', this.fmt(v.speed) + ' m/s']];
      out.because = `${v.decisionReason}. Holding at the stop line until it clears.`;

    } else if (v.decision === 'FOLLOW') {
      out.rows = [['Car-following', v.conflictOther || '—'], ['Gap TTC', this.fmt(v.ttc) + ' s']];
      out.because = `Matching the vehicle ahead (${v.conflictOther}); no crossing conflict.`;

    } else {
      out.rows = [['Status', 'clear'], ['Speed', this.fmt(v.speed) + ' m/s']];
      out.because = 'No conflicting agents in the prediction horizon → proceed.';
    }
    return out;
  },

  _lightStop(v, sim) {
    const sig = sim.lights.vehicle(v.from);
    if ((sig === 'red' || sig === 'yellow') && v.dist < v.route.stopDist) return v.route.stopDist - v.dist;
    return Infinity;
  },

  _ped(p, sim) {
    const out = {
      id: p.id, type: 'PED', intent: p.intent, speed: p.speed,
      decision: p.state === 'cross' ? 'CROSS' : p.state === 'wait' ? 'WAIT' : 'APPROACH',
      reason: p.decision, rows: [], hypotheses: [], ghosts: [], because: '', nearest: p.conflictOther || '—',
      ttc: p.ttc,
    };
    out.rows = [
      ['Type', p.personality],
      ['P(cross)', p.pCross.toFixed(2)],
      ['Nearest vehicle', p.conflictOther || '—'],
      ['Gap TTC', this.fmt(p.ttc) + ' s'],
    ];
    const need = p.gapNeed();
    if (p.state === 'wait') {
      out.hypotheses = [
        { label: 'cross', desc: `accept gap (need ≥ ${need}s)`, prob: clamp(p.pCross, 0, 1), selected: false },
        { label: 'wait', desc: 'hold at the curb', prob: clamp(1 - p.pCross, 0, 1), selected: true },
      ];
      out.because = `Gap TTC ${this.fmt(p.ttc)}s vs required ${need}s → ${p.ttc > need ? 'gap acceptable' : 'waiting'}.`;
    } else if (p.state === 'cross') {
      out.because = `Crossing at ${this.fmt(p.speed)} m/s. Vehicles must yield right-of-way.`;
      out.ghosts.push({ pts: p.pred.map(s => s.pos), color: CFG.col.ped, label: 'crossing', dashed: false, selected: true });
    } else {
      out.because = 'Walking toward the curb.';
    }
    return out;
  },
};
