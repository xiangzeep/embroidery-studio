/**
 * Pyodide は Web Worker に隔離して呼ぶ。
 * 旧 API (`getPyodide` / `PyodideInstance`) は削除。
 * 必要な API は pyodide-worker.ts から re-export する。
 */
export {
  writeEmbroideryViaWorker,
  warmupPyodide,
  terminatePyodide,
  type WriteEmbroideryInput,
} from "./pyodide-worker";
