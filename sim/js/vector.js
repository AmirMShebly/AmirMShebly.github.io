/* ============================================================================
   2D vector helpers (plain {x,y}) + small geometry utilities.
   ============================================================================ */

const V = {
  add(a, b)   { return { x: a.x + b.x, y: a.y + b.y }; },
  sub(a, b)   { return { x: a.x - b.x, y: a.y - b.y }; },
  mul(a, s)   { return { x: a.x * s,   y: a.y * s   }; },
  mid(a, b)   { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; },
  perp(a)     { return { x: -a.y, y: a.x }; },
  neg(a)      { return { x: -a.x, y: -a.y }; },
  clone(a)    { return { x: a.x, y: a.y }; },

  mag(a)      { return Math.hypot(a.x, a.y); },
  dist(a, b)  { return Math.hypot(a.x - b.x, a.y - b.y); },
  dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; },
  dot(a, b)   { return a.x * b.x + a.y * b.y; },
  angle(a)    { return Math.atan2(a.y, a.x); },

  norm(a)     { const m = Math.hypot(a.x, a.y) || 1; return { x: a.x / m, y: a.y / m }; },
  setMag(a,l) { const m = Math.hypot(a.x, a.y) || 1; return { x: a.x / m * l, y: a.y / m * l }; },
  fromAngle(t, l = 1) { return { x: Math.cos(t) * l, y: Math.sin(t) * l }; },
  lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; },
  rot(a, t)   { const c = Math.cos(t), s = Math.sin(t); return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }; },
};

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t)    { return a + (b - a) * t; }
function rand(lo, hi)     { return lo + Math.random() * (hi - lo); }
function randInt(lo, hi)  { return Math.floor(rand(lo, hi + 1)); }
function pick(arr)        { return arr[(Math.random() * arr.length) | 0]; }
function smoothstep(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }

/* Cubic Bézier point at parameter t. */
function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t, uu = u * u, tt = t * t;
  const a = uu * u, b = 3 * uu * t, c = 3 * u * tt, d = tt * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/* Shortest distance from point p to segment ab, plus the closest point. */
function pointSeg(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby || 1), 0, 1);
  const c = { x: a.x + abx * t, y: a.y + aby * t };
  return { dist: Math.hypot(p.x - c.x, p.y - c.y), t, point: c };
}

/* Segment–segment intersection point, or null. */
function segSeg(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y), t, u };
}

/* Is point p inside the (unrotated) axis-aligned box centred at c with half-extents h? */
function inBox(p, c, hx, hy) {
  return Math.abs(p.x - c.x) <= hx && Math.abs(p.y - c.y) <= hy;
}
