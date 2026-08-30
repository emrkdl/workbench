/**
 * .blg 레이어 기하 버퍼 리더 — backend/boardlens/geometry/blg.py 와 짝을 이룬다.
 *
 * 요점은 **객체로 풀지 않는다**는 것이다. gzip 을 푼 ArrayBuffer 위에 타입 배열 뷰만
 * 씌워서 그대로 GPU 인스턴스 버퍼로 넘긴다. 20만 객체를 JSON 으로 받아 파싱했다면
 * 그 단계에서만 수 초가 걸리고 뷰어의 성능 목표는 그 자리에서 무너진다.
 */

const MAGIC = 0x31474c42; // "BLG1" 리틀 엔디언
const HEADER_SIZE = 64;
export const NO_NET = 0xffffffff;

const align8 = (n: number) => (n + 7) & ~7;

export interface LayerBuffers {
  layerIndex: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  netCount: number;
  /** x, y, w, h — 인스턴스당 4개. stride 16바이트. */
  pads: Int32Array;
  padNets: Uint32Array;
  /** x, y, pad_d, drill_d — 인스턴스당 4개. stride 16바이트. */
  vias: Int32Array;
  /** 비아 종류 코드 — 0 through / 1 blind / 2 buried / 3 micro. 색이 여기서 나온다. */
  viaKinds: Uint8Array;
  viaNets: Uint32Array;
  /** x0, y0, x1, y1 — 선분 하나가 인스턴스 하나. stride 16바이트. */
  traces: Int32Array;
  traceWidths: Uint32Array;
  traceNets: Uint32Array;
  /** 폴리곤 — 점 인덱스 경계 배열과 좌표. */
  planeOffsets: Uint32Array;
  planeNets: Uint32Array;
  planePoints: Int32Array;
  objectCount: number;
}

const EMPTY_I32 = new Int32Array(0);
const EMPTY_U32 = new Uint32Array(0);
const EMPTY_U8 = new Uint8Array(0);

export function parseBlg(buffer: ArrayBuffer): LayerBuffers {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) throw new Error("BLG 파일이 아닙니다");
  const version = view.getUint16(4, true);
  if (version !== 2) throw new Error(`지원하지 않는 BLG 버전: ${version}`);

  const layerIndex = view.getUint16(6, true);
  const bbox = {
    x0: view.getInt32(8, true),
    y0: view.getInt32(12, true),
    x1: view.getInt32(16, true),
    y1: view.getInt32(20, true),
  };
  const padCount = view.getUint32(24, true);
  const viaCount = view.getUint32(28, true);
  const traceCount = view.getUint32(32, true);
  const planeCount = view.getUint32(36, true);
  const planePointCount = view.getUint32(40, true);
  const netCount = view.getUint32(44, true);

  let at = HEADER_SIZE;
  /** 섹션을 잘라내고 커서를 8바이트 경계로 민다. subarray 가 아니라 뷰라서 복사가 없다. */
  const take = <T>(ctor: { new (b: ArrayBuffer, o: number, n: number): T; BYTES_PER_ELEMENT: number }, n: number): T => {
    const out = new ctor(buffer, at, n);
    at = align8(at + n * ctor.BYTES_PER_ELEMENT);
    return out;
  };

  const pads = padCount ? take(Int32Array, padCount * 4) : EMPTY_I32;
  const padNets = padCount ? take(Uint32Array, padCount) : EMPTY_U32;
  const vias = viaCount ? take(Int32Array, viaCount * 4) : EMPTY_I32;
  const viaKinds = viaCount ? take(Uint8Array, viaCount) : EMPTY_U8;
  const viaNets = viaCount ? take(Uint32Array, viaCount) : EMPTY_U32;
  const traces = traceCount ? take(Int32Array, traceCount * 4) : EMPTY_I32;
  const traceWidths = traceCount ? take(Uint32Array, traceCount) : EMPTY_U32;
  const traceNets = traceCount ? take(Uint32Array, traceCount) : EMPTY_U32;
  const planeOffsets = planeCount ? take(Uint32Array, planeCount + 1) : EMPTY_U32;
  const planeNets = planeCount ? take(Uint32Array, planeCount) : EMPTY_U32;
  const planePoints = planeCount ? take(Int32Array, planePointCount * 2) : EMPTY_I32;

  return {
    layerIndex,
    bbox,
    netCount,
    pads,
    padNets,
    vias,
    viaKinds,
    viaNets,
    traces,
    traceWidths,
    traceNets,
    planeOffsets,
    planeNets,
    planePoints,
    objectCount: padCount + viaCount + traceCount + planeCount,
  };
}

/**
 * 레이어 하나를 받아 푼다.
 *
 * 파일이 gzip 이므로 DecompressionStream 으로 푼다 — 브라우저 내장이라 라이브러리를
 * 번들에 넣을 필요가 없고, 폐쇄망에서 반입할 의존성이 하나 줄어든다.
 */
export async function fetchLayer(url: string, signal?: AbortSignal): Promise<LayerBuffers> {
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) throw new Error(`레이어를 불러오지 못했습니다 (${res.status})`);
  const gz = await res.arrayBuffer();

  // 서버가 이미 Content-Encoding 으로 풀어준 경우엔 그대로 쓴다.
  const head = new DataView(gz);
  if (gz.byteLength >= 4 && head.getUint32(0, true) === MAGIC) return parseBlg(gz);

  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"));
  return parseBlg(await new Response(stream).arrayBuffer());
}
