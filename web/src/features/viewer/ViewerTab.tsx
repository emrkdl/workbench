import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ComponentRow, Polygon, RevisionDetail, StackupLayer } from "@/lib/cdm";
import { geometryUrl } from "@/lib/api";
import { formatCoarse, formatFine, toMil, toMm, type DisplayUnit } from "@/lib/units";
import { conductorNumbers, ROLE_LABEL } from "../revision/layers";
import { fetchLayer, type LayerBuffers } from "./blg";
import { BoardRenderer, type Camera } from "./renderer";
import { pick, pickComponent, pickComponentBody, type ComponentPoint, type Hit } from "./picking";
import { bodySize, css as familyCss, familyOf, FAMILIES, FAMILY_BY_KEY, type FamilyKey } from "@/lib/families";
import type { PlacementGroup } from "./renderer";
import s from "./viewer.module.css";

/**
 * 2D 레이아웃 뷰어.
 *
 * 카메라는 상태가 아니라 ref 다. 팬·줌은 프레임마다 일어나는데 그때마다 React 를 다시
 * 그리면 60fps 가 나오지 않는다. 화면 갱신은 rAF 루프 하나가 맡고, React 상태는 사람이
 * 실제로 선택을 바꿨을 때만 움직인다.
 */

/**
 * 배선 색 — 층 번호가 정한다.
 *
 * D:\PCB_auto_route 뷰어의 L1~L6 배색을 그대로 가져왔다. 색이 "몇 번째 신호층인가"가
 * 아니라 "L 몇인가"를 말해야, 적층표를 보면서 화면을 읽을 때 둘이 어긋나지 않는다.
 * 6층을 넘으면 다시 돈다 — 12층 보드에서 L1 과 L7 이 같은 색이지만, 그 둘이 한 화면에
 * 같이 켜져 있는 일은 드물고 단독 보기가 바로 옆에 있다.
 */
const LAYER_COLORS: [number, number, number][] = [
  [0.878, 0.322, 0.322],  // L1 #e05252
  [0.878, 0.651, 0.235],  // L2 #e0a63c
  [0.690, 0.416, 0.816],  // L3 #b06ad0
  [0.251, 0.690, 0.690],  // L4 #40b0b0
  [0.341, 0.800, 0.478],  // L5 #57cc7a
  [0.310, 0.561, 0.878],  // L6 #4f8fe0
];
/** 비아 종류 — 렌더러의 색 순서와 같은 순서다. */
const VIA_KIND_ORDER = ["through", "blind", "buried", "micro"];
const VIA_KIND_LABEL = ["관통", "블라인드", "베리드", "마이크로"];
const VIA_KIND_RGB_CSS = ["#d8dee6", "#b0c4d8", "#9fb4c9", "#7fd8c0"];

const GND_COLOR: [number, number, number] = [0.56, 0.62, 0.64];
const POWER_COLOR: [number, number, number] = [0.92, 0.58, 0.28];

