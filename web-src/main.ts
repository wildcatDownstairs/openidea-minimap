/**
 * 代码缩略图：每行 4px、每个字符 2px 的色块（像 WebStorm），按语法高亮着色；可见区画成可拖动的框。
 * 只画面板里看得见的那几百行，所以上万行的文件每帧也只画这么多。
 */
import { CHAR_W, LINE_H, layout, lineForFrameTop, type MapLayout } from "./layout.ts";
import { openidea, type EditorTarget, type EditorViewport, type HighlightSpan } from "./openidea.ts";

const editor = openidea.editor!;
const canvas = document.getElementById("map") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

/** 一次向宿主要多少行的高亮（宿主上限 2000）。 */
const BLOCK = 1000;
/** 每行最多看多少个字符：面板最宽 400px。 */
const SCAN = Math.ceil(400 / CHAR_W);
// ponytail: 编辑器的 tab 宽度接口里拿不到，先按 4
const TAB = 4;

/** 一行里非空白的片段，`runs` 为视觉列 [起, 止, 起, 止…]；有 tab 时 `xs` 把 UTF-16 列换成视觉列。 */
interface LineShape {
  runs: number[];
  xs: Uint16Array | null;
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

/** 拖动中：指针按在框里的位置、指针当前位置、上次请求滚到的行。 */
let drag: { grab: number; y: number; sent: number } | null = null;
let hover = false;
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
      x = text[c] === "\t" ? (Math.floor(x / TAB) + 1) * TAB : x + 1;
    }
    xs[text.length] = x;
  }
  const runs: number[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const a = m.index!;
    const b = a + m[0].length;
    runs.push(xs ? xs[a]! : a, xs ? xs[b]! : b);
  }
  s = { runs, xs };
  shapes[i] = s;
  return s;
}

/**
 * 高亮色在缩略图里怎么画：灰色（普通文字、注释、标点）淡一些，让有颜色的部分突出；
 * 浅色主题的语法色偏深（深蓝、深紫挨在一起发闷），缩成色块后又重又扎眼：调成浅一些的粉彩色、紫色压成淡灰紫，
 * 和深色主题下的观感接近。
 */
const paintCache = new Map<string, { style: string; alpha: number }>();
function paintOf(color: string): { style: string; alpha: number } {
  const dark = !!openidea.theme?.dark;
  const key = `${dark ? "d" : "l"}${color}`;
  let p = paintCache.get(key);
  if (p) return p;
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (!m) p = { style: color, alpha: 0.9 };
  else {
    const [h, s, l] = hsl(+m[1]!, +m[2]!, +m[3]!);
    if (s < 0.12) p = { style: color, alpha: dark ? 0.45 : 0.3 };
    else if (dark) p = { style: color, alpha: 0.9 };
    else {
      // 紫色系（属性、字段）在亮色方案里和蓝色关键字挤在一起，压成接近灰的淡紫，突出关键字和字符串
      const purple = h >= 260 && h <= 330;
      const sat = purple ? 0.18 : Math.min(s, 0.5);
      p = { style: `hsl(${h} ${sat * 100}% ${Math.min(0.72, Math.max(l, 0.62)) * 100}%)`, alpha: 0.95 };
    }
  }
  paintCache.set(key, p);
  return p;
}

function hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
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
  return view ? layout(view, canvas.clientHeight) : null;
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
  const first = Math.max(0, Math.floor(offset / lineH));
  const last = Math.min(lines.length, Math.ceil((offset + h) / lineH));
  const maxX = Math.ceil(w / charW);

  // 先把所有字画成淡色，再按颜色分组叠上高亮：每种颜色只 fill 一次
  const fg = themeVar("--openidea-fg", "#888");
  const groups = new Map<string, Path2D>();
  const base = new Path2D();
  for (let i = first; i < last; i++) {
    const y = i * lineH - offset;
    const { runs, xs } = shapeOf(i);
    if (!runs.length) continue;
    for (let r = 0; r < runs.length; r += 2) {
      if (runs[r]! >= maxX) break;
      base.rect(runs[r]! * charW, y, (runs[r + 1]! - runs[r]!) * charW, glyphH);
    }
    const spans = colors[i];
    if (!spans) continue;
    let r = 0;
    for (const s of spans) {
      const a = xs ? xs[Math.min(s.from, xs.length - 1)]! : s.from;
      const b = xs ? xs[Math.min(s.to, xs.length - 1)]! : s.to;
      if (a >= maxX) break;
      // 只给片段里非空白的部分上色
      while (r < runs.length && runs[r + 1]! <= a) r += 2;
      let path = groups.get(s.color);
      if (!path) groups.set(s.color, (path = new Path2D()));
      for (let k = r; k < runs.length && runs[k]! < b; k += 2) {
        const x0 = Math.max(a, runs[k]!);
        const x1 = Math.min(b, runs[k + 1]!);
        if (x1 > x0) path.rect(x0 * charW, y, (x1 - x0) * charW, glyphH);
      }
    }
  }
  ctx.fillStyle = fg;
  ctx.globalAlpha = openidea.theme?.dark ? 0.3 : 0.2;
  ctx.fill(base);
  for (const [color, path] of groups) {
    const paint = paintOf(color);
    ctx.fillStyle = paint.style;
    ctx.globalAlpha = paint.alpha;
    ctx.fill(path);
  }

  // 可见区：淡淡的底色加 1px 边框，悬停和拖动时更明显
  const top = Math.round(m.frameTop * dpr);
  const frameH = Math.max(Math.round(m.frameH * dpr), 2 * lineH);
  ctx.fillStyle = fg;
  ctx.globalAlpha = drag ? 0.16 : hover ? 0.11 : 0.07;
  ctx.fillRect(0, top, w, frameH);
  const px = Math.max(1, Math.round(dpr));
  ctx.globalAlpha = drag ? 0.55 : hover ? 0.35 : 0.22;
  ctx.fillRect(0, top, w, px);
  ctx.fillRect(0, top + frameH - px, w, px);
  ctx.fillRect(0, top, px, frameH);
  ctx.fillRect(w - px, top, px, frameH);
  ctx.globalAlpha = 1;

  // 看得见的行再往两头各多取一些，滚动时不闪
  const margin = Math.ceil(h / lineH);
  ensureHighlights(Math.max(0, first - margin), Math.min(lines.length, last + margin));
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
  if (!t) {
    setText("");
    redraw();
    return;
  }
  try {
    const [doc, vp] = await Promise.all([editor.document.get(), editor.viewport()]);
    if (gen !== generation) return;
    target = t;
    setText(doc.text);
    view = vp;
  } catch (err) {
    if (gen !== generation) return;
    console.warn("minimap: load", err);
    setText("");
  }
  redraw();
}

editor.onTarget((t) => void retarget(t));
editor.document.onChange((doc) => {
  if (!target) return;
  setText(doc.text);
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

// 交互：点框外让框居中到那里，拖动框滚动编辑器，滚轮交给编辑器
function steer() {
  const m = currentLayout();
  if (!drag || !m || !view) return;
  const line = lineForFrameTop(m, view, drag.y - drag.grab);
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
  if (!m || e.button !== 0) return;
  const grab = inFrame(e.offsetY) ? e.offsetY - m.frameTop : m.frameH / 2;
  drag = { grab, y: e.offsetY, sent: -1 };
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
canvas.addEventListener("pointerleave", () => {
  if (hover) {
    hover = false;
    redraw();
  }
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
