/**
 * 보드 레이아웃 WebGL2 렌더러.
 *
 * 설계 문서는 PixiJS 를 적었지만 실제로 필요한 것은 네 종류의 인스턴스 드로우뿐이라
 * 직접 작성했다. 400 KB 짜리 의존성을 폐쇄망 번들에 넣지 않아도 되고, 무엇보다
 * .blg 의 타입 배열을 **가공 없이 그대로** 인스턴스 속성으로 바인딩할 수 있다 —
 * Pixi 의 Graphics 를 거치면 어차피 CPU 에서 정점을 다시 만들어야 한다.
 *
 * 좌표 정밀도: 좌표는 나노미터 정수이고 보드 하나가 1e8 을 넘는다. float32 의 유효
 * 자릿수(약 7자리)로는 깊게 확대했을 때 떨림이 생기므로, 정점 셰이더에서 **정수 상태로**
 * 카메라 원점을 빼고 나서 float 으로 바꾼다. 이러면 화면에 들어오는 값이 항상 작다.
 */

import type { LayerBuffers } from "./blg";

/**
 * 비아 색 — 종류별. D:\PCB_auto_route 뷰어의 배색을 그대로 따랐다.
 *
 * 관통이 가장 밝고 마이크로가 청록이다. 이 순서는 취향이 아니라 제조 난이도 순이라,
 * 화면에서 청록이 많이 보이면 그 보드는 HDI 라는 뜻이 된다.
 */
const VIA_KIND_RGB = new Float32Array([
  0.847, 0.871, 0.902,   // through  #d8dee6
  0.690, 0.769, 0.847,   // blind    #b0c4d8
  0.624, 0.706, 0.788,   // buried   #9fb4c9
  0.498, 0.847, 0.753,   // micro    #7fd8c0
]);

/**
 * 축소해도 비아가 점으로 남게 하는 최소 화면 지름(px).
 *
 * 2px 는 "있다"가 겨우 보이는 크기다. 더 키우면 보드 전체를 볼 때 비아가 실제보다 커져
 * 흰 점의 눈보라가 되고, 정작 봐야 할 배선이 그 밑에 깔린다.
 */
const VIA_MIN_PAD_PX = 2.0;

/** 기판 바탕. 비아 구멍은 이 색으로 메워야 뚫린 것처럼 보인다. */
const SUBSTRATE: [number, number, number] = [0.12, 0.16, 0.21];

export interface LayerStyle {
  color: [number, number, number];
  visible: boolean;
  opacity: number;
}

/**
 * 배치도 한 묶음 — 같은 색으로 칠할 부품 몸통들.
 *
 * 색은 패키지 외형(BGA / QFN / 칩 수동 / 커넥터 …) 기준으로 묶는다. "무엇으로
 * 만들어졌는가"가 아니라 "실장·검사에서 서로 다른 물건인가"가 기준이라, 배치도를 볼 때
 * 눈이 먼저 찾는 구분과 일치한다.
 */
export interface PlacementGroup {
  key: string;
  color: [number, number, number];
  /** 인스턴스당 x, y, w, h (회전 반영 후). stride 16바이트. */
  rects: Int32Array;
  opacity: number;
}

export interface Camera {
  /** 화면 중심의 보드 좌표 (nm). */
  cx: number;
  cy: number;
  /** nm 당 CSS 픽셀. */
  scale: number;
}

const VS_HEAD = `#version 300 es
precision highp float;
precision highp int;
uniform ivec2 u_origin;
uniform vec2 u_scale;
vec4 project(vec2 rel) { return vec4(rel * u_scale, 0.0, 1.0); }
`;

const FS_COMMON = `#version 300 es
precision highp float;
uniform vec3 u_color;
uniform float u_opacity;
uniform int u_highlight;     // -1 이면 강조 없음
flat in int v_net;
out vec4 outColor;
vec4 shade() {
  if (u_highlight >= 0) {
    if (v_net == u_highlight) return vec4(min(u_color * 1.9 + 0.35, vec3(1.0)), 1.0);
    return vec4(u_color, u_opacity * 0.16);
  }
  return vec4(u_color, u_opacity);
}
`;

