import { defineConfig } from "vite";

// 页面在沙箱 iframe 里从插件目录加载：必须用相对路径
export default defineConfig({
  root: "web-src",
  base: "./",
  build: { outDir: "../web", emptyOutDir: true },
});
