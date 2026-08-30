import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentChange, ComponentRow, Polygon, RevisionDetail } from "@/lib/cdm";
import { formatCoarse, toMm } from "@/lib/units";
import s from "./compare.module.css";

/**
 * 두 리비전을 눈으로 맞대어 보는 화면.
 *
 * 기본은 **나란히 보기**다. 각자의 기판을 각자 그리고, 두 판이 같은 배율·같은 카메라를
 * 공유한다 — 배율이 다르면 14mm BGA 와 10mm QFP 가 같은 크기로 보여서 비교 자체가
 * 성립하지 않는다. 팬·줌도 함께 움직인다.
 *
 * **겹쳐보기**는 옵션이다. 같은 보드의 미세한 이동을 볼 때는 겹쳐 놓는 편이 정확하지만,
 * 판이 둘 다 보이지 않아 "이 근처가 통째로 달라졌다" 같은 것은 놓치기 쉽다.
 *
 * SVG 가 아니라 캔버스로 그린다. 부품이 판마다 1,000개를 넘고 두 판이면 배가 되는데,
 * 그만큼의 DOM 노드를 만들면 팬 한 번에 프레임이 끊긴다.
 */

export type CompareView = "side" | "overlay";

type ChangeRole = "added" | "removed" | "moved" | "replaced" | "rotated" | "flipped";

const KIND_LABEL: Record<string, string> = {
  added: "추가",
  removed: "삭제",
  moved: "이동",
  replaced: "치환",
  rotated: "회전",
  flipped: "면 이동",
};

/** 토큰에서 실제 색을 읽어 온다. 캔버스는 var() 를 모르고, 테마가 바뀌면 값도 바뀐다. */
function palette(): Record<string, string> {
  const root = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => root.getPropertyValue(name).trim() || fallback;
  return {
    added: v("--ok", "#2c6b4a"),
    removed: v("--crit", "#a33a33"),
    moved: v("--warn", "#8a6010"),
    replaced: v("--accent", "#a85f2b"),
    rotated: v("--info", "#15687e"),
    flipped: v("--info", "#15687e"),
    board: v("--surface-3", "#e8eded"),
    edge: v("--line-3", "#adb7b7"),
    quiet: v("--line-2", "#c5cdcd"),
    ink: v("--ink", "#14181a"),
    bg: v("--surface-2", "#f3f6f6"),
  };
}

interface Camera {
  cx: number;
  cy: number;
  scale: number;
}

