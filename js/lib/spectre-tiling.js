/**
 * Spectre monotile patch generator.
 *
 * The Spectre (Smith, Myers, Kaplan, Goodman-Strauss 2023) is a single
 * 14-sided tile that covers the plane only in non-repeating, one-handed
 * arrangements. This module ports the published hierarchical substitution
 * system (nine metatile labels + the "mystic" Gamma pair) and flattens the
 * recursion into a renderable patch: every tile with its transform, label,
 * and ancestry through the substitution hierarchy.
 *
 * Geometry and substitution rules follow the reference implementation
 * (Kaplan's spectre app / shrx-spectre port).
 */

const SQ3 = Math.sqrt(3);

export const SPECTRE_POINTS = [
  [0, 0],
  [1.0, 0.0],
  [1.5, -SQ3 / 2],
  [1.5 + SQ3 / 2, 0.5 - SQ3 / 2],
  [1.5 + SQ3 / 2, 1.5 - SQ3 / 2],
  [2.5 + SQ3 / 2, 1.5 - SQ3 / 2],
  [3 + SQ3 / 2, 1.5],
  [3.0, 2.0],
  [3 - SQ3 / 2, 1.5],
  [2.5 - SQ3 / 2, 1.5 + SQ3 / 2],
  [1.5 - SQ3 / 2, 1.5 + SQ3 / 2],
  [0.5 - SQ3 / 2, 1.5 + SQ3 / 2],
  [-SQ3 / 2, 1.5],
  [0.0, 1.0],
];

const TILE_NAMES = ['Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi'];
const IDENTITY = [1, 0, 0, 0, 1, 0];

// affine ops on [a,b,tx, c,d,ty]
function mul(A, B) {
  return [
    A[0] * B[0] + A[1] * B[3],
    A[0] * B[1] + A[1] * B[4],
    A[0] * B[2] + A[1] * B[5] + A[2],
    A[3] * B[0] + A[4] * B[3],
    A[3] * B[1] + A[4] * B[4],
    A[3] * B[2] + A[4] * B[5] + A[5],
  ];
}
const trot = (ang) => {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return [c, -s, 0, s, c, 0];
};
const ttrans = (tx, ty) => [1, 0, tx, 0, 1, ty];
const transPt = (M, P) => [M[0] * P[0] + M[1] * P[1] + M[2], M[3] * P[0] + M[4] * P[1] + M[5]];
const transTo = (p, q) => ttrans(q[0] - p[0], q[1] - p[1]);

const QUAD_IDX = [3, 5, 7, 11];

function buildSpectreBase() {
  const base = {};
  for (const label of TILE_NAMES) {
    if (label === 'Gamma') continue;
    base[label] = { tile: true, label, quad: QUAD_IDX.map((i) => SPECTRE_POINTS[i]) };
  }
  // "mystic" Gamma: a pair of spectres, the second rotated 30 degrees
  base.Gamma = {
    tile: false,
    quad: QUAD_IDX.map((i) => SPECTRE_POINTS[i]),
    children: [
      [{ tile: true, label: 'Gamma1' }, IDENTITY],
      [{ tile: true, label: 'Gamma2' },
        mul(ttrans(SPECTRE_POINTS[8][0], SPECTRE_POINTS[8][1]), trot(Math.PI / 6))],
    ],
  };
  return base;
}

