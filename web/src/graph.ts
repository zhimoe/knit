// Commit graph lanes — VS Code Git Graph / Fork / IDEA style DAG layout:
// - Zero zombie lanes: converging lanes merge & release immediately, p0 reuses
//   an existing target lane when already open, and truncated/root ends close cleanly.
// - Branch-continuous coloring: each lane carries its own color id across rows.
// - Dynamic compact width (13px lane spacing) with a hard cap (180px) so even
//   massive multi-merge histories never overlap the commit subject column.

import type { Commit } from './types';

const PALETTE = [
  '#2563eb', // cobalt (main)
  '#16a34a', // emerald
  '#7c3aed', // violet
  '#d97706', // amber
  '#e11d48', // rose
  '#0891b2', // cyan
  '#4f46e5', // indigo
  '#0d9488', // teal
];

const LANE_W = 13;
const GRAPH_X0 = 11;
export const GRAPH_ROW_H = 36;
export const MIN_GRAPH_W = 44;
export const MAX_GRAPH_W = 180;

interface LaneSlot {
  target: number; // commit index this lane is waiting for
  color: number;  // persistent branch color index
}

export interface GraphCurve {
  from: number;
  to: number;
  color: number;
}

export interface GraphPassLine {
  lane: number;
  color: number;
}

export interface GraphRow {
  lane: number;
  color: number;
  hasTop: boolean;
  hasBottom: boolean;
  truncatedBottom: boolean;
  passThrough: GraphPassLine[];
  inMerges: GraphCurve[];
  outBranches: GraphCurve[];
  isMerge: boolean;
  isHead: boolean;
}

export interface Graph {
  rows: GraphRow[];
  maxLanes: number;
  rawWidth: number;
  width: number;
  clipped: boolean;
}

function findFreeSlot(lanes: (LaneSlot | null)[], preferNear?: number): number {
  if (preferNear !== undefined) {
    // Prefer the closest free slot to the right of preferNear, then any leftmost free slot.
    for (let i = preferNear + 1; i < lanes.length; i += 1) {
      if (lanes[i] === null) return i;
    }
  }
  const idx = lanes.indexOf(null);
  return idx >= 0 ? idx : lanes.length;
}

function findTargetLane(lanes: (LaneSlot | null)[], target: number): number {
  for (let i = 0; i < lanes.length; i += 1) {
    if (lanes[i]?.target === target) return i;
  }
  return -1;
}

function trimTrailing(lanes: (LaneSlot | null)[]): void {
  while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
    lanes.pop();
  }
}

/** `commits` should be in topological or date-order (children before parents). */
export function computeGraph(commits: Commit[]): Graph {
  const indexByHash = new Map<string, number>();
  commits.forEach((c, i) => indexByHash.set(c.hash, i));

  const lanes: (LaneSlot | null)[] = [];
  const rows: GraphRow[] = [];
  let maxLanes = 1;
  let nextColor = 1;

  commits.forEach((commit, index) => {
    // 1. Find all incoming lanes waiting for this commit.
    const matched: number[] = [];
    for (let i = 0; i < lanes.length; i += 1) {
      if (lanes[i]?.target === index) matched.push(i);
    }

    let lane: number;
    let commitColor: number;
    let hasTop: boolean;
    const inMerges: GraphCurve[] = [];

    if (matched.length === 0) {
      // Fresh branch head / tip commit.
      lane = findFreeSlot(lanes);
      commitColor = lane === 0 ? 0 : nextColor++;
      lanes[lane] = { target: index, color: commitColor };
      hasTop = false;
    } else {
      lane = matched[0];
      commitColor = lanes[lane]!.color;
      hasTop = true;
      // Converge every duplicate lane targeting this commit into `lane` and release it!
      for (let m = 1; m < matched.length; m += 1) {
        const dup = matched[m];
        inMerges.push({ from: dup, to: lane, color: lanes[dup]!.color });
        lanes[dup] = null;
      }
    }

    // 2. Record straight pass-through lanes that are untouched by this commit.
    const passThrough: GraphPassLine[] = [];
    for (let i = 0; i < lanes.length; i += 1) {
      if (i !== lane && lanes[i] !== null) {
        passThrough.push({ lane: i, color: lanes[i]!.color });
      }
    }

    // 3. Advance `lanes` to the outgoing state for this commit's parents.
    const outBranches: GraphCurve[] = [];
    let hasBottom = false;
    let truncatedBottom = false;

    if (commit.parents.length === 0) {
      lanes[lane] = null;
    } else {
      // Primary parent (first parent)
      const p0Idx = indexByHash.get(commit.parents[0]) ?? -1;
      if (p0Idx < 0) {
        // Parent is beyond the loaded page: draw a short fade stub and free the lane.
        lanes[lane] = null;
        truncatedBottom = true;
      } else {
        const existingP0 = findTargetLane(lanes, p0Idx);
        if (existingP0 >= 0 && existingP0 !== lane) {
          // Another lane already heads to p0: curve smoothly into it and free our lane.
          outBranches.push({ from: lane, to: existingP0, color: commitColor });
          lanes[lane] = null;
        } else {
          lanes[lane] = { target: p0Idx, color: commitColor };
          hasBottom = true;
        }
      }

      // Secondary parents (merge commits)
      for (let o = 1; o < commit.parents.length; o += 1) {
        const piIdx = indexByHash.get(commit.parents[o]) ?? -1;
        if (piIdx < 0) continue;
        const existing = findTargetLane(lanes, piIdx);
        if (existing >= 0) {
          if (existing !== lane) {
            outBranches.push({ from: lane, to: existing, color: lanes[existing]!.color });
          }
        } else {
          const slot = findFreeSlot(lanes, lane);
          const col = nextColor++;
          lanes[slot] = { target: piIdx, color: col };
          outBranches.push({ from: lane, to: slot, color: col });
        }
      }
    }

    trimTrailing(lanes);

    // Track peak visual lane index across incoming, commit, pass-through, and outgoing elements.
    let rowMax = lane + 1;
    for (const p of passThrough) rowMax = Math.max(rowMax, p.lane + 1);
    for (const c of inMerges) rowMax = Math.max(rowMax, c.from + 1, c.to + 1);
    for (const c of outBranches) rowMax = Math.max(rowMax, c.from + 1, c.to + 1);
    if (lanes.length > rowMax) rowMax = lanes.length;
    if (rowMax > maxLanes) maxLanes = rowMax;

    const isHead = index === 0 || commit.refs.some((r) => r.startsWith('HEAD'));
    rows.push({
      lane,
      color: commitColor,
      hasTop,
      hasBottom,
      truncatedBottom,
      passThrough,
      inMerges,
      outBranches,
      isMerge: commit.parents.length > 1,
      isHead,
    });
  });

  const rawWidth = GRAPH_X0 + (maxLanes - 1) * LANE_W + 16;
  const width = Math.min(MAX_GRAPH_W, Math.max(MIN_GRAPH_W, rawWidth));
  return { rows, maxLanes, rawWidth, width, clipped: rawWidth > MAX_GRAPH_W };
}

