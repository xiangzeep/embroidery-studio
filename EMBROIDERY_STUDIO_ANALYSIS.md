# Embroidery Studio 项目分析文档

## 1. 基本信息

- 本地项目：`/Users/zeep/myself/code/ai/image_2_emb`
- 本地目录：`/Users/zeep/myself/code/ai/image_2_emb`
- 当前提交：`82a14fd2f91c234facdf8f4de6ba29059a632f85`
- 本地开发地址：`http://localhost:3000`
- 项目类型：纯前端图片转刺绣机文件 Web 应用
- 主要目标：将 logo、线稿、图标、少色简单图形转换为刺绣机可读文件，并在浏览器内预览针迹。

这个项目不是传统的服务端图像处理系统。它把图像处理、矢量化、针迹生成、刺绣文件写出都放在浏览器侧完成。用户上传图片后，图片不需要发送到服务器，隐私和部署成本都更友好。

## 2. 本机运行状态

已经在指定目录完成下载、安装和启动：

```bash
cd /Users/zeep/myself/code/ai/image_2_emb
npm install
npm run dev -- --port 3000
```

验证结果：

- `npm run test`：24 个测试文件通过，487 个测试通过。
- `npm run build`：Next.js 生产构建通过。
- `curl -I http://127.0.0.1:3000`：返回 `HTTP/1.1 200 OK`。

当前 dev server 地址：

```text
http://localhost:3000
```

## 3. 技术栈

### 3.1 前端层

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS v4
- shadcn/ui
- lucide-react 图标

### 3.2 图像与刺绣处理

- OpenCV.js：在 Web Worker 中执行 k-means 减色、平滑等图像处理。
- imagetracerjs：把每个颜色区域的二值 mask 转成 SVG path / polygon。
- 自研 TypeScript pipeline：生成 run、satin、fill 等刺绣针迹。
- Pyodide + pyembroidery：在 Web Worker 中把针迹写出为刺绣文件。
- Three.js：显示 3D 线材式针迹预览。

### 3.3 状态与测试

- Zustand：编辑器设计状态管理。
- immer：undo / redo 历史栈。
- Vitest：单元测试。

## 4. 页面与功能结构

当前正式接入页面的主应用在 `src/components/embroidery-studio.tsx`。页面是一个单页三栏工作台。

### 4.1 顶部 Header

显示：

- `Embroidery Studio`
- 说明文案：从图片生成并预览刺绣机数据
- 标签：`100% client-side`、`WASM`

### 4.2 左侧栏：输入与参数

#### 图片上传

组件：`src/components/image-uploader.tsx`

功能：

- 支持拖拽上传。
- 支持点击选择文件。
- 支持格式：PNG、JPEG、SVG。
- 文件读取为 Data URL 后进入浏览器内处理。

#### 转换参数

组件：`src/components/conversion-settings.tsx`

可调参数：

- 生地 / fabric
- 输出格式
- 宽度 mm
- 色数
- stitch density
- satin 最大宽度
- fill 方向策略
- 全局缝制角度
- 颜色平滑强度
- 边界重叠像素

支持的输出格式：

- DST / Tajima
- PES / Brother
- JEF / Janome
- EXP / Melco
- VP3 / Husqvarna

支持的布料 profile：

- denim
- twill
- canvas
- knit-light
- knit-heavy
- terry
- fleece
- leather
- silk
- felt

### 4.3 中间栏：预览区

组件：`src/components/stitch-preview.tsx`

包含三个 Tab：

- `元画像`：显示原始上传图片。
- `Stitches`：Canvas 2D 针迹预览。
- `3D`：Three.js 3D 绣线预览。

处理时会显示进度：

- loading-cv
- loading-py
- quantize
- vectorize
- stitch
- write

3D 预览组件：`src/components/stitch-preview-3d.tsx`

3D 预览会把 stitch path 转成 Three.js TubeGeometry，按线色生成管状绣线，并支持拖拽旋转、滚轮缩放。

### 4.4 右侧栏：结果与颜色角度编辑

#### 结果面板

组件：`src/components/result-panel.tsx`

显示：

- 总针数
- 颜色数
- 输出格式
- 下载按钮

点击下载时，会把 Pyodide worker 写出的 Blob 下载为 `embroidery.{format}`。

