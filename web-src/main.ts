/**
 * 代码缩略图：每行 4px、每个字符 2px 的色块（像 WebStorm），按语法高亮着色；可见区画成可拖动的框。
 * 只画面板里看得见的那几百行，所以上万行的文件每帧也只画这么多。
 */
import { CHAR_W, LINE_H, countsFromFolds, layout, lineForClick, lineForFrameTop, rows, type MapLayout, type Rows } from "./layout.ts";
import {
  openidea,
  type Change,
  type EditorTarget,
  type EditorViewport,
  type Fold,
  type HighlightSpan,
  type Problem,
  type Selection,
} from "./openidea.ts";
import { sectionHeader, type SectionHeader } from "./sections.ts";

const editor = openidea.editor!;
const canvas = document.getElementById("map") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

/** 一次向宿主要多少行的高亮（宿主上限 2000）。 */
const BLOCK = 1000;
/** 一次向宿主要多少行的换行信息（宿主上限 2000）。 */
const WRAP_BLOCK = 2000;
/** 改动标记的颜色（API 1.10 的主题变量，和编辑器侧栏一致）。 */
const CHANGE_FALLBACK: Record<string, string> = { added: "#5fb865", modified: "#548af7", deleted: "#868a91" };
/** 问题标记的颜色和画的先后：错误最后画，压在上面。 */
const PROBLEM_COLOR: Record<string, string> = { error: "--openidea-danger", warning: "--openidea-warning" };
const PROBLEM_RANK: Record<string, number> = { error: 2, warning: 1 };
/** 每行最多看多少个字符：面板最宽 400px。 */
const SCAN = Math.ceil(400 / CHAR_W);
/** 一个 tab 占几列：API 1.10 起用编辑器的值（`get().tabSize`），之前固定按 4。 */
let tab = 4;

/** 一行里非空白的片段，`runs` 为视觉列 [起, 止, 起, 止…]；有 tab 时 `xs` 把 UTF-16 列换成视觉列。`header`：分区标题。 */
interface LineShape {
  runs: number[];
  xs: Uint16Array | null;
  header: SectionHeader | null;
}

let generation = 0;
let target: EditorTarget | null = null;
let view: EditorViewport | null = null;
let lines: string[] = [];
let shapes: (LineShape | undefined)[] = [];
let colors: (HighlightSpan[] | undefined)[] = [];
/** 每块高亮的版本：失效时 `wanted` 加一，取回后 `loaded` 记下取时的版本。 */
let wanted: number[] = [];
let loaded: number[] = [];
let inflight = new Set<number>();
// API 1.10，旧版 IDE 上一直是空的
let problems: Problem[] = [];
let folds: Fold[] = [];
let selections: Selection[] = [];
let changes: Change[] = [];
/** 开了自动换行时每行的视觉行数，否则 null。 */
let wrapCounts: number[] | null = null;
/** 编辑器行 ↔ 缩略图行。 */
let rowMap: Rows = rows(1);

/** 拖动中：指针按在框里的位置、指针当前位置、上次请求滚到的行。 */
let drag: { grab: number; y: number; sent: number } | null = null;
let hover = false;
/** 指针在缩略图上：这时才画视口框（同 VS Code 的 showSlider: mouseover）。 */
let inside = false;
let queued = false;

function shapeOf(i: number): LineShape {
  let s = shapes[i];
  if (s) return s;
  const text = (lines[i] ?? "").slice(0, SCAN);
  let xs: Uint16Array | null = null;
  if (text.includes("\t")) {
    xs = new Uint16Array(text.length + 1);
    let x = 0;
    for (let c = 0; c < text.length; c++) {
      xs[c] = x;
      x = text[c] === "\t" ? (Math.floor(x / tab) + 1) * tab : x + 1;
    }
    xs[text.length] = x;
  }
  const runs: number[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const a = m.index!;
    const b = a + m[0].length;
    runs.push(xs ? xs[a]! : a, xs ? xs[b]! : b);
  }
  s = { runs, xs, header: sectionHeader(lines[i] ?? "") };
  shapes[i] = s;
  return s;
}