const RECT_VS = `${VS_HEAD}
in vec2 a_unit;
in ivec2 a_center;
in ivec2 a_size;
in int a_net;
flat out int v_net;
void main() {
  vec2 unit = vec2(a_unit.x - 0.5, a_unit.y);   // 유닛 사각형은 0..1 이라 중심 기준으로 옮긴다
  vec2 rel = vec2(a_center - u_origin) + unit * vec2(a_size);
  v_net = a_net;
  gl_Position = project(rel);
}`;

const RECT_FS = `${FS_COMMON}
void main() { outColor = shade(); }`;

/**
 * 비아 — 바깥은 패드, 안쪽은 뚫린 구멍인 도넛.
 *
 * 꽉 찬 원으로 그리면 화면에서 패드와 구별되지 않는다. 비아는 "여기서 배선이 층을
 * 바꿨다"는 표시이고, 그 사실은 배선을 따라가는 눈에 즉시 보여야 하므로 형태 자체가
 * 달라야 한다. 구멍을 배경색으로 칠하는 것도 같은 이유다 — 밑의 배선이 비쳐 보이면
 * 구멍인지 겹친 선인지 알 수 없다.
 *
 * 색은 층이 아니라 **비아 종류**를 말한다. 어느 층에 있는지는 배선 색이 이미 말하고,
 * 비아에서 궁금한 것은 관통인지 마이크로인지다 — 제조 난이도와 단가가 거기서 갈린다.
 */
const VIA_VS = `${VS_HEAD}
in vec2 a_unit;
in ivec2 a_center;
in int a_pad;
in int a_drill;
in uint a_kind;      // u8 로 올린 값이라 uint 로 받는다 — int 로 선언하면 타입이 어긋나
                     // glDrawArraysInstanced 가 통째로 실패한다
in int a_net;
uniform float u_minPad;     // 축소했을 때 비아가 사라지지 않도록 하는 최소 지름 (nm)
flat out int v_net;
flat out int v_kind;
flat out float v_hole;      // 반지름 대비 구멍 비율
out vec2 v_local;
void main() {
  float pad = max(float(a_pad), u_minPad);
  vec2 unit = vec2(a_unit.x - 0.5, a_unit.y);
  vec2 rel = vec2(a_center - u_origin) + unit * pad;
  v_net = a_net;
  v_kind = int(a_kind);
  // 지름을 키워 그릴 때도 구멍 비율은 실제 규격대로 유지한다
  v_hole = pad > 0.0 ? clamp(float(a_drill) / max(float(a_pad), 1.0), 0.0, 0.9) : 0.0;
  v_local = unit;
  gl_Position = project(rel);
}`;

const VIA_FS = `#version 300 es
precision highp float;
uniform vec3 u_kindColor[4];
uniform vec3 u_holeColor;
uniform float u_opacity;
uniform int u_highlight;
flat in int v_net;
flat in int v_kind;
flat in float v_hole;
in vec2 v_local;
out vec4 outColor;
void main() {
  float r2 = dot(v_local, v_local);
  if (r2 > 0.25) discard;
  vec3 ring = u_kindColor[clamp(v_kind, 0, 3)];
  bool hole = r2 < 0.25 * v_hole * v_hole;
  if (u_highlight >= 0 && v_net != u_highlight) {
    if (hole) discard;                       // 흐린 비아까지 구멍을 뚫으면 배경만 남는다
    outColor = vec4(ring, u_opacity * 0.16);
    return;
  }
  if (hole) { outColor = vec4(u_holeColor, 1.0); return; }
  vec3 c = u_highlight >= 0 ? min(ring * 1.5 + 0.25, vec3(1.0)) : ring;
  outColor = vec4(c, 1.0);
}`;

/**
 * 배선 — 선분 하나가 인스턴스 하나이고, 끝은 둥글다.
 *
 * 배선은 폴리라인을 선분으로 쪼개 저장한다. 끝을 각지게 자르면 45° 코너마다 바깥쪽에
 * 쐐기 모양 틈이 생기고, 확대했을 때 한 줄이어야 할 배선이 토막으로 보인다. 끝을 반폭만큼
 * 늘리고 그 부분을 반원으로 깎으면 이어지는 선분끼리 자연스럽게 맞물린다 — 실제 에칭된
 * 동박의 모양이기도 하다.
 */