#### 色별角度编辑

组件：`src/components/color-angle-editor.tsx`

功能：

- 对每个颜色块设置独立 fill angle。
- 可以重置到全局角度。
- 点击应用后复用 quantize + vectorize 的中间结果，只重新执行 stitch + write。

这是一个性能优化点。只改角度时不需要重新做 OpenCV 减色和矢量化。

## 5. 核心处理流程

核心入口在 `src/lib/pipeline/compose.ts`。

### 5.1 总流程

```text
ImageBitmap
  -> bitmapToImageData
  -> OpenCV.js quantize
  -> imagetracerjs vectorize
  -> buildObjects
  -> optimizeOrder
  -> renderDesign
  -> writeEmbroidery
  -> Blob
```

项目把 pipeline 分成两段：

1. `runPrepipeline`
   - 负责 OpenCV 加载、Pyodide 预热、图片缩放、减色、矢量化。
   - 输出 `regions`、宽高、像素尺寸等中间数据。

2. `runStitchAndWrite`
   - 负责构建刺绣对象、路径优化、生成 stitch pattern、写出文件。
   - 当只改缝制角度或格式时，可以复用第一段结果。

### 5.2 图片缩放与透明处理

函数：`bitmapToImageData`

关键点：

- 最大处理边长限制为 384 像素，降低 WASM 内存和矢量化成本。
- RGB 图像会先用白色背景合成。
- alpha 会单独生成 opaque mask。
- 透明像素不会参与 k-means，避免透明背景污染颜色聚类。

## 6. 图像处理算法

### 6.1 OpenCV.js k-means 减色

实现：

- 客户端封装：`src/lib/pipeline/opencv-worker.ts`
- Worker 文件：`public/opencv-kmeans.worker.js`

算法流程：

1. 将 RGBA 转成 RGB。
2. 如果 smoothing > 0，先做 bilateralFilter。
3. 只收集 opaque mask 中不透明的像素。
4. 用 OpenCV `cv.kmeans` 做颜色聚类。
5. 输出：
   - palette
   - 每个像素的 color label
   - 减色后的 ImageData

为什么用 bilateralFilter：

- 普通 blur 会模糊边界。
- bilateralFilter 会保边平滑，让抗锯齿和阴影中间色更稳定地归入主色，同时尽量保留图形边缘。

### 6.2 背景 label

透明背景使用 `BACKGROUND_LABEL = 0xff`，不会和正常颜色索引 `0..colorCount-1` 冲突。

这保证透明区域不会被错误地转成 stitch object。

## 7. 矢量化算法

实现：`src/lib/pipeline/vectorize.ts`

### 7.1 每色 mask

对每个 palette color：

1. 根据 labels 生成二值 mask。
2. 可选执行 foreground dilation。
3. 用 imagetracerjs 转 SVG path。
4. 解析 SVG path 的 `d` 属性为 polygon。
5. 根据包含关系重建 outer + holes。

### 7.2 边界膨胀

参数：`boundaryDilatePx`

作用：

- 对每个颜色层的二值 mask 做 4-neighbor dilation。
- 让相邻色层略微重叠。
- 目的是补偿刺绣中的 pull gap，减少颜色边界露底。

### 7.3 path 解析

`parsePathD` 会解析 SVG path 命令，并把曲线用线段近似：

- M
- L
- H
- V
- C
- Q
- Z

Bezier 目前按固定采样数量离散成 polyline。

### 7.4 holes 重建

imagetracerjs 会输出多个 subpath。项目用 even-odd / ray casting 判断包含关系：

- 偶数深度：outer
- 奇数深度：hole

最终形成：

```ts
type Shape = {
  outer: Polygon;
  holes: Polygon[];
}
```

## 8. Embroidery Object 模型

定义：`src/lib/pipeline/types.ts`

项目不是直接把颜色区域渲染成针迹，而是先构建 `EmbroideryObject`：

```ts
type EmbroideryObject = {
  id: string;
  kind: "run" | "satin" | "fill";
  colorIndex: number;
  rgb: [number, number, number];
  shape: Shape;
  props: ObjectProps;
  order: number;
  locked?: boolean;
  visible?: boolean;
}
```

这个模型很重要，因为它让项目具备编辑器能力：

