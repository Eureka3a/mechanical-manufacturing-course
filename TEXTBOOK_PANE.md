# 教材分屏（feat/textbook-pane）

给课件阅读器加一个可以并排看教材的副面板。

## 用起来是什么样

- 顶栏多一个「教材」按钮（快捷键 `B`），点一下把页面一分为二：一边课件、一边教材 PDF。
- 中间的竖条可以拖动改比例（双击回到 50%），竖条中间有个 ⇄ 按钮可以左右互换。
- 比例、左右顺序、缩放、看到第几页都记在本地，下次打开还是原样。
- 教材面板有：页码输入（回车跳转）、±缩放、下载 PDF、关闭。
- 窄屏（≤900px）自动变成上下分屏，分隔条改成横向拖动。
- 首页章节列表上方多了「配套教材」入口，可以直接「并排阅读」或「下载 PDF」。

## 改了哪些文件

| 文件 | 变化 |
|---|---|
| `reader/textbook.js` | 新增。分屏逻辑 + PDF 阅读器（基于 pdf.js） |
| `reader/textbook.css` | 新增。分屏与阅读器样式，跟随深/浅主题 |
| `vendor/pdfjs/` | 新增。pdf.js 3.11.174（UMD 版 + worker），只在打开教材时才加载 |
| `assets/textbook/mechanical-manufacturing-basics.pdf` | 新增。教材（10.7 MB，333 页），元数据 Title 已改为「机械制造技术基础教材」 |
| `reader/app.js` | 改两处：`fit()`/`transform()` 改为量取舞台的父容器（分屏时舞台变窄也能正确自适应）；末尾暴露 `window.__mmRefit` 并监听 `resize` |
| `ch01…ch09/index.html` | 各加一行 CSS、一行 JS 引用 |
| `index.html`、`home.css` | 首页增加「配套教材」卡片 |

## 设计取舍

- **PDF 用 pdf.js 而不是 `<iframe>`**：iframe 在手机上要么只显示第一页，要么直接触发下载，做不到「像阅读器一样翻」。
- **按需加载**：pdf.js 约 1.4 MB，只在第一次点「教材」时才注入；不点就不下载，不影响原本的加载速度。
- **虚拟渲染**：333 页只渲染视口附近几页，离开视口 7 页以上就释放，内存不会越滚越大。
- **文件名与展示名分离**：文件用 ASCII 名，展示名和下载名都用「机械制造技术基础教材」，PDF 内部 Title 也改成了这个名字。

## 合并

```bash
git checkout main
git merge --no-ff feat/textbook-pane -m "feat: 教材分屏"
git push origin main
```

## 注意：重新构建站点会覆盖这些改动

当前改动是直接打在**构建产物**上的。项目里的 `src/course-web/reader.html`、`src/course-web/style.css` 和 `build_course.py` 还是旧的，重新跑构建会把分屏冲掉。

要长期保留，需要把下面三件事同步到源模板里：

1. `reader.html` 里加 `<link rel="stylesheet" href="../reader/textbook.css">` 和 `<script src="../reader/textbook.js"></script>`；
2. `build.py` 复制静态资源时带上 `reader/textbook.*`、`vendor/pdfjs/`、`assets/textbook/`；
3. `app.js` 的 `fit()` 改动（量取 `stage.parentElement`）合并进 `src/course-web/app.js`。

## 回滚

```bash
git revert -m 1 <merge-commit>
```
或者只删掉章节页里那两行引用，功能即完全消失（其余文件不影响原页面）。