const x = (lane: number): number => GRAPH_X0 + lane * LANE_W;

const colorFor = (colorIndex: number, primaryColor?: string): string => {
  if (colorIndex === 0 && primaryColor) return primaryColor;
  return PALETTE[Math.abs(colorIndex) % PALETTE.length];
};

export function graphSvg(row: GraphRow, width: number, selected: boolean, primaryColor?: string): string {
  const parts: string[] = [];
  const cy = GRAPH_ROW_H / 2;
  const cx = x(row.lane);
  const col = colorFor(row.color, primaryColor);

  // 1. Pass-through vertical lines (drawn beneath curves & node)
  for (const p of row.passThrough) {
    const px = x(p.lane);
    if (px > width + 8) continue;
    const pcol = colorFor(p.color, primaryColor);
    parts.push(
      `<line x1="${px}" y1="0" x2="${px}" y2="${GRAPH_ROW_H}" stroke="${pcol}" stroke-opacity=".72" stroke-width="1.75"/>`,
    );
  }

  // 2. Incoming converging curves (top half: y=0 -> cy)
  for (const curve of row.inMerges) {
    const x1 = x(curve.from);
    const x2 = x(curve.to);
    const ccol = colorFor(curve.color, primaryColor);
    parts.push(
      `<path d="M ${x1} 0 C ${x1} ${cy * 0.65}, ${x2} ${cy * 0.35}, ${x2} ${cy}" fill="none" stroke="${ccol}" stroke-opacity=".85" stroke-width="1.75" stroke-linecap="round"/>`,
    );
  }

  // 3. Outgoing branch/merge curves (bottom half: cy -> H)
  for (const curve of row.outBranches) {
    const x1 = x(curve.from);
    const x2 = x(curve.to);
    const ccol = colorFor(curve.color, primaryColor);
    parts.push(
      `<path d="M ${x1} ${cy} C ${x1} ${cy + (GRAPH_ROW_H - cy) * 0.6}, ${x2} ${cy + (GRAPH_ROW_H - cy) * 0.4}, ${x2} ${GRAPH_ROW_H}" fill="none" stroke="${ccol}" stroke-opacity=".88" stroke-width="1.75" stroke-linecap="round"/>`,
    );
  }

  // 4. Commit's own vertical segments
  if (row.hasTop) {
    parts.push(
      `<line x1="${cx}" y1="0" x2="${cx}" y2="${cy}" stroke="${col}" stroke-opacity=".9" stroke-width="1.75"/>`,
    );
  }
  if (row.hasBottom) {
    parts.push(
      `<line x1="${cx}" y1="${cy}" x2="${cx}" y2="${GRAPH_ROW_H}" stroke="${col}" stroke-opacity=".9" stroke-width="1.75"/>`,
    );
  } else if (row.truncatedBottom) {
    parts.push(
      `<line x1="${cx}" y1="${cy}" x2="${cx}" y2="${GRAPH_ROW_H}" stroke="${col}" stroke-opacity=".45" stroke-width="1.75" stroke-dasharray="2.5 2.5"/>`,
    );
  }

  // 5. Commit dot (drawn on top)
  if (selected) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="8" fill="${col}" opacity=".16"/>`);
  }
  if (row.isHead) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="4.8" fill="${col}"/>`);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="1.8" fill="var(--surface-graph, #ffffff)"/>`);
  } else if (row.isMerge) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="4.3" fill="var(--surface-graph, #ffffff)" stroke="${col}" stroke-width="1.9"/>`);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="1.45" fill="${col}"/>`);
  } else {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="3.6" fill="var(--surface-graph, #ffffff)" stroke="${col}" stroke-width="1.85"/>`);
  }

  return `<svg width="${width}" height="${GRAPH_ROW_H}" viewBox="0 0 ${width} ${GRAPH_ROW_H}" aria-hidden="true">${parts.join('')}</svg>`;
}
