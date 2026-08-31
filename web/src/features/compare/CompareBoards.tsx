import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ComponentChange, ComponentSnapshot, RevisionDetail } from "@/lib/cdm";
import type { FamilyKey } from "@/lib/families";
import { formatCoarse, toMm, type DisplayUnit } from "@/lib/units";
import {
  BoardScene,
  css,
  outlineBox,
  useLayerInfos,
  type LayerInfo,
  type SceneHandle,
  type Selection,
  type SideView,
  type ViewMode,
} from "../viewer/BoardScene";
import type { Camera } from "../viewer/renderer";
import s from "./compare.module.css";

/**
 * 두 리비전을 눈으로 맞대어 보는 화면.
 *
 * 뷰어와 **같은 렌더러**로 그린다. 예전에는 여기서 캔버스로 외형과 부품 몸통만 따로
 * 그렸는데, 그러면 비교하려고 연 화면에서 뷰어와 다른 그림을 보게 된다 — 배선도 비아도
 * 없는 그림으로 "배선이 어떻게 달라졌나"를 물을 수는 없다. 지금은 배치도·동박·비아가
 * 뷰어와 한 획도 다르지 않고, 뷰어의 조작(팬·줌·층 끄기·클릭 선택·넷 강조)도 그대로다.
 *
 * 이 화면만의 것은 **변경 표시**다. 판 위에 겹쳐 그리는 얇은 층 하나로, 어느 부품이
 * 사라졌고 어디로 옮겨 갔는지를 색으로 말한다.
 *
 * 기본은 나란히 보기다. 두 판이 카메라 하나를 공유하므로 배율이 같고 팬·줌도 함께
 * 움직인다 — 배율이 다르면 14mm BGA 와 10mm QFP 가 같은 크기로 보여서 비교 자체가
 * 성립하지 않는다. 겹쳐보기는 미세한 이동을 확인할 때 쓰는 옵션이다.
 */

export type CompareView = "side" | "overlay";

type ChangeRole = "added" | "removed" | "moved" | "replaced" | "rotated" | "flipped";

const ROLE_LABEL: Record<ChangeRole, string> = {
  added: "추가",
  removed: "삭제",
  moved: "이동",
  replaced: "치환",
  rotated: "회전",
  flipped: "면 이동",
};

const ROLE_ORDER: ChangeRole[] = ["removed", "added", "moved", "replaced", "rotated", "flipped"];

/** 변경 색은 표의 배지와 같은 토큰에서 온다. 캔버스는 var() 를 모르므로 값을 읽어 온다. */
function palette(): Record<string, string> {
  const root = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => root.getPropertyValue(name).trim() || fallback;
  return {
    added: v("--ok", "#43a06b"),
    removed: v("--crit", "#d05a52"),
    moved: v("--warn", "#d09a30"),
    replaced: v("--accent", "#e08a4a"),
    rotated: v("--info", "#4aa8c0"),
    flipped: v("--info", "#4aa8c0"),
    ink: v("--ink", "#e6eef7"),
  };
}

const bodyOf = (c: { body_w_nm?: number | null; body_h_nm?: number | null; rotation_mdeg: number }) => {
  const w = c.body_w_nm ?? 800_000;
  const h = c.body_h_nm ?? 500_000;
  return Math.round(c.rotation_mdeg / 90_000) % 2 ? ([h, w] as const) : ([w, h] as const);
};

/** A 판에서 보여 줄 역할과 B 판의 것은 다르다 — 삭제는 A 에만, 추가는 B 에만 있다. */
function rolesFor(changes: ComponentChange[], side: "a" | "b"): Map<string, ChangeRole> {
  const out = new Map<string, ChangeRole>();
  for (const c of changes) {
    const kind = c.kind as ChangeRole;
    if (side === "a" && kind === "added") continue;
    if (side === "b" && kind === "removed") continue;
    out.set(c.refdes, kind);
  }
  return out;
}

/* ── 변경 표시 ─────────────────────────────── */

type Project = (x: number, y: number) => [number, number];

/** 나란히 보기 — 이 판에서 달라진 부품에 색 상자를 씌운다. */
function markChanged(
  ctx: CanvasRenderingContext2D,
  project: Project,
  camera: Camera,
  detail: RevisionDetail,
  roles: Map<string, ChangeRole>,
  pal: Record<string, string>,
) {
  for (const c of detail.components) {
    const role = roles.get(c.refdes);
    if (!role) continue;
    const [bw, bh] = bodyOf(c);
    const pw = Math.max(bw * camera.scale, 5);
    const ph = Math.max(bh * camera.scale, 5);
    const [cx, cy] = project(c.x_nm, c.y_nm);
    const color = pal[role] ?? pal.ink!;
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = color;
    ctx.fillRect(cx - pw / 2, cy - ph / 2, pw, ph);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - pw / 2 - 2, cy - ph / 2 - 2, pw + 4, ph + 4);
  }
}

