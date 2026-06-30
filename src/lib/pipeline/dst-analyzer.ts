const DST_HEADER_SIZE = 512;
const DST_RECORD_SIZE = 3;

export type DstCommandKind = "stitch" | "jump" | "stop" | "end" | "other";

export type DstAnalysis = {
  byteLength: number;
  header: Record<string, string>;
  recordCount: number;
  stitchCount: number;
  jumpCount: number;
  trimCount: number;
  stopCount: number;
  endCount: number;
  otherCount: number;
  jumpRatio: number;
  longestJumpMm: number;
  consecutiveJumpRunCount: number;
  maxConsecutiveJumpRun: number;
  colorBlockCount: number;
};

type DstDelta = { dx: number; dy: number };

export function analyzeDstBytes(bytes: Uint8Array): DstAnalysis {
  if (bytes.length < DST_HEADER_SIZE) {
    throw new Error("DST header is missing or incomplete");
  }

  const header = parseDstHeader(bytes.slice(0, DST_HEADER_SIZE));
  const bodyLength = bytes.length - DST_HEADER_SIZE;
  const recordCount = Math.floor(bodyLength / DST_RECORD_SIZE);

  let stitchCount = 0;
  let jumpCount = 0;
  let stopCount = 0;
  let endCount = 0;
  let otherCount = 0;
  let longestJumpMm = 0;
  let consecutiveJumpRunCount = 0;
  let maxConsecutiveJumpRun = 0;
  let currentJumpRun = 0;

  for (let i = 0; i < recordCount; i++) {
    const offset = DST_HEADER_SIZE + i * DST_RECORD_SIZE;
    const record = bytes.slice(offset, offset + DST_RECORD_SIZE);
    const kind = classifyDstRecord(record);

    if (kind === "stitch") stitchCount += 1;
    else if (kind === "jump") jumpCount += 1;
    else if (kind === "stop") stopCount += 1;
    else if (kind === "end") endCount += 1;
    else otherCount += 1;

    if (kind === "jump") {
      const delta = decodeDstDelta(record);
      const jumpMm = Math.hypot(delta.dx, delta.dy) / 10;
      longestJumpMm = Math.max(longestJumpMm, jumpMm);
      currentJumpRun += 1;
      maxConsecutiveJumpRun = Math.max(maxConsecutiveJumpRun, currentJumpRun);
    } else {
      if (currentJumpRun > 0) consecutiveJumpRunCount += 1;
      currentJumpRun = 0;
    }
  }
  if (currentJumpRun > 0) consecutiveJumpRunCount += 1;

  const commandCount = stitchCount + jumpCount + stopCount + otherCount;

  return {
    byteLength: bytes.length,
    header,
    recordCount,
    stitchCount,
    jumpCount,
    trimCount: 0,
    stopCount,
    endCount,
    otherCount,
    jumpRatio: commandCount === 0 ? 0 : jumpCount / commandCount,
    longestJumpMm,
    consecutiveJumpRunCount,
    maxConsecutiveJumpRun,
    colorBlockCount: commandCount === 0 ? 0 : stopCount + 1,
  };
}

export function parseDstHeader(headerBytes: Uint8Array): Record<string, string> {
  const text = new TextDecoder("ascii").decode(headerBytes);
  const header: Record<string, string> = {};
  const carriageReturn = String.fromCharCode(13);
  const endMarker = String.fromCharCode(26);
  for (const rawLine of text.split(carriageReturn)) {
    const markerIndex = rawLine.indexOf(endMarker);
    const line = (markerIndex >= 0 ? rawLine.slice(0, markerIndex) : rawLine).trimEnd();
    if (line.length < 3) continue;
    const key = line.slice(0, 2);
    if (line[2] !== ":") continue;
    header[key] = line.slice(3).trim();
  }
  return header;
}


export function classifyDstRecord(record: Uint8Array): DstCommandKind {
  if (record.length < DST_RECORD_SIZE) return "other";
  const b0 = record[0];
  const b1 = record[1];
  const b2 = record[2];
  if (b0 === 0x00 && b1 === 0x00 && b2 === 0xf3) return "end";
  if ((b2 & 0xc0) === 0xc0) return "stop";
  if ((b2 & 0x80) === 0x80) return "jump";
  if ((b2 & 0x03) === 0x03) return "stitch";
  return "other";
}

export function decodeDstDelta(record: Uint8Array): DstDelta {
  if (record.length < DST_RECORD_SIZE) return { dx: 0, dy: 0 };
  const b0 = record[0];
  const b1 = record[1];
  const b2 = record[2];
  let dx = 0;
  let dstDy = 0;

  dx += bit(b2, 0x04) * 81;
  dx -= bit(b2, 0x08) * 81;
  dx += bit(b1, 0x04) * 27;
  dx -= bit(b1, 0x08) * 27;
  dx += bit(b0, 0x04) * 9;
  dx -= bit(b0, 0x08) * 9;
  dx += bit(b1, 0x01) * 3;
  dx -= bit(b1, 0x02) * 3;
  dx += bit(b0, 0x01) * 1;
  dx -= bit(b0, 0x02) * 1;

  dstDy += bit(b2, 0x20) * 81;
  dstDy -= bit(b2, 0x10) * 81;
  dstDy += bit(b1, 0x20) * 27;
  dstDy -= bit(b1, 0x10) * 27;
  dstDy += bit(b0, 0x20) * 9;
  dstDy -= bit(b0, 0x10) * 9;
  dstDy += bit(b1, 0x80) * 3;
  dstDy -= bit(b1, 0x40) * 3;
  dstDy += bit(b0, 0x80) * 1;
  dstDy -= bit(b0, 0x40) * 1;

  return { dx, dy: -dstDy };
}


function bit(value: number, mask: number): number {
  return (value & mask) === mask ? 1 : 0;
}