- 单独选择对象
- 改 stitch type
- 改密度
- 改角度
- 改 underlay
- 改缝制顺序
- 改节点形状

## 9. Object 构建与 stitch type 判断

实现：`src/lib/pipeline/build-objects.ts`

### 9.1 像素坐标到毫米坐标

项目用：

```text
mmPerPx = widthMm / widthPx
```

把 vectorize 得到的像素 polygon 转换为真实刺绣尺寸。

### 9.2 类型判断

函数：`determineKind`

判断依据：

- shortSide
- aspectRatio
- 是否有 holes

规则：

```text
shortSide < runMaxWidthMm
  -> run

无 holes 且 shortSide < satinMaxWidthMm 且 aspectRatio > satinMinAspectRatio
  -> satin

其他
  -> fill
```

默认参数：

- runMaxWidthMm：0.6mm
- satinMinAspectRatio：4
- satinMaxWidthMm：来自 UI，默认 5mm

### 9.3 默认属性

`deriveDefaultProps` 会从 fabric profile 派生：

- densityMm
- maxStitchMm
- pushCompMm
- pullCompMm
- underlay

## 10. 布料 profile 与补偿策略

实现：`src/lib/pipeline/fabric.ts`

每种布料包含：

- defaultDensityMm
- pullCompPerWidth
- minPullCompMm
- defaultPushCompMm
- underlayPolicy

例如 knit / terry 的 pull compensation 更大，因为弹性或毛圈布更容易吃线、露底；leather 的补偿较小，并避免重 underlay 造成针孔问题。

### 10.1 pull compensation

函数：

```ts
pullCompForWidth(profile, widthMm)
```

公式：

```text
max(profile.minPullCompMm, widthMm * profile.pullCompPerWidth)
```

意义：

- satin 或 fill 实际缝制后会被线张力拉窄。
- 预先把形状向外补偿一点，减少缝完后的收缩误差。

## 11. Underlay 算法

实现：`src/lib/pipeline/underlay.ts`

支持的 underlay：

- none
- edge-run
- center-run
- zigzag
- fill

### 11.1 center-run

用于细 satin 或细长形状。

核心思想：

1. rasterize shape。
2. 使用 Zhang-Suen thinning 得到 skeleton。
3. 用 BFS 找骨架图上的最长路径。
4. resample 为 stitchLenMm 间距的 run stitch。

### 11.2 edge-run

沿外形内缩一圈，作为边缘下缝。

作用：

- 固定边缘。
- 减少表面 satin / fill 的边界漂移。

### 11.3 zigzag

在形状两侧 rail 间生成之字形下缝。

适合较宽 satin，能增加支撑。

### 11.4 fill underlay

用较粗间距的填充线作为下缝，通常与 top fill 方向正交。

适合大面积 fill，能稳定布料。

## 12. Pull / Push Compensation

实现：`src/lib/pipeline/compensation.ts`、`src/lib/pipeline/polygon-offset.ts`

### 12.1 Pull Compensation

处理对象：

- satin
- fill

run stitch 不需要 pull compensation。

基本思路：

- 对 shape outer 向外偏移。
- 对 holes 反向处理。
- satin 可按短边宽度推导补偿量。

渲染顺序中，underlay 使用原始 shape；top stitch 使用补偿后的 shape。这样可以避免 underlay 外露。

### 12.2 Push Compensation

用于对象叠压时的边缘挤压补偿。

当前项目已经有 profile 和部分补偿参数，但实际 UI 暴露较少，更多是 pipeline 内部能力。

## 13. Stitch 渲染算法

主要实现：`src/lib/pipeline/render.ts`

核心函数：

- `renderRun`
- `renderSatin`
- `renderFill`
- `renderDesign`

### 13.1 renderDesign

流程：

1. 按 order 排序。
2. 按 colorIndex 分组。
3. 每个 object 根据 kind 分发到 run / satin / fill renderer。
4. 同色 block 内连接相邻 object。
5. 不同颜色 block 之间插入 stop / color change。
6. 统计总 stitch 数。

### 13.2 Run stitch

实现：`src/lib/pipeline/run.ts`

run kind 优先使用 medial-axis：

1. 复用 center-run underlay 的 thinning / skeleton 逻辑。
2. 把细形状变成中心线。
3. 如果 skeleton 失败，则回退到 outer polyline resample。

