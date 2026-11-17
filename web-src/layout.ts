/** 缩略图的几何：每行固定高度，文件比面板长时缩略图随编辑器一起滚动（同 VS Code / CodeGlance）。 */
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

export function layout(v: EditorViewport, panelH: number, lineH = LINE_H): MapLayout {
  const lines = Math.max(1, v.lineCount);
  const frameH = Math.max(0, v.lastLine - v.firstLine) * lineH;
  if (lines * lineH <= panelH) return { offset: 0, frameTop: v.firstLine * lineH, frameH, travel: 0 };
  const scrollable = v.scrollHeight - v.clientHeight;
  const p = scrollable > 0 ? clamp(v.scrollTop / scrollable, 0, 1) : 0;
  const travel = Math.max(0, panelH - frameH);
  const frameTop = p * travel;
  // 内容跟着框走，让框里正好是编辑器看得见的那几行
  return { offset: Math.max(0, v.firstLine * lineH - frameTop), frameTop, frameH, travel };
}

/**
 * 视口框顶部拖到 `frameTop` 时编辑器应滚到的首行。
 * 长文件里行和像素的对应只有当前视口是准的（代码透镜、折叠会让行高不一），
 * 所以从当前视口按平均行高推算；视口更新后再算一次，几帧内就对准了。
 */
export function lineForFrameTop(m: MapLayout, v: EditorViewport, frameTop: number, lineH = LINE_H): number {
  const lines = Math.max(1, v.lineCount);
  if (!m.travel) return clamp(frameTop / lineH, 0, lines);
  const scrollable = Math.max(0, v.scrollHeight - v.clientHeight);
  const target = clamp(frameTop / m.travel, 0, 1) * scrollable;
  return clamp(v.firstLine + (target - v.scrollTop) / (v.scrollHeight / lines), 0, lines);
}

/**
 * 点击缩略图（框外）时编辑器应滚到的首行：点击处画的那一行居中。
 * 长文件的缩略图卷动过，点击处的行要加上 offset 算，不能按滚动比例换算（那是拖框用的）。
 */
export function lineForClick(m: MapLayout, v: EditorViewport, y: number, lineH = LINE_H): number {
  const lines = Math.max(1, v.lineCount);
  const clicked = (m.offset + y) / lineH;
  return clamp(clicked - (v.lastLine - v.firstLine) / 2, 0, lines);
}
