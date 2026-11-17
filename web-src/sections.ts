/** 分区标题（同 VS Code 缩略图）：`// MARK: 标题`、`// MARK: - 标题`（带分隔线）和带名字的 `#region 标题`。 */
export interface SectionHeader {
  label: string;
  /** `MARK: -`：标题上方画一条分隔线。 */
  separator: boolean;
}

/** 标题最多取这么多个字符：110px 的面板本来也只写得下二十来个字。 */
const MAX_LABEL = 100;
// 行终止符：CodeMirror 把 U+2028 / U+2029（和单独的 \r）留在同一行里，标题只取它们之前的部分
const BREAK = /[\r\u2028\u2029]/;
// `// #region`、`# region`、`#region`、`<!-- #region -->`、`/* #region */`；`#endregion` 不算。
// 只匹配开头一小段，没有可以互相让位的量词，不会回溯
const REGION = /^[ \t]*(?:(?:\/\/|\/\*|<!--|--|;|')[ \t]*#?|#[ \t]*)region\b/;

/** 去掉行尾的块注释结束符（星号加斜杠、`-->`）和空白。 */
function stripClose(s: string): string {
  s = s.trimEnd();
  if (s.endsWith("*/")) s = s.slice(0, -2);
  else if (s.endsWith("-->")) s = s.slice(0, -3);
  return s.trim();
}

/**
 * 不用整行正则：先截到第一个行终止符，再用 indexOf / startsWith 和字符串裁剪，
 * 每行的工作量和长度成正比（0.1.2 的正则有重叠的 `\s*`，遇到 U+2028 会指数回溯）。
 */
export function sectionHeader(line: string): SectionHeader | null {
  // 先粗筛，绝大多数行不用往下走
  if (!line.includes("MARK:") && !line.includes("region")) return null;
  const cut = line.search(BREAK);
  const text = cut >= 0 ? line.slice(0, cut) : line;

  const at = text.indexOf("MARK:");
  // 同 VS Code 的 `\bMARK:`：前面不能紧挨着字母、数字或下划线
  if (at >= 0 && !/\w/.test(text[at - 1] ?? "")) {
    let rest = stripClose(text.slice(at + 5));
    const separator = rest.startsWith("-");
    if (separator) rest = rest.slice(1).trim();
    return rest || separator ? { label: rest.slice(0, MAX_LABEL), separator } : null;
  }
  const m = REGION.exec(text);
  if (!m) return null;
  const label = stripClose(text.slice(m[0].length));
  return label ? { label: label.slice(0, MAX_LABEL), separator: false } : null;
}