const SEG_VS = `${VS_HEAD}
in vec2 a_unit;          // x: 0..1 진행 방향, y: -0.5..0.5 폭 방향
in ivec2 a_p0;
in ivec2 a_p1;
in int a_width;
in int a_net;
uniform float u_minWidth; // 축소했을 때 배선이 사라지지 않도록 하는 최소 폭 (nm)
flat out int v_net;
out vec2 v_cap;          // 반폭을 1 로 둔 좌표. x 는 진행 방향, y 는 폭 방향
flat out float v_len;    // 같은 단위로 잰 선분 길이
void main() {
  vec2 a = vec2(a_p0 - u_origin);
  vec2 b = vec2(a_p1 - u_origin);
  vec2 d = b - a;
  float len = length(d);
  vec2 dir = len > 0.0 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float w = max(float(a_width), u_minWidth);
  float hw = w * 0.5;   // half 는 GLSL 예약어라 못 쓴다
  // 선분 끝을 반폭만큼 늘려 이어지는 배선 사이에 틈이 생기지 않게 한다
  vec2 pos = mix(a, b, a_unit.x) + dir * ((a_unit.x - 0.5) * w) + nrm * (a_unit.y * w);
  v_cap = vec2((a_unit.x * len + (a_unit.x - 0.5) * w) / hw, a_unit.y * w / hw);
  v_len = len / hw;
  v_net = a_net;
  gl_Position = project(pos);
}`;

const SEG_FS = `${FS_COMMON}
in vec2 v_cap;
flat in float v_len;
void main() {
  // 몸통 밖으로 나간 양 끝만 반원으로 깎는다
  float over = v_cap.x < 0.0 ? v_cap.x : (v_cap.x > v_len ? v_cap.x - v_len : 0.0);
  if (over * over + v_cap.y * v_cap.y > 1.0) discard;
  outColor = shade();
}`;

const TRI_VS = `${VS_HEAD}
in ivec2 a_pos;
in int a_net;
flat out int v_net;
void main() {
  v_net = a_net;
  gl_Position = project(vec2(a_pos - u_origin));
}`;

const TRI_FS = `${FS_COMMON}
void main() { outColor = shade(); }`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const make = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(`셰이더 컴파일 실패: ${gl.getShaderInfoLog(sh)}`);
    }
    return sh;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`프로그램 링크 실패: ${gl.getProgramInfoLog(p)}`);
  }
  return p;
}

interface Prog {
  program: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
  attr: Record<string, number>;
}

function prog(gl: WebGL2RenderingContext, vs: string, fs: string, attrs: string[], uniforms: string[]): Prog {
  const program = compile(gl, vs, fs);
  const loc: Record<string, WebGLUniformLocation | null> = {};
  for (const u of ["u_origin", "u_scale", "u_color", "u_opacity", "u_highlight", ...uniforms]) {
    loc[u] = gl.getUniformLocation(program, u);
  }
  const attr: Record<string, number> = {};
  for (const a of attrs) attr[a] = gl.getAttribLocation(program, a);
  return { program, loc, attr };
}

interface LayerGpu {
  vaoPads: WebGLVertexArrayObject | null;
  padCount: number;
  vaoVias: WebGLVertexArrayObject | null;
  viaCount: number;
  vaoTraces: WebGLVertexArrayObject | null;
  traceCount: number;
  vaoPlanes: WebGLVertexArrayObject | null;
  planeVertexCount: number;
  buffers: WebGLBuffer[];
}

/** 폴리곤을 팬 삼각분할한다. 목데이터의 플레인은 사각형이라 이걸로 충분하다. */
function fanTriangulate(points: Int32Array, start: number, end: number): { pos: number[]; count: number } {
  const pos: number[] = [];
  for (let i = start + 1; i < end - 1; i += 1) {
    pos.push(
      points[start * 2]!, points[start * 2 + 1]!,
      points[i * 2]!, points[i * 2 + 1]!,
      points[(i + 1) * 2]!, points[(i + 1) * 2 + 1]!,
    );
  }
  return { pos, count: Math.max(end - start - 2, 0) * 3 };
}

