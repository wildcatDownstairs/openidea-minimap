# 对 PR #3677（editorPanels）的反馈

用 PR 分支（d8961829）的开发版 IDE 写这个缩略图时遇到的问题，可以在 PR 里提。

1. **沙箱 iframe 里的 `requestAnimationFrame` 被 WebKit 限流。** 页面按 rAF 重绘时，编辑器滚动 240 帧，
   缩略图只画了 96 次；改成收到 `onViewport` 就画后是 239 次。fixture 的示例页用的是 rAF，
   README 也可以提醒一句「收到事件直接画，宿主已经每帧最多发一次」。
2. **切换标签页时 `onTarget` 先收到 `null` 再收到新文件**（同一时刻连发两次，`bind(null)` 再 `bind(handle)`）。
   页面会多清空一次；只在分组真的没有文件时发 `null` 更好。
3. **`onTarget` 之后、页面取回新文档之前，`onViewport` 已经是新文件的了。** 页面要自己丢掉这段时间的事件，
   否则会拿新视口配旧文本（我就因为这个只取到了第 0 行的高亮）。可以考虑让 `onTarget` 的值带上
   `viewport`，或者文档说明这个顺序。
4. **`document.onChange` 每次都发整篇文本。** 1 万行的测试文件（28 万字符）每次按键都整篇走一遍 postMessage。
   发改动（`{ from, to, insert }`）或至少改动的行范围会省很多。
5. **`scrollTo` 只收行号，长文件拖动框时不好对准。** 缩略图在长文件里按滚动比例定位视口框，
   但代码透镜（"N usages"）、折叠让每行的像素高度不一样，行号和滚动位置换算有误差，
   只能每次视口更新后再校正。`scrollTo` 也接受滚动比例或像素（如 `scrollTo({ fraction })`）就能一次到位。
6. **拿不到编辑器的 tab 宽度。** `get()` 加上 `tabSize` 就够了。
7. **`editor.read` 的说明还是「Read the focused editor's file and selection」。** 有了编辑器面板后，
   页面能读到每个分组显示的文件，安装对话框里的说明可以写清楚。
8. **Settings › Plugins 的 Reload 不会重新加载已经打开的面板页面**（页面 URL 里的版本号没变，iframe 不刷新），
   调试时要关掉窗口重开。普通 web 视图大概也一样。
9. **只有语法高亮的颜色，没有语义高亮。** WebStorm 的缩略图里局部变量、参数、函数调用等标识符都有颜色，
   这里只能画成普通文字的灰色，对比之下差别明显。以后 `highlights()` 带上语义高亮的颜色就能补上。