/** 겹쳐보기 — 이전 위치는 파선, 이후 위치는 채움, 그 사이를 선으로 잇는다. */
function markMoves(
  ctx: CanvasRenderingContext2D,
  project: Project,
  camera: Camera,
  changes: ComponentChange[],
  pal: Record<string, string>,
) {
  const box = (snap: ComponentSnapshot, dashed: boolean, color: string) => {
    const [bw, bh] = bodyOf(snap);
    const pw = Math.max(bw * camera.scale, 5);
    const ph = Math.max(bh * camera.scale, 5);
    const [cx, cy] = project(snap.x_nm, snap.y_nm);
    if (!dashed) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = color;
      ctx.fillRect(cx - pw / 2, cy - ph / 2, pw, ph);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.setLineDash(dashed ? [3, 2] : []);
    ctx.strokeRect(cx - pw / 2, cy - ph / 2, pw, ph);
    ctx.setLineDash([]);
  };

  for (const c of changes) {
    const color = pal[c.kind] ?? pal.ink!;
    if (c.before) box(c.before, true, color);
    if (c.after) box(c.after, false, color);
    if (c.before && c.after && c.kind === "moved") {
      const [ax, ay] = project(c.before.x_nm, c.before.y_nm);
      const [bx, by] = project(c.after.x_nm, c.after.y_nm);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

/* ── 화면 ──────────────────────────────────── */

const EMPTY_FAMILIES = new Set<FamilyKey>();

/** 한쪽만 골랐을 때도 훅 개수를 맞추려고 쓰는 빈 리비전. */
const EMPTY_DETAIL = {
  revision: { id: "" },
  stackup: [],
  layer_geometry: [],
  components: [],
  nets: [],
  outline: [],
} as unknown as RevisionDetail;

export function CompareBoards({
  view,
  onViewChange,
  labels,
  onLabelsChange,
  expanded,
  onExpandedChange,
  changes,
  detailA,
  detailB,
  labelA,
  labelB,
  unit,
  height = 420,
}: {
  view: CompareView;
  onViewChange: (view: CompareView) => void;
  labels: boolean;
  onLabelsChange: (labels: boolean) => void;
  /** 확장은 패널 전체를 덮는 일이라 상태를 패널 쪽이 들고 있다. */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  changes: ComponentChange[];
  detailA: RevisionDetail | null;
  detailB: RevisionDetail | null;
  labelA: string;
  labelB: string;
  unit: DisplayUnit;
  height?: number;
}) {
  const sceneA = useRef<SceneHandle>(null);
  const sceneB = useRef<SceneHandle>(null);
  // 카메라 하나를 두 판이 나눠 쓴다. 배율이 다르면 크기 비교가 성립하지 않는다.
  const camera = useRef<Camera>({ cx: 0, cy: 0, scale: 1e-5 });

  // 뷰어와 같은 조작을 여기서도 준다. 다만 두 판에 **같은 값**을 먹인다 — 한쪽만 동박이고
  // 다른 쪽은 배치도이면 그것은 비교가 아니다.
  //
  // 무엇을 보고 있었는지는 URL 에 남긴다. 나란히/겹쳐보기와 같은 이유다 — "이 비교의
  // 동박 좀 봐 주세요"를 링크 하나로 보낼 수 있어야 한다.
  const [params, setParams] = useSearchParams();
  const mode = ((): ViewMode => {
    const v = params.get("bmode");
    return v === "placement" || v === "copper" ? v : "both";
  })();
  const setMode = (next: ViewMode) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("bmode", next);
      return p;
    }, { replace: true });
  const [sideView, setSideView] = useState<SideView>("top");
  const [marks, setMarks] = useState(true);
  const [hiddenNo, setHiddenNo] = useState<Set<number>>(() => new Set());
  const [selection, setSelection] = useState<{ side: "a" | "b"; value: Selection } | null>(null);
  const [netName, setNetName] = useState<string | null>(null);
  const [cursor, setCursor] = useState("—");

  // 화면을 다 덮는 것에는 언제나 나가는 길이 있어야 한다.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onExpandedChange(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, onExpandedChange]);

  const layersA = useLayerInfos(detailA ?? EMPTY_DETAIL);
  const layersB = useLayerInfos(detailB ?? EMPTY_DETAIL);
  const pal = useMemo(palette, []);

  /** 층 번호로 켜고 끈다. 보드마다 층 인덱스는 달라도 "L3 을 본다"는 뜻은 같다. */
  const conductors = useMemo(() => {
    const all = new Map<number, LayerInfo>();
    for (const l of [...layersA, ...layersB]) if (!all.has(l.no)) all.set(l.no, l);
    return [...all.values()].sort((x, y) => x.no - y.no);
  }, [layersA, layersB]);

  const visibleOf = useCallback(
    (layers: LayerInfo[]) => Object.fromEntries(layers.map((l) => [l.index, !hiddenNo.has(l.no)])),
    [hiddenNo],
  );

  const rolesA = useMemo(() => rolesFor(changes, "a"), [changes]);
  const rolesB = useMemo(() => rolesFor(changes, "b"), [changes]);

  const redraw = useCallback(() => {
    sceneA.current?.invalidate();
    sceneB.current?.invalidate();
  }, []);

  /** 두 보드를 함께 담는 범위로 한 번만 맞춘다. 각자 맞추면 서로를 밀어낸다. */
  const fitBoth = useCallback(() => {
    const boxes = [detailA, detailB].filter(Boolean).map((d) => outlineBox(d!.outline));
    const stage = sceneA.current?.stage() ?? sceneB.current?.stage();
    if (!boxes.length || !stage || !stage.clientWidth) return;
    // 큰 쪽에 맞춰야 둘 다 들어온다
    const w = Math.max(...boxes.map((b) => b.x1 - b.x0), 1);
    const h = Math.max(...boxes.map((b) => b.y1 - b.y0), 1);
    const first = boxes[0]!;
    camera.current = {
      cx: (first.x0 + first.x1) / 2,
      cy: (first.y0 + first.y1) / 2,
      scale: Math.min(stage.clientWidth / w, stage.clientHeight / h) * 0.92,
    };
    redraw();
  }, [detailA, detailB, redraw]);

  // 넷 강조는 **이름**으로 맞춘다. 넷 번호는 리비전마다 다른 배열의 인덱스라 그대로 쓰면
  // 다른 판에서 엉뚱한 넷이 켜진다.
  const netIdIn = (detail: RevisionDetail | null) =>
    netName && detail ? detail.nets.findIndex((n) => n.name === netName) : -1;
  const highlightA = netIdIn(detailA);
  const highlightB = netIdIn(detailB);

  const onSelect = (side: "a" | "b", detail: RevisionDetail | null) => (next: Selection | null) => {
    setSelection(next ? { side, value: next } : null);
    const id = next?.hit?.netId;
    setNetName(id != null && detail ? detail.nets[id]?.name ?? null : null);
  };

  const overlayA = useCallback(
    (ctx: CanvasRenderingContext2D, project: Project, cam: Camera) => {
      if (!marks) return;
      if (view === "overlay") markMoves(ctx, project, cam, changes, pal);
      else if (detailA) markChanged(ctx, project, cam, detailA, rolesA, pal);
    },
    [marks, detailA, view, changes, rolesA, pal],
  );

  const overlayB = useCallback(
    (ctx: CanvasRenderingContext2D, project: Project, cam: Camera) => {
      if (marks && detailB) markChanged(ctx, project, cam, detailB, rolesB, pal);
    },
    [marks, detailB, rolesB, pal],
  );

  const counts = useMemo(() => {
    const out = new Map<ChangeRole, number>();
    for (const c of changes) out.set(c.kind as ChangeRole, (out.get(c.kind as ChangeRole) ?? 0) + 1);
    return out;
  }, [changes]);

  // 겹쳐보기는 B 판 하나 위에 두 시점을 겹친다. 두 판의 동박을 정말로 포개면 어느 쪽
  // 배선인지 알 수 없는 뭉개진 그림이 되고, 정작 보려던 미세한 이동이 묻힌다.
  const paneDetail = view === "overlay" ? detailB ?? detailA : detailA;
  const paneLayers = view === "overlay" ? (detailB ? layersB : layersA) : layersA;
  const paneHighlight = view === "overlay" ? (detailB ? highlightB : highlightA) : highlightA;

  const common = {
    mode,
    sideView,
    labels,
    alpha: 0.85,
    hiddenFamilies: EMPTY_FAMILIES,
    unit,
    camera,
    onCameraChange: redraw,
    autoFit: false,
    onCursor: setCursor,
  };

  const picked = selection?.value;
  const pickedDetail = selection?.side === "a" ? paneDetail : detailB;
  const boxA = detailA ? outlineBox(detailA.outline) : null;

  return (
    <div className={`${s.boards} ${expanded ? s.boardsExpanded : ""}`}>
      <div className={s.boardTools}>
        <div className={s.seg} role="group" aria-label="보기 종류">
          {([["placement", "배치"], ["copper", "동박"], ["both", "둘 다"]] as const).map(([k, label]) => (
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
          {([["top", "TOP"], ["bottom", "BOTTOM"], ["both", "양면"]] as const).map(([k, label]) => (
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
        <div className={s.seg} role="group" aria-label="맞대는 방식">
          {([["side", "나란히"], ["overlay", "겹쳐보기"]] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={view === k ? s.segOn : ""}
              aria-pressed={view === k}
              onClick={() => onViewChange(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`${s.filterChip} ${labels ? s.filterChipOn : ""}`}
          aria-pressed={labels}
          onClick={() => onLabelsChange(!labels)}
        >
          라벨
        </button>
        <button
          type="button"
          className={`${s.filterChip} ${marks ? s.filterChipOn : ""}`}
          aria-pressed={marks}
          onClick={() => setMarks((v) => !v)}
        >
          변경 표시
        </button>
        <button type="button" className={s.filterChip} onClick={fitBoth}>
          전체 보기
        </button>
        {/* 확장 단추는 패널 머리에 있는데, 펼치면 그 머리가 이 화면에 덮인다.
            그래서 나가는 단추는 여기에 둔다. */}
        {expanded && (
          <button
            type="button"
            className={`${s.filterChip} ${s.filterChipOn}`}
            title="축소 (Esc)"
            onClick={() => onExpandedChange(false)}
          >
            ⤡ 축소
          </button>
        )}
        {netName && (
          <button
            type="button"
            className={s.filterChip}
            onClick={() => {
              setNetName(null);
              setSelection(null);
            }}
          >
            강조 해제 · {netName}
          </button>
        )}
        {mode !== "placement" && conductors.length > 0 && (
          <span className={s.layerChips}>
            {conductors.map((info) => {
              const on = !hiddenNo.has(info.no);
              return (
                <button
                  key={info.no}
                  type="button"
                  className={`${s.layerChip} ${on ? "" : s.layerChipOff}`}
                  aria-pressed={on}
                  title={`L${info.no} 끄고 켜기`}
                  onClick={() =>
                    setHiddenNo((prev) => {
                      const next = new Set(prev);
                      if (next.has(info.no)) next.delete(info.no);
                      else next.add(info.no);
                      return next;
                    })
                  }
                >
                  <i style={{ background: css(info.color) }} />
                  L{info.no}
                </button>
              );
            })}
          </span>
        )}
      </div>

      <div
        className={view === "side" ? s.boardsSide : s.boardsOne}
        style={expanded ? undefined : { height }}
      >
        <div className={s.boardPane}>
          <span className={`${s.paneLabel} ${s.sideA}`}>
            {view === "overlay" ? `${labelA} → ${labelB}` : labelA}
          </span>
          {paneDetail && (
            <BoardScene
              {...common}
              ref={sceneA}
              detail={paneDetail}
              layers={paneLayers}
              visible={visibleOf(paneLayers)}
              highlightNet={paneHighlight}
              selection={selection?.side === "a" ? selection.value : null}
              onSelect={onSelect("a", paneDetail)}
              onLoadedChange={(n, total) => n === total && fitBoth()}
              extraOverlay={overlayA}
              overlayKey={`${view}|${marks}|${changes.length}`}
            />
          )}
        </div>
        {view === "side" && (
          <div className={s.boardPane}>
            <span className={`${s.paneLabel} ${s.sideB}`}>{labelB}</span>
            {detailB && (
              <BoardScene
                {...common}
                ref={sceneB}
                detail={detailB}
                layers={layersB}
                visible={visibleOf(layersB)}
                highlightNet={highlightB}
                selection={selection?.side === "b" ? selection.value : null}
                onSelect={onSelect("b", detailB)}
                extraOverlay={overlayB}
                overlayKey={`${view}|${marks}|${changes.length}`}
              />
            )}
          </div>
        )}
      </div>

      <div className={s.boardLegend}>
        {ROLE_ORDER.filter((r) => counts.get(r)).map((r) => (
          <span key={r} className={s.legendItem}>
            <i className={s.legendDot} style={{ background: pal[r] }} />
            {ROLE_LABEL[r]} <b className="tnum">{counts.get(r)}</b>
          </span>
        ))}
        <span className={s.headSpacer} />
        {picked && (
          <span className={s.legendPick}>
            {picked.component?.refdes ?? ""}
            {picked.hit
              ? ` · ${{ pad: "패드", via: "비아", trace: "배선", plane: "플레인" }[picked.hit.kind]}`
              : ""}
            {picked.hit?.netId != null && pickedDetail
              ? ` · ${pickedDetail.nets[picked.hit.netId]?.name ?? ""}`
              : ""}
            {picked.hit?.width ? ` · ${formatCoarse(picked.hit.width, unit)}` : ""}
          </span>
        )}
        <span className={s.legendQuiet}>커서 {cursor}</span>
        {boxA && (
          <span className={s.legendQuiet}>
            보드 {toMm(boxA.x1 - boxA.x0).toFixed(1)} × {toMm(boxA.y1 - boxA.y0).toFixed(1)} mm
          </span>
        )}
      </div>
    </div>
  );
}
