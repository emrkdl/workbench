import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { geometryUrl } from "@/lib/api";
import type { ComponentRow, Polygon, RevisionDetail, StackupLayer } from "@/lib/cdm";
import { bodySize, familyOf, FAMILY_BY_KEY, type FamilyKey } from "@/lib/families";
import { formatCoarse, toMil, toMm, type DisplayUnit } from "@/lib/units";
import { conductorNumbers } from "../revision/layers";
import { fetchLayer, type LayerBuffers } from "./blg";
import { pick, pickComponent, pickComponentBody, type ComponentPoint, type Hit } from "./picking";
import { BoardRenderer, type Camera, type PlacementGroup } from "./renderer";
import s from "./viewer.module.css";

/**
 * 보드 한 장을 그리는 화면.
 *
 * 뷰어 탭과 비교 화면이 **같은 이 컴포넌트**를 쓴다. 예전에는 비교 쪽이 캔버스로 외형과
 * 부품 몸통만 따로 그렸는데, 그러면 같은 보드가 두 화면에서 다르게 보인다 — 비교하려고
 * 연 화면에서 뷰어와 다른 그림을 보는 것만큼 나쁜 것이 없다. 배선도 비아도 플레인도
 * 여기 하나를 거치므로, 렌더러를 고치면 두 화면이 같이 따라온다.
 *
 * 카메라를 ref 로 밖에서 받는 것은 비교 화면 때문이다. 두 판이 하나의 카메라를 공유해야
 * 같은 배율로 나란히 서고, 한쪽을 끌면 다른 쪽도 같이 움직인다.
 */

/* ── 배색 ──────────────────────────────────── */

/**
 * 배선 색 — 층 번호가 정한다.
 *
 * D:\PCB_auto_route 뷰어의 L1~L6 배색을 그대로 가져왔다. 색이 "몇 번째 신호층인가"가
 * 아니라 "L 몇인가"를 말해야, 적층표를 보면서 화면을 읽을 때 둘이 어긋나지 않는다.
 * 6층을 넘으면 다시 돈다 — 12층 보드에서 L1 과 L7 이 같은 색이지만, 그 둘이 한 화면에
 * 같이 켜져 있는 일은 드물고 단독 보기가 바로 옆에 있다.
 */
export const LAYER_COLORS: [number, number, number][] = [
  [0.878, 0.322, 0.322],  // L1 #e05252
  [0.878, 0.651, 0.235],  // L2 #e0a63c
  [0.690, 0.416, 0.816],  // L3 #b06ad0
  [0.251, 0.690, 0.690],  // L4 #40b0b0
  [0.341, 0.800, 0.478],  // L5 #57cc7a
  [0.310, 0.561, 0.878],  // L6 #4f8fe0
];

/** 비아 종류 — 렌더러의 색 순서와 같은 순서다. */
export const VIA_KIND_ORDER = ["through", "blind", "buried", "micro"];
export const VIA_KIND_LABEL = ["관통", "블라인드", "베리드", "마이크로"];
export const VIA_KIND_RGB_CSS = ["#d8dee6", "#b0c4d8", "#9fb4c9", "#7fd8c0"];

export const GND_COLOR: [number, number, number] = [0.56, 0.62, 0.64];
export const POWER_COLOR: [number, number, number] = [0.92, 0.58, 0.28];