/** 灰色（普通文字、注释、标点）：画淡一些，让有颜色的部分突出。 */
const greyCache = new Map<string, boolean>();
function isGrey(color: string): boolean {
  let grey = greyCache.get(color);
  if (grey === undefined) {
    const c = rgbOf(color);
    grey = !!c && Math.max(...c) - Math.min(...c) < 24;
    greyCache.set(color, grey);
  }
  return grey;
}

/** 任意 CSS 颜色 → [r, g, b]：交给 canvas 规范化成 #rrggbb 或 rgba()。 */
function rgbOf(color: string): [number, number, number] | null {
  ctx.fillStyle = "#000";
  ctx.fillStyle = color;
  const s = String(ctx.fillStyle);
  if (s.startsWith("#")) return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s);
  return m ? [+m[1]!, +m[2]!, +m[3]!] : null;
}

/**
 * 浅色主题照 WebStorm 的缩略图：语法色和背景混成一半深浅的浅色（深蓝→浅蓝、深绿→浅绿），灰色更浅。
 * 预先混好、不透明地画，盖住下面那层灰，颜色才干净。
 */
const mixCache = new Map<string, string>();
function lightColor(color: string, bg: string): string {
  const key = `${color}|${bg}`;
  let out = mixCache.get(key);
  if (out === undefined) {
    const c = rgbOf(color);
    const b = rgbOf(bg) ?? [255, 255, 255];
    const t = isGrey(color) ? 0.25 : 0.5; // 原色占的比例
    out = c ? `rgb(${c.map((v, i) => Math.round(v * t + b[i]! * (1 - t))).join(",")})` : color;
    mixCache.set(key, out);
  }
  return out;
}

const themeVar = (name: string, fallback: string) => openidea.theme?.vars[name] || fallback;

// 不用 requestAnimationFrame：WebKit 会给沙箱 iframe 的 rAF 限流（实测只跟上约 4 成的滚动帧）。
// 宿主每帧最多发一次 viewport，同一个任务里的多次 redraw 用 microtask 合并成一次就够了。
function redraw() {
  if (queued) return;
  queued = true;
  queueMicrotask(draw);
}

function currentLayout(): MapLayout | null {
  return view ? layout(view, canvas.clientHeight, rowMap) : null;
}

function updateRows() {
  // 换行信息已经把折叠掉的行算成 0；行数对不上（刚编辑过）就先只按折叠算，等下一次 onLayout
  const counts = wrapCounts?.length === lines.length ? wrapCounts : countsFromFolds(lines.length, folds);
  rowMap = rows(lines.length, counts);
}

/** 画一段 [x0, x1) 列：自动换行的行按 `wc` 列一折，折到下面的视觉行（`wc` 为 0：不折）。 */
function rectWrapped(path: Path2D, x0: number, x1: number, y: number, wc: number, lineH: number, charW: number, glyphH: number) {
  if (!wc) {
    path.rect(x0 * charW, y, (x1 - x0) * charW, glyphH);
    return;
  }
  while (x0 < x1) {
    const r = Math.floor(x0 / wc);
    const end = Math.min(x1, (r + 1) * wc);
    path.rect((x0 - r * wc) * charW, y + r * lineH, (end - x0) * charW, glyphH);
    x0 = end;
  }
}

