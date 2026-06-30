// Phase 1 PR4 で実体は ./render に移動した。
// 既存 import 経路 (`from "./stitch"`, `from "@/lib/pipeline/stitch"`) を
// 壊さないための薄い shim。新規コードは `./render` か `@/lib/pipeline` から import すること。
export * from "./render";
