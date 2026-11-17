/**
 * 缩略图的几何：每个缩略图行固定高度，文件比面板长时缩略图随编辑器一起滚动（同 VS Code / CodeGlance）。
 * 编辑器的行和缩略图行由 `Rows` 对应：折叠掉的行占 0 行，自动换行的行占多行（API 1.10 的 folded / wrapped）。
 */
import type { EditorViewport } from "./openidea.ts";

/** 每行在缩略图里的高度（CSS 像素），其中 1px 是行间的缝。 */
export const LINE_H = 4;
/** 每个字符的宽度（CSS 像素）。 */
export const CHAR_W = 2;

export interface MapLayout {
  /** 缩略图内容往上卷走的高度（CSS 像素）。 */
  offset: number;
  /** 视口框在面板里的位置和高度。 */
  frameTop: number;
  frameH: number;
  /** 长文件：视口框能上下移动的距离，框的位置就是编辑器的滚动比例。短文件为 0，框按行定位。 */
  travel: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** 编辑器的行（可带小数）↔ 缩略图行（可带小数）。 */
export interface Rows {
  /** 缩略图行的总数。 */
  readonly total: number;
  /** 第 `line` 行占几个缩略图行（0：被折叠）。 */
  count(line: number): number;
  /** 第 `line` 行开头所在的缩略图行；小数部分按该行占的行数折算。 */
  rowOf(line: number): number;
  /** `rowOf` 的反函数：缩略图第 `row` 行属于编辑器哪一行（跳过折叠掉的行）。 */
  lineAt(row: number): number;
}

/** 每行占几个缩略图行；`counts` 为 null 时每行 1 行。 */
export function rows(lineCount: number, counts: ArrayLike<number> | null = null): Rows {
  const n = Math.max(1, lineCount);
  if (!counts) {
    return { total: n, count: () => 1, rowOf: (l) => clamp(l, 0, n), lineAt: (r) => clamp(r, 0, n) };
  }
  // start[i]：第 i 行之前一共多少缩略图行
  const start = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i]! + (counts[i] ?? 1);
  const total = start[n]!;
  const count = (l: number) => (l >= 0 && l < n ? (counts[l] ?? 1) : 0);
  return {
    total,
    count,
    rowOf(line) {
      const l = clamp(line, 0, n);
      const i = Math.floor(l);
      return i >= n ? total : start[i]! + (l - i) * count(i);
    },
    lineAt(row) {
      const r = clamp(row, 0, total);
      // 第一个 start[i + 1] > r 的行：折叠掉的行 start 不增长，自然被跳过
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (start[mid + 1]! > r) hi = mid;
        else lo = mid + 1;
      }
      if (lo >= n) return n;
      return lo + (r - start[lo]!) / (count(lo) || 1);
    },
  };
}

/** 折叠范围 → 每行的缩略图行数：`fromLine` 留着，后面到 `toLine` 的行占 0 行。 */
export function countsFromFolds(lineCount: number, folded: readonly { fromLine: number; toLine: number }[]): Uint8Array | null {
  if (!folded.length) return null;
  const counts = new Uint8Array(Math.max(1, lineCount)).fill(1);
  for (const f of folded) counts.fill(0, Math.max(0, f.fromLine + 1), Math.min(counts.length, f.toLine + 1));
  return counts;
}

export function layout(v: EditorViewport, panelH: number, map: Rows = rows(v.lineCount), lineH = LINE_H): MapLayout {
  const top = map.rowOf(v.firstLine);
  const frameH = Math.max(0, map.rowOf(v.lastLine) - top) * lineH;
  if (map.total * lineH <= panelH) return { offset: 0, frameTop: top * lineH, frameH, travel: 0 };
  const scrollable = v.scrollHeight - v.clientHeight;
  const p = scrollable > 0 ? clamp(v.scrollTop / scrollable, 0, 1) : 0;
  const travel = Math.max(0, panelH - frameH);
  const frameTop = p * travel;
  // 内容跟着框走，让框里正好是编辑器看得见的那几行
  return { offset: Math.max(0, top * lineH - frameTop), frameTop, frameH, travel };
}

/**
 * 视口框顶部拖到 `frameTop` 时编辑器应滚到的首行。
 * 长文件里行和像素的对应只有当前视口是准的（代码透镜、折叠会让行高不一），
 * 所以从当前视口按平均行高推算；视口更新后再算一次，几帧内就对准了。
 */
export function lineForFrameTop(
  m: MapLayout,
  v: EditorViewport,
  frameTop: number,
  map: Rows = rows(v.lineCount),
  lineH = LINE_H,
): number {
  if (!m.travel) return map.lineAt(frameTop / lineH);
  const scrollable = Math.max(0, v.scrollHeight - v.clientHeight);
  const target = clamp(frameTop / m.travel, 0, 1) * scrollable;
  // 按缩略图行（而不是编辑器行）摊平均高度：折叠掉的行不占高度，换行的行占好几行
  return map.lineAt(map.rowOf(v.firstLine) + (target - v.scrollTop) / (v.scrollHeight / map.total));
}

/**
 * 点击缩略图（框外）时编辑器应滚到的首行：点击处画的那一行居中。
 * 长文件的缩略图卷动过，点击处的行要加上 offset 算，不能按滚动比例换算（那是拖框用的）。
 */
export function lineForClick(
  m: MapLayout,
  v: EditorViewport,
  y: number,
  map: Rows = rows(v.lineCount),
  lineH = LINE_H,
): number {
  const clicked = (m.offset + y) / lineH;
  const visible = map.rowOf(v.lastLine) - map.rowOf(v.firstLine);
  return map.lineAt(clicked - visible / 2);
}
