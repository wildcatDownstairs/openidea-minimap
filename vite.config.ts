import { defineConfig } from "vite";

// 页面在沙箱 iframe 里从插件目录加载：必须用相对路径
export default defineConfig({
  root: "web-src",
  base: "./",
  // 不压缩：包里的 JS 和源码能直接对照（registry 审核要看）
  // 不要 modulepreload 的 polyfill：页面只有一个模块，用不上
  build: { outDir: "../web", emptyOutDir: true, minify: false, modulePreload: { polyfill: false } },
});
