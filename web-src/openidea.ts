/** 页面里 `window.openidea` 中本插件用到的部分（PR #3677 的 frame-bridge.js）。 */

export interface EditorTarget {
  path: string;
  language: string;
  version: number;
  lineCount: number;
}

export interface EditorViewport {
  firstLine: number;
  lastLine: number;
  lineCount: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface HighlightSpan {
  from: number;
  to: number;
  color: string;
}

/** API 1.10：问题标记栏里的一个问题。 */
export interface Problem {
  line: number;
  lastLine: number;
  severity: string; // "error" | "warning" | "weakWarning"
}

/** API 1.10：一个折叠范围，`fromLine` 留着，`fromLine + 1` 到 `toLine` 被藏起来。 */
export interface Fold {
  fromLine: number;
  toLine: number;
}

export interface Theme {
  dark: boolean;
  vars: Record<string, string>;
}

interface DocumentState {
  version: number;
  text: string;
}

export interface OpenIdeaEditor {
  get(): Promise<EditorTarget | null>;
  onTarget(fn: (t: EditorTarget | null) => void): void;
  document: {
    get(): Promise<DocumentState>;
    onChange(fn: (d: DocumentState) => void): void;
  };
  viewport(): Promise<EditorViewport | null>;
  onViewport(fn: (v: EditorViewport) => void): void;
  scrollTo(line: number): Promise<void>;
  scrollBy(pixels: number): Promise<void>;
  highlights(fromLine: number, toLine: number): Promise<HighlightSpan[][]>;
  onHighlights(fn: (r: { fromLine: number; toLine: number }) => void): void;
  // 以下是 API 1.10，旧版 IDE 没有：用之前先判断
  problems?(): Promise<Problem[]>;
  onProblems?(fn: (p: Problem[]) => void): void;
  folded?(): Promise<Fold[]>;
  /** 每行占几个视觉行（一次最多 2000 行）；没开自动换行时为 null。 */
  wrapped?(fromLine: number, toLine: number): Promise<number[] | null>;
  onLayout?(fn: (l: { folded: Fold[]; softWrap: boolean }) => void): void;
}

interface OpenIdea {
  readonly theme: Theme | null;
  onThemeChange(fn: (t: Theme) => void): void;
  editor?: OpenIdeaEditor;
}

export const openidea = (window as unknown as { openidea: OpenIdea }).openidea;
