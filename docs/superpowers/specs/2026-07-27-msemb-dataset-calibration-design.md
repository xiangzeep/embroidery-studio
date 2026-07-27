# MSEmb Dataset Calibration Design

## Goal

Use the local MSEmb paired image dataset to improve Stitch Studio's photo-stitch
and cross-stitch generation quality in a measurable way.

The dataset contains 4250 complete pairs:

- source images: `trainX_c/c_XXXXX.png`;
- embroidery-style target images: `trainX_e/e_XXXXX.png`;
- all sampled files are 256x256 RGB PNGs;
- every numeric id exists in both folders.

The project will not copy this dataset into git. The dataset path is configured
locally and the code reads paired samples on demand.

## Non-Goal

This does not train the Codex model or permanently change the assistant. It
adds project-level tools and optional calibration data that help the local
application choose better recognition and stitch-generation behavior.

The target images are visual embroidery renderings, not PES/DST stitch files.
They can supervise visual style, color grouping, edge retention, and texture
quality. They cannot directly provide real jump commands, thread changes, or
machine-native stitch order.

## Approach

### Phase 1: Dataset Adapter and Audit

Add a small dataset module that:

1. scans source and target folders;
2. pairs files by numeric id;
3. validates image mode, size, and readability;
4. creates deterministic train/validation/test splits;
5. reports missing pairs, corrupt images, size mismatches, and duplicate ids.

The adapter exposes an iterator returning:

- pair id;
- source image path;
- target style image path;
- loaded source RGB image;
- loaded target RGB image.

The default dataset root remains outside the repository:
`/Users/zeep/Downloads/多针刺绣数据集/MSEmb_DATASET/embs_all_unaligned`.

### Phase 2: Visual Fidelity Metrics

Add metrics that compare generated previews against embroidery-style targets:

- color palette similarity;
- edge recall and edge precision;
- subject/detail boundary recall;
- texture direction similarity;
- small-component retention;
- noise penalty for isolated specks;
- background simplification penalty;
- overall perceptual similarity.

Metrics are computed from preview images, not exported PES/DST files. This keeps
the evaluation fast and repeatable.

### Phase 3: Calibration Runner

Add an offline command that evaluates a fixed sample subset against several
generation profiles:

- beginner photo stitch;
- subject-priority photo stitch;
- cartoon/line-art photo stitch;
- cross stitch with semantic overlays;
- simplified background profile.

For each profile, the runner records:

- average metric scores;
- stitchability proxies such as color count and connected component count;
- generation time;
- top failing sample ids;
- small montage images for visual inspection.

The initial runner is read-only. It does not change project behavior by itself.

### Phase 4: Parameter Recommendation

After metric baselines exist, add a lightweight calibrator that selects
generation parameters from image features:

- cartoon or photo-like source;
- foreground complexity;
- edge density;
- small-detail density;
- background texture level;
- dominant color count.

The calibrator outputs existing project settings:

- color count;
- include/simplify background;
- detail retention strength;
- line-art cleanup thresholds;
- fill density;
- outline mode selection;
- cross-stitch overlay strength.

It does not introduce a heavy neural dependency in the first version.

## Data Flow

1. User or test runner provides the dataset root.
2. `MSEmbDataset` validates and yields paired images.
3. The calibration runner sends each source image through existing recognition
   and generation profiles.
4. A preview renderer produces a comparable RGB image.
5. `MSEmbMetrics` compares the preview against the target embroidery-style
   image.
6. The report stores JSON metrics plus optional montage images under a local
   output directory.
7. Later, `GenerationProfileRecommender` learns conservative parameter choices
   from the best-scoring profiles.

## User Experience

The normal beginner workflow stays simple. The user does not see the dataset or
calibration controls during ordinary import and export.

Advanced users get a local command, for example:

```bash
python -m stitch_studio.tools.msemb_calibrate \
  --dataset-root /path/to/embs_all_unaligned \
  --limit 128 \
  --output .local/msemb-calibration
```

The command prints a short Chinese summary:

- evaluated pair count;
- best profile;
- most common failure categories;
- recommended settings for future generation.

## Testing

Automated tests cover:

- complete id pairing from mocked source and target folders;
- missing pair detection;
- unreadable image handling;
- deterministic splits;
- metric behavior on identical images;
- metric behavior when edges or colors are intentionally damaged;
- calibration runner report schema;
- no repository writes outside the requested output directory.

Small synthetic fixtures are used in unit tests. The full 4250-pair dataset is
used only for optional local calibration runs, because it lives outside the
repository.

## Risks

- The dataset target images show a rendered style, not machine stitch order.
  The calibrator must not infer jump count or color-change quality directly from
  these targets.
- If the dataset contains mostly logo-like artwork, it may overfit away from
  photo-stitch behavior. Reports must separate cartoon/line-art and photo-like
  samples.
- A visual target may intentionally simplify details that a user wants to keep.
  Subject-priority rules remain stronger than global style matching.
- Running all 4250 pairs may be slow. The default command uses a deterministic
  sample limit.

## Success Criteria

- The project can validate all 4250 local pairs without copying data into git.
- A 128-sample calibration run produces a report and montage outputs.
- Metrics identify known current failures: rounded mouth corners, missing small
  marks, noisy subject edges, and excessive background detail.
- At least one calibrated profile improves average subject/detail metrics over
  the current default without increasing color count or generation time beyond
  documented limits.