export const css = (c: [number, number, number]) =>
  `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

/** 배치도(부품 몸통) · 동박(패드·배선·플레인) · 둘 다. */
export type ViewMode = "placement" | "copper" | "both";
export type SideView = "top" | "bottom" | "both";

/** 반대 면 부품은 지운다. 지우지 않으면 어느 면 것인지 구분이 안 되고, 아예 감추면
 *  "이 자리에 뭔가 있다"는 사실이 사라진다. */
const GHOST_ALPHA = 0.22;

const BACKGROUND: [number, number, number] = [0.04, 0.05, 0.055];

export interface LayerInfo {
  index: number;
  /** 도체층 번호 — L1 의 1. 보드마다 층 인덱스는 달라도 이 번호는 같은 자리를 가리킨다. */
  no: number;
  label: string;
  role: string;
  color: [number, number, number];
  storageKey: string;
  objectCount: number;
}

/* ── 리비전에서 화면 재료 뽑기 ──────────────── */

/** 적층에서 레이어 목록과 색을 만든다. 뷰어와 비교가 같은 규칙을 써야 색이 어긋나지 않는다. */
export function useLayerInfos(detail: RevisionDetail): LayerInfo[] {
  const stackupByIndex = useMemo(
    () => new Map(detail.stackup.map((l: StackupLayer) => [l.index, l])),
    [detail.stackup],
  );
  const conductorNo = useMemo(() => conductorNumbers(detail.stackup), [detail.stackup]);

  return useMemo(
    () =>
      (detail.layer_geometry ?? []).map((g) => {
        const layer = stackupByIndex.get(g.layer_index);
        const role = layer?.role ?? "signal";
        const no = conductorNo.get(g.layer_index) ?? g.layer_index;
        let color: [number, number, number];
        if (role === "plane_gnd") color = GND_COLOR;
        else if (role === "plane_power") color = POWER_COLOR;
        else color = LAYER_COLORS[(no - 1) % LAYER_COLORS.length]!;
        return {
          index: g.layer_index,
          no,
          label: `L${no}`,
          role,
          color,
          storageKey: g.storage_key,
          objectCount: g.object_count,
        };
      }),
    [detail.layer_geometry, stackupByIndex, conductorNo],
  );
}

/** 면 필터와 계열 필터를 통과한 부품. */
export function useShownComponents(
  detail: RevisionDetail,
  sideView: SideView,
  hiddenFamilies: Set<FamilyKey>,
): ComponentRow[] {
  return useMemo(
    () =>
      detail.components.filter((c) => {
        if (hiddenFamilies.has(familyOf(c))) return false;
        if (sideView === "both") return true;
        return c.side === sideView;
      }),
    [detail.components, hiddenFamilies, sideView],
  );
}

/**
 * 계열별로 묶어 인스턴스 배열을 만든다. 색이 같은 것끼리 한 번에 그리므로 드로우콜은
 * 계열 수(최대 12)만큼이고, 부품이 몇 천 개든 달라지지 않는다.
 */
export function usePlacementGroups(
  shown: ComponentRow[],
  sideView: SideView,
  alpha: number,
): PlacementGroup[] {
  return useMemo(() => {
    const buckets = new Map<string, { rgb: [number, number, number]; opacity: number; xs: number[] }>();
    for (const c of shown) {
      const key = familyOf(c);
      const ghost = sideView === "both" && c.side !== "top";
      const id = ghost ? `${key}:ghost` : key;
      let bucket = buckets.get(id);
      if (!bucket) {
        bucket = { rgb: FAMILY_BY_KEY.get(key)!.rgb, opacity: ghost ? GHOST_ALPHA : alpha, xs: [] };
        buckets.set(id, bucket);
      }
      const [w, h] = bodySize(c);
      bucket.xs.push(c.x_nm, c.y_nm, w, h);
    }
    // 반대 면(고스트)을 먼저 그려 앞면 부품이 위에 오게 한다
    return [...buckets.entries()]
      .sort((a, b) => Number(b[0].endsWith(":ghost")) - Number(a[0].endsWith(":ghost")))
      .map(([key, b]) => ({ key, color: b.rgb, opacity: b.opacity, rects: new Int32Array(b.xs) }));
  }, [shown, sideView, alpha]);
}

export function outlineBox(outline: Polygon[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of outline) {
    if (p.is_cutout) continue;
    for (let i = 0; i < p.points_nm.length; i += 2) {
      xs.push(p.points_nm[i]!);
      ys.push(p.points_nm[i + 1]!);
    }
  }
  if (!xs.length) return { x0: 0, y0: 0, x1: 1e8, y1: 1e8 };
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

export function componentPoints(detail: RevisionDetail): ComponentPoint[] {
  return detail.components.map((c) => {
    const [w, h] = bodySize(c);
    return {
      refdes: c.refdes, x: c.x_nm, y: c.y_nm, side: c.side,
      package: c.package, partNumber: c.part_number, w, h,
    };
  });
}

/* ── 화면 ──────────────────────────────────── */

export type Project = (x: number, y: number) => [number, number];

export interface Selection {
  hit: Hit | null;
  component: ComponentPoint | null;
}

export interface SceneHandle {
  /** 다음 프레임에 다시 그린다. 카메라를 밖에서 바꿨을 때 부른다. */
  invalidate(): void;
  /** 보드 전체가 들어오도록 카메라를 맞춘다. */
  fit(): void;
  toBoard(clientX: number, clientY: number): [number, number];
  buffers(): Map<number, LayerBuffers>;
  stage(): HTMLDivElement | null;
}

export interface BoardSceneProps {
  detail: RevisionDetail;
  layers: LayerInfo[];
  visible: Record<number, boolean>;
  mode: ViewMode;
  sideView: SideView;
  labels: boolean;
  alpha: number;
  hiddenFamilies: Set<FamilyKey>;
  highlightNet: number | null;
  selection: Selection | null;
  unit: DisplayUnit;
  /** 밖에서 들고 있는 카메라. 비교 화면은 두 판이 이걸 공유한다. */
  camera: React.MutableRefObject<Camera>;
  /** 카메라가 움직였다. 다른 판도 같이 다시 그려야 할 때 쓴다. */
  onCameraChange?: () => void;
  onSelect?: (selection: Selection | null) => void;
  onCursor?: (text: string, x: number, y: number) => void;
  onLoadedChange?: (loaded: number, total: number) => void;
  onError?: (message: string) => void;
  /** 거리 측정 모드. 뷰어에서만 쓴다. */
  measuring?: boolean;
  measure?: { a: [number, number] | null; b: [number, number] | null };
  onMeasure?: (m: { a: [number, number] | null; b: [number, number] | null }) => void;
  /** 화면 위에 더 그릴 것 — 비교 화면의 변경 표시가 여기로 들어온다. */
  extraOverlay?: (ctx: CanvasRenderingContext2D, project: Project, camera: Camera) => void;
  /** extraOverlay 의 내용이 바뀌었음을 알리는 값. 바뀌면 다시 그린다. */
  overlayKey?: unknown;
  /**
   * 레이어를 다 받은 뒤 보드가 화면에 꽉 차게 카메라를 맞춘다. 기본값이다.
   *
   * 비교 화면은 끈다 — 두 판이 카메라 하나를 나눠 쓰므로 각자 맞추면 서로를 밀어낸다.
   * 그쪽은 두 보드를 함께 담는 범위로 한 번만 맞춘다.
   */
  autoFit?: boolean;
  className?: string;
}

export const BoardScene = forwardRef<SceneHandle, BoardSceneProps>(function BoardScene(props, ref) {
  const {
    detail, layers, visible, mode, sideView, labels, alpha, hiddenFamilies,
    highlightNet, selection, unit, camera,
    onCameraChange, onSelect, onCursor, onLoadedChange, onError,
    measuring = false, measure = { a: null, b: null }, onMeasure,
    extraOverlay, overlayKey, autoFit = true, className,
  } = props;

  const stageRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const buffersRef = useRef(new Map<number, LayerBuffers>());
  const dirtyRef = useRef(true);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  // 콜백은 매 렌더 새 함수다. 그리기 루프가 그것 때문에 다시 걸리지 않게 ref 로 받는다.
  const extraRef = useRef(extraOverlay);
  extraRef.current = extraOverlay;

  const shown = useShownComponents(detail, sideView, hiddenFamilies);
  const placementGroups = usePlacementGroups(shown, sideView, alpha);
  const points = useMemo(() => componentPoints(detail), [detail]);
  const pickable = useMemo(() => {
    const keep = new Set(shown.map((c) => c.refdes));
    return points.filter((c) => keep.has(c.refdes));
  }, [points, shown]);
  const box = useMemo(() => outlineBox(detail.outline), [detail.outline]);

  const invalidate = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const w = box.x1 - box.x0 || 1;
    const h = box.y1 - box.y0 || 1;
    const scale = Math.min(stage.clientWidth / w, stage.clientHeight / h) * 0.92;
    camera.current = { cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2, scale };
    dirtyRef.current = true;
    onCameraChange?.();
  }, [box, camera, onCameraChange]);

  const toBoard = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const stage = stageRef.current;
      if (!stage) return [0, 0];
      const rect = stage.getBoundingClientRect();
      const { cx, cy, scale } = camera.current;
      return [
        cx + (clientX - rect.left - rect.width / 2) / scale,
        cy - (clientY - rect.top - rect.height / 2) / scale,
      ];
    },
    [camera],
  );

  useImperativeHandle(
    ref,
    () => ({
      invalidate,
      fit,
      toBoard,
      buffers: () => buffersRef.current,
      stage: () => stageRef.current,
    }),
    [invalidate, fit, toBoard],
  );

  // ── 렌더러 수명 ───────────────────────────
  useEffect(() => {
    const canvas = glRef.current;
    if (!canvas) return;
    let renderer: BoardRenderer;
    try {
      renderer = new BoardRenderer(canvas);
    } catch (e) {
      onError?.((e as Error).message);
      return;
    }
    rendererRef.current = renderer;
    dirtyRef.current = true;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
    // 렌더러는 캔버스 하나에 하나. onError 가 바뀌었다고 다시 만들 이유가 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 레이어 적재 ───────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    buffersRef.current = new Map();
    onLoadedChange?.(0, layers.length);

    let cancelled = false;
    let done = 0;
    (async () => {
      await Promise.all(
        layers.map(async (info) => {
          try {
            const url = geometryUrl(detail.revision.id, info.index, info.storageKey);
            const buffers = await fetchLayer(url, controller.signal);
            if (cancelled) return;
            buffersRef.current.set(info.index, buffers);
            rendererRef.current?.setLayer(info.index, buffers);
            done += 1;
            onLoadedChange?.(done, layers.length);
            dirtyRef.current = true;
          } catch (e) {
            if (!cancelled && (e as Error).name !== "AbortError") onError?.((e as Error).message);
          }
        }),
      );
      if (cancelled) return;
      if (autoFit) fit();
      dirtyRef.current = true;
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // fit 은 매 렌더 새 함수라 여기 넣으면 적재가 무한히 다시 돈다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, detail.revision.id]);

  useEffect(() => {
    rendererRef.current?.setPlacement(placementGroups);
    dirtyRef.current = true;
  }, [placementGroups]);

  useEffect(() => {
    rendererRef.current?.setBoard(
      detail.outline.map((p) => ({ points: new Int32Array(p.points_nm), isCutout: p.is_cutout })),
    );
    dirtyRef.current = true;
  }, [detail.outline]);

  // ── 그리기 루프 ───────────────────────────
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const renderer = rendererRef.current;
      const stage = stageRef.current;
      const overlay = overlayRef.current;
      if (!renderer || !stage || !overlay) return;
      if (!dirtyRef.current) return;
      dirtyRef.current = false;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.resize(dpr);
      overlay.width = Math.round(stage.clientWidth * dpr);
      overlay.height = Math.round(stage.clientHeight * dpr);

      // 아래 층부터 그려야 위 층이 위에 온다
      for (const info of layers) {
        renderer.setStyle(info.index, {
          color: info.color,
          visible: visible[info.index] !== false,
          opacity: 0.9,
        });
      }
      renderer.setOrder([...layers].map((l) => l.index).reverse());
      renderer.setCamera(camera.current);
      renderer.setHighlight(mode === "placement" ? null : highlightNet);
      renderer.render(BACKGROUND, { copper: mode !== "placement", placement: mode !== "copper" });

      drawOverlay(overlay, dpr, stage, camera.current, {
        outline: detail.outline,
        selection,
        measure,
        unit,
        components: mode === "copper" || !labels ? [] : shown,
        sideView,
        extra: extraRef.current,
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [layers, visible, highlightNet, selection, unit, detail.outline, mode, labels, shown, sideView, measure, camera]);

  // 그림에 영향을 주는 값이 바뀌면 다음 프레임에 다시 그린다
  useEffect(() => {
    dirtyRef.current = true;
  }, [visible, highlightNet, selection, unit, mode, sideView, labels, alpha, overlayKey]);

  useEffect(() => {
    const onResize = () => {
      dirtyRef.current = true;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── 입력 ──────────────────────────────────
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const [bx, by] = toBoard(e.clientX, e.clientY);
      const cam = camera.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const next = Math.min(Math.max(cam.scale * factor, 1e-7), 0.05);
      // 커서 아래 지점이 제자리에 남도록 중심을 옮긴다
      camera.current = {
        scale: next,
        cx: bx - (bx - cam.cx) * (cam.scale / next),
        cy: by - (by - cam.cy) * (cam.scale / next),
      };
      dirtyRef.current = true;
      onCameraChange?.();
    },
    [toBoard, camera, onCameraChange],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const [bx, by] = toBoard(e.clientX, e.clientY);
    onCursor?.(
      unit === "mil"
        ? `${toMil(bx).toFixed(0)}, ${toMil(by).toFixed(0)} mil`
        : `${toMm(bx).toFixed(2)}, ${toMm(by).toFixed(2)} mm`,
      bx,
      by,
    );

    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!draggingRef.current && Math.hypot(dx, dy) > 3) draggingRef.current = true;
    if (draggingRef.current) {
      const cam = camera.current;
      camera.current = { ...cam, cx: cam.cx - dx / cam.scale, cy: cam.cy + dy / cam.scale };
      dragRef.current = { x: e.clientX, y: e.clientY };
      dirtyRef.current = true;
      onCameraChange?.();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (draggingRef.current) {
      draggingRef.current = false;
      return;
    }
    if (!drag) return;

    const [bx, by] = toBoard(e.clientX, e.clientY);

    if (measuring) {
      const next = !measure.a || measure.b
        ? { a: [bx, by] as [number, number], b: null }
        : { a: measure.a, b: [bx, by] as [number, number] };
      onMeasure?.(next);
      dirtyRef.current = true;
      return;
    }

    const tolerance = 6 / camera.current.scale;

    if (mode === "placement") {
      // 배치도에서는 몸통을 누른 것이지 동박을 누른 것이 아니다.
      const component = pickComponentBody(pickable, bx, by, tolerance / 3);
      onSelect?.(component ? { hit: null, component } : null);
      return;
    }

    const active = layers
      .filter((l) => visible[l.index] !== false)
      .map((l) => ({ index: l.index, buffers: buffersRef.current.get(l.index) }))
      .filter((l): l is { index: number; buffers: LayerBuffers } => !!l.buffers);

    const hit = pick(active, bx, by, tolerance);
    const component = pickComponent(points, bx, by, tolerance * 2);
    onSelect?.(hit || component ? { hit, component } : null);
  };

  return (
    <div
      ref={stageRef}
      className={`${s.stage} ${className ?? ""}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => {
        dragRef.current = null;
        draggingRef.current = false;
      }}
    >
      <canvas ref={glRef} className={s.canvas} />
      <canvas ref={overlayRef} className={s.overlay} />
    </div>
  );
});

