// pyodide を Web Worker で動かして pyembroidery 出力を生成する。
// メインスレッドからのメッセージプロトコルは
// src/lib/pipeline/pyodide-worker.ts の PyodideWorkerRequest/Response を参照。
//
// このファイルは plain JS。public/ に置いて static 配信される。

const PYODIDE_VERSION = "0.29.4";
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

self.importScripts(`${PYODIDE_CDN}pyodide.js`);

const PY_CODE = `
import json
import pyembroidery
from pyembroidery import EmbPattern, STITCH, JUMP, TRIM, COLOR_CHANGE, END

KIND_TO_CMD = {
    "run": STITCH,
    "satin": STITCH,
    "fill": STITCH,
    "jump": JUMP,
    "trim": TRIM,
    "stop": COLOR_CHANGE,
}

def build_pattern(pattern_json: str, fmt: str) -> bytes:
    # pyembroidery は内部座標を Y-down (画像座標系) として扱い、
    # 各フォーマット writer が必要な Y 反転を自動で行う。
    # こちらの stitch データも既に Y-down (mm) なので、そのまま渡す。
    p = json.loads(pattern_json)
    emb = EmbPattern()
    for bi, block in enumerate(p["blocks"]):
        r, g, b = block["rgb"]
        emb.add_thread({"rgb": (int(r), int(g), int(b))})
        for s in block["stitches"]:
            cmd = KIND_TO_CMD.get(s["kind"], STITCH)
            x = int(round(s["x"] * 10))
            y = int(round(s["y"] * 10))
            emb.add_stitch_absolute(cmd, x, y)
    emb.add_stitch_relative(END, 0, 0)
    out_path = "/tmp/out." + fmt
    pyembroidery.write(emb, out_path)
    with open(out_path, "rb") as f:
        return f.read()
`;

let pyodide = null;
let ready = false;
const queued = [];

const initPromise = (async () => {
  pyodide = await self.loadPyodide({ indexURL: PYODIDE_CDN });
  await pyodide.loadPackage(["micropip"]);
  await pyodide.runPythonAsync(`
import micropip
await micropip.install("pyembroidery")
`);
  await pyodide.runPythonAsync(PY_CODE);
  ready = true;
  self.postMessage({ type: "ready" });
  for (const msg of queued) dispatch(msg);
  queued.length = 0;
})().catch((err) => {
  self.postMessage({
    type: "error",
    message: `Pyodide init failed: ${(err && err.message) || String(err)}`,
  });
  throw err;
});

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg || typeof msg.type !== "string") return;
  if (ready) dispatch(msg);
  else queued.push(msg);
};

function dispatch(msg) {
  if (msg.type === "init") {
    self.postMessage({ type: "init-ok", seq: msg.seq });
    return;
  }
  if (msg.type === "write") {
    handleWrite(msg).catch((err) => {
      self.postMessage({
        type: "error",
        seq: msg.seq,
        message: (err && err.message) || String(err),
      });
    });
    return;
  }
}

void initPromise;

async function handleWrite(msg) {
  const { seq, patternJson, format } = msg;
  pyodide.globals.set("pattern_json", patternJson);
  pyodide.globals.set("fmt", format);
  let result = null;
  try {
    result = await pyodide.runPythonAsync("build_pattern(pattern_json, fmt)");
    const u8 = toUint8Array(result);
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    self.postMessage({ type: "result", seq, buffer: ab }, [ab]);
  } catch (err) {
    self.postMessage({
      type: "error",
      seq,
      message: (err && err.message) || String(err),
    });
  } finally {
    if (result && typeof result.destroy === "function") {
      try {
        result.destroy();
      } catch (_) {
        /* noop */
      }
    }
  }
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value && typeof value.getBuffer === "function") {
    const buf = value.getBuffer();
    try {
      return new Uint8Array(buf.data);
    } finally {
      buf.release();
      if (typeof value.destroy === "function") value.destroy();
    }
  }
  if (value && typeof value.toJs === "function") {
    const js = value.toJs({ create_proxies: false });
    if (typeof value.destroy === "function") value.destroy();
    if (js instanceof Uint8Array) return js;
    if (Array.isArray(js)) return new Uint8Array(js);
  }
  throw new Error("pyembroidery output: could not convert to Uint8Array");
}