function draw() {
  queued = false;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const m = currentLayout();
  if (!m) return;

  // 全部按设备像素取整，滚动时字不会忽虚忽实
  const lineH = Math.round(LINE_H * dpr);
  const glyphH = lineH - Math.max(1, Math.round(dpr)); // 行间留 1px 缝
  const charW = CHAR_W * dpr;
  const offset = Math.round(m.offset * dpr);
  const firstRow = Math.max(0, Math.floor(offset / lineH));
  const first = Math.floor(rowMap.lineAt(firstRow));
  const last = Math.min(lines.length, Math.floor(rowMap.lineAt(Math.ceil((offset + h) / lineH))) + 1);
  // 宿主能给改动标记（API 1.10）时，左边留一条窄栏画改动，代码往右挪一点
  const gx = editor.changes ? Math.round(3 * dpr) : 0;
  const maxX = Math.ceil((w - gx) / charW);
  /** 第 i 行在面板里的 y（设备像素）。 */
  const yOf = (i: number) => Math.round(rowMap.rowOf(i)) * lineH - offset;
  const px = Math.max(1, Math.round(dpr));

  // 选区和光标所在行（API 1.10）：先画底色，代码叠在上面
  for (const sel of selections) {
    const a = Math.min(sel.anchor.line, sel.head.line);
    const b = Math.max(sel.anchor.line, sel.head.line);
    const top = yOf(a);
    const bottom = yOf(b + 1);
    if (bottom <= top || bottom < 0 || top > h) continue; // 整段都被折叠，或不在面板里
    const caret = sel.anchor.line === sel.head.line && sel.anchor.column === sel.head.column;
    ctx.fillStyle = caret ? themeVar("--openidea-fg", "#888") : themeVar("--openidea-bg-selected", "#2e436e");
    ctx.globalAlpha = caret ? 0.1 : 0.9;
    ctx.fillRect(0, top, w, bottom - top);
  }

  // 先把所有字画成淡色，再按颜色分组叠上高亮：每种颜色只 fill 一次
  const fg = themeVar("--openidea-fg", "#888");
  const groups = new Map<string, Path2D>();
  const base = new Path2D();
  for (let i = first; i < last; i++) {
    const n = rowMap.count(i);
    if (!n) continue; // 被折叠的行
    const y = yOf(i);
    const { runs, xs } = shapeOf(i);
    if (!runs.length) continue;
    // 自动换行：编辑器的折行列数拿不到，按「行宽 / 视觉行数」均分（只是近似）
    const wc = n > 1 ? Math.max(1, Math.ceil(runs[runs.length - 1]! / n)) : 0;
    for (let r = 0; r < runs.length; r += 2) {
      if (!wc && runs[r]! >= maxX) break;
      rectWrapped(base, runs[r]!, runs[r + 1]!, y, wc, lineH, charW, glyphH);
    }
    const spans = colors[i];
    if (!spans) continue;
    let r = 0;
    for (const s of spans) {
      const a = xs ? xs[Math.min(s.from, xs.length - 1)]! : s.from;
      const b = xs ? xs[Math.min(s.to, xs.length - 1)]! : s.to;
      if (!wc && a >= maxX) break;
      // 只给片段里非空白的部分上色
      while (r < runs.length && runs[r + 1]! <= a) r += 2;
      let path = groups.get(s.color);
      if (!path) groups.set(s.color, (path = new Path2D()));
      for (let k = r; k < runs.length && runs[k]! < b; k += 2) {
        const x0 = Math.max(a, runs[k]!);
        const x1 = Math.min(b, runs[k + 1]!);
        if (x1 > x0) rectWrapped(path, x0, x1, y, wc, lineH, charW, glyphH);
      }
    }
  }
  const dark = !!openidea.theme?.dark;
  const bg = themeVar("--openidea-bg", "#fff");
  ctx.setTransform(1, 0, 0, 1, gx, 0);
  ctx.fillStyle = fg;
  ctx.globalAlpha = dark ? 0.3 : 0.18;
  ctx.fill(base);
  for (const [color, path] of groups) {
    if (dark) {
      // 深色主题：原色略透一点，灰色更淡
      ctx.fillStyle = color;
      ctx.globalAlpha = isGrey(color) ? 0.45 : 0.9;
    } else {
      ctx.fillStyle = lightColor(color, bg);
      ctx.globalAlpha = 1;
    }
    ctx.fill(path);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // 分区标题：先用背景色盖住标题占的那几行，再写字；`MARK: -` 在上方加一条线
  const fontPx = Math.round(9 * dpr);
  const boxH = fontPx + 2 * px;
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  ctx.textBaseline = "top";
  // 标题比一行高，上面几行的标题也会伸进来
  const headFirst = Math.floor(rowMap.lineAt(Math.max(0, firstRow - Math.ceil(boxH / lineH))));
  for (let i = headFirst; i < last; i++) {
    if (!rowMap.count(i)) continue;
    const hd = shapeOf(i).header;
    if (!hd) continue;
    const y = yOf(i);
    ctx.globalAlpha = 1;
    ctx.fillStyle = bg;
    ctx.fillRect(0, y, w, boxH);
    ctx.fillStyle = fg;
    if (hd.separator) {
      ctx.globalAlpha = 0.5;
      ctx.fillRect(0, y, w, px);
    }
    if (hd.label) {
      ctx.globalAlpha = 0.9;
      ctx.fillText(hd.label, gx + 2 * px, y + px);
    }
  }

  // 问题标记（API 1.10）：右边缘一条竖线，至少两行高才看得见；问题已按严重程度排好，错误最后画
  const barW = Math.max(2, Math.round(3 * dpr));
  for (const p of problems) {
    const top = yOf(p.line);
    const bottom = Math.max(yOf(p.lastLine + 1), top + 2 * lineH);
    if (bottom < 0 || top > h) continue;
    ctx.globalAlpha = PROBLEM_COLOR[p.severity] ? 1 : 0.7;
    ctx.fillStyle = themeVar(PROBLEM_COLOR[p.severity] ?? "--openidea-fg-muted", p.severity === "error" ? "#e55765" : "#c9a23a");
    ctx.fillRect(w - barW, top, barW, bottom - top);
  }

  // 改动标记（API 1.10）：左边窄栏，颜色同编辑器侧栏；删除的地方画一道短横线
  const cw = Math.max(2, gx - px);
  for (const c of changes) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = themeVar(`--openidea-change-${c.kind}`, CHANGE_FALLBACK[c.kind] ?? "#868a91");
    const top = yOf(c.line);
    if (c.kind === "deleted") {
      if (top >= -px && top <= h) ctx.fillRect(0, top - px, 2 * cw, 2 * px);
      continue;
    }
    const bottom = Math.max(yOf(c.lastLine + 1), top + lineH);
    if (bottom < 0 || top > h) continue;
    ctx.fillRect(0, top, cw, bottom - top);
  }

  // 可见区：指针在缩略图上或拖动时才画，淡淡的底色加 1px 边框，悬停在框上和拖动时更明显
  if (inside || drag) drawFrame(m, dpr, w, fg, px);
  ctx.globalAlpha = 1;

  // 看得见的行再往两头各多取一些，滚动时不闪
  const margin = Math.ceil(h / lineH);
  ensureHighlights(Math.max(0, first - margin), Math.min(lines.length, last + margin));
}