const css = (c: [number, number, number]) =>
  `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

/** 배치도(부품 몸통) · 동박(패드·배선·플레인) · 둘 다. */
export type ViewMode = "placement" | "copper" | "both";
export type SideView = "top" | "bottom" | "both";

/** 반대 면 부품은 지운다. 지우지 않으면 어느 면 것인지 구분이 안 되고, 아예 감추면
 *  "이 자리에 뭔가 있다"는 사실이 사라진다. */
const GHOST_ALPHA = 0.22;

interface LayerInfo {
  index: number;
  label: string;
  role: string;
  color: [number, number, number];
  storageKey: string;
  objectCount: number;
}

export function ViewerTab({
  detail,
  unit,
  onUnitChange,
}: {
  detail: RevisionDetail;
  unit: DisplayUnit;
  onUnitChange: (u: DisplayUnit) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const buffersRef = useRef(new Map<number, LayerBuffers>());
  const cameraRef = useRef<Camera>({ cx: 0, cy: 0, scale: 1e-5 });
  const dirtyRef = useRef(true);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const measureRef = useRef<{ a: [number, number] | null; b: [number, number] | null }>({ a: null, b: null });

  const [visible, setVisible] = useState<Record<number, boolean>>({});
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ hit: Hit | null; component: ComponentPoint | null } | null>(null);
  const [highlightNet, setHighlightNet] = useState<number | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [measured, setMeasured] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [cursorText, setCursorText] = useState("—");
  const [refdesQuery, setRefdesQuery] = useState("");
  const [params] = useSearchParams();
  // 배치도가 기본이다. 설계 리뷰에서 먼저 보는 것이 "무엇이 어디 있나"이지
  // "동박이 어떻게 깔렸나"가 아니다.
  // URL 에 실어 두면 "이 배선 좀 봐 주세요"를 링크 하나로 보낼 수 있다. 넷 강조(?net=)도
  // 같은 방식이라 동박 화면을 그대로 건네는 데 필요한 것이 다 URL 에 있다.
  const [mode, setMode] = useState<ViewMode>(() => {
    const v = params.get("view");
    return v === "copper" || v === "both" ? v : "placement";
  });
  const [sideView, setSideView] = useState<SideView>("top");
  const [labels, setLabels] = useState(true);
  const [hiddenFamilies, setHiddenFamilies] = useState<Set<FamilyKey>>(() => new Set());
  const [alpha, setAlpha] = useState(0.85);

  const stackupByIndex = useMemo(
    () => new Map(detail.stackup.map((l: StackupLayer) => [l.index, l])),
    [detail.stackup],
  );
  const conductorNo = useMemo(() => conductorNumbers(detail.stackup), [detail.stackup]);

  const layerInfos = useMemo<LayerInfo[]>(() => {
    return (detail.layer_geometry ?? []).map((g) => {
      const layer = stackupByIndex.get(g.layer_index);
      const role = layer?.role ?? "signal";
      const no = conductorNo.get(g.layer_index) ?? g.layer_index;
      let color: [number, number, number];
      if (role === "plane_gnd") color = GND_COLOR;
      else if (role === "plane_power") color = POWER_COLOR;
      else color = LAYER_COLORS[(no - 1) % LAYER_COLORS.length]!;
      return {
        index: g.layer_index,
        label: `L${no}`,
        role,
        color,
        storageKey: g.storage_key,
        objectCount: g.object_count,
      };
    });
  }, [detail.layer_geometry, stackupByIndex, conductorNo]);

  /** 이 보드에 실제로 쓰인 비아 규격. 범례는 있는 것만 적는다. */
  const viaKindsPresent = useMemo(
    () =>
      detail.vias.map((v) => ({
        kind: VIA_KIND_ORDER.indexOf(v.kind),
        from: v.from_layer,
        to: v.to_layer,
        drill: v.drill_nm,
      })).filter((v) => v.kind >= 0),
    [detail.vias],
  );

  const components = useMemo<ComponentPoint[]>(
    () =>
      detail.components.map((c) => {
        const [w, h] = bodySize(c);
        return {
          refdes: c.refdes,
          x: c.x_nm,
          y: c.y_nm,
          side: c.side,
          package: c.package,
          partNumber: c.part_number,
          w,
          h,
        };
      }),
    [detail.components],
  );


  /** 화면에 보일 부품 — 면 필터와 패키지 계열 필터를 적용한 목록. */
  const shownComponents = useMemo(() => {
    return detail.components.filter((c) => {
      if (hiddenFamilies.has(familyOf(c))) return false;
      if (sideView === "both") return true;
      return c.side === sideView;
    });
  }, [detail.components, hiddenFamilies, sideView]);

/** 배치 모드에서 고를 수 있는 부품 — 화면에 보이는 것만. */
  const pickableComponents = useMemo<ComponentPoint[]>(() => {
    const shown = new Set(shownComponents.map((c) => c.refdes));
    return components.filter((c) => shown.has(c.refdes));
  }, [components, shownComponents]);

  const familyCounts = useMemo(() => {
    const out = new Map<FamilyKey, number>();
    for (const c of detail.components) {
      if (sideView !== "both" && c.side !== sideView) continue;
      const k = familyOf(c);
      out.set(k, (out.get(k) ?? 0) + 1);
    }
    return out;
  }, [detail.components, sideView]);

  /**
   * 계열별로 묶어 인스턴스 배열을 만든다. 색이 같은 것끼리 한 번에 그리므로 드로우콜은
   * 계열 수(최대 12)만큼이고, 부품이 몇 천 개든 달라지지 않는다.
   */
  const placementGroups = useMemo<PlacementGroup[]>(() => {
    const buckets = new Map<string, { rgb: [number, number, number]; opacity: number; xs: number[] }>();
    for (const c of shownComponents) {
      const key = familyOf(c);
      const ghost = sideView === "both" && c.side !== "top";
      const id = ghost ? `${key}:ghost` : key;
      let bucket = buckets.get(id);
      if (!bucket) {
        bucket = {
          rgb: FAMILY_BY_KEY.get(key)!.rgb,
          opacity: ghost ? GHOST_ALPHA : alpha,
          xs: [],
        };
        buckets.set(id, bucket);
      }
      const [w, h] = bodySize(c);
      bucket.xs.push(c.x_nm, c.y_nm, w, h);
    }
    // 반대 면(고스트)을 먼저 그려 앞면 부품이 위에 오게 한다
    return [...buckets.entries()]
      .sort((a, b) => Number(b[0].endsWith(":ghost")) - Number(a[0].endsWith(":ghost")))
      .map(([key, b]) => ({ key, color: b.rgb, opacity: b.opacity, rects: new Int32Array(b.xs) }));
  }, [shownComponents, sideView, alpha]);

  const boardBox = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of detail.outline) {
      if (p.is_cutout) continue;
      for (let i = 0; i < p.points_nm.length; i += 2) {
        xs.push(p.points_nm[i]!);
        ys.push(p.points_nm[i + 1]!);
      }
    }
    if (!xs.length) return { x0: 0, y0: 0, x1: 1e8, y1: 1e8 };
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }, [detail.outline]);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const w = boardBox.x1 - boardBox.x0 || 1;
    const h = boardBox.y1 - boardBox.y0 || 1;
    const scale = Math.min(stage.clientWidth / w, stage.clientHeight / h) * 0.92;
    cameraRef.current = { cx: (boardBox.x0 + boardBox.x1) / 2, cy: (boardBox.y0 + boardBox.y1) / 2, scale };
    dirtyRef.current = true;
  }, [boardBox]);

  // ── 렌더러 수명 ───────────────────────────
  useEffect(() => {
    const canvas = glRef.current;
    if (!canvas) return;
    let renderer: BoardRenderer;
    try {
      renderer = new BoardRenderer(canvas);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  // ── 레이어 적재 ───────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    buffersRef.current = new Map();
    setLoaded(0);
    setVisible(Object.fromEntries(layerInfos.map((l) => [l.index, true])));
    setSelection(null);
    setHighlightNet(null);

    let cancelled = false;
    (async () => {
      await Promise.all(
        layerInfos.map(async (info) => {
          try {
            const url = geometryUrl(detail.revision.id, info.index, info.storageKey);
            const buffers = await fetchLayer(url, controller.signal);
            if (cancelled) return;
            buffersRef.current.set(info.index, buffers);
            rendererRef.current?.setLayer(info.index, buffers);
            setLoaded((n) => n + 1);
            dirtyRef.current = true;
          } catch (e) {
            if (!cancelled && (e as Error).name !== "AbortError") setError((e as Error).message);
          }
        }),
      );
      if (!cancelled) fit();
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [layerInfos, fit, detail.revision.id]);

  // 넷 표에서 "뷰어에서 보기"로 넘어오면 그 넷을 강조하고 화면을 그쪽으로 맞춘다.
  const requestedNet = params.get("net");
  useEffect(() => {
    if (!requestedNet || loaded === 0) return;
    const id = detail.nets.findIndex((n) => n.name === requestedNet);
    if (id < 0) return;
    setHighlightNet(id);

    const xs: number[] = [];
    const ys: number[] = [];
    for (const [, buffers] of buffersRef.current) {
      for (let i = 0; i < buffers.pads.length / 4; i += 1) {
        if (buffers.padNets[i] === id) {
          xs.push(buffers.pads[i * 4]!);
          ys.push(buffers.pads[i * 4 + 1]!);
        }
      }
    }
    if (xs.length && stageRef.current) {
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      const stage = stageRef.current;
      const scale = Math.min(stage.clientWidth / (x1 - x0 || 1), stage.clientHeight / (y1 - y0 || 1)) * 0.7;
      cameraRef.current = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale: Math.min(scale, 0.01) };
    }
    dirtyRef.current = true;
  }, [requestedNet, loaded, detail.nets]);

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
      const order = [...layerInfos].map((l) => l.index).reverse();
      for (const info of layerInfos) {
        renderer.setStyle(info.index, {
          color: info.color,
          visible: visible[info.index] !== false,
          opacity: 0.9,
        });
      }
      renderer.setOrder(order);
      renderer.setCamera(cameraRef.current);
      renderer.setHighlight(mode === "placement" ? null : highlightNet);
      renderer.render([0.04, 0.05, 0.055], {
        copper: mode !== "placement",
        placement: mode !== "copper",
      });

      drawOverlay(overlay, dpr, stage, cameraRef.current, {
        outline: detail.outline,
        selection,
        measure: measureRef.current,
        unit,
        components: mode === "copper" || !labels ? [] : shownComponents,
        sideView,
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [layerInfos, visible, highlightNet, selection, unit, detail.outline, mode, labels, shownComponents, sideView]);

  useEffect(() => {
    dirtyRef.current = true;
  }, [visible, highlightNet, selection, unit, mode, sideView, labels, alpha]);

  useEffect(() => {
    const onResize = () => {
      dirtyRef.current = true;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── 좌표 변환 ─────────────────────────────
  const toBoard = useCallback((clientX: number, clientY: number): [number, number] => {
    const stage = stageRef.current!;
    const rect = stage.getBoundingClientRect();
    const { cx, cy, scale } = cameraRef.current;
    return [
      cx + (clientX - rect.left - rect.width / 2) / scale,
      cy - (clientY - rect.top - rect.height / 2) / scale,
    ];
  }, []);

  // ── 입력 ──────────────────────────────────
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const [bx, by] = toBoard(e.clientX, e.clientY);
      const cam = cameraRef.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const next = Math.min(Math.max(cam.scale * factor, 1e-7), 0.05);
      // 커서 아래 지점이 제자리에 남도록 중심을 옮긴다
      cameraRef.current = {
        scale: next,
        cx: bx - (bx - cam.cx) * (cam.scale / next),
        cy: by - (by - cam.cy) * (cam.scale / next),
      };
      dirtyRef.current = true;
    },
    [toBoard],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const [bx, by] = toBoard(e.clientX, e.clientY);
    cursorRef.current = { x: bx, y: by };
    setCursorText(
      unit === "mil"
        ? `${toMil(bx).toFixed(0)}, ${toMil(by).toFixed(0)} mil`
        : `${toMm(bx).toFixed(2)}, ${toMm(by).toFixed(2)} mm`,
    );

    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!dragging && Math.hypot(dx, dy) > 3) setDragging(true);
    if (dragging || Math.hypot(dx, dy) > 3) {
      const cam = cameraRef.current;
      cameraRef.current = { ...cam, cx: cam.cx - dx / cam.scale, cy: cam.cy + dy / cam.scale };
      dragRef.current = { x: e.clientX, y: e.clientY };
      dirtyRef.current = true;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (dragging) {
      setDragging(false);
      return;
    }
    if (!drag) return;

    const [bx, by] = toBoard(e.clientX, e.clientY);

    if (measuring) {
      const m = measureRef.current;
      if (!m.a || m.b) measureRef.current = { a: [bx, by], b: null };
      else {
        measureRef.current = { a: m.a, b: [bx, by] };
        setMeasured(Math.hypot(bx - m.a[0], by - m.a[1]));
      }
      dirtyRef.current = true;
      return;
    }

    const tolerance = 6 / cameraRef.current.scale;

    if (mode === "placement") {
      // 배치도에서는 몸통을 누른 것이지 동박을 누른 것이 아니다.
      const component = pickComponentBody(pickableComponents, bx, by, tolerance / 3);
      setSelection(component ? { hit: null, component } : null);
      setHighlightNet(null);
      return;
    }

    const active = layerInfos
      .filter((l) => visible[l.index] !== false)
      .map((l) => ({ index: l.index, buffers: buffersRef.current.get(l.index) }))
      .filter((l): l is { index: number; buffers: LayerBuffers } => !!l.buffers);

    const hit = pick(active, bx, by, tolerance);
    const component = pickComponent(components, bx, by, tolerance * 2);
    if (!hit && !component) {
      setSelection(null);
      setHighlightNet(null);
      return;
    }
    setSelection({ hit, component });
    setHighlightNet(hit?.netId ?? null);
  };

  const gotoRefdes = (query: string) => {
    const target = components.find((c) => c.refdes.toLowerCase() === query.trim().toLowerCase());
    if (!target) return;
    cameraRef.current = { cx: target.x, cy: target.y, scale: Math.max(cameraRef.current.scale, 5e-4) };
    setSelection({ hit: null, component: target });
    dirtyRef.current = true;
  };

  const soloLayer = (index: number) => {
    const onlyThis = layerInfos.every((l) => (l.index === index) === (visible[l.index] !== false));
    setVisible(Object.fromEntries(layerInfos.map((l) => [l.index, onlyThis ? true : l.index === index])));
  };

  const netName = (id: number | null) => (id == null ? null : detail.nets[id]?.name ?? `#${id}`);
  const totalObjects = layerInfos.reduce((sum, l) => sum + l.objectCount, 0);

  if (error) {
    return (
      <div className={s.wrap}>
        <div className={s.failure}>
          <b>레이아웃을 표시할 수 없습니다</b>
          <p style={{ maxWidth: "46ch", lineHeight: 1.6 }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={s.wrap}>
      <div className={s.toolbar}>
        <div className={s.seg} role="group" aria-label="보기 종류">
          {(
            [
              ["placement", "배치"],
              ["copper", "동박"],
              ["both", "둘 다"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={mode === k ? s.segOn : ""}
              aria-pressed={mode === k}
              onClick={() => setMode(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={s.seg} role="group" aria-label="보는 면">
          {(
            [
              ["top", "TOP"],
              ["bottom", "BOTTOM"],
              ["both", "양면"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={sideView === k ? s.segOn : ""}
              aria-pressed={sideView === k}
              onClick={() => setSideView(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className={s.sep} />
        <button type="button" className={s.btn} onClick={fit}>
          전체 보기
        </button>
        <label className={s.chk}>
          <input type="checkbox" checked={labels} onChange={() => setLabels((v) => !v)} />
          라벨
        </label>
        <label className={s.range} title="부품 투명도">
          α
          <input
            type="range"
            min={20}
            max={100}
            step={5}
            value={Math.round(alpha * 100)}
            onChange={(e) => setAlpha(Number(e.target.value) / 100)}
            aria-label="부품 투명도"
          />
        </label>
        <button
          type="button"
          className={`${s.btn} ${measuring ? s.btnOn : ""}`}
          onClick={() => {
            setMeasuring((v) => !v);
            measureRef.current = { a: null, b: null };
            setMeasured(null);
            dirtyRef.current = true;
          }}
        >
          거리 측정
        </button>
        <button
          type="button"
          className={s.btn}
          disabled={highlightNet === null}
          onClick={() => setHighlightNet(null)}
        >
          강조 해제
        </button>
        <span className={s.sep} />
        <input
          className={s.search}
          placeholder="RefDes 이동"
          aria-label="RefDes 로 이동"
          value={refdesQuery}
          onChange={(e) => setRefdesQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && gotoRefdes(refdesQuery)}
        />
        <button type="button" className={s.btn} onClick={() => gotoRefdes(refdesQuery)}>
          찾기
        </button>
        <span className={s.sep} />
        <button
          type="button"
          className={`${s.btn} ${unit === "mm" ? s.btnOn : ""}`}
          onClick={() => onUnitChange("mm")}
        >
          mm
        </button>
        <button
          type="button"
          className={`${s.btn} ${unit === "mil" ? s.btnOn : ""}`}
          onClick={() => onUnitChange("mil")}
        >
          mil
        </button>
        <span className={s.spacer} />
        <span className={s.hintText}>휠 확대 · 끌어서 이동 · 클릭으로 선택</span>
      </div>

      <aside className={s.layers}>
        {mode !== "copper" && (
          <>
            <div className={s.layersHead}>
              <span>패키지 계열</span>
              <button
                type="button"
                className={s.soloBtn}
                onClick={() => setHiddenFamilies(new Set())}
                disabled={hiddenFamilies.size === 0}
              >
                모두 켜기
              </button>
            </div>
            {FAMILIES.filter((f) => familyCounts.get(f.key)).map((f) => {
              const on = !hiddenFamilies.has(f.key);
              return (
                <label key={f.key} className={`${s.layerRow} ${on ? "" : s.layerDim}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setHiddenFamilies((prev) => {
                        const next = new Set(prev);
                        if (on) next.add(f.key);
                        else next.delete(f.key);
                        return next;
                      })
                    }
                  />
                  <span className={s.swatch} style={{ background: familyCss(f.rgb) }} />
                  <span className={s.layerName}>{f.label}</span>
                  <span className={s.layerRole}>{familyCounts.get(f.key)}</span>
                </label>
              );
            })}
          </>
        )}

        {mode !== "placement" && (
        <>
        <div className={s.layersHead}>
          <span>레이어 {layerInfos.length}</span>
          <button
            type="button"
            className={s.soloBtn}
            onClick={() => setVisible(Object.fromEntries(layerInfos.map((l) => [l.index, true])))}
          >
            모두 켜기
          </button>
        </div>
        {layerInfos.map((info) => {
          const on = visible[info.index] !== false;
          return (
            <label key={info.index} className={`${s.layerRow} ${on ? "" : s.layerDim}`}>
              <input type="checkbox" checked={on} onChange={() => setVisible((v) => ({ ...v, [info.index]: !on }))} />
              <span className={s.swatch} style={{ background: css(info.color) }} />
              <span className={s.layerName}>
                {info.label}
                <span className={s.layerRole}> {ROLE_LABEL[info.role as keyof typeof ROLE_LABEL] ?? info.role}</span>
              </span>
              <button
                type="button"
                className={s.soloBtn}
                title="이 층만 보기"
                onClick={(e) => {
                  e.preventDefault();
                  soloLayer(info.index);
                }}
              >
                단독
              </button>
            </label>
          );
        })}

        {/* 비아 색은 층이 아니라 종류를 말한다. 층 목록의 색과 규칙이 다르므로 따로 적어 둔다. */}
        {viaKindsPresent.length > 0 && (
          <>
            <div className={s.layersHead}>
              <span>비아</span>
            </div>
            {viaKindsPresent.map((k) => (
              <div key={k.kind} className={s.viaRow}>
                <span className={s.viaSwatch} style={{ borderColor: VIA_KIND_RGB_CSS[k.kind] }} />
                <span className={s.layerName}>
                  {VIA_KIND_LABEL[k.kind]}
                  <span className={s.layerRole}> L{k.from}–L{k.to} · ⌀{formatFine(k.drill, unit)}</span>
                </span>
              </div>
            ))}
          </>
        )}
        </>
        )}
      </aside>

      <div
        ref={stageRef}
        className={`${s.stage} ${dragging ? s.dragging : ""} ${measuring ? s.measuring : ""}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          dragRef.current = null;
          setDragging(false);
        }}
      >
        <canvas ref={glRef} className={s.canvas} />
        <canvas ref={overlayRef} className={s.overlay} />

        {loaded < layerInfos.length && (
          <div className={s.loading}>
            <span>
              레이어 {loaded} / {layerInfos.length} 적재 중
            </span>
            <div className={s.progress}>
              <div
                className={s.progressFill}
                style={{ width: `${(loaded / Math.max(layerInfos.length, 1)) * 100}%` }}
              />
            </div>
          </div>
        )}

        {selection && (
          <div className={s.inspector}>
            <div className={s.inspectorHead}>
              <span>선택</span>
              <button
                type="button"
                className={s.inspectorClose}
                aria-label="닫기"
                onClick={() => {
                  setSelection(null);
                  setHighlightNet(null);
                }}
              >
                ×
              </button>
            </div>
            <dl className={s.inspectorBody}>
              {selection.component && (
                <>
                  <dt>부품</dt>
                  <dd>{selection.component.refdes}</dd>
                  <dt>패키지</dt>
                  <dd>{selection.component.package}</dd>
                  {selection.component.partNumber && (
                    <>
                      <dt>파트넘버</dt>
                      <dd>{selection.component.partNumber}</dd>
                    </>
                  )}
                  <dt>면</dt>
                  <dd>{selection.component.side}</dd>
                </>
              )}
              {selection.hit && (
                <>
                  <dt>객체</dt>
                  <dd>
                    {{ pad: "패드", via: "비아", trace: "배선", plane: "플레인" }[selection.hit.kind]}
                    {selection.hit.kind === "via" && selection.hit.viaKind !== undefined
                      ? ` (${VIA_KIND_LABEL[selection.hit.viaKind] ?? "?"})`
                      : ""}
                    {" · L"}
                    {conductorNo.get(selection.hit.layerIndex) ?? selection.hit.layerIndex}
                  </dd>
                  <dt>넷</dt>
                  <dd>{netName(selection.hit.netId) ?? "연결 없음"}</dd>
                  {selection.hit.width ? (
                    <>
                      <dt>선폭</dt>
                      <dd>{formatFine(selection.hit.width, unit)}</dd>
                    </>
                  ) : null}
                </>
              )}
            </dl>
          </div>
        )}
      </div>

      <div className={s.status}>
        <span>
          커서 <b>{cursorText}</b>
        </span>
        <span>
          배율 <b>1 px = {formatCoarse(Math.round(1 / cameraRef.current.scale), unit)}</b>
        </span>
        <span>
          {mode === "placement" ? (
            <>
              부품 <b>{shownComponents.length.toLocaleString()}</b> / {detail.components.length.toLocaleString()}
            </>
          ) : (
            <>
              객체 <b>{totalObjects.toLocaleString()}</b>
            </>
          )}
        </span>
        {highlightNet !== null && (
          <span className={s.statusAccent}>
            넷 강조 <b>{netName(highlightNet)}</b> · {detail.nets[highlightNet]?.pin_count ?? 0}핀
          </span>
        )}
        {measured !== null && (
          <span className={s.statusAccent}>
            측정 <b>{formatCoarse(Math.round(measured), unit)}</b>
          </span>
        )}
      </div>
    </div>
  );
}

/** 선택 표시, 측정선, 보드 외형, 그리고 부품 라벨. GL 로 글자를 그리면 번거로워 2D 캔버스를 겹쳐 쓴다. */
function drawOverlay(
  canvas: HTMLCanvasElement,
  dpr: number,
  stage: HTMLDivElement,
  camera: Camera,
  opts: {
    outline: Polygon[];
    selection: { hit: Hit | null; component: ComponentPoint | null } | null;
    measure: { a: [number, number] | null; b: [number, number] | null };
    unit: DisplayUnit;
    components: ComponentRow[];
    sideView: SideView;
  },
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { outline, selection, measure, unit, components, sideView } = opts;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, stage.clientWidth, stage.clientHeight);

  const toScreen = (x: number, y: number): [number, number] => [
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
