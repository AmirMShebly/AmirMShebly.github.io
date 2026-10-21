/* ============================================================================
   ROAD — static geometry of the 4-way intersection.
   Builds lane routes (spawn → intersection → exit) as arc-length polylines,
   plus crosswalks, stop lines and signal-head positions.  Everything in metres.
   ============================================================================ */

const O    = CFG.laneOffset;
const BOX   = CFG.box;
const SPAWN = CFG.spawn;
const STOP  = CFG.stopLine;
const CROSS_OFF = BOX + CFG.crossWidth / 2;   // centre of a crosswalk band

// Each approach: where a vehicle enters from, travelling INTO the intersection.
const APPROACHES = {
  S: { travel: { x: 0, y: -1 }, spawn: { x: +O, y: +SPAWN }, boundary: { x: +O, y: +BOX }, stop: { x: +O, y: +STOP } },
  N: { travel: { x: 0, y: +1 }, spawn: { x: -O, y: -SPAWN }, boundary: { x: -O, y: -BOX }, stop: { x: -O, y: -STOP } },
  W: { travel: { x: +1, y: 0 }, spawn: { x: -SPAWN, y: +O }, boundary: { x: -BOX, y: +O }, stop: { x: -STOP, y: +O } },
  E: { travel: { x: -1, y: 0 }, spawn: { x: +SPAWN, y: -O }, boundary: { x: +BOX, y: -O }, stop: { x: +STOP, y: -O } },
};

// Each exit: the lane a vehicle leaves on, travelling AWAY from the intersection.
const EXITS = {
  N: { dir: { x: 0, y: -1 }, boundary: { x: +O, y: -BOX }, end: { x: +O, y: -SPAWN } },
  S: { dir: { x: 0, y: +1 }, boundary: { x: -O, y: +BOX }, end: { x: -O, y: +SPAWN } },
  E: { dir: { x: +1, y: 0 }, boundary: { x: +BOX, y: +O }, end: { x: +SPAWN, y: +O } },
  W: { dir: { x: -1, y: 0 }, boundary: { x: -BOX, y: -O }, end: { x: -SPAWN, y: -O } },
};

// From an approach + movement, which exit do you take?
const MOVEMENTS = {
  S: { through: 'N', left: 'W', right: 'E' },
  N: { through: 'S', left: 'E', right: 'W' },
  W: { through: 'E', left: 'N', right: 'S' },
  E: { through: 'W', left: 'S', right: 'N' },
};

// The 4 crosswalks (a pedestrian walks along segment a→b).
const CROSSWALKS = {
  S: { id: 'S', a: { x: -BOX, y: +CROSS_OFF }, b: { x: +BOX, y: +CROSS_OFF }, axis: 'h' },
  N: { id: 'N', a: { x: -BOX, y: -CROSS_OFF }, b: { x: +BOX, y: -CROSS_OFF }, axis: 'h' },
  E: { id: 'E', a: { x: +CROSS_OFF, y: -BOX }, b: { x: +CROSS_OFF, y: +BOX }, axis: 'v' },
  W: { id: 'W', a: { x: -CROSS_OFF, y: -BOX }, b: { x: -CROSS_OFF, y: +BOX }, axis: 'v' },
};

class Route {
  constructor(id, from, movement, to, pts) {
    this.id = id;
    this.from = from;
    this.movement = movement;   // 'through' | 'left' | 'right'
    this.to = to;
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + V.dist(pts[i - 1], pts[i]));
    this.length = this.cum[this.cum.length - 1];
    this.stopDist = V.dist(APPROACHES[from].spawn, APPROACHES[from].stop);
    this.enterDist = V.dist(APPROACHES[from].spawn, APPROACHES[from].boundary);
  }

  /* Project a world point onto the route; returns arc-length + lateral offset. */
  project(p) {
    let best = { dist: 0, lat: Infinity, point: this.pts[0] };
    for (let i = 1; i < this.pts.length; i++) {
      const ps = pointSeg(p, this.pts[i - 1], this.pts[i]);
      if (ps.dist < best.lat) {
        best = { dist: this.cum[i - 1] + ps.t * (this.cum[i] - this.cum[i - 1]), lat: ps.dist, point: ps.point };
      }
    }
    return best;
  }

  /* Position + heading at arc-length d along the route. */
  sample(d) {
    d = clamp(d, 0, this.length);
    let i = 1;
    while (i < this.cum.length && this.cum[i] < d) i++;
    const a = this.pts[i - 1], b = this.pts[i] || this.pts[i - 1];
    const seg = (this.cum[i] - this.cum[i - 1]) || 1;
    const t = (d - this.cum[i - 1]) / seg;
    return {
      pos: V.lerp(a, b, t),
      heading: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }
}

