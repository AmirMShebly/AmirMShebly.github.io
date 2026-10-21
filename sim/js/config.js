/* ============================================================================
   URBAN INTERACTION LAB — global configuration
   All spatial units are METRES, all time in SECONDS, speeds in m/s.
   The renderer converts metres → pixels with a camera scale.
   ============================================================================ */

const CFG = {
  /* --- intersection geometry (metres) --- */
  laneWidth:   4.6,
  laneOffset:  2.3,     // lane centre offset from road centreline (laneWidth/2)
  box:         4.6,     // half-size of the central intersection square
  crossWidth:  4.6,     // depth of a crosswalk band
  crossHalf:   4.6,     // half-length of a crosswalk (== box, spans the road)
  get stopLine() { return this.box + this.crossWidth + 0.6; }, // stop-line dist from centre
  spawn:       46,      // distance from centre where agents appear / vanish
  sidewalk:    9,       // sidewalk depth in the corners

  /* --- view --- */
  viewRadius:  24,      // metres visible from centre to shorter edge (roads fill the frame)
  minScale:    5,

  /* --- vehicle dynamics (IDM) --- */
  idm: {
    v0:   9.0,          // desired speed (~32 km/h)
    aMax: 1.7,          // max acceleration
    b:    2.4,          // comfortable deceleration
    s0:   2.4,          // minimum standstill gap
    T:    1.2,          // safe time headway
    delta: 4,
  },
  aggressive: { v0: 12.5, aMax: 2.6, b: 3.2, s0: 1.4, T: 0.6, delta: 4 },

  car:      { length: 4.5, width: 1.95 },
  cyclist:  { length: 1.8, width: 0.62, v0: 5.2, aMax: 1.4, b: 2.6, s0: 1.4, T: 1.0, delta: 4 },
  ped: {
    radius: 0.36,
    speed:  1.35,
    speedJay: 1.85,
    speedHesitant: 1.0,
  },

  /* --- prediction --- */
  horizon:  3.5,        // seconds of look-ahead
  predDt:   0.5,        // prediction sample step
  // uncertainty growth (metres): sigma(t) = a + b*t (+ curvature term)
  unc: {
    carLong:  [0.20, 0.55, 0.05],   // [const, *t, *t^2] longitudinal
    carLat:   [0.18, 0.06, 0.0],
    pedBase:  [0.30, 0.45, 0.06],
    pedIntent: 1.6,                 // extra spread when intent is uncertain
    occluded: 2.6,                  // multiplier when an agent is occluded
  },

  /* --- conflict / risk --- */
  gapWindow: 2.6,       // |arrival-time difference| under which a crossing = conflict
  ttcHazard: 2.2,       // TTC (s) below which risk is considered high
  riskHigh:  0.6,       // risk score threshold for "high-risk interaction"
  conflictRadius: 2.4,  // metres, spatial tolerance for a shared conflict point

  /* --- pedestrian decision --- */
  pedGapAccept: 3.2,    // seconds of clear gap a cautious ped wants before crossing
  pedImpatience: 0.055, // per-second rise of crossing desire while waiting

  /* --- palette --- */
  col: {
    bg:        '#0b0e13',
    asphalt:   '#24272e',
    asphalt2:  '#1e2128',
    sidewalk:  '#3b414b',
    curb:      '#4a515c',
    block:     '#2b3038',   // corner buildings
    laneLine:  '#c9d1d9',
    centre:    '#e0b53c',
    crosswalk: '#c6ccd4',
    stopline:  '#e8edf2',
    text:      '#e6edf3',
    av:        '#5ad1c8',
    avSel:     '#7ef7ec',
    hv:        '#ff6b6b',
    ped:       '#4cc9f0',
    pedWait:   '#8b98a5',
    cyclist:   '#c197fc',
    ghost:     '#6ee7ff',
    riskLow:   '#37d67a',
    riskMid:   '#f0b429',
    riskHigh:  '#ff5470',
    edge:      '#6ee7ff',
    accent:    '#5ad1c8',
  },
};

/* Traffic-light timing (seconds) for the phase cycle. */
const LIGHT = {
  nsGreen: 8.5, nsYellow: 2.0, allRed1: 1.6,
  ewGreen: 8.5, ewYellow: 2.0, allRed2: 1.6,
};

/* Scenarios. */
const SCENARIOS = [
  { id: 'nominal', name: 'Nominal Flow',
    desc: 'Steady traffic. Cars follow lanes, obey signals, and yield to pedestrians in the crosswalks.',
    cars: 3, peds: 6, cyclists: 1, hard: false },
  { id: 'rush', name: 'Rush Hour',
    desc: 'Dense demand — more vehicles and pedestrians competing for the same space and time.',
    cars: 6, peds: 10, cyclists: 2, hard: false },
  { id: 'edge', name: 'Edge Cases',
    desc: 'The hard stuff: a jaywalker, an unprotected left turn, an occluded pedestrian behind a parked bus, an aggressive human driver, and a hesitating pedestrian.',
    cars: 4, peds: 7, cyclists: 1, hard: true },
];

/* Overlay visibility defaults. */
const OVERLAYS = {
  velocity:   true,
  prediction: true,
  uncertainty:true,
  conflicts:  true,
  ttc:        true,
  graph:      true,
  crosswalk:  true,
  heatmap:    false,
};

const OVERLAY_META = [
  ['prediction', 'Predicted paths'],
  ['uncertainty','Uncertainty'],
  ['velocity',   'Velocity arrows'],
  ['conflicts',  'Conflict points'],
  ['ttc',        'TTC labels'],
  ['graph',      'Interaction graph'],
  ['crosswalk',  'Crosswalk zones'],
  ['heatmap',    'Risk heatmap'],
];