export class BoardRenderer {
  private gl: WebGL2RenderingContext;
  private rect: Prog;
  private via: Prog;
  private seg: Prog;
  private tri: Prog;
  private unitQuad: WebGLBuffer;
  private layers = new Map<number, LayerGpu>();
  private board: {
    solid: { vao: WebGLVertexArrayObject; count: number; buffer: WebGLBuffer } | null;
    cutout: { vao: WebGLVertexArrayObject; count: number; buffer: WebGLBuffer } | null;
  } = { solid: null, cutout: null };
  private placement: { key: string; color: [number, number, number]; opacity: number; vao: WebGLVertexArrayObject; count: number; buffers: WebGLBuffer[] }[] = [];
  private styles = new Map<number, LayerStyle>();
  private order: number[] = [];
  private camera: Camera = { cx: 0, cy: 0, scale: 1e-5 };
  private highlight = -1;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false, premultipliedAlpha: false });
    if (!gl) throw new Error("이 브라우저에서 WebGL2 를 쓸 수 없습니다.");
    this.gl = gl;

    this.rect = prog(gl, RECT_VS, RECT_FS, ["a_unit", "a_center", "a_size", "a_net"], []);
    this.via = prog(
      gl, VIA_VS, VIA_FS,
      ["a_unit", "a_center", "a_pad", "a_drill", "a_kind", "a_net"],
      ["u_minPad", "u_kindColor[0]", "u_holeColor"],
    );
    this.seg = prog(gl, SEG_VS, SEG_FS, ["a_unit", "a_p0", "a_p1", "a_width", "a_net"], ["u_minWidth"]);
    this.tri = prog(gl, TRI_VS, TRI_FS, ["a_pos", "a_net"], []);

    this.unitQuad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitQuad);
    // TRIANGLE_STRIP 4개. x 는 0..1(진행), y 는 -0.5..0.5(폭). 사각형에도 그대로 쓴다.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -0.5, 0, 0.5, 1, -0.5, 1, 0.5]), gl.STATIC_DRAW);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private buffer(data: ArrayBufferView): WebGLBuffer {
    const gl = this.gl;
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }

  private bindUnit(location: number) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitQuad);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(location, 0);
  }

  setLayer(index: number, buf: LayerBuffers | null) {
    const gl = this.gl;
    const old = this.layers.get(index);
    if (old) {
      for (const b of old.buffers) gl.deleteBuffer(b);
      for (const v of [old.vaoPads, old.vaoVias, old.vaoTraces, old.vaoPlanes]) if (v) gl.deleteVertexArray(v);
      this.layers.delete(index);
    }
    if (!buf) return;

    const buffers: WebGLBuffer[] = [];
    const iattr = (loc: number, size: number, b: WebGLBuffer, stride: number, offset: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribIPointer(loc, size, gl.INT, stride, offset);
      gl.vertexAttribDivisor(loc, 1);
    };

    let vaoPads: WebGLVertexArrayObject | null = null;
    if (buf.pads.length) {
      vaoPads = gl.createVertexArray()!;
      gl.bindVertexArray(vaoPads);
      this.bindUnit(this.rect.attr.a_unit!);
      const bp = this.buffer(buf.pads);
      const bn = this.buffer(buf.padNets);
      buffers.push(bp, bn);
      iattr(this.rect.attr.a_center!, 2, bp, 16, 0);
      iattr(this.rect.attr.a_size!, 2, bp, 16, 8);
      iattr(this.rect.attr.a_net!, 1, bn, 4, 0);
    }

    let vaoVias: WebGLVertexArrayObject | null = null;
    if (buf.vias.length) {
      vaoVias = gl.createVertexArray()!;
      gl.bindVertexArray(vaoVias);
      this.bindUnit(this.via.attr.a_unit!);
      const bv = this.buffer(buf.vias);
      const bk = this.buffer(buf.viaKinds);
      const bn = this.buffer(buf.viaNets);
      buffers.push(bv, bk, bn);
      iattr(this.via.attr.a_center!, 2, bv, 16, 0);
      iattr(this.via.attr.a_pad!, 1, bv, 16, 8);
      iattr(this.via.attr.a_drill!, 1, bv, 16, 12);
      iattr(this.via.attr.a_net!, 1, bn, 4, 0);
      // 종류 코드만 u8 이다. 비아 하나에 1바이트라 배열이 작고, 네 가지뿐이라 남지도 않는다.
      gl.bindBuffer(gl.ARRAY_BUFFER, bk);
      gl.enableVertexAttribArray(this.via.attr.a_kind!);
      gl.vertexAttribIPointer(this.via.attr.a_kind!, 1, gl.UNSIGNED_BYTE, 1, 0);
      gl.vertexAttribDivisor(this.via.attr.a_kind!, 1);
    }

    let vaoTraces: WebGLVertexArrayObject | null = null;
    if (buf.traces.length) {
      vaoTraces = gl.createVertexArray()!;
      gl.bindVertexArray(vaoTraces);
      this.bindUnit(this.seg.attr.a_unit!);
      const bt = this.buffer(buf.traces);
      const bw = this.buffer(buf.traceWidths);
      const bn = this.buffer(buf.traceNets);
      buffers.push(bt, bw, bn);
      iattr(this.seg.attr.a_p0!, 2, bt, 16, 0);
      iattr(this.seg.attr.a_p1!, 2, bt, 16, 8);
      iattr(this.seg.attr.a_width!, 1, bw, 4, 0);
      iattr(this.seg.attr.a_net!, 1, bn, 4, 0);
    }

    let vaoPlanes: WebGLVertexArrayObject | null = null;
    let planeVertexCount = 0;
    if (buf.planeOffsets.length > 1) {
      const pos: number[] = [];
      const nets: number[] = [];
      for (let i = 0; i < buf.planeOffsets.length - 1; i += 1) {
        const { pos: tri, count } = fanTriangulate(buf.planePoints, buf.planeOffsets[i]!, buf.planeOffsets[i + 1]!);
        pos.push(...tri);
        for (let k = 0; k < count; k += 1) nets.push(buf.planeNets[i]!);
      }
      planeVertexCount = nets.length;
      if (planeVertexCount) {
        vaoPlanes = gl.createVertexArray()!;
        gl.bindVertexArray(vaoPlanes);
        const bp = this.buffer(new Int32Array(pos));
        const bn = this.buffer(new Int32Array(nets));
        buffers.push(bp, bn);
        gl.bindBuffer(gl.ARRAY_BUFFER, bp);
        gl.enableVertexAttribArray(this.tri.attr.a_pos!);
        gl.vertexAttribIPointer(this.tri.attr.a_pos!, 2, gl.INT, 8, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, bn);
        gl.enableVertexAttribArray(this.tri.attr.a_net!);
        gl.vertexAttribIPointer(this.tri.attr.a_net!, 1, gl.INT, 4, 0);
      }
    }

    gl.bindVertexArray(null);
    this.layers.set(index, {
      vaoPads,
      padCount: buf.pads.length / 4,
      vaoVias,
      viaCount: buf.vias.length / 4,
      vaoTraces,
      traceCount: buf.traces.length / 4,
      vaoPlanes,
      planeVertexCount,
      buffers,
    });
  }

  /**
   * 기판 바탕. 부품보다 먼저, 가장 아래에 깔린다.
   *
   * 오버레이(2D 캔버스)는 GL 위에 그려지므로 여기에 둘 수 없다 — 바탕이 부품을 덮는다.
   * 폴리곤 하나뿐이라 삼각분할 비용도 없다.
   */
  setBoard(polygons: { points: Int32Array; isCutout: boolean }[]) {
    const gl = this.gl;
    for (const part of [this.board.solid, this.board.cutout]) {
      if (part) {
        gl.deleteVertexArray(part.vao);
        gl.deleteBuffer(part.buffer);
      }
    }
    this.board = { solid: null, cutout: null };

    const fan = (poly: { points: Int32Array }, out: number[]) => {
      const n = poly.points.length / 2;
      for (let i = 1; i < n - 1; i += 1) {
        out.push(
          poly.points[0]!, poly.points[1]!,
          poly.points[i * 2]!, poly.points[i * 2 + 1]!,
          poly.points[(i + 1) * 2]!, poly.points[(i + 1) * 2 + 1]!,
        );
      }
    };
    const upload = (tri: number[]) => {
      if (!tri.length) return null;
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const buffer = this.buffer(new Int32Array(tri));
      gl.enableVertexAttribArray(this.tri.attr.a_pos!);
      gl.vertexAttribIPointer(this.tri.attr.a_pos!, 2, gl.INT, 8, 0);
      gl.vertexAttribI4i(this.tri.attr.a_net!, -1, 0, 0, 0);
      gl.disableVertexAttribArray(this.tri.attr.a_net!);
      gl.bindVertexArray(null);
      return { vao, count: tri.length / 2, buffer };
    };

    const solid: number[] = [];
    const cutout: number[] = [];
    for (const poly of polygons) {
      if (poly.points.length >= 6) fan(poly, poly.isCutout ? cutout : solid);
    }
    // 컷아웃은 바탕색으로 다시 덮어 구멍처럼 보이게 한다. 팬 삼각분할로는 구멍 뚫린
    // 폴리곤을 만들 수 없고, 실제 구멍의 모양은 오버레이의 파선 윤곽이 마저 알려준다.
    this.board = { solid: upload(solid), cutout: upload(cutout) };
  }

  /**
   * 부품 몸통을 올린다. 패드와 같은 사각형 프로그램을 그대로 쓴다 — 중심 좌표와 크기를
   * 인스턴스 속성으로 넘기는 형태가 이미 같아서, 배치도를 위해 새 셰이더를 만들 이유가 없다.
   */
  setPlacement(groups: PlacementGroup[]) {
    const gl = this.gl;
    for (const g of this.placement) {
      gl.deleteVertexArray(g.vao);
      for (const b of g.buffers) gl.deleteBuffer(b);
    }
    this.placement = [];

    for (const group of groups) {
      const count = group.rects.length / 4;
      if (!count) continue;
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      this.bindUnit(this.rect.attr.a_unit!);
      const buffer = this.buffer(group.rects);
      // 넷 강조는 배치도에서 쓰지 않는다. 넷 속성 자리에는 -1(넷 없음)을 상수로 넣는다.
      gl.vertexAttribI4i(this.rect.attr.a_net!, -1, 0, 0, 0);
      gl.disableVertexAttribArray(this.rect.attr.a_net!);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(this.rect.attr.a_center!);
      gl.vertexAttribIPointer(this.rect.attr.a_center!, 2, gl.INT, 16, 0);
      gl.vertexAttribDivisor(this.rect.attr.a_center!, 1);
      gl.enableVertexAttribArray(this.rect.attr.a_size!);
      gl.vertexAttribIPointer(this.rect.attr.a_size!, 2, gl.INT, 16, 8);
      gl.vertexAttribDivisor(this.rect.attr.a_size!, 1);
      gl.bindVertexArray(null);
      this.placement.push({
        key: group.key, color: group.color, opacity: group.opacity, vao, count, buffers: [buffer],
      });
    }
  }

  setStyle(index: number, style: LayerStyle) {
    this.styles.set(index, style);
  }

  setOrder(order: number[]) {
    this.order = order;
  }

  setCamera(camera: Camera) {
    this.camera = camera;
  }

  setHighlight(netId: number | null) {
    this.highlight = netId ?? -1;
  }

  resize(dpr: number) {
    this.dpr = dpr;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  render(background: [number, number, number], show: { copper: boolean; placement: boolean }) {
    const gl = this.gl;
    const { width, height } = this.canvas;
    gl.viewport(0, 0, width, height);
    gl.clearColor(background[0], background[1], background[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const { cx, cy, scale } = this.camera;
    const originX = Math.round(cx);
    const originY = Math.round(cy);
    // CSS 픽셀 기준 scale 을 클립 공간으로. 캔버스는 dpr 배라 그만큼 곱한다.
    const sx = (2 * scale * this.dpr) / width;
    const sy = (2 * scale * this.dpr) / height;
    // 1픽셀보다 가는 배선은 사라진다. 화면에서 최소 1.3px 는 되도록 폭을 올린다.
    const minWidth = 1.0 / scale;

    const setup = (p: Prog) => {
      gl.useProgram(p.program);
      gl.uniform2i(p.loc.u_origin!, originX, originY);
      gl.uniform2f(p.loc.u_scale!, sx, sy);
      gl.uniform1i(p.loc.u_highlight!, this.highlight);
    };
    const paint = (p: Prog, style: LayerStyle) => {
      gl.uniform3f(p.loc.u_color!, style.color[0], style.color[1], style.color[2]);
      gl.uniform1f(p.loc.u_opacity!, style.opacity);
    };

    if (show.placement && this.board.solid) {
      setup(this.tri);
      paint(this.tri, { color: SUBSTRATE, visible: true, opacity: 1 });
      gl.bindVertexArray(this.board.solid.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.board.solid.count);
      if (this.board.cutout) {
        paint(this.tri, { color: background, visible: true, opacity: 1 });
        gl.bindVertexArray(this.board.cutout.vao);
        gl.drawArrays(gl.TRIANGLES, 0, this.board.cutout.count);
      }
    }

    if (show.copper) {
      // 비아 구멍을 메울 색. 배치도를 같이 그리면 구멍 뒤에 기판이 있고, 동박만 보면
      // 화면 바탕이 있다. 틀린 쪽을 쓰면 구멍마다 색이 어긋난 점이 찍힌다.
      this.drawCopper(setup, paint, minWidth, show.placement ? SUBSTRATE : background);
    }

    if (show.placement && this.placement.length) {
      setup(this.rect);
      for (const g of this.placement) {
        paint(this.rect, { color: g.color, visible: true, opacity: g.opacity });
        gl.bindVertexArray(g.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, g.count);
      }
    }
    gl.bindVertexArray(null);
  }

  private drawCopper(
    setup: (p: Prog) => void,
    paint: (p: Prog, style: LayerStyle) => void,
    minWidth: number,
    holeColor: [number, number, number],
  ) {
    const gl = this.gl;
    // 종류별로 그리지 않고 **한 종류씩 전 레이어를 훑는다**. 층 순서대로 그리면 위층
    // 플레인이 아래층 배선을 통째로 덮어 라우팅이 보이지 않는다. 플레인은 바탕이고,
    // 배선이 그 위에, 패드가 그 위에, 비아가 맨 위다 — 읽는 순서가 그 순서다.
    const visible = this.order
      .map((index) => ({ layer: this.layers.get(index), style: this.styles.get(index) }))
      .filter((x): x is { layer: LayerGpu; style: LayerStyle } => !!x.layer && !!x.style && x.style.visible);

    for (const { layer, style } of visible) {
      if (!layer.vaoPlanes) continue;
      setup(this.tri);
      // 플레인은 배경에 가깝게 — 참조 뷰어와 같은 0.16 이다. 진하게 칠하면 그 위의
      // 배선이 묻히고, 플레인 층이 서넛 겹치는 보드에서는 알파가 곱해져 더 심해진다.
      paint(this.tri, { ...style, opacity: style.opacity * 0.16 });
      gl.bindVertexArray(layer.vaoPlanes);
      gl.drawArrays(gl.TRIANGLES, 0, layer.planeVertexCount);
    }

    for (const { layer, style } of visible) {
      if (!layer.vaoTraces) continue;
      setup(this.seg);
      gl.uniform1f(this.seg.loc.u_minWidth!, minWidth);
      paint(this.seg, style);
      gl.bindVertexArray(layer.vaoTraces);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, layer.traceCount);
    }

    for (const { layer, style } of visible) {
      if (!layer.vaoPads) continue;
      setup(this.rect);
      paint(this.rect, style);
      gl.bindVertexArray(layer.vaoPads);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, layer.padCount);
    }

    let viaSetup = false;
    for (const { layer, style } of visible) {
      if (!layer.vaoVias) continue;
      if (!viaSetup) {
        setup(this.via);
        gl.uniform1f(this.via.loc.u_minPad!, minWidth * VIA_MIN_PAD_PX);
        gl.uniform3fv(this.via.loc["u_kindColor[0]"]!, VIA_KIND_RGB);
        gl.uniform3f(this.via.loc.u_holeColor!, holeColor[0], holeColor[1], holeColor[2]);
        viaSetup = true;
      }
      // 비아 색은 종류가 정하므로 레이어 스타일에서는 투명도만 가져온다
      gl.uniform1f(this.via.loc.u_opacity!, style.opacity);
      gl.bindVertexArray(layer.vaoVias);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, layer.viaCount);
    }
  }

  dispose() {
    const gl = this.gl;
    for (const layer of this.layers.values()) {
      for (const b of layer.buffers) gl.deleteBuffer(b);
      for (const v of [layer.vaoPads, layer.vaoVias, layer.vaoTraces, layer.vaoPlanes]) {
        if (v) gl.deleteVertexArray(v);
      }
    }
    this.layers.clear();
    for (const g of this.placement) {
      gl.deleteVertexArray(g.vao);
      for (const b of g.buffers) gl.deleteBuffer(b);
    }
    this.placement = [];
    for (const part of [this.board.solid, this.board.cutout]) {
      if (part) {
        gl.deleteVertexArray(part.vao);
        gl.deleteBuffer(part.buffer);
      }
    }
    this.board = { solid: null, cutout: null };
    gl.deleteBuffer(this.unitQuad);
    for (const p of [this.rect, this.via, this.seg, this.tri]) gl.deleteProgram(p.program);
  }
}