function buildRoutePolyline(from, to, movement) {
  const a = APPROACHES[from], e = EXITS[to];
  const pts = [];
  const push = p => { if (!pts.length || V.dist(pts[pts.length - 1], p) > 1e-6) pts.push(p); };

  // straight approach segment (sampled so distance-along is accurate)
  const inSteps = 8;
  for (let i = 0; i <= inSteps; i++) push(V.lerp(a.spawn, a.boundary, i / inSteps));

  // curved segment through the intersection (cubic Bézier matching tangents)
  const k = V.dist(a.boundary, e.boundary) * 0.55;
  const p0 = a.boundary;
  const p1 = V.add(a.boundary, V.mul(a.travel, k));
  const p2 = V.sub(e.boundary, V.mul(e.dir, k));
  const p3 = e.boundary;
  const curveSteps = movement === 'through' ? 4 : 16;
  for (let i = 1; i <= curveSteps; i++) push(bezier(p0, p1, p2, p3, i / curveSteps));

  // straight exit segment
  const outSteps = 8;
  for (let i = 1; i <= outSteps; i++) push(V.lerp(e.boundary, e.end, i / outSteps));

  return pts;
}

const Road = {
  approaches: APPROACHES,
  exits: EXITS,
  crosswalks: CROSSWALKS,
  routes: [],
  routesByFrom: { S: [], N: [], W: [], E: [] },

  build() {
    this.routes = [];
    this.routesByFrom = { S: [], N: [], W: [], E: [] };
    for (const from of ['S', 'N', 'W', 'E']) {
      for (const movement of ['through', 'left', 'right']) {
        const to = MOVEMENTS[from][movement];
        const pts = buildRoutePolyline(from, to, movement);
        const r = new Route(`${from}-${movement}`, from, movement, to, pts);
        this.routes.push(r);
        this.routesByFrom[from].push(r);
      }
    }
    this.buildCrossings();
    return this;
  },

  /* Precompute, for every ordered pair of routes, where their centrelines
     cross inside the intersection (arc-length on each). Used for priority-based
     conflict resolution. Routes that merely share an approach or exit lane are
     collinear there and produce no transversal crossing — those are handled by
     same-lane following instead. */
  buildCrossings() {
    this.crossings = {};
    const lim = CFG.box + CFG.crossWidth + 2;
    for (const A of this.routes) {
      for (const B of this.routes) {
        if (A === B) continue;
        // Vehicles from the SAME approach share the approach lane — they are
        // ordered by lane-following, never by crossing priority. (Their polylines
        // only "touch" at the divergence point, which would otherwise make the
        // lead car spuriously yield to the car behind it → deadlock.)
        if (A.from === B.from) continue;
        const c = this._firstCross(A, B, lim);
        if (c) (this.crossings[A.id] = this.crossings[A.id] || {})[B.id] = c;
      }
    }
  },

  _firstCross(A, B, lim) {
    for (let a = 1; a < A.pts.length; a++) {
      for (let b = 1; b < B.pts.length; b++) {
        const hit = segSeg(A.pts[a - 1], A.pts[a], B.pts[b - 1], B.pts[b]);
        if (hit && Math.hypot(hit.x, hit.y) < lim) {
          return {
            arcA: A.cum[a - 1] + V.dist(A.pts[a - 1], hit),
            arcB: B.cum[b - 1] + V.dist(B.pts[b - 1], hit),
            point: { x: hit.x, y: hit.y },
          };
        }
      }
    }
    return null;
  },

  randomRoute(from) {
    const list = from ? this.routesByFrom[from] : this.routes;
    return pick(list);
  },

  /* Which crosswalks does a route physically cross, and at what arc-length? */
  crosswalkHits(route) {
    const hits = [];
    for (const key in CROSSWALKS) {
      const cw = CROSSWALKS[key];
      for (let i = 1; i < route.pts.length; i++) {
        const hit = segSeg(route.pts[i - 1], route.pts[i], cw.a, cw.b);
        if (hit) {
          const d = route.cum[i - 1] + V.dist(route.pts[i - 1], hit) ;
          hits.push({ cw: key, dist: d, point: { x: hit.x, y: hit.y } });
          break;
        }
      }
    }
    return hits;
  },
};
