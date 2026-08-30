import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Polygon, RevisionDetail, StackupLayer } from "@/lib/cdm";
import { geometryUrl } from "@/lib/api";
import { formatCoarse, formatFine, toMil, toMm, type DisplayUnit } from "@/lib/units";
import { conductorNumbers, ROLE_LABEL } from "../revision/layers";
import { fetchLayer, type LayerBuffers } from "./blg";
import { BoardRenderer, type Camera } from "./renderer";
import { pick, pickComponent, type ComponentPoint, type Hit } from "./picking";
import s from "./viewer.module.css";

/**
 * 2D 레이아웃 뷰어.
 *
 * 카메라는 상태가 아니라 ref 다. 팬·줌은 프레임마다 일어나는데 그때마다 React 를 다시
 * 그리면 60fps 가 나오지 않는다. 화면 갱신은 rAF 루프 하나가 맡고, React 상태는 사람이
 * 실제로 선택을 바꿨을 때만 움직인다.
 */

const SIGNAL_COLORS: [number, number, number][] = [
  [0.94, 0.42, 0.3],
  [0.3, 0.72, 0.95],
  [0.48, 0.85, 0.48],
  [0.95, 0.78, 0.32],
  [0.78, 0.5, 0.95],
  [0.35, 0.92, 0.82],
];
const GND_COLOR: [number, number, number] = [0.56, 0.62, 0.64];
const POWER_COLOR: [number, number, number] = [0.92, 0.58, 0.28];

const css = (c: [number, number, number]) =>
  `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

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

  const stackupByIndex = useMemo(
    () => new Map(detail.stackup.map((l: StackupLayer) => [l.index, l])),
    [detail.stackup],
  );
  const conductorNo = useMemo(() => conductorNumbers(detail.stackup), [detail.stackup]);

  const layerInfos = useMemo<LayerInfo[]>(() => {
    let signalSeen = 0;
    return (detail.layer_geometry ?? []).map((g) => {
      const layer = stackupByIndex.get(g.layer_index);
      const role = layer?.role ?? "signal";
      let color: [number, number, number];
      if (role === "plane_gnd") color = GND_COLOR;
      else if (role === "plane_power") color = POWER_COLOR;
      else color = SIGNAL_COLORS[signalSeen++ % SIGNAL_COLORS.length]!;
      return {
        index: g.layer_index,
        label: `L${conductorNo.get(g.layer_index) ?? g.layer_index}`,
        role,
        color,
        storageKey: g.storage_key,
        objectCount: g.object_count,
      };
    });
  }, [detail.layer_geometry, stackupByIndex, conductorNo]);

  const components = useMemo<ComponentPoint[]>(
    () =>
      detail.components.map((c) => ({
        refdes: c.refdes,
        x: c.x_nm,
        y: c.y_nm,
        side: c.side,
        package: c.package,
        partNumber: c.part_number,
      })),
    [detail.components],
  );

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
      renderer.setHighlight(highlightNet);
      renderer.render([0.04, 0.05, 0.055]);

      drawOverlay(overlay, dpr, stage, cameraRef.current, detail.outline, selection, measureRef.current, unit);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [layerInfos, visible, highlightNet, selection, unit, detail.outline]);

  useEffect(() => {
    dirtyRef.current = true;
  }, [visible, highlightNet, selection, unit]);

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
        <button type="button" className={s.btn} onClick={fit}>
          전체 보기
        </button>
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
        <span className={s.hintText}>휠 확대 · 끌어서 이동 · 클릭으로 넷 선택</span>
      </div>

      <aside className={s.layers}>
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
                    {{ pad: "패드", via: "비아", trace: "배선", plane: "플레인" }[selection.hit.kind]} · L
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
          객체 <b>{totalObjects.toLocaleString()}</b>
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

/** 선택 표시와 측정선. GL 로 그리면 텍스트가 번거로워 2D 캔버스를 겹쳐 쓴다. */
function drawOverlay(
  canvas: HTMLCanvasElement,
  dpr: number,
  stage: HTMLDivElement,
  camera: Camera,
  outline: Polygon[],
  selection: { hit: Hit | null; component: ComponentPoint | null } | null,
  measure: { a: [number, number] | null; b: [number, number] | null },
  unit: DisplayUnit,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, stage.clientWidth, stage.clientHeight);

  const toScreen = (x: number, y: number): [number, number] => [
    (x - camera.cx) * camera.scale + stage.clientWidth / 2,
    -(y - camera.cy) * camera.scale + stage.clientHeight / 2,
  ];

  // 보드 외형 — 어디까지가 기판인지 없으면 배선만 공중에 떠 보인다
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
      ctx.font = "600 11px ui-monospace, Consolas, monospace";
      ctx.fillStyle = "#7fd6e8";
      ctx.fillText(formatCoarse(Math.round(dist), unit), (ax + bx) / 2 + 8, (ay + by) / 2 - 6);
    }
  }
}
