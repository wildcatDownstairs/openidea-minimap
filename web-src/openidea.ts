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
}

interface OpenIdea {
  readonly theme: Theme | null;
  onThemeChange(fn: (t: Theme) => void): void;
  editor?: OpenIdeaEditor;
}

export const openidea = (window as unknown as { openidea: OpenIdea }).openidea;
