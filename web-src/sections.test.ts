// 运行：yarn test
import assert from "node:assert/strict";
import { test } from "node:test";
import { sectionHeader } from "./sections.ts";

test("MARK 和带名字的 region 是分区标题", () => {
  assert.deepEqual(sectionHeader("// MARK: 用户信息"), { label: "用户信息", separator: false });
  assert.deepEqual(sectionHeader("  // MARK: - Layout"), { label: "Layout", separator: true });
  assert.deepEqual(sectionHeader("/* MARK: Styles */"), { label: "Styles", separator: false });
  assert.deepEqual(sectionHeader("# MARK: -"), { label: "", separator: true });
  assert.deepEqual(sectionHeader("// #region Handlers"), { label: "Handlers", separator: false });
  assert.deepEqual(sectionHeader("//#region Handlers"), { label: "Handlers", separator: false });
  assert.deepEqual(sectionHeader("#region Fields"), { label: "Fields", separator: false });
  assert.deepEqual(sectionHeader("# region utils"), { label: "utils", separator: false });
  assert.deepEqual(sectionHeader("<!-- #region nav -->"), { label: "nav", separator: false });
});

test("其他行不是", () => {
  for (const line of [
    "// #region",
    "// #endregion Handlers",
    "#endregion",
    "const region = 1;",
    "regionName = 'x'",
    "region = 1;",
    "// MARK:",
    "const s = 'nothing';",
  ]) {
    assert.equal(sectionHeader(line), null, line);
  }
});

test("U+2028 / U+2029 / \\r：标题只取它们之前的部分", () => {
  assert.deepEqual(sectionHeader("// MARK: Rows\u2028more"), { label: "Rows", separator: false });
  assert.deepEqual(sectionHeader("// #region Helpers\u2029x"), { label: "Helpers", separator: false });
  assert.deepEqual(sectionHeader("// MARK: - Render\r"), { label: "Render", separator: true });
  assert.equal(sectionHeader("// MARK:\u2028Y"), null);
});

test("MARK 前面紧挨着字母不算，标题过长只取前一段", () => {
  assert.equal(sectionHeader("// BOOKMARK: x"), null);
  assert.equal(sectionHeader("// MARK: " + "a".repeat(1000))!.label.length, 100);
});

test("解析时间和行长成正比：审核里的回溯输入", () => {
  // 0.1.2 的正则在这类输入上指数回溯：256 个空格要十几秒
  const inputs = [
    "// MARK: " + " ".repeat(256) + "X\u2028Y",
    "// MARK: " + " ".repeat(100_000) + "X\u2028Y",
    "// MARK: -" + " \t".repeat(50_000) + "-->x",
    "// #region " + " ".repeat(100_000) + "X\u2028Y",
    "/* MARK: " + "*/ ".repeat(50_000),
  ];
  const t = performance.now();
  for (let k = 0; k < 100; k++) for (const line of inputs) sectionHeader(line);
  const ms = performance.now() - t;
  assert.ok(ms < 200, `500 次解析用了 ${ms.toFixed(1)}ms`);
  assert.deepEqual(sectionHeader(inputs[0]!), { label: "X", separator: false });
});