function outlineBox(outline: Polygon[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of outline) {
    if (p.is_cutout) continue;
    for (let i = 0; i < p.points_nm.length; i += 2) {
      xs.push(p.points_nm[i]!);
      ys.push(p.points_nm[i + 1]!);
    }
  }
  if (!xs.length) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const bodyOf = (c: { body_w_nm?: number | null; body_h_nm?: number | null; rotation_mdeg: number }) => {
  const w = c.body_w_nm ?? 800_000;
  const h = c.body_h_nm ?? 500_000;
  return Math.round(c.rotation_mdeg / 90_000) % 2 ? ([h, w] as const) : ([w, h] as const);
};

interface PanelData {
  label: string;
  outline: Polygon[];
  components: ComponentRow[];
  /** RefDes → 이 판에서의 변경 역할. 없으면 바뀌지 않은 부품이다. */
  roles: Map<string, ChangeRole>;
}

function drawPanel(
  canvas: HTMLCanvasElement,
  dpr: number,
  cam: Camera,
  data: PanelData,
  pal: Record<string, string>,
  labels: boolean,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const sx = (x: number) => (x - cam.cx) * cam.scale + w / 2;
  const sy = (y: number) => -(y - cam.cy) * cam.scale + h / 2;

  // 기판
  ctx.lineWidth = 1;
  for (const poly of data.outline) {
    if (poly.points_nm.length < 6) continue;
    ctx.beginPath();
    for (let i = 0; i < poly.points_nm.length; i += 2) {
      const px = sx(poly.points_nm[i]!);
      const py = sy(poly.points_nm[i + 1]!);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    if (poly.is_cutout) {
      ctx.fillStyle = pal.bg!;
      ctx.fill();
      ctx.setLineDash([4, 3]);
    } else {
      ctx.fillStyle = pal.board!;
      ctx.globalAlpha = 0.5;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = pal.edge!;
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 바뀌지 않은 부품은 눌러서 배경으로 보낸다. 지우면 "이 자리에 뭔가 있다"가 사라지고,
  // 그대로 칠하면 변경된 것이 묻힌다.
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = pal.quiet!;
  for (const c of data.components) {
    if (data.roles.has(c.refdes)) continue;
    const [bw, bh] = bodyOf(c);
    const pw = Math.max(bw * cam.scale, 1);
    const ph = Math.max(bh * cam.scale, 1);
    ctx.fillRect(sx(c.x_nm) - pw / 2, sy(c.y_nm) - ph / 2, pw, ph);
  }
  ctx.globalAlpha = 1;

  // 변경된 부품
  const changed = data.components.filter((c) => data.roles.has(c.refdes));
  for (const c of changed) {
    const role = data.roles.get(c.refdes)!;
    const [bw, bh] = bodyOf(c);
    const pw = Math.max(bw * cam.scale, 3);
    const ph = Math.max(bh * cam.scale, 3);
    const x = sx(c.x_nm) - pw / 2;
    const y = sy(c.y_nm) - ph / 2;
    ctx.fillStyle = pal[role] ?? pal.ink!;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(x, y, pw, ph);
    ctx.globalAlpha = 1;
    // 작은 부품은 칠만으로는 눈에 안 띈다. 테두리를 둘러 시선을 잡는다.
    if (pw < 9 || ph < 9) {
      ctx.strokeStyle = pal[role] ?? pal.ink!;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 2.5, y - 2.5, pw + 5, ph + 5);
    }
  }

  if (labels) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const c of changed) {
      const [bw, bh] = bodyOf(c);
      const pw = bw * cam.scale;
      if (pw < 26) continue;
      const size = Math.max(9, Math.min(pw / (c.refdes.length * 0.62), bh * cam.scale * 0.6, 18));
      ctx.font = `600 ${size}px ui-monospace, Consolas, monospace`;
      ctx.fillStyle = pal.bg!;
      ctx.fillText(c.refdes, sx(c.x_nm), sy(c.y_nm));
    }
  }
}

/** 겹쳐보기 — 같은 판 위에 이전은 파선, 이후는 채움. 미세한 이동을 볼 때 정확하다. */
function drawOverlay(
  canvas: HTMLCanvasElement,
  dpr: number,
  cam: Camera,
  outline: Polygon[],
  changes: ComponentChange[],
  quiet: ComponentRow[],
  pal: Record<string, string>,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const sx = (x: number) => (x - cam.cx) * cam.scale + w / 2;
  const sy = (y: number) => -(y - cam.cy) * cam.scale + h / 2;

  for (const poly of outline) {
    if (poly.points_nm.length < 6 || poly.is_cutout) continue;
    ctx.beginPath();
    for (let i = 0; i < poly.points_nm.length; i += 2) {
      const px = sx(poly.points_nm[i]!);
      const py = sy(poly.points_nm[i + 1]!);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = pal.board!;
    ctx.globalAlpha = 0.45;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = pal.edge!;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 바뀌지 않은 부품을 눌러서 깔아 둔다. 없으면 판이 비어 보이고, "이 근처가 통째로
  // 달라졌다" 같은 것을 읽을 수 없다 — 나란히 보기와 같은 이유다.
  const changedRefs = new Set(changes.map((c) => c.refdes));
  ctx.globalAlpha = 0.24;
  ctx.fillStyle = pal.quiet!;
  for (const c of quiet) {
    if (changedRefs.has(c.refdes)) continue;
    const [bw, bh] = bodyOf(c);
    const pw = Math.max(bw * cam.scale, 1);
    const ph = Math.max(bh * cam.scale, 1);
    ctx.fillRect(sx(c.x_nm) - pw / 2, sy(c.y_nm) - ph / 2, pw, ph);
  }
  ctx.globalAlpha = 1;

  for (const c of changes) {
    const color = pal[c.kind] ?? pal.ink!;
    const to = c.after ?? c.before;
    if (!to) continue;
    const moved = c.kind === "moved" && c.before && c.after;

    if (moved) {
      const [bw, bh] = bodyOf(c.before!);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(
        sx(c.before!.x_nm) - (bw * cam.scale) / 2,
        sy(c.before!.y_nm) - (bh * cam.scale) / 2,
        Math.max(bw * cam.scale, 3),
        Math.max(bh * cam.scale, 3),
      );
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(sx(c.before!.x_nm), sy(c.before!.y_nm));
      ctx.lineTo(sx(c.after!.x_nm), sy(c.after!.y_nm));
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const [bw, bh] = bodyOf(to);
    const pw = Math.max(bw * cam.scale, 3);
    const ph = Math.max(bh * cam.scale, 3);
    const x = sx(to.x_nm) - pw / 2;
    const y = sy(to.y_nm) - ph / 2;
    if (c.kind === "removed") {
      // 이제 없는 것을 실체처럼 칠하지 않는다
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(x, y, pw, ph);
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x, y, pw, ph);
      ctx.globalAlpha = 1;
    }
  }
}

export function CompareBoards({
  view,
  labels,
  changes,
  detailA,
  detailB,
  labelA,
  labelB,
  height = 380,
}: {
  view: CompareView;
  labels: boolean;
  changes: ComponentChange[];
  detailA: RevisionDetail | null;
  detailB: RevisionDetail | null;
  labelA: string;
  labelB: string;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasA = useRef<HTMLCanvasElement>(null);
  const canvasB = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<Camera>({ cx: 0, cy: 0, scale: 1e-5 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [, bump] = useState(0);
  const redraw = useCallback(() => bump((n) => n + 1), []);

  /** A 쪽 역할: 사라지는 것들. B 쪽 역할: 새로 생기는 것들. */
  const roles = useMemo(() => {
    const a = new Map<string, ChangeRole>();
    const b = new Map<string, ChangeRole>();
    for (const c of changes) {
      const kind = c.kind as ChangeRole;
      if (c.kind === "removed") a.set(c.refdes, "removed");
      else if (c.kind === "added") b.set(c.refdes, "added");
      else {
        a.set(c.refdes, kind);
        b.set(c.refdes, kind);
      }
    }
    return { a, b };
  }, [changes]);

  const fit = useCallback(() => {
    // 캔버스의 실제 크기를 재서 맞춘다. 바깥 상자에서 여백·간격을 빼 계산하면 조금씩
    // 어긋나고, 그 차이만큼 판이 패널 밖으로 잘린다.
    const canvas = canvasA.current;
    if (!canvas || !canvas.clientWidth) return;
    const boxes = [detailA, detailB].filter(Boolean).map((d) => outlineBox(d!.outline));
    if (!boxes.length) return;
    // 두 판을 같은 배율로 묶는다. 큰 쪽에 맞춰야 둘 다 들어온다.
    const w = Math.max(...boxes.map((b) => b.x1 - b.x0), 1);
    const h = Math.max(...boxes.map((b) => b.y1 - b.y0), 1);
    const scale = Math.min(canvas.clientWidth / w, canvas.clientHeight / h) * 0.92;
    const box = boxes[0]!;
    cameraRef.current = { cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2, scale };
    redraw();
  }, [detailA, detailB, redraw]);

  // 창 크기가 바뀌면 다시 맞춘다
  useEffect(() => {
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fit]);

  // 보기 방식이 바뀌면 패널 크기가 달라지므로 다시 맞춘다
  useEffect(() => {
    fit();
  }, [fit, view]);

  useEffect(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pal = palette();
    const cam = cameraRef.current;
    if (view === "overlay") {
      if (canvasA.current && detailB) {
        drawOverlay(canvasA.current, dpr, cam, detailB.outline, changes, detailB.components, pal);
      }
      return;
    }
    if (canvasA.current && detailA) {
      drawPanel(canvasA.current, dpr, cam,
        { label: labelA, outline: detailA.outline, components: detailA.components, roles: roles.a }, pal, labels);
    }
    if (canvasB.current && detailB) {
      drawPanel(canvasB.current, dpr, cam,
        { label: labelB, outline: detailB.outline, components: detailB.components, roles: roles.b }, pal, labels);
    }
  });

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const cam = cameraRef.current;
    const next = Math.min(Math.max(cam.scale * Math.exp(-e.deltaY * 0.0015), 1e-7), 0.02);
    cameraRef.current = { ...cam, scale: next };
    redraw();
  };
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const cam = cameraRef.current;
    cameraRef.current = {
      ...cam,
      cx: cam.cx - (e.clientX - drag.x) / cam.scale,
      cy: cam.cy + (e.clientY - drag.y) / cam.scale,
    };
    dragRef.current = { x: e.clientX, y: e.clientY };
    redraw();
  };
  const stopDrag = () => {
    dragRef.current = null;
  };

  const ready = detailA && detailB;
  const box = detailA ? outlineBox(detailA.outline) : null;

  return (
    <div>
      <div
        ref={wrapRef}
        className={view === "side" ? s.boardsSide : s.boardsOne}
        style={{ height }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopDrag}
        onPointerLeave={stopDrag}
      >
        <figure className={s.boardPanel}>
          <figcaption className={`${s.boardCap} ${s.capA}`}>
            {view === "overlay" ? `${labelA} → ${labelB} 겹쳐보기` : labelA}
          </figcaption>
          <canvas ref={canvasA} className={s.boardCanvas} />
        </figure>
        {view === "side" && (
          <figure className={s.boardPanel}>
            <figcaption className={`${s.boardCap} ${s.capB}`}>{labelB}</figcaption>
            <canvas ref={canvasB} className={s.boardCanvas} />
          </figure>
        )}
        {!ready && <div className={s.boardsLoading}>보드를 불러오는 중…</div>}
      </div>

      <div className={s.mapLegend}>
        {(["moved", "replaced", "removed", "added"] as const).map((k) => {
          const n = changes.filter((c) => c.kind === k).length;
          if (!n) return null;
          return (
            <span key={k}>
              <i className={s.mapDot} style={{ background: `var(--${k === "moved" ? "warn" : k === "replaced" ? "accent" : k === "removed" ? "crit" : "ok"})` }} />
              {KIND_LABEL[k]} <b className="tnum">{n}</b>
            </span>
          );
        })}
        <span style={{ color: "var(--ink-4)" }}>
          <i className={s.mapDot} style={{ background: "var(--line-2)", opacity: 0.5 }} />
          변경 없음
        </span>
        {box && (
          <span style={{ marginLeft: "auto", color: "var(--ink-4)" }}>
            1 px = {formatCoarse(Math.round(1 / cameraRef.current.scale))} · 보드{" "}
            {toMm(box.x1 - box.x0).toFixed(1)} × {toMm(box.y1 - box.y0).toFixed(1)} mm
          </span>
        )}
      </div>
    </div>
  );
}
