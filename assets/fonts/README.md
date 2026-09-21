# Elysia API 字标字体

当前登录页采用手写字体预选中的 **H03 Italianno Regular**。

- 设计者：Robert Leuschke。
- 来源：[Google Fonts / Italianno](https://fonts.google.com/specimen/Italianno)。
- 原始文件：[Italianno-Regular.ttf](https://raw.githubusercontent.com/google/fonts/main/ofl/italianno/Italianno-Regular.ttf)。
- 获取日期：2026-09-21。
- 授权：SIL Open Font License 1.1，原始全文保留于 `Italianno-OFL.txt`。

固定字标由此字体转为内联 SVG 路径，页面运行时不请求远程字体，也不加载完整字体文件。

字形生成参数：字体大小 60，起始横坐标 12，基线 51，按 `Elysia API` 顺序使用默认字符字形与字偶距，保留字体自带的词间空格；视框为 `0 0 257 88`。视框宽度取字符前进宽度与实际轮廓最右端的较大值，再增加 12 个单位留白，避免末尾装饰笔画裁切。使用 opentype.js 将各字符轮廓输出为 SVG 路径，坐标保留两位小数，不翻转 Y 轴。

每个字形使用独立描边遮罩依次显现，形成书写表现；这些路径来自字体轮廓，不是字体作者提供的真实手写笔顺数据。进入页面后延迟 100ms 开始，逐字书写共 1400ms，文字在 1500ms 时完全显示；两侧细线随后从靠近文字的一端向外延伸，持续 950ms。字体路径与布局位于 `index.html`，动画位于 `login.css`。

遮罩描边使用平头端点与 `1 2` 虚线模式（路径长度归一化为 1），避免未开始绘制时圆形端点或下一段虚线提前露出色块。每个字母完成时，零时长收尾动画将遮罩填满并取消虚线，保证字形内部及端点没有空洞。

此前试用的 Great Vibes、Mazius Display 原始字体及授权保留作为设计历史资料，当前字标不再使用。