function buildSupertiles(system) {
  const quad = system.Delta.quad;
  const R = [-1, 0, 0, 0, 1, 0];
  const rules = [
    [60, 3, 1], [0, 2, 0], [60, 3, 1], [60, 3, 1],
    [0, 2, 0], [60, 3, 1], [-120, 3, 3],
  ];

  const transformations = [IDENTITY.slice()];
  let totalAngle = 0;
  let rotation = IDENTITY;
  let transformedQuad = quad.slice();
  for (const [angle, from, to] of rules) {
    if (angle !== 0) {
      totalAngle += angle;
      rotation = trot((totalAngle * Math.PI) / 180);
      transformedQuad = quad.map((q) => transPt(rotation, q));
    }
    const ttt = transTo(transformedQuad[to], transPt(transformations[transformations.length - 1], quad[from]));
    transformations.push(mul(ttt, rotation));
  }
  const placed = transformations.map((T) => mul(R, T));

  const superRules = {
    Gamma: ['Pi', 'Delta', null, 'Theta', 'Sigma', 'Xi', 'Phi', 'Gamma'],
    Delta: ['Xi', 'Delta', 'Xi', 'Phi', 'Sigma', 'Pi', 'Phi', 'Gamma'],
    Theta: ['Psi', 'Delta', 'Pi', 'Phi', 'Sigma', 'Pi', 'Phi', 'Gamma'],
    Lambda: ['Psi', 'Delta', 'Xi', 'Phi', 'Sigma', 'Pi', 'Phi', 'Gamma'],
    Xi: ['Psi', 'Delta', 'Pi', 'Phi', 'Sigma', 'Psi', 'Phi', 'Gamma'],
    Pi: ['Psi', 'Delta', 'Xi', 'Phi', 'Sigma', 'Psi', 'Phi', 'Gamma'],
    Sigma: ['Xi', 'Delta', 'Xi', 'Phi', 'Sigma', 'Pi', 'Lambda', 'Gamma'],
    Phi: ['Psi', 'Delta', 'Psi', 'Phi', 'Sigma', 'Pi', 'Phi', 'Gamma'],
    Psi: ['Psi', 'Delta', 'Psi', 'Phi', 'Sigma', 'Psi', 'Phi', 'Gamma'],
  };
  const superQuad = [
    transPt(placed[6], quad[2]),
    transPt(placed[5], quad[1]),
    transPt(placed[3], quad[2]),
    transPt(placed[0], quad[1]),
  ];

  const next = {};
  for (const [label, subs] of Object.entries(superRules)) {
    const children = [];
    for (let i = 0; i < subs.length; i++) {
      if (subs[i]) children.push([system[subs[i]], placed[i]]);
    }
    next[label] = { tile: false, quad: superQuad, children };
  }
  return next;
}

/**
 * Build a flattened Spectre patch.
 * iterations: substitution depth (3 => ~hundreds, 4 => ~thousands of tiles)
 * Returns { tiles: [{ points: Float64Array(28), cx, cy, label, angle,
 *                     parents: [idAtDepth0(coarsest) ... idAtDeepest] }],
 *           bounds: {minX, minY, maxX, maxY} }
 */
export function buildSpectrePatch(iterations) {
  let system = buildSpectreBase();
  for (let i = 0; i < iterations; i++) system = buildSupertiles(system);

  const tiles = [];
  const counters = []; // per-depth child counters to make ancestry ids

  function walk(node, T, ancestry) {
    if (node.tile !== false && node.tile === true) {
      // leaf spectre
      const pts = new Float64Array(28);
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < 14; i++) {
        const p = transPt(T, SPECTRE_POINTS[i]);
        pts[i * 2] = p[0];
        pts[i * 2 + 1] = p[1];
        cx += p[0];
        cy += p[1];
      }
      tiles.push({
        points: pts,
        cx: cx / 14,
        cy: cy / 14,
        label: node.label,
        angle: Math.atan2(T[3], T[0]),
        parents: ancestry.slice(),
      });
      return;
    }
    for (let i = 0; i < node.children.length; i++) {
      const [child, ct] = node.children[i];
      walk(child, mul(T, ct), ancestry.concat(i));
    }
  }
  void counters;
  walk(system.Delta, IDENTITY, []);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tiles) {
    if (t.cx < minX) minX = t.cx;
    if (t.cx > maxX) maxX = t.cx;
    if (t.cy < minY) minY = t.cy;
    if (t.cy > maxY) maxY = t.cy;
  }
  return { tiles, bounds: { minX, minY, maxX, maxY } };
}