这比直接沿外形绕一圈更接近真实线稿刺绣。

### 13.3 Satin stitch

实现：`src/lib/pipeline/satin.ts`

当前实现包含：

- rail extraction
- 2-rail satin rendering
- wide satin brick split

基本思路：

1. 从 shape outer 中抽取左右两条 rail。
2. 按 arc length 同步采样。
3. 在两条 rail 之间来回生成 zigzag。
4. 如果单针超过 maxStitchMm，则用 brick split 插入中间针点。

brick split 的价值：

- 避免宽 satin 的长浮线。
- 避免针孔在同一条线上密集排列。

### 13.4 Fill / Tatami stitch

实现：`src/lib/pipeline/fill.ts`、`src/lib/pipeline/scanline.ts`

基本思路：

1. 按指定角度生成平行 scanline。
2. 与 polygon outer / holes 求交。
3. 得到一组 inside segments。
4. 行间距由 densityMm 控制。
5. 使用 tatami brick 相位偏移打散针点。

Tatami brick 的作用：

- 普通 fill 会让每行端点或中间分割点排成直线。
- brick fill 会按行移动针点相位，让穿刺点分散。
- 这样实际绣出来更平整，也更不容易沿针孔线撕裂布料。

## 14. Pathing 与 Trim Policy

实现：`src/lib/pipeline/pathing.ts`、`src/lib/pipeline/policy.ts`

### 14.1 optimizeOrder

目标：

- 同色对象尽量连续。
- 接近的对象优先连续缝。
- 减少 jump 和 trim。
- 保留 locked object 的顺序。

基本思路：

1. 按颜色分组。
2. 检测同色 object 是否接触或很近，形成 branch group。
3. 组内用 nearest-neighbor 近似路径。
4. 输出新的 order。

### 14.2 travel / jump / trim

函数：`connectObjects`

根据相邻对象的距离决定：

```text
距离 < travelRunUntilMm
  -> travel run

距离 < trimThresholdMm
  -> jump

距离 >= trimThresholdMm
  -> trim + jump
```

这些阈值由输出格式的 `TRIM_POLICY_BY_FORMAT` 决定。

### 14.3 tie-in / tie-off 抑制

当两个 object 用 travel run 连接时，项目会抑制前一个 object 的 tie-off 和后一个 object 的 tie-in，避免不必要的加固针增加线团。

## 15. Lockstitch

实现：`src/lib/pipeline/lockstitch.ts`

每个 object 的开始和结束处可插入 tie-in / tie-off。

作用：

- 防止线头脱落。
- 在 trim 前后增强固定。

渲染顺序：

```text
tie-in
underlay
top stitch
tie-off
```

## 16. 文件写出

实现：

- `src/lib/pipeline/writer.ts`
- `src/lib/pipeline/pyodide-worker.ts`
- `public/pyodide.worker.js`

流程：

1. React 主线程把 `StitchPattern` JSON 发给 worker。
2. Worker 加载 Pyodide。
3. Pyodide 通过 micropip 安装 `pyembroidery`。
4. Python 侧构造 `EmbPattern`。
5. 按 stitch kind 映射 pyembroidery command：
   - run / satin / fill -> STITCH
   - jump -> JUMP
   - trim -> TRIM
   - stop -> COLOR_CHANGE
6. 坐标从 mm 转成 0.1mm 单位。
7. 写出指定格式文件。

注意：首次写出需要加载 Pyodide 和安装 pyembroidery，因此第一次会慢一些，并且需要网络访问 CDN / Python 包源。

## 17. 编辑器相关能力

仓库里已经有一批编辑器组件，但当前首页尚未正式接入这些组件。

### 17.1 已有组件

- `src/components/design-store.ts`
  - Zustand store
  - design
  - selectedObjectId
  - editMode
  - visualization flags
  - undo / redo

- `src/components/object-inspector.tsx`
  - 编辑 object kind
  - 编辑角度
  - 编辑密度
  - 编辑 pull comp
  - 编辑 underlay

- `src/components/sewing-order-panel.tsx`
  - object 列表
  - dnd-kit 拖拽排序
  - lock / visible / delete
  - 自动优化顺序

