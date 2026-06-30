# 90. References - 参考文献

本計画書を作成するにあたって参照した一次/二次資料の URL 集。
実装中に細かい数値や挙動を確認したくなった時は、まずここを当たる。

## 商用ソフト公式

### Wilcom EmbroideryStudio

- [EmbroideryStudio 公式トップ](https://wilcom.com/embroiderystudio)
- [EmbroideryStudio Designing](https://wilcom.com/embroiderystudio/designing)
- [Digitizing methods (公式ヘルプ)](https://docs.wilcom.com/embroiderystudio/26/en/OnlineHelp/Digitizing/input/Digitizing_methods.htm)
- [Applying satin stitch (公式ヘルプ)](https://docs.wilcom.com/embroiderystudio/e4/en/MainHelp/Digitizing/stitches/Applying_satin_stitch.htm)
- [Split satin stitches / Auto Split](https://docs.wilcom.com/embroiderystudio/26/en/OnlineHelp/Quality/quality/Split_satin_stitches.htm)
- [User-defined splits](https://docs.wilcom.com/embroiderystudio/26/en/OnlineHelp/Decorative/patterns/User-defined_splits.htm)
- [Push and Pull Compensation (公式 blog)](https://wilcom.com/resources/blog/push-and-pull-compensation)
- [Complex Fill Tool (公式 blog)](https://wilcom.com/resources/blog/complex-fill-tool)
- [Branching (Wilcom Product Blog)](https://productblog.wilcom.com/branching/)
- [WilcomWorkspace: TrueSizer](https://wilcom.com/workspace/truesizer)

### Brother PE-Design

- [PE-DESIGN 11 (Brother USA 公式)](https://www.brother-usa.com/products/pedesign11)
- [PE-DESIGN 11 ホーム (Brother USA)](https://www.brother-usa.com/home/sewing-embroidery/pe-design-11-software)
- [PE-Design Software (Brother EU 公式)](https://sewingcraft.brother.eu/en/products/machines/pe-design-software)
- [PE-Design 11 ブローシャ PDF (EU)](https://sewingcraft.brother.eu/-/media/product-downloads/bsme/uk/pe-design-11_en.pdf)

### Ink/Stitch (OSS, 参考実装)

- [Ink/Stitch 公式](https://inkstitch.org/)
- [Stitch Path Optimization](https://inkstitch.org/tutorials/routing/)

## 業界記事 (Best Practice)

### Pathing / Travel / Branching

- [Embroidery Digitizing Pathing — Embroidery Legacy](https://embroiderylegacy.com/pathing-design-embroidery-digitizing/)
- [Automated Stitch Path Optimization — Falcon Embroidery](https://falconembroidery.com/blog/machine-embroidery-blog/automated-stitch-path-optimization-save-time-and-reduce-errors-in-digitizing)
- [Mastering Stitch Jump in Machine Embroidery — MaggieFrames](https://www.maggieframes.com/blogs/embroidery-blogs/mastering-stitch-jump-in-machine-embroidery-trimming-prevention-and-efficiency-tips)
- [What Are Jump Stitches — NK Embroidery](https://www.nkemb.com/what-are-jump-stitches-in-digitizing/)

### Underlay

- [Understanding Underlay Stitches — Embroidery Legacy](https://embroiderylegacy.com/embroidery-digitizing-underlay-digitizing/)
- [How to Choose the Right Underlay — Hatch Embroidery](https://hatchembroidery.com/resources/blog/how-to-choose-the-right-underlay-for-your-machine-embroidery-designs)

### Push / Pull Compensation

- [Push and Pull Compensation — Embroidery Legacy](https://embroiderylegacy.com/push-pull-compensation-embroidery-digitizing/)
- [Push and Pull Compensation Complete Guide — Impact Digitizing](https://impactdigitizing.com/blog/push-and-pull-compensation-in-embroidery/)

### Fill / Tatami / Satin

- [Machine Embroidery Fill Stitch Guide — Embroidery Legacy](https://embroiderylegacy.com/the-ultimate-machine-embroidery-fill-stitch-guide/)
- [How to Use Tatami Stitch — DigitEMB](https://www.digitemb.com/blog/how-to-use-tatami-stitch/)
- [Mastering Tatami Fill — Embroideres Forum](https://forum.embroideres.com/blogs/entry/244-mastering-tatami-fill-secrets-to-smooth-and-professional/)
- [What Is Tatami Stitch — 360 Digitizing Solutions](https://360digitizingsolutions.com/what-is-tatami-stitch-and-when-should-you-use-it/)
- [Satin vs Tatami — EZ Stitch Digitizing](https://ezstitchdigitizing.com/satin-stitch-vs-tatami-fill-expert-comparison/)
- [Types of Stitches — Embroidery Legacy](https://embroiderylegacy.com/machine-embroidery-digitizing-types-of-stitches/)

### 総合ガイド

- [Introduction to Embroidery Digitizing — Embird](https://www.embird.net/studio/manual/0050digit.htm)
- [Embroidery Digitizing Software for Brother — HoopTalent](https://www.hooptalent.com/blogs/news/embroidery-digitizing-software-for-brother-the-complete-guide)
- [Mastering Brother PE Design 11 — MaggieFrames](https://www.maggieframes.com/blogs/embroidery-blogs/mastering-brother-pe-design-11-essential-features-projects-and-optimization)
- [Brother PE-Design Mastery — MaggieFrameStore](https://maggieframestore.com/blogs/maggieframe-news/brother-pe-design-mastery-features-upgrades-professional-techniques)
- [Master Digitizing Embroidery Designs — MaggieFrame](https://www.maggieframes.com/blogs/embroidery-blogs/master-digitizing-embroidery-designs-techniques-software-cost-efficiency)

## OSS / ライブラリ

- [pyembroidery (Python, MIT) — DST/PES/JEF/EXP/VP3 read/write](https://github.com/EmbroidePy/pyembroidery)
- [imagetracerjs (JS, MIT) — 画像 → SVG パス変換](https://github.com/jankovicsandras/imagetracerjs)
- [Clipper2 / clipper-lib (MIT) — polygon offset / clipping](http://www.angusj.com/clipper2/Docs/Overview.htm)
- [@dnd-kit/core (MIT) — drag and drop for React](https://docs.dndkit.com/)
- [opencv.js — distanceTransform / thinning](https://docs.opencv.org/4.x/d5/d1f/tutorial_js_setup.html)

## 関連標準・フォーマット仕様

- [DST format (Tajima) — pyembroidery docs](https://github.com/EmbroidePy/pyembroidery/blob/main/docs/files.md)
- DST: 色情報を含まない。色替えは STOP コマンド + 機械側手動
- PES: Brother native format。色情報含む
- JEF: Janome native format。色情報含む
- EXP: Melco native format
- VP3: Husqvarna Viking native format

## 内部参照

- [本リポジトリ AGENTS.md](../AGENTS.md)
- [既存パイプライン仕様 docs/pipeline.md](../docs/pipeline.md)
