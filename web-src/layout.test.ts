// 运行：yarn test（Node 24 直接跑 TS）
import assert from "node:assert/strict";
import { test } from "node:test";
import { LINE_H, layout, lineForClick, lineForFrameTop } from "./layout.ts";

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

test("点击框外：点击处画的那一行居中，长文件的缩略图卷动过也一样", () => {
  for (const [lines, first] of [
    [150, 0], // 短文件
    [1500, 296], // 长文件，缩略图已卷动（问题现场：点 390 行附近跳到了 930 行）
    [10_000, 5000],
  ]) {
    const v = view(first, lines);
    const m = layout(v, 800);
    const target = Math.min(first + 90, lines - 1); // 框下面一段内容
    const y = target * LINE_H - m.offset + 1; // 点在这一行的色块上
    assert.ok(y >= 0 && y < 800, `${lines} 行：目标行要在面板里`);
    const line = lineForClick(m, v, y);
    assert.ok(Math.abs(line + 20 - target) < 1, `${lines} 行：跳到 ${line}，期望 ${target - 20}`);
  }
});
