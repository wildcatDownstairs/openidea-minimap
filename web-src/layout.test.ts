// 运行：yarn test（Node 24 直接跑 TS）
import assert from "node:assert/strict";
import { test } from "node:test";
import { LINE_H, countsFromFolds, layout, lineForClick, lineForFrameTop, rows } from "./layout.ts";

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

test("折叠：被折叠的行不占缩略图行，换算来回一致", () => {
  // 第 10 行折叠了 11–19 行
  const map = rows(100, countsFromFolds(100, [{ fromLine: 10, toLine: 19 }]));
  assert.equal(map.total, 91);
  assert.equal(map.rowOf(10), 10);
  assert.equal(map.rowOf(20), 11);
  assert.equal(map.lineAt(11), 20);
  assert.equal(map.lineAt(10.5), 10.5);
  for (const l of [0, 5.25, 10, 20, 50.5, 99]) assert.ok(Math.abs(map.lineAt(map.rowOf(l)) - l) < 1e-9, `第 ${l} 行`);
});

test("自动换行：一行占好几个缩略图行", () => {
  const counts = new Array(10).fill(1);
  counts[3] = 4; // 第 3 行折成 4 行
  const map = rows(10, counts);
  assert.equal(map.total, 13);
  assert.equal(map.rowOf(4), 7);
  assert.equal(map.lineAt(5), 3.5);
});

test("有折叠时，视口框和点击都按缩略图行算", () => {
  // 1000 行，开头 10–509 行折叠，编辑器停在第 600 行
  const map = rows(1000, countsFromFolds(1000, [{ fromLine: 9, toLine: 509 }]));
  const v = view(600, 1000);
  const m = layout(v, 2400, map); // 499 行 × 4px 放得下：短文件
  assert.equal(m.travel, 0);
  assert.equal(m.frameTop, map.rowOf(600) * LINE_H);
  // 框原地不动，换算回的还是第 600 行
  assert.ok(Math.abs(lineForFrameTop(m, v, m.frameTop, map) - 600) < 1e-9);
  // 点在第 700 行的色块上：700 行居中
  const y = map.rowOf(700) * LINE_H + 1;
  assert.ok(Math.abs(lineForClick(m, v, y, map) + 20 - 700) < 1);
});
