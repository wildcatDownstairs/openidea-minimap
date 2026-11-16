// 运行：yarn test（Node 24 直接跑 TS）
import assert from "node:assert/strict";
import { test } from "node:test";
import { LINE_H, layout, lineForFrameTop } from "./layout.ts";

const view = (first: number, lineCount: number, visible = 40, pxPerLine = 20, pastEnd = 0) => {
  const clientHeight = visible * pxPerLine;
  const scrollHeight = (lineCount + pastEnd) * pxPerLine;
  return { firstLine: first, lastLine: first + visible, lineCount, scrollTop: first * pxPerLine, scrollHeight, clientHeight };
};

test("视口框停在原地时，换算回的就是当前首行", () => {
  for (const [lines, pastEnd] of [
    [150, 0], // 短文件：缩略图不滚动
    [10_000, 0], // 长文件：缩略图跟着滚
    [10_000, 39], // 编辑器可以滚过末尾
  ]) {
    for (const first of [0, 13.5, lines / 3, lines - 40 + pastEnd]) {
      const v = view(first, lines, 40, 20, pastEnd);
      const m = layout(v, 800);
      assert.ok(Math.abs(lineForFrameTop(m, v, m.frameTop) - first) < 1e-6, `${lines} 行, 首行 ${first}`);
    }
  }
});

test("长文件：框拖到底就滚到底，滚到底时框贴着面板底边", () => {
  const v = view(0, 10_000);
  const m = layout(v, 800);
  assert.equal(lineForFrameTop(m, v, m.travel), 10_000 - 40);
  const end = view(10_000 - 40, 10_000);
  const e = layout(end, 800);
  assert.ok(Math.abs(e.frameTop + e.frameH - 800) < 1e-6);
  // 框里正好是编辑器看得见的那几行
  assert.ok(Math.abs(end.firstLine * LINE_H - e.offset - e.frameTop) < 1e-6);
});
