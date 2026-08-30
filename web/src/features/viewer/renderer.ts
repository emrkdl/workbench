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

export interface LayerStyle {
  color: [number, number, number];
  visible: boolean;
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

const CIRCLE_VS = `${VS_HEAD}
in vec2 a_unit;
in ivec2 a_center;
in int a_diameter;
in int a_net;
flat out int v_net;
out vec2 v_local;
void main() {
  vec2 unit = vec2(a_unit.x - 0.5, a_unit.y);
  vec2 rel = vec2(a_center - u_origin) + unit * float(a_diameter);
  v_net = a_net;
  v_local = unit;
  gl_Position = project(rel);
}`;

const CIRCLE_FS = `${FS_COMMON}
in vec2 v_local;
void main() {
  if (dot(v_local, v_local) > 0.25) discard;
  outColor = shade();
}`;

const SEG_VS = `${VS_HEAD}
in vec2 a_unit;          // x: 0..1 진행 방향, y: -0.5..0.5 폭 방향
in ivec2 a_p0;
in ivec2 a_p1;
in int a_width;
in int a_net;
uniform float u_minWidth; // 축소했을 때 배선이 사라지지 않도록 하는 최소 폭 (nm)
flat out int v_net;
void main() {
  vec2 a = vec2(a_p0 - u_origin);
  vec2 b = vec2(a_p1 - u_origin);
  vec2 d = b - a;
  float len = length(d);
  vec2 dir = len > 0.0 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float w = max(float(a_width), u_minWidth);
  // 선분 끝을 반폭만큼 늘려 이어지는 배선 사이에 틈이 생기지 않게 한다
  vec2 pos = mix(a, b, a_unit.x) + dir * ((a_unit.x - 0.5) * w) + nrm * (a_unit.y * w);
  v_net = a_net;
  gl_Position = project(pos);
}`;

const SEG_FS = `${FS_COMMON}
void main() { outColor = shade(); }`;

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
  private circle: Prog;
  private seg: Prog;
  private tri: Prog;
  private unitQuad: WebGLBuffer;
  private layers = new Map<number, LayerGpu>();
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
    this.circle = prog(gl, CIRCLE_VS, CIRCLE_FS, ["a_unit", "a_center", "a_diameter", "a_net"], []);
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
      this.bindUnit(this.circle.attr.a_unit!);
      const bv = this.buffer(buf.vias);
      const bn = this.buffer(buf.viaNets);
      buffers.push(bv, bn);
      iattr(this.circle.attr.a_center!, 2, bv, 12, 0);
      iattr(this.circle.attr.a_diameter!, 1, bv, 12, 8);
      iattr(this.circle.attr.a_net!, 1, bn, 4, 0);
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
      viaCount: buf.vias.length / 3,
      vaoTraces,
      traceCount: buf.traces.length / 4,
      vaoPlanes,
      planeVertexCount,
      buffers,
    });
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

  render(background: [number, number, number]) {
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

    for (const index of this.order) {
      const layer = this.layers.get(index);
      const style = this.styles.get(index);
      if (!layer || !style || !style.visible) continue;

      if (layer.vaoPlanes) {
        setup(this.tri);
        // 플레인은 배경에 가깝게. 진하게 칠하면 그 위의 배선이 전부 묻힌다.
        paint(this.tri, { ...style, opacity: style.opacity * 0.26 });
        gl.bindVertexArray(layer.vaoPlanes);
        gl.drawArrays(gl.TRIANGLES, 0, layer.planeVertexCount);
      }
      if (layer.vaoTraces) {
        setup(this.seg);
        gl.uniform1f(this.seg.loc.u_minWidth!, minWidth);
        paint(this.seg, style);
        gl.bindVertexArray(layer.vaoTraces);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, layer.traceCount);
      }
      if (layer.vaoPads) {
        setup(this.rect);
        paint(this.rect, style);
        gl.bindVertexArray(layer.vaoPads);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, layer.padCount);
      }
      if (layer.vaoVias) {
        setup(this.circle);
        paint(this.circle, style);
        gl.bindVertexArray(layer.vaoVias);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, layer.viaCount);
      }
    }
    gl.bindVertexArray(null);
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
    gl.deleteBuffer(this.unitQuad);
    for (const p of [this.rect, this.circle, this.seg, this.tri]) gl.deleteProgram(p.program);
  }
}
