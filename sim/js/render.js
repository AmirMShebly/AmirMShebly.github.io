/* ============================================================================
   RENDERER — draws the intersection, agents and every analysis overlay:
   predicted trajectories, uncertainty ellipses, velocity arrows, conflict
   points with TTC, the interaction graph, crosswalk zones, a risk heatmap and
   the selected-agent explanation (competing decision ghosts).
   ============================================================================ */

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    this.scale = 10;
    this.cx = 0; this.cy = 0;
    this.t = 0;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.W = Math.max(320, rect.width);
    this.H = Math.max(240, rect.height);
    this.canvas.width = Math.floor(this.W * this.dpr);
    this.canvas.height = Math.floor(this.H * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.scale = Math.min(this.W, this.H) / (2 * CFG.viewRadius);
    this.cx = this.W / 2; this.cy = this.H / 2;
  }

  w2s(p) { return { x: this.cx + p.x * this.scale, y: this.cy + p.y * this.scale }; }
  s2w(p) { return { x: (p.x - this.cx) / this.scale, y: (p.y - this.cy) / this.scale }; }
  m(v) { return v * this.scale; }

  riskColor(r) {
    const c = CFG.col;
    if (r < 0.5) return mixHex(c.riskLow, c.riskMid, r / 0.5);
    return mixHex(c.riskMid, c.riskHigh, (r - 0.5) / 0.5);
  }

  /* ======================================================================= */
  draw(sim, dt) {
    this.t += dt || 0.016;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);

    this._ground(ctx);
    this._markings(ctx);
    this._crosswalks(ctx);
    if (OVERLAYS.heatmap && sim.heat) this._heatmap(ctx, sim.heat);
    if (OVERLAYS.crosswalk) this._crosswalkZones(ctx, sim);
    this._signals(ctx, sim);
    if (sim.bus) this._bus(ctx, sim.bus);

    if (OVERLAYS.prediction || OVERLAYS.uncertainty) for (const a of sim.allAgents()) this._prediction(ctx, a);
    if (OVERLAYS.graph) this._graph(ctx, sim);

    for (const a of sim.vehicles) this._vehicle(ctx, a, sim);
    for (const a of sim.peds) this._ped(ctx, a, sim);
    if (OVERLAYS.velocity) for (const a of sim.allAgents()) this._velocity(ctx, a);

    if (OVERLAYS.conflicts) this._conflicts(ctx, sim);
    this._selection(ctx, sim);
  }

  /* ------------------------------------------------------------ static map */
  _ground(ctx) {
    const c = CFG.col;
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, this.W, this.H);

    const swHalf = CFG.box + 3.2;
    // sidewalk cross
    ctx.fillStyle = c.sidewalk;
    this._rectW(ctx, 0, 0, CFG.spawn * 2, swHalf * 2);
    this._rectW(ctx, 0, 0, swHalf * 2, CFG.spawn * 2);
    // corner buildings
    ctx.fillStyle = c.block;
    const far = CFG.spawn;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const x0 = sx * swHalf, x1 = sx * far;
      const y0 = sy * swHalf, y1 = sy * far;
      const a = this.w2s({ x: Math.min(x0, x1), y: Math.min(y0, y1) });
      const b = this.w2s({ x: Math.max(x0, x1), y: Math.max(y0, y1) });
      this._round(ctx, a.x, a.y, b.x - a.x, b.y - a.y, 6); ctx.fill();
    }
    // asphalt cross
    ctx.fillStyle = c.asphalt;
    this._rectW(ctx, 0, 0, CFG.spawn * 2, CFG.box * 2);
    this._rectW(ctx, 0, 0, CFG.box * 2, CFG.spawn * 2);
    // subtle intersection box shading
    ctx.fillStyle = c.asphalt2;
    this._rectW(ctx, 0, 0, CFG.box * 2, CFG.box * 2);
  }

  _rectW(ctx, cx, cy, w, h) {
    const a = this.w2s({ x: cx - w / 2, y: cy - h / 2 });
    ctx.fillRect(a.x, a.y, this.m(w), this.m(h));
  }

  _markings(ctx) {
    const c = CFG.col;
    // centre dashed yellow lines
    ctx.strokeStyle = c.centre; ctx.lineWidth = Math.max(1.5, this.m(0.16));
    ctx.setLineDash([this.m(1.6), this.m(1.4)]);
    this._lineW(ctx, { x: 0, y: -CFG.spawn }, { x: 0, y: -CFG.box });
    this._lineW(ctx, { x: 0, y: CFG.box }, { x: 0, y: CFG.spawn });
    this._lineW(ctx, { x: -CFG.spawn, y: 0 }, { x: -CFG.box, y: 0 });
    this._lineW(ctx, { x: CFG.box, y: 0 }, { x: CFG.spawn, y: 0 });
    ctx.setLineDash([]);

    // road edge lines (curbs)
    ctx.strokeStyle = 'rgba(210,220,230,0.35)'; ctx.lineWidth = Math.max(1, this.m(0.1));
    for (const s of [-1, 1]) {
      this._lineW(ctx, { x: s * CFG.box, y: -CFG.spawn }, { x: s * CFG.box, y: -CFG.box });
      this._lineW(ctx, { x: s * CFG.box, y: CFG.box }, { x: s * CFG.box, y: CFG.spawn });
      this._lineW(ctx, { x: -CFG.spawn, y: s * CFG.box }, { x: -CFG.box, y: s * CFG.box });
      this._lineW(ctx, { x: CFG.box, y: s * CFG.box }, { x: CFG.spawn, y: s * CFG.box });
    }

    // stop lines (thick white bars in front of each approach)
    ctx.strokeStyle = c.stopline; ctx.lineWidth = Math.max(2, this.m(0.5));
    const O = CFG.laneOffset, S = CFG.stopLine, B = CFG.box;
    this._lineW(ctx, { x: 0.15, y: S }, { x: B, y: S });      // S approach (northbound lane)
    this._lineW(ctx, { x: -0.15, y: -S }, { x: -B, y: -S });  // N approach
    this._lineW(ctx, { x: -S, y: 0.15 }, { x: -S, y: B });    // W approach
    this._lineW(ctx, { x: S, y: -0.15 }, { x: S, y: -B });    // E approach
  }

  _crosswalks(ctx) {
    const c = CFG.col;
    ctx.fillStyle = c.crosswalk;
    for (const key in Road.crosswalks) {
      const cw = Road.crosswalks[key];
      const along = V.norm(V.sub(cw.b, cw.a));
      const across = V.perp(along);
      const len = V.dist(cw.a, cw.b);
      const nStripes = 6;
      for (let i = 0; i < nStripes; i++) {
        const t0 = (i + 0.15) / nStripes, t1 = (i + 0.85) / nStripes;
        const p0 = V.lerp(cw.a, cw.b, t0), p1 = V.lerp(cw.a, cw.b, t1);
        const w = CFG.crossWidth / 2 - 0.3;
        const q0 = V.add(p0, V.mul(across, -w)), q1 = V.add(p1, V.mul(across, -w));
        const q2 = V.add(p1, V.mul(across, w)), q3 = V.add(p0, V.mul(across, w));
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        [q0, q1, q2, q3].forEach((p, k) => { const s = this.w2s(p); k ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  _crosswalkZones(ctx, sim) {
    // highlight crosswalks that are occupied or have WALK
    for (const key in Road.crosswalks) {
      const cw = Road.crosswalks[key];
      const walk = sim.lights.pedestrian(key) === 'walk';
      const occupied = sim.peds.some(p => p.alive && p.crosswalk === key && p.state === 'cross');
      if (!walk && !occupied) continue;
      const along = V.norm(V.sub(cw.b, cw.a)), across = V.perp(along);
      const w = CFG.crossWidth / 2;
      const corners = [
        V.add(cw.a, V.mul(across, -w)), V.add(cw.b, V.mul(across, -w)),
        V.add(cw.b, V.mul(across, w)), V.add(cw.a, V.mul(across, w)),
      ];
      ctx.beginPath();
      corners.forEach((p, k) => { const s = this.w2s(p); k ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
      ctx.closePath();
      ctx.fillStyle = occupied ? 'rgba(255,84,112,0.12)' : 'rgba(76,201,240,0.09)';
      ctx.fill();
      ctx.strokeStyle = occupied ? 'rgba(255,84,112,0.5)' : 'rgba(76,201,240,0.35)';
      ctx.lineWidth = 1.2; ctx.setLineDash([this.m(0.5), this.m(0.5)]); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  _signals(ctx, sim) {
    const O = CFG.laneOffset, S = CFG.stopLine, B = CFG.box;
    const heads = {
      S: { x: B + 1.1, y: S + 0.4 }, N: { x: -B - 1.1, y: -S - 0.4 },
      W: { x: -S - 0.4, y: B + 1.1 }, E: { x: S + 0.4, y: -B - 1.1 },
    };
    for (const ap in heads) {
      const state = sim.lights.vehicle(ap);
      const s = this.w2s(heads[ap]);
      const col = state === 'green' ? '#37d67a' : state === 'yellow' ? '#f0b429' : '#ff5470';
      ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(3.5, this.m(0.62)), 0, 7);
      ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    }
    // pedestrian WALK indicators at crosswalk mid-points
    for (const key in Road.crosswalks) {
      const cw = Road.crosswalks[key];
      const mid = V.mid(cw.a, cw.b);
      const st = sim.lights.pedestrian(key);
      const s = this.w2s(mid);
      const col = st === 'walk' ? '#37d67a' : st === 'flash' ? '#f0b429' : '#7a828c';
      ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(2, this.m(0.32)), 0, 7);
      ctx.fillStyle = col; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
    }
  }

  _bus(ctx, bus) {
    ctx.save();
    const s = this.w2s(bus.pos);
    ctx.translate(s.x, s.y); ctx.rotate(bus.angle);
    const l = this.m(bus.len), w = this.m(bus.wid);
    ctx.fillStyle = '#c9a227';
    this._round(ctx, -l / 2, -w / 2, l, w, 3); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    this._round(ctx, -l / 2 + 2, -w / 2 + 2, l - 4, w - 4, 2); ctx.fill();
    ctx.restore();
    this._chip(ctx, s.x, s.y - this.m(bus.wid) - 6, 'BUS (parked)', '#c9a227');
  }

  /* ----------------------------------------------------------- prediction */
  _prediction(ctx, a) {
    if (!a.pred || a.pred.length < 2) return;
    const col = this._agentColor(a);
    // uncertainty ellipses (under the line)
    if (OVERLAYS.uncertainty) {
      for (let i = 1; i < a.pred.length; i++) {
        const s = a.pred[i];
        const c = this.w2s(s.pos);
        ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(s.heading);
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.max(1, this.m(s.sigA)), Math.max(1, this.m(s.sigB)), 0, 0, 7);
        ctx.fillStyle = hexA(col, 0.05 + 0.02 * (a.pred.length - i));
        ctx.fill();
        ctx.strokeStyle = hexA(col, 0.14); ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
      }
    }
    // predicted path line + sample dots
    if (OVERLAYS.prediction) {
      ctx.beginPath();
      const start = this.w2s(a.pos);
      ctx.moveTo(start.x, start.y);
      for (const s of a.pred) { const p = this.w2s(s.pos); ctx.lineTo(p.x, p.y); }
      ctx.strokeStyle = hexA(col, 0.55); ctx.lineWidth = Math.max(1.5, this.m(0.14));
      ctx.setLineDash([this.m(0.6), this.m(0.5)]); ctx.stroke(); ctx.setLineDash([]);
      for (let i = 1; i < a.pred.length; i++) {
        const p = this.w2s(a.pred[i].pos);
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.8, 0, 7); ctx.fillStyle = hexA(col, 0.7); ctx.fill();
      }
    }
  }

  _graph(ctx, sim) {
    for (const c of sim.conflicts) {
      const a = this.w2s(c.a.pos), b = this.w2s(c.b.pos);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = hexA(this.riskColor(c.risk), 0.35 + 0.4 * c.risk);
      ctx.lineWidth = Math.max(1, 1 + 2.5 * c.risk);
      ctx.setLineDash([this.m(0.4), this.m(0.35)]); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  /* --------------------------------------------------------------- agents */
  _agentColor(a) {
    if (a.kind === 'ped') return a.personality === 'jay' ? '#ff9f43' : CFG.col.ped;
    if (a.subtype === 'HV') return CFG.col.hv;
    if (a.subtype === 'CYC') return CFG.col.cyclist;
    return CFG.col.av;
  }

  _vehicle(ctx, v, sim) {
    const s = this.w2s(v.pos);
    const col = this._agentColor(v);
    ctx.save();
    ctx.translate(s.x, s.y); ctx.rotate(v.heading);
    const l = this.m(v.length), w = this.m(v.width);

    if (v.selected || v.id === sim.hoverId) {
      ctx.shadowColor = col; ctx.shadowBlur = 16;
    }
    // body
    ctx.fillStyle = col;
    this._round(ctx, -l / 2, -w / 2, l, w, Math.min(4, w * 0.35)); ctx.fill();
    ctx.shadowBlur = 0;
    // roof / windshield
    ctx.fillStyle = 'rgba(10,14,20,0.55)';
    this._round(ctx, -l * 0.05, -w / 2 + 2, l * 0.34, w - 4, 2); ctx.fill();
    // nose indicator (heading)
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    this._round(ctx, l / 2 - Math.max(2, l * 0.08), -w / 2 + 1.5, Math.max(2, l * 0.06), w - 3, 1); ctx.fill();
    // decision tint ring
    if (v.decision === 'YIELD' || v.decision === 'STOP') {
      ctx.strokeStyle = v.decision === 'STOP' ? CFG.col.riskHigh : CFG.col.riskMid;
      ctx.lineWidth = 1.6; this._round(ctx, -l / 2, -w / 2, l, w, Math.min(4, w * 0.35)); ctx.stroke();
    }
    ctx.restore();

    this._agentLabel(ctx, v, s, col);
  }

  _ped(ctx, p, sim) {
    const s = this.w2s(p.pos);
    const col = this._agentColor(p);
    const r = Math.max(3.4, this.m(p.radius + 0.15));

    // p(cross) ring for waiting peds
    if (p.state === 'wait') {
      ctx.beginPath(); ctx.arc(s.x, s.y, r + 3, -Math.PI / 2, -Math.PI / 2 + p.pCross * Math.PI * 2);
      ctx.strokeStyle = this.riskColor(p.pCross); ctx.lineWidth = 2; ctx.stroke();
    }
    if (p.selected || p.id === sim.hoverId) { ctx.shadowColor = col; ctx.shadowBlur = 14; }
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 7);
    ctx.fillStyle = p.state === 'wait' ? CFG.col.pedWait : col;
    if (p.occluded) { ctx.globalAlpha = 0.5; }
    ctx.fill(); ctx.globalAlpha = 1; ctx.shadowBlur = 0;

    // occluded marker
    if (p.occluded) {
      ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.arc(s.x, s.y, r + 2.5, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      this._chip(ctx, s.x, s.y - r - 9, 'occluded?', '#ff9f43');
    }
    // facing tick
    const f = V.setMag(p.faceDir || { x: 1, y: 0 }, p.radius + 0.7);
    const tip = this.w2s(V.add(p.pos, f));
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(tip.x, tip.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.6; ctx.stroke();

    this._agentLabel(ctx, p, s, col, r);
  }

  _agentLabel(ctx, a, s, col, r) {
    const show = a.selected || a.id === (window.FNC ? window.FNC.sim.hoverId : null);
    const off = (r || this.m(a.width || 1)) + 8;
    if (show) this._chip(ctx, s.x, s.y - off, a.id, col);
  }

  _velocity(ctx, a) {
    const sp = a.kind === 'ped' ? V.mag(a.vel) : a.speed;
    if (sp < 0.15) return;
    const dir = a.kind === 'ped' ? V.norm(a.vel) : V.fromAngle(a.heading);
    const from = this.w2s(a.pos);
    const to = this.w2s(V.add(a.pos, V.mul(dir, 0.6 + sp * 0.5)));
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.8; ctx.stroke();
    // arrowhead
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - 5 * Math.cos(ang - 0.4), to.y - 5 * Math.sin(ang - 0.4));
    ctx.lineTo(to.x - 5 * Math.cos(ang + 0.4), to.y - 5 * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();
  }

  /* ------------------------------------------------------------ conflicts */
  _conflicts(ctx, sim) {
    const sel = sim.selectedId, hov = sim.hoverId;
    for (const c of sim.conflicts) {
      const s = this.w2s(c.point);
      const col = this.riskColor(c.risk);
      const pulse = 1 + 0.16 * Math.sin(this.t * 6 + c.ttc);
      const rad = (3 + 4 * c.risk) * pulse;
      // diamond marker (subtler for low-risk conflicts)
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = hexA(col, c.high ? 0.85 : 0.55);
      ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
      ctx.strokeStyle = '#0b0e13'; ctx.lineWidth = 1.2; ctx.strokeRect(-rad, -rad, rad * 2, rad * 2);
      ctx.restore();
      // Only label the conflicts that matter: high-risk ones, or whichever
      // involves the agent you're inspecting. Keeps the scene readable.
      const focus = c.a.id === sel || c.b.id === sel || c.a.id === hov || c.b.id === hov;
      if (OVERLAYS.ttc && isFinite(c.ttc) && (c.high || focus)) {
        this._chip(ctx, s.x, s.y - rad - 9, `TTC ${Math.max(c.ttc, 0.1).toFixed(1)}s`, col);
      }
    }
  }

  /* -------------------------------------------------- selection reasoning */
  _selection(ctx, sim) {
    const a = sim.selectedId ? sim.byId(sim.selectedId) : null;
    if (!a) return;
    const s = this.w2s(a.pos);
    const col = this._agentColor(a);
    // pulsing selection ring
    const rr = (a.kind === 'ped' ? this.m(a.radius) + 6 : this.m(a.length) * 0.6 + 5) + 2 * Math.sin(this.t * 4);
    ctx.beginPath(); ctx.arc(s.x, s.y, rr, 0, 7);
    ctx.strokeStyle = CFG.col.avSel; ctx.lineWidth = 2; ctx.stroke();

    // explanation ghosts (competing futures)
    const ex = Reason.explain(a, sim);
    for (const g of ex.ghosts) {
      if (!g.pts || g.pts.length < 2) continue;
      ctx.beginPath();
      g.pts.forEach((p, k) => { const q = this.w2s(p); k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
      ctx.strokeStyle = hexA(g.color, g.selected ? 0.95 : 0.6);
      ctx.lineWidth = g.selected ? Math.max(2.4, this.m(0.22)) : (g.thin ? 1.6 : 2);
      if (g.dashed) ctx.setLineDash([this.m(0.7), this.m(0.5)]);
      ctx.stroke(); ctx.setLineDash([]);
      // end label
      const end = this.w2s(g.pts[g.pts.length - 1]);
      this._chip(ctx, end.x, end.y, g.label, g.color);
    }
  }

  /* ------------------------------------------------------------- heatmap */
  _heatmap(ctx, heat) {
    const { grid, n, cell, R } = heat;
    ctx.globalAlpha = 0.5;
    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++) {
        const val = grid[gy * n + gx];
        if (val < 0.05) continue;
        const wx = gx * cell - R, wy = gy * cell - R;
        const s = this.w2s({ x: wx, y: wy });
        const r = clamp(val, 0, 1);
        ctx.fillStyle = hexA(this.riskColor(r), Math.min(0.5, 0.12 + r * 0.4));
        const cs = this.m(cell) + 1;
        ctx.fillRect(s.x - cs / 2, s.y - cs / 2, cs, cs);
      }
    }
    ctx.globalAlpha = 1;
  }

  /* -------------------------------------------------------------- helpers */
  _lineW(ctx, a, b) { const s = this.w2s(a), e = this.w2s(b); ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke(); }

  _round(ctx, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _chip(ctx, x, y, text, col) {
    ctx.font = '600 11px ui-monospace, "SF Mono", Menlo, monospace';
    const w = ctx.measureText(text).width + 10;
    const h = 15;
    ctx.fillStyle = 'rgba(8,11,16,0.82)';
    this._round(ctx, x - w / 2, y - h, w, h, 4); ctx.fill();
    ctx.strokeStyle = hexA(col, 0.6); ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y - h / 2 + 0.5);
    ctx.textAlign = 'left';
  }
}

/* colour helpers */
function hexA(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function mixHex(h1, h2, t) {
  const a = h1.replace('#', ''), b = h2.replace('#', '');
  const r = Math.round(lerp(parseInt(a.substring(0, 2), 16), parseInt(b.substring(0, 2), 16), t));
  const g = Math.round(lerp(parseInt(a.substring(2, 4), 16), parseInt(b.substring(2, 4), 16), t));
  const bl = Math.round(lerp(parseInt(a.substring(4, 6), 16), parseInt(b.substring(4, 6), 16), t));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}
