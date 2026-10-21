/* ============================================================================
   UI — side panel: scenario picker, live metrics, overlay toggles, controls,
   the hover tooltip and the selected-agent reasoning card.
   ============================================================================ */

class UI {
  constructor(sim) {
    this.sim = sim;
    this.speed = 1;
    this._scenarioButtons();
    this._overlayToggles();
    this._legend();
    this._controls();
    this.el = {
      active: byId('m-active'), conflicts: byId('m-conflicts'), high: byId('m-high'),
      ttc: byId('m-ttc'), yields: byId('m-yields'), phase: byId('m-phase'),
      desc: byId('scenario-desc'), agentBlock: byId('agent-block'), card: byId('agent-card'),
      tooltip: byId('tooltip'), pill: byId('phasepill'), pause: byId('btn-pause'),
    };
    this._syncScenario();
  }

  _scenarioButtons() {
    const wrap = byId('scenario-buttons');
    this.scnBtns = {};
    SCENARIOS.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'scn-btn';
      b.innerHTML = `${i + 1}. ${s.name}`;
      b.onclick = () => this.selectScenario(s.id);
      wrap.appendChild(b);
      this.scnBtns[s.id] = b;
    });
  }

  _overlayToggles() {
    const wrap = byId('overlay-toggles');
    this.tgls = {};
    OVERLAY_META.forEach(([key, label]) => {
      const t = document.createElement('div');
      t.className = 'tgl' + (OVERLAYS[key] ? ' on' : '');
      t.innerHTML = `<span class="sw"></span>${label}`;
      t.onclick = () => { OVERLAYS[key] = !OVERLAYS[key]; t.classList.toggle('on', OVERLAYS[key]); };
      wrap.appendChild(t);
      this.tgls[key] = t;
    });
  }

  _legend() {
    const items = [
      ['#5ad1c8', 'AV (autonomous)', 0], ['#ff6b6b', 'HV (aggressive)', 0],
      ['#c197fc', 'Cyclist', 0], ['#4cc9f0', 'Pedestrian', 1],
      ['#ff9f43', 'Jaywalker', 1], ['#ff5470', 'High conflict', 0],
    ];
    byId('legend').innerHTML = items.map(([c, l, round]) =>
      `<div class="li"><span class="sw ${round ? 'round' : ''}" style="background:${c}"></span>${l}</div>`).join('');
  }

  _controls() {
    byId('btn-pause').onclick = () => this.togglePause();
    byId('btn-reset').onclick = () => { this.sim.reset(); this.hideCard(); };
    this.speedBtns = {};
    document.querySelectorAll('.speed-btn').forEach(b => {
      const v = parseFloat(b.dataset.speed);
      this.speedBtns[v] = b;
      b.onclick = () => this.setSpeed(v);
    });
    this.setSpeed(1);
    window.addEventListener('keydown', e => {
      if (e.code === 'Space') { e.preventDefault(); this.togglePause(); }
      else if (e.key === 'r' || e.key === 'R') { this.sim.reset(); this.hideCard(); }
      else { const n = parseInt(e.key, 10); if (n >= 1 && n <= SCENARIOS.length) this.selectScenario(SCENARIOS[n - 1].id); }
    });
  }

  selectScenario(id) {
    this.sim.setScenario(id);
    this.hideCard();
    this._syncScenario();
  }

  _syncScenario() {
    Object.values(this.scnBtns).forEach(b => b.classList.remove('active'));
    this.scnBtns[this.sim.scenario.id].classList.add('active');
    byId('scenario-desc').textContent = this.sim.scenario.desc;
  }

  setSpeed(v) {
    this.speed = v;
    Object.values(this.speedBtns).forEach(b => b.classList.remove('active'));
    if (this.speedBtns[v]) this.speedBtns[v].classList.add('active');
  }

  togglePause() {
    this.sim.paused = !this.sim.paused;
    this.el.pause.textContent = this.sim.paused ? '▶ Resume' : '❚❚ Pause';
  }

  /* --------------------------------------------------------- per-frame UI */
  refresh() {
    const s = this.sim.stats;
    this.el.active.textContent = s.active;
    this.el.conflicts.textContent = s.conflicts;
    this.el.high.textContent = s.highRisk;
    this.el.ttc.textContent = s.avgTTC > 0 ? s.avgTTC.toFixed(1) + ' s' : '–';
    this.el.yields.textContent = s.yields;

    const ph = this.sim.lights.phase;
    this.el.phase.textContent = ph.name.replace('_', ' ');
    this._pill(ph);

    if (this.sim.selectedId) {
      const a = this.sim.byId(this.sim.selectedId);
      if (a) this._card(a); else this.hideCard();
    }
  }

  _pill(ph) {
    const dot = c => `<span class="dot" style="background:${c}"></span>`;
    const col = st => st === 'green' ? '#37d67a' : st === 'yellow' ? '#f0b429' : '#ff5470';
    this.el.pill.innerHTML =
      `${dot(col(ph.ns))} NS &nbsp; ${dot(col(ph.ew))} EW &nbsp;·&nbsp; ${this.sim.lights.timeLeft.toFixed(0)}s`;
  }

  /* --------------------------------------------------------- tooltip ---- */
  showTooltip(agent, x, y) {
    if (!agent) { this.el.tooltip.style.opacity = 0; return; }
    const t = this.el.tooltip;
    const type = agent.kind === 'ped' ? (agent.personality === 'jay' ? 'jaywalker' : 'pedestrian') :
      (agent.subtype === 'HV' ? 'aggressive vehicle' : agent.subtype === 'CYC' ? 'cyclist' : 'autonomous vehicle');
    const dec = this._decLabel(agent);
    const other = agent.confOther || agent.conflictOther || '—';
    const ttcVal = isFinite(agent.confTTC) ? agent.confTTC : agent.ttc;
    const ttc = isFinite(ttcVal) ? ttcVal.toFixed(1) + ' s' : '—';
    t.innerHTML =
      `<div class="tt-head" style="color:${this._agentCol(agent)}">${agent.id} · ${type}</div>` +
      `<div class="tt-row">Intent: <b>${agent.intent}</b></div>` +
      `<div class="tt-row">Speed: <b>${(agent.kind === 'ped' ? V.mag(agent.vel) : agent.speed).toFixed(1)} m/s</b></div>` +
      `<div class="tt-row">Nearest conflict: <b>${other}</b></div>` +
      `<div class="tt-row">TTC: <b>${ttc}</b></div>` +
      `<div class="tt-row">Decision: <b>${dec}</b></div>`;
    t.style.left = x + 'px'; t.style.top = y + 'px'; t.style.opacity = 1;
  }
  hideTooltip() { this.el.tooltip.style.opacity = 0; }

  /* --------------------------------------------------- selected-agent card */
  _card(a) {
    const ex = Reason.explain(a, this.sim);
    this.el.agentBlock.style.display = '';
    const dec = this._decLabel(a);
    let html = `<div class="card-head">
        <span class="card-id" style="color:${this._agentCol(a)}">${ex.id}</span>
        <span class="badge type">${this._typeLabel(a)}</span>
        <span class="badge dec-${a.decision}">${dec}</span></div>`;

    const rows = [['Intent', ex.intent], ['Speed', (a.kind === 'ped' ? V.mag(a.vel) : a.speed).toFixed(1) + ' m/s'], ...ex.rows];
    html += `<div class="card-rows">` + rows.map(([k, v]) =>
      `<div class="card-row"><span class="rk">${k}</span><span class="rv">${v}</span></div>`).join('') + `</div>`;

    if (ex.hypotheses.length) {
      html += `<div class="hyp-title">Interaction hypotheses</div>`;
      html += ex.hypotheses.map(h =>
        `<div class="hyp ${h.selected ? 'sel' : ''}">
           <div class="hyp-top"><span class="hl">${h.label}${h.selected ? ' ✓' : ''}</span><span class="hp">${(h.prob * 100).toFixed(0)}%</span></div>
           <div class="hyp-desc">${h.desc}</div>
           <div class="hyp-bar"><div style="width:${(h.prob * 100).toFixed(0)}%"></div></div>
         </div>`).join('');
    }
    if (ex.because) html += `<div class="because">${ex.because}</div>`;
    html += `<button class="deselect" id="deselect-btn">Clear selection</button>`;
    this.el.card.innerHTML = html;
    byId('deselect-btn').onclick = () => { this.sim.select(null); this.hideCard(); };
  }
  hideCard() { this.el.agentBlock.style.display = 'none'; this.sim.select(null); }

  _decLabel(a) {
    if (a.kind === 'ped') return { cross: 'Crossing', wait: 'Waiting', approach: 'Approaching', done: '–' }[a.state];
    return { YIELD: 'Yield', STOP: 'Stop', PROCEED: 'Proceed', FOLLOW: 'Following' }[a.decision] || a.decision;
  }
  _typeLabel(a) {
    if (a.kind === 'ped') return a.personality === 'jay' ? 'JAYWALKER' : 'PED';
    return a.subtype;
  }
  _agentCol(a) {
    if (a.kind === 'ped') return a.personality === 'jay' ? '#ff9f43' : '#4cc9f0';
    if (a.subtype === 'HV') return '#ff6b6b';
    if (a.subtype === 'CYC') return '#c197fc';
    return '#5ad1c8';
  }
}

function byId(id) { return document.getElementById(id); }
