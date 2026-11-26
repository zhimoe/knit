// Commit graph lanes — styled to match knit-prototype/app.js (36px row height,
// smooth cubic Bezier curves, HEAD filled dot, merge hollow+inner dot).

import type { Commit } from './types';

const PALETTE = ['#6ea8ff', '#68c98d', '#c18df2', '#e0a35c', '#e57984', '#5fa8c9'];
const LANE_W = 18;
const GRAPH_X0 = 14;
export const GRAPH_ROW_H = 36;

export interface GraphRow {
  lane: number;
  snapshot: number[];
  links: { from: number; to: number }[];
  isMerge: boolean;
  isHead: boolean;
}

export interface Graph {
  rows: GraphRow[];
  width: number;
}

/** `commits` must be topological (children before parents). */
export function computeGraph(commits: Commit[]): Graph {
  const indexByHash = new Map<string, number>();
  commits.forEach((c, i) => indexByHash.set(c.hash, i));
  const lanes: number[] = [];
  const rows: GraphRow[] = [];
  let maxLanes = 1;

  commits.forEach((commit, index) => {
    let lane = lanes.indexOf(index);
    if (lane < 0) {
      lane = lanes.indexOf(-1);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = index;
    }

    const links: { from: number; to: number }[] = [];
    if (commit.parents.length === 0) {
      lanes[lane] = -1;
    }
    commit.parents.forEach((parentHash, order) => {
      const parentIndex = indexByHash.get(parentHash) ?? -1;
      if (parentIndex < 0) {
        links.push({ from: lane, to: lane });
        return;
      }
      if (order === 0) {
        lanes[lane] = parentIndex;
        links.push({ from: lane, to: lane });
      } else {
        let target = lanes.indexOf(parentIndex);
        if (target < 0) {
          target = lanes.indexOf(-1);
          if (target < 0) target = lanes.length;
          lanes[target] = parentIndex;
        }
        links.push({ from: lane, to: target });
      }
    });

    const snapshot = lanes.slice();
    maxLanes = Math.max(maxLanes, snapshot.length, lane + 1);
    const isHead = index === 0 || commit.refs.some((r) => r.startsWith('HEAD'));
    rows.push({
      lane,
      snapshot,
      links,
      isMerge: commit.parents.length > 1,
      isHead,
    });
  });

  return { rows, width: Math.max(64, GRAPH_X0 + maxLanes * LANE_W + 6) };
}

const x = (lane: number): number => GRAPH_X0 + lane * LANE_W;
const laneColor = (lane: number, primaryColor?: string): string =>
  lane === 0 && primaryColor ? primaryColor : PALETTE[lane % PALETTE.length];

export function graphSvg(row: GraphRow, width: number, selected: boolean, primaryColor?: string): string {
  const parts: string[] = [];
  const cy = GRAPH_ROW_H / 2;

  row.snapshot.forEach((laneIndex, lane) => {
    if (laneIndex < 0) return;
    parts.push(
      `<line x1="${x(lane)}" y1="0" x2="${x(lane)}" y2="${GRAPH_ROW_H}" stroke="${laneColor(
        lane,
        primaryColor,
      )}" stroke-opacity=".8" stroke-width="1.8"/>`,
    );
  });

  const cx = x(row.lane);
  const col = laneColor(row.lane, primaryColor);

  parts.push(
    `<line x1="${cx}" y1="0" x2="${cx}" y2="${cy}" stroke="${col}" stroke-opacity=".9" stroke-width="1.8"/>`,
  );

  row.links.forEach((link) => {
    if (link.from === link.to) return;
    const x1 = x(link.from);
    const x2 = x(link.to);
    const lcol = laneColor(link.to, primaryColor);
    parts.push(
      `<path d="M ${x1} ${cy} C ${x1} ${cy + 10}, ${x2} ${cy + 9}, ${x2} ${GRAPH_ROW_H}" fill="none" stroke="${lcol}" stroke-width="1.8" stroke-linecap="round"/>`,
    );
  });

  if (selected) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="8.5" fill="${col}" opacity=".14"/>`);
  }
  if (row.isHead) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="5" fill="${col}"/>`);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="1.7" fill="#17181c" opacity=".9"/>`);
  } else if (row.isMerge) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="4.7" fill="#17181c" stroke="${col}" stroke-width="2"/>`);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="1.35" fill="${col}"/>`);
  } else {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="4" fill="#17181c" stroke="${col}" stroke-width="2"/>`);
  }

  return `<svg width="${width}" height="${GRAPH_ROW_H}" viewBox="0 0 ${width} ${GRAPH_ROW_H}" aria-hidden="true">${parts.join('')}</svg>`;
}
