# Run Stitch Skeleton Graph Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Generate run stitches from ordered skeleton graph edges instead of raw skeleton pixels, so thin-line artwork with loops, branches, crossings, and connected internal lines is stitched as RUN paths.

**Architecture:** Keep `src/lib/pipeline/skeleton.ts` responsible for thinning, connected components, endpoint/junction detection, junction cluster merging, branch tracing, and closed loop extraction. Update `src/lib/pipeline/run.ts` to consume all `SkeletonBranch` edges, simplify and smooth each ordered polyline, resample by run stitch length, and stitch a deterministic graph walk that includes loops and side branches instead of falling back to a single longest path.

**Tech Stack:** TypeScript, Vitest, existing Zhang-Suen thinning and `SkeletonGraph` types.

## Global Constraints

- Do not use raw skeleton pixels as final run stitch points.
- Junction clusters must be merged before edge tracing; `skeleton.ts` already does this and tests must protect it.
- Closed-loop skeleton components must produce closed polylines.
- Branch tracing must stop at endpoint or junction nodes; graph routing decides edge order.
- The processing order is orderedPixels -> RDP -> Chaikin smoothing -> adaptive resample.
- Run stitch spacing should be near 2.0mm, with adaptive shorter steps around curves.
- Do not touch Next.js app routing or server/component conventions.

---

### Task 1: Protect Skeleton Graph Semantics

**Files:**
- Modify: `src/lib/pipeline/__tests__/skeleton.test.ts`

**Interfaces:**
- Consumes: `skeletonizeMask(mask: BinaryMask): SkeletonGraph`
- Produces: coverage for multi-component branches, junction cluster merging, and closed loop branches.

- [x] **Step 1: Add regression tests**

Add tests that assert a clustered junction is still one junction node and a mask with a separate loop plus branched component returns both loop and branch edges.

- [x] **Step 2: Run the tests to verify baseline**

Run: `npx vitest run src/lib/pipeline/__tests__/skeleton.test.ts`
Expected: PASS for existing graph semantics.

### Task 2: Add Run Routing Regression Tests

**Files:**
- Modify: `src/lib/pipeline/__tests__/run.test.ts`

**Interfaces:**
- Consumes: `medialAxisRun(shape: Shape, stitchLenMm: number): Point2D[]`
- Produces: failing tests showing current routing drops parts of complex skeleton graphs or emits pixel-density stitches.

- [x] **Step 1: Add failing tests**

Add tests for:
- a thin shape with a loop and a handle, requiring both loop and handle coverage;
- a branched thin shape requiring left arm, right arm, and stem coverage;
- stitch spacing for complex routes, requiring no dense pixel-level steps except intentional graph backtracking seams.

- [x] **Step 2: Verify RED**

Run: `npx vitest run src/lib/pipeline/__tests__/run.test.ts`
Expected: at least one new test fails because current `branchAwareSkeletonRun` only routes tree graphs or falls back to longest-pixel paths.

### Task 3: Route All Skeleton Branches in `run.ts`

**Files:**
- Modify: `src/lib/pipeline/run.ts`

**Interfaces:**
- Consumes: `SkeletonGraph.branches` with ordered `points`, `isLoop`, `startNodeId`, and `endNodeId`
- Produces: `routeSkeletonGraphBranches(graph, stitchLenMm): Point2D[]`

- [x] **Step 1: Implement graph-branch routing**

Replace tree-only routing selection with a route that:
- uses every `SkeletonBranch` once;
- handles loop branches even when a component has no endpoints;
- sorts start nodes deterministically by endpoint first, then y/x;
- does depth-first edge traversal but cuts at graph edges, never walking through junction pixels as one raw DFS path;
- emits outbound and return paths for side branches so all branches are physically stitchable as one polyline.

- [x] **Step 2: Process each edge before stitch output**

For each branch edge:
- convert raster pixels to millimeter points;
- run RDP simplification with `clamp(stitchLenMm * 0.08, 0.1, 0.25)`;
- run Chaikin smoothing with 1 or 2 iterations;
- adaptive-resample with the existing `resampleAdaptiveOpenLine`.

- [x] **Step 3: Keep fallback behavior**

If graph routing returns fewer than two points, preserve existing `centerRunUnderlay` and rail-midline fallbacks.

### Task 4: Verify and Commit

**Files:**
- Modify: implementation and test files from prior tasks.

**Interfaces:**
- Consumes: all project tests.
- Produces: a clean committed branch.

- [x] **Step 1: Run focused tests**

Run: `npx vitest run src/lib/pipeline/__tests__/skeleton.test.ts src/lib/pipeline/__tests__/run.test.ts`
Expected: PASS.

- [x] **Step 2: Run full tests**

Run: `npm run test`
Expected: PASS.

- [x] **Step 3: Run diff checks**

Run: `git diff --check`
Expected: no output, exit code 0.

- [x] **Step 4: Commit**

Commit message: `feat: optimize run stitch skeleton routing`