function drawFrame(m: MapLayout, dpr: number, w: number, fg: string, px: number) {
  const lineH = Math.round(LINE_H * dpr);
  const top = Math.round(m.frameTop * dpr);
  const frameH = Math.max(Math.round(m.frameH * dpr), 2 * lineH);
  ctx.fillStyle = fg;
  ctx.globalAlpha = drag ? 0.16 : hover ? 0.11 : 0.07;
  ctx.fillRect(0, top, w, frameH);
  ctx.globalAlpha = drag ? 0.55 : hover ? 0.35 : 0.22;
  ctx.fillRect(0, top, w, px);
  ctx.fillRect(0, top + frameH - px, w, px);
  ctx.fillRect(0, top, px, frameH);
  ctx.fillRect(w - px, top, px, frameH);
}

function ensureHighlights(from: number, to: number) {
  for (let b = Math.floor(from / BLOCK); b * BLOCK < to; b++) {
    if (!inflight.has(b) && loaded[b] !== (wanted[b] ?? 0)) void fetchBlock(b);
  }
}

async function fetchBlock(b: number) {
  const gen = generation;
  const version = wanted[b] ?? 0;
  inflight.add(b);
  try {
    const from = b * BLOCK;
    // 总是要整块：宿主会截到文件实际的行数（不能用 lines.length，切换文件时它可能还是上一个文件的）
    const result = await editor.highlights(from, from + BLOCK);
    if (gen !== generation) return;
    result.forEach((spans, i) => (colors[from + i] = spans));
  } catch (err) {
    // 失败也记下版本，不在每帧里反复请求；下次 onHighlights 再试
    console.warn("minimap: highlights", err);
  }
  if (gen !== generation) return;
  inflight.delete(b);
  loaded[b] = version;
  redraw();
}