/** 선택 표시, 측정선, 보드 외형, 그리고 부품 라벨. GL 로 글자를 그리면 번거로워 2D 캔버스를 겹쳐 쓴다. */
function drawOverlay(
  canvas: HTMLCanvasElement,
  dpr: number,
  stage: HTMLDivElement,
  camera: Camera,
  opts: {
    outline: Polygon[];
    selection: Selection | null;
    measure: { a: [number, number] | null; b: [number, number] | null };
    unit: DisplayUnit;
    components: ComponentRow[];
    sideView: SideView;
    extra?: (ctx: CanvasRenderingContext2D, project: Project, camera: Camera) => void;
  },
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { outline, selection, measure, unit, components, sideView, extra } = opts;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, stage.clientWidth, stage.clientHeight);

  const toScreen: Project = (x, y) => [
    (x - camera.cx) * camera.scale + stage.clientWidth / 2,
    -(y - camera.cy) * camera.scale + stage.clientHeight / 2,
  ];

  // 보드 외형 — 어디까지가 기판인지 없으면 부품만 공중에 떠 보인다
  ctx.strokeStyle = "rgba(190, 205, 210, 0.55)";
  ctx.lineWidth = 1;
  for (const poly of outline) {
    if (poly.points_nm.length < 6) continue;
    ctx.setLineDash(poly.is_cutout ? [4, 3] : []);
    ctx.beginPath();
    for (let i = 0; i < poly.points_nm.length; i += 2) {
      const [sx, sy] = toScreen(poly.points_nm[i]!, poly.points_nm[i + 1]!);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 부품 라벨. 몸통이 화면에서 충분히 클 때만 쓴다 — 축소했을 때 글자를 다 그리면
  // 읽히지도 않으면서 프레임만 잡아먹는다.
  if (components.length) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    for (const c of components) {
      const [bw, bh] = bodySize(c);
      const pw = bw * camera.scale;
      const ph = bh * camera.scale;
      if (pw < 22 || ph < 8) continue;
      const [sx, sy] = toScreen(c.x_nm, c.y_nm);
      if (sx < -40 || sy < -20 || sx > w + 40 || sy > h + 20) continue;
      const size = Math.max(8, Math.min(pw / (c.refdes.length * 0.62), ph * 0.62, 22));
      if (size < 8) continue;
      ctx.font = `600 ${size}px ui-monospace, Consolas, monospace`;
      const ghost = sideView === "both" && c.side !== "top";
      ctx.fillStyle = ghost ? "rgba(226,232,240,0.5)" : "#0b1220";
      ctx.fillText(c.refdes, sx, sy);
    }
  }

  // 화면을 쓰는 쪽이 더 그릴 것 — 비교의 변경 표시는 라벨 위, 선택 표시 아래에 온다
  extra?.(ctx, toScreen, camera);

  const target = selection?.hit ?? selection?.component;
  if (target) {
    const [sx, sy] = toScreen(target.x, target.y);
    ctx.strokeStyle = "#f0b070";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx - 20, sy);
    ctx.lineTo(sx - 16, sy);
    ctx.moveTo(sx + 16, sy);
    ctx.lineTo(sx + 20, sy);
    ctx.moveTo(sx, sy - 20);
    ctx.lineTo(sx, sy - 16);
    ctx.moveTo(sx, sy + 16);
    ctx.lineTo(sx, sy + 20);
    ctx.stroke();
    if (selection?.component) {
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = "600 11px ui-monospace, Consolas, monospace";
      ctx.fillStyle = "#f0b070";
      ctx.fillText(selection.component.refdes, sx + 17, sy - 15);
    }
  }

  if (measure.a) {
    const [ax, ay] = toScreen(measure.a[0], measure.a[1]);
    const end = measure.b ?? measure.a;
    const [bx, by] = toScreen(end[0], end[1]);
    ctx.strokeStyle = "#7fd6e8";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [px, py] of [[ax, ay], [bx, by]] as [number, number][]) {
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#7fd6e8";
      ctx.fill();
    }
    if (measure.b) {
      const dist = Math.hypot(measure.b[0] - measure.a[0], measure.b[1] - measure.a[1]);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = "600 11px ui-monospace, Consolas, monospace";
      ctx.fillStyle = "#7fd6e8";
      ctx.fillText(formatCoarse(Math.round(dist), unit), (ax + bx) / 2 + 8, (ay + by) / 2 - 6);
    }
  }
}
