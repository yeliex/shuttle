# Shuttle 标志探索

这组文件只保留 Shuttle 的空心端点波浪方向。箭头、基线和整体比例以当前 Codex SVG 的测量值为起点重绘，不复制 Codex App bundle 中的 SVG 路径或 Lottie 数据。

- `prompt-wave-static.svg` / `icon-prompt-wave-static.svg`：箭头与无端点波浪，对应转换动画首帧。
- `prompt-wave-animated.svg` / `icon-prompt-wave-animated.svg`：箭头保持可见、无端点波浪显示蓝色流转。
- `linked-wave-static.svg` / `icon-static.svg`：箭头与双端点波浪的组合静态标志。
- `linked-wave-animated.svg` / `icon-animated.svg`：双端点保持可见的信号流转动画。
- `linked-wave-transition-animated.svg` / `icon-transition-animated.svg`：按 `10% / 15% / 50% / 15% / 10%` 节奏在代码态和连接态之间转换。
- `icon-prompt-wave-light.svg` / `icon-prompt-wave-dark.svg`：无端点代码态的 Light/Dark 应用图标。
- `icon-combined-light.svg` / `icon-combined-dark.svg`：组合静态态的 Light/Dark 应用图标。
- `index.html`：五组符号与完整图标、四个主题应用图标的对照页；点击动效卡片会触发整标旋转和回弹。

动效文件使用内嵌 CSS，可直接在浏览器中打开。`prefers-reduced-motion: reduce` 下会停用循环与点击动画。