function setText(text: string) {
  lines = text.split("\n");
  shapes = [];
  updateRows();
}

/** 问题按严重程度从轻到重排：画的时候错误最后画，压在上面。 */
function setProblems(p: Problem[]) {
  problems = [...p].sort((a, b) => (PROBLEM_RANK[a.severity] ?? 0) - (PROBLEM_RANK[b.severity] ?? 0));
}

let wrapFetching = false;
let wrapAgain = false;
/** 取全文件每行的视觉行数（API 1.10）；取的时候又有变化就再取一次。没开自动换行时为 null。 */
async function fetchWrapped() {
  if (!editor.wrapped) return;
  if (wrapFetching) {
    wrapAgain = true;
    return;
  }
  wrapFetching = true;
  try {
    do {
      wrapAgain = false;
      const gen = generation;
      const n = lines.length;
      const parts: Promise<number[] | null>[] = [];
      for (let from = 0; from < n; from += WRAP_BLOCK) parts.push(editor.wrapped(from, Math.min(n, from + WRAP_BLOCK)));
      const got = await Promise.all(parts);
      // 取的时候切了文件：结果作废，按新文件再取一次
      if (gen !== generation) {
        wrapAgain = true;
        continue;
      }
      wrapCounts = got.some((g) => !g) ? null : (got as number[][]).flat();
    } while (wrapAgain);
    updateRows();
    redraw();
  } catch (err) {
    console.warn("minimap: wrapped", err);
  } finally {
    wrapFetching = false;
  }
}

async function retarget(t: EditorTarget | null) {
  const gen = ++generation;
  // 文档到手之前不接收视口和改动事件，免得拿新视口配旧文本
  target = null;
  view = null;
  colors = [];
  wanted = [];
  loaded = [];
  inflight = new Set();
  drag = null;
  problems = [];
  folds = [];
  wrapCounts = null;
  selections = [];
  changes = [];
  if (!t) {
    setText("");
    redraw();
    return;
  }
  try {
    const [doc, vp, p, f, sel, ch] = await Promise.all([
      editor.document.get(),
      editor.viewport(),
      // 新接口出错不影响画代码
      editor.problems?.().catch(() => []) ?? [],
      editor.folded?.().catch(() => []) ?? [],
      editor.selections?.().catch(() => []) ?? [],
      editor.changes?.().catch(() => []) ?? [],
    ]);
    if (gen !== generation) return;
    target = t;
    setProblems(p);
    folds = f;
    selections = sel;
    changes = ch;
    setTab(t.tabSize);
    setText(doc.text);
    view = vp;
    void fetchWrapped();
  } catch (err) {
    if (gen !== generation) return;
    console.warn("minimap: load", err);
    setText("");
  }
  redraw();
}

/** API 1.10 的 tab 宽度；没给就按 4。变了要重新算每行的形状。 */
function setTab(size: number | undefined): boolean {
  const next = size && size > 0 ? size : 4;
  if (next === tab) return false;
  tab = next;
  shapes = [];
  return true;
}

