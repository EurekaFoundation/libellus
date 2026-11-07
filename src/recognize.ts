// Riconoscimento delle forme disegnate a mano.
// Si attiva quando, alla fine di un tratto di penna, si tiene fermo il puntatore per un attimo.

import type { ShapeItem, StrokeItem } from './model';

type P = [number, number];

const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function perpDist(p: P, a: P, b: P): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (!len) return dist(p, a);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

/** Semplificazione di Ramer-Douglas-Peucker: restituisce i "vertici" del tratto. */
function simplify(pts: P[], eps: number): P[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Aggancia l'angolo a multipli di 45° se ci si avvicina entro qualche grado. */
function snapAngle(a: P, b: P, tolDeg = 7): P {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const step = Math.PI / 4;
  const snapped = Math.round(ang / step) * step;
  if (Math.abs(ang - snapped) > (tolDeg * Math.PI) / 180) return b;
  const len = dist(a, b);
  return [a[0] + Math.cos(snapped) * len, a[1] + Math.sin(snapped) * len];
}

export function recognize(stroke: StrokeItem, id: string): ShapeItem | null {
  const pts: P[] = stroke.points.map(([x, y]) => [x, y]);
  if (pts.length < 6) return null;

  let pathLen = 0;
  for (let i = 1; i < pts.length; i++) pathLen += dist(pts[i - 1], pts[i]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const diag = Math.hypot(maxX - minX, maxY - minY);
  if (diag < 24) return null;

  const first = pts[0], last = pts[pts.length - 1];
  const base = { type: 'shape' as const, id, color: stroke.color, size: Math.max(2, stroke.size * 0.6) };

  // Linea: il tratto è quasi dritto.
  if (dist(first, last) / pathLen > 0.93) {
    return { ...base, kind: 'line', pts: [first, snapAngle(first, last)] };
  }

  // Forme chiuse: gli estremi si toccano (o quasi).
  const closed = dist(first, last) < Math.max(0.22 * diag, 18);
  if (!closed) return null;

  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const rx = (maxX - minX) / 2 || 1, ry = (maxY - minY) / 2 || 1;
  let ellipseErr = 0;
  for (const [x, y] of pts) ellipseErr += Math.abs(Math.hypot((x - cx) / rx, (y - cy) / ry) - 1);
  ellipseErr /= pts.length;

  let corners = simplify(pts, diag * 0.075);
  if (corners.length > 2 && dist(corners[0], corners[corners.length - 1]) < diag * 0.2) corners = corners.slice(0, -1);
  const n = corners.length;

  if (ellipseErr < 0.09 && n !== 3) return { ...base, kind: 'ellipse', pts: [[minX, minY], [maxX, maxY]] };

  if (n === 3) return { ...base, kind: 'polygon', pts: corners };

  if (n === 4) {
    const axisAligned = corners.every((c, i) => {
      const d = corners[(i + 1) % 4];
      const ang = Math.abs(Math.atan2(d[1] - c[1], d[0] - c[0])) % (Math.PI / 2);
      return Math.min(ang, Math.PI / 2 - ang) < (14 * Math.PI) / 180;
    });
    if (axisAligned) return { ...base, kind: 'rect', pts: [[minX, minY], [maxX, maxY]] };
    return { ...base, kind: 'polygon', pts: corners };
  }

  if (ellipseErr < 0.2) return { ...base, kind: 'ellipse', pts: [[minX, minY], [maxX, maxY]] };
  return null;
}
