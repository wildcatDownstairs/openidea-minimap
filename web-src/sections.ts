/** 分区标题（同 VS Code 缩略图）：`// MARK: 标题`、`// MARK: - 标题`（带分隔线）和带名字的 `#region 标题`。 */
export interface SectionHeader {
  label: string;
  /** `MARK: -`：标题上方画一条分隔线。 */
  separator: boolean;
}

// VS Code 的默认写法（editor.minimap.markSectionHeaderRegex）
const MARK = /\bMARK:\s*(-?)\s*(.*?)\s*(?:\*\/|-->)?\s*$/;
// `// #region`、`# region`、`#region`、`<!-- #region -->`、`/* #region */`；`#endregion` 不算
const REGION = /^\s*(?:(?:\/\/|\/\*|<!--|--|;|')\s*#?|#\s*)region\b\s*(.*?)\s*(?:\*\/|-->)?\s*$/;

export function sectionHeader(line: string): SectionHeader | null {
  // 先粗筛，绝大多数行不用跑正则
  if (!line.includes("MARK:") && !line.includes("region")) return null;
  const m = MARK.exec(line);
  if (m) return m[2] || m[1] ? { label: m[2]!, separator: !!m[1] } : null;
  const r = REGION.exec(line);
  return r?.[1] ? { label: r[1], separator: false } : null;
}