editor.onTarget((t) => {
  // 同一个文件、文本没变，只是 tab 宽度变了（API 1.10 会为此再发一次 onTarget）：重排就行，不用整个重载
  if (t && target && t.path === target.path && t.version === target.version) {
    if (setTab(t.tabSize)) redraw();
    return;
  }
  void retarget(t);
});
editor.document.onChange((doc) => {
  if (!target) return;
  target = { ...target, version: doc.version };
  setText(doc.text);
  if (wrapCounts) void fetchWrapped();
  redraw();
});
// API 1.10：问题标记、选区、改动标记、折叠和自动换行
editor.onSelections?.((sel) => {
  if (!target) return;
  selections = sel;
  redraw();
});
editor.onChanges?.((ch) => {
  if (!target) return;
  changes = ch;
  redraw();
});
editor.onProblems?.((p) => {
  if (!target) return;
  setProblems(p);
  redraw();
});
editor.onLayout?.(({ folded, softWrap }) => {
  if (!target) return;
  folds = folded;
  if (softWrap) void fetchWrapped();
  else {
    wrapCounts = null;
    wrapAgain = wrapFetching; // 正在取的是关闭之前的结果，再取一次才会得到 null
  }
  updateRows();
  redraw();
});
editor.onViewport((v) => {
  if (!target) return;
  view = v;
  steer(); // 拖动中：编辑器落点和框不一致就再校正一次
  redraw();
});
editor.onHighlights(({ fromLine, toLine }) => {
  // 旧颜色先留着，等新颜色到了再换，避免闪
  for (let b = Math.floor(fromLine / BLOCK); b * BLOCK < toLine; b++) wanted[b] = (wanted[b] ?? 0) + 1;
  redraw();
});
openidea.onThemeChange(redraw);
new ResizeObserver(redraw).observe(canvas);
window.addEventListener("resize", redraw); // 换到不同 DPR 的屏幕

// 交互：点框外让点击处那一行居中，拖动框滚动编辑器，滚轮交给编辑器
function steer() {
  const m = currentLayout();
  if (!drag || !m || !view) return;
  const line = lineForFrameTop(m, view, drag.y - drag.grab, rowMap);
  // 已经在那儿了就不再发：编辑器不动就没有新的 viewport，校正自然停下
  if (Math.abs(line - drag.sent) < 0.01) return;
  drag.sent = line;
  void editor.scrollTo(line);
}

function inFrame(y: number): boolean {
  const m = currentLayout();
  return !!m && y >= m.frameTop && y <= m.frameTop + m.frameH;
}

canvas.addEventListener("pointerdown", (e) => {
  const m = currentLayout();
  if (!m || !view || e.button !== 0) return;
  if (!inFrame(e.offsetY)) {
    // 点击只跳转，不开始拖动：跳过去后框不在指针下，接着拖会按滚动比例再跳一次
    void editor.scrollTo(lineForClick(m, view, e.offsetY, rowMap));
    return;
  }
  drag = { grab: e.offsetY - m.frameTop, y: e.offsetY, sent: -1 };
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // 测试里派发的事件没有真实指针
  }
  steer();
  redraw();
});
canvas.addEventListener("pointermove", (e) => {
  if (drag) {
    drag.y = e.offsetY;
    steer();
    return;
  }
  const over = inFrame(e.offsetY);
  if (over !== hover) {
    hover = over;
    redraw();
  }
});
const endDrag = () => {
  if (!drag) return;
  drag = null;
  redraw();
};
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener("pointerenter", () => {
  inside = true;
  redraw();
});
canvas.addEventListener("pointerleave", () => {
  inside = false;
  hover = false;
  redraw();
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? (view?.clientHeight ?? 600) : 1;
    void editor.scrollBy(e.deltaY * unit);
  },
  { passive: false },
);

void editor.get().then(retarget);
