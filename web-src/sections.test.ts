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