- `src/components/preview-canvas-editable.tsx`
  - 点击选择 object
  - 高亮选中 object
  - 节点编辑模式
  - 顶点移动
  - 边中点插入顶点
  - Delete / Backspace 删除顶点

- `src/components/undo-redo-buttons.tsx`
  - undo
  - redo
  - JSON 保存
  - JSON 加载

- `src/components/visualization-toggle.tsx`
  - travel run 显示开关
  - jump 显示开关
  - trim 显示开关

### 17.2 当前接入状态

这些组件已经实现并有测试，但 `EmbroideryStudio` 当前仍使用较早的三栏转换界面，没有把完整对象编辑器正式挂到首页。

因此当前可直接使用的是：

- 上传
- 参数调整
- 自动生成
- 2D/3D 预览
- 下载刺绣文件
- 按颜色调整 fill angle

尚未在页面主流程中完整开放的是：

- object inspector
- sewing order panel
- node editor
- undo / redo
- JSON design 保存/读取
- travel / jump / trim 可视化叠加

## 18. 目录结构说明

```text
src/app
  Next.js 页面入口

src/components
  页面组件、预览组件、编辑器组件、UI 组件

src/lib/pipeline
  图像转刺绣的核心算法

src/lib/design
  设计序列化、历史栈

public
  opencv worker、pyodide worker、静态资源

docs
  pipeline 草案文档

plans
  Phase 1-5 开发计划和状态说明
```

## 19. 项目优点

1. 纯客户端架构清晰
   图片不上传服务器，适合静态部署。

2. pipeline 分层合理
   quantize、vectorize、build objects、render、write 分得比较清楚。

3. 对刺绣工艺有一定理解
   不只是画线，而是实现了 underlay、pull compensation、lockstitch、pathing、trim policy、tatami brick、satin split 等真实刺绣概念。

4. 测试覆盖不错
   当前有 487 个测试，覆盖 pipeline、geometry、render、pathing、store、serialize 等。

5. 为编辑器形态打好了基础
   Object model 和一批编辑器组件已经存在。

## 20. 当前限制与风险

1. README 有些内容滞后
   README 仍写着 pull compensation / underlay 未对应，但源码和 plans 显示这些已经实现。

2. 首页还不是完整编辑器
   代码里有对象编辑组件，但主页面尚未整合。

3. 自动 digitizing 质量有限
   它适合 logo / 线稿 / 图标，不适合复杂照片。

4. 首次文件写出依赖外网
   Pyodide worker 会从 CDN 加载 Pyodide，并用 micropip 安装 pyembroidery。

5. 真实刺绣质量仍需要实机验证
   浏览器预览不能完全模拟线张力、布料变形、针迹堆叠、线断、收缩等现实问题。

6. 图像处理分辨率有限
   当前 MAX_DIMENSION 为 384，利于性能，但复杂细节会被简化。

## 21. 后续开发建议

### 21.1 先整合编辑器 UI

优先把以下组件接入 `EmbroideryStudio`：

- `PreviewCanvasEditable`
- `ObjectInspector`
- `SewingOrderPanel`
- `UndoRedoButtons`
- `VisualizationToggle`

这样项目会从“自动转换工具”升级成“可编辑刺绣工作台”。

### 21.2 增加示例素材

建议加入：

- 简单 logo 样例
- 线稿样例
- 多色图标样例
- 带透明背景样例

并给出预期 stitch count 和输出格式。

### 21.3 增加导出前检查

可以在生成后提示：

- stitch count
- trim count
- jump count
- color changes
- 最大 stitch 长度
- 是否存在过小 object
- 是否存在过密区域

### 21.4 实机反馈闭环

如果要走向可用产品，需要用真实绣花机测试：

- denim
- knit
- terry
- leather
- silk

把实机反馈映射回 fabric profile。

## 22. 总结

`embroidery-studio` 是一个技术含量较高的浏览器端刺绣 digitizing 项目。它已经完成了从图片到刺绣文件的主链路，并且实现了不少真实刺绣软件才会考虑的算法层能力。

当前最准确的定位是：

```text
一个已经具备较完整刺绣生成 pipeline 的纯前端 Web 原型，
主界面可完成图片转刺绣文件，
底层已具备对象编辑器基础，
但完整编辑器体验还需要把已有组件整合到首页。
```

