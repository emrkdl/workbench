import { useMemo } from "react";
import type { ComponentChange, ComponentSnapshot, Polygon } from "@/lib/cdm";
import s from "./compare.module.css";

/**
 * 부품 변경 지도.
 *
 * "이 리비전에서 어디를 손댔나"에 답한다. 부품 좌표와 몸통 크기는 실제 데이터이므로
 * 여기 그려지는 사각형은 전부 근거가 있다. 배선 기하 비교(설계 문서 §08의 격자 해시
 * 방식)는 .blg 버퍼가 생기는 Phase 2 이후라, 지금은 부품 변경만 그린다.
 *
 * 색은 **변경 종류**를 나타낸다. 뷰어의 배치도가 패키지 계열로 칠하는 것과 다른데,
 * 이 화면에서 알고 싶은 것이 "무엇이 놓였나"가 아니라 "무엇이 달라졌나"이기 때문이다.
 *
 * 이동한 부품은 이전 몸통을 파선으로, 이후 몸통을 실선으로 그리고 둘을 선으로 잇는다.
 * 점만 찍으면 "옮겼다"는 사실은 보여도 "어디서 어디로, 얼마나 큰 것이"가 사라진다.
 */

const KIND_COLOR: Record<string, string> = {
  added: "var(--ok)",
  removed: "var(--crit)",
  moved: "var(--warn)",
  replaced: "var(--accent)",
  rotated: "var(--info)",
  flipped: "var(--info)",
};

const KIND_LABEL: Record<string, string> = {
  added: "추가",
  removed: "삭제",
  moved: "이동",
  replaced: "치환",
  rotated: "회전",
  flipped: "면 이동",
};

const DRAW_ORDER = ["rotated", "flipped", "moved", "replaced", "removed", "added"];

/** SVG 표시 좌표계의 긴 변 길이. 데이터의 나노미터 좌표를 여기에 맞춰 줄인다. */
const VIEW = 1000;

/** 회전을 반영한 몸통 크기. 몸통 크기가 없으면(옛 파서) 작은 기본값으로 둔다. */
function body(snap: ComponentSnapshot): [number, number] {
  const w = snap.body_w_nm ?? 800_000;
  const h = snap.body_h_nm ?? 500_000;
  return Math.round(snap.rotation_mdeg / 90_000) % 2 ? [h, w] : [w, h];
}

export function ChangeMap({
  outline,
  changes,
  height = 300,
}: {
  outline: Polygon[] | null | undefined;
  changes: ComponentChange[];
  height?: number;
}) {
  const view = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of outline ?? []) {
      if (p.is_cutout) continue;
      for (let i = 0; i < p.points_nm.length; i += 2) {
        xs.push(p.points_nm[i]!);
        ys.push(p.points_nm[i + 1]!);
      }
    }
    // 외형이 없으면(세대 비교 등) 변경된 부품들의 경계로 대신한다.
    if (!xs.length) {
      for (const c of changes) {
        for (const snap of [c.before, c.after]) {
          if (snap) {
            xs.push(snap.x_nm);
            ys.push(snap.y_nm);
          }
        }
      }
    }
    if (!xs.length) return null;
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const w = Math.max(...xs) - x0 || 1;
    const h = Math.max(...ys) - y0 || 1;
    // 나노미터 원값을 SVG 좌표로 그대로 쓰면 안 된다. 보드 하나가 1억 단위여서
    // 렌더러가 도형을 약 2^25 에서 잘라버린다. 표시 좌표는 0~1000 으로 정규화한다.
    const k = VIEW / Math.max(w, h);
    return { x0, y0, h, k, vw: w * k, vh: h * k, pad: VIEW * 0.03 };
  }, [outline, changes]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of changes) out[c.kind] = (out[c.kind] ?? 0) + 1;
    return out;
  }, [changes]);

  if (!view) return null;
  const { x0, y0, h, k, vw, vh, pad } = view;

  // SVG 는 Y 가 아래로 자란다. 좌표계 규약(Y 상방향)은 데이터 쪽에 그대로 두고 여기서만 뒤집는다.
  const px = (x: number) => (x - x0) * k;
  const py = (y: number) => (h - (y - y0)) * k;
  //: 0402 하나가 화면에서 1px 아래로 내려가면 사라진다. 최소 크기를 준다.
  const minSize = VIEW / 260;

  const rect = (snap: ComponentSnapshot, color: string, filled: boolean, key: string) => {
    const [bw, bh] = body(snap);
    const w = Math.max(bw * k, minSize);
    const hh = Math.max(bh * k, minSize);
    return (
      <rect
        key={key}
        x={px(snap.x_nm) - w / 2}
        y={py(snap.y_nm) - hh / 2}
        width={w}
        height={hh}
        fill={filled ? color : "none"}
        stroke={color}
        strokeWidth={filled ? 0 : minSize / 3}
        strokeDasharray={filled ? undefined : `${minSize / 2} ${minSize / 3}`}
        opacity={filled ? 0.9 : 0.75}
      />
    );
  };

  const points = (p: Polygon) => {
    const out: string[] = [];
    for (let i = 0; i < p.points_nm.length; i += 2) {
      out.push(`${px(p.points_nm[i]!)},${py(p.points_nm[i + 1]!)}`);
    }
    return out.join(" ");
  };

  const ordered = [...changes].sort(
    (a, b) => DRAW_ORDER.indexOf(a.kind) - DRAW_ORDER.indexOf(b.kind),
  );

  return (
    <div>
      <svg
        className={s.map}
        viewBox={`${-pad} ${-pad} ${vw + pad * 2} ${vh + pad * 2}`}
        style={{ height: `${height}px` }}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`부품 변경 위치 지도 — 총 ${changes.length}건`}
      >
        {(outline ?? []).map((p, i) => (
          <polygon key={i} className={p.is_cutout ? s.mapOutline : s.mapBoard} points={points(p)} />
        ))}

        {ordered.map((c, i) => {
          const color = KIND_COLOR[c.kind] ?? "var(--ink-3)";
          const to = c.after ?? c.before;
          if (!to) return null;
          const id = `${c.refdes}-${i}`;
          const moved = c.kind === "moved" && c.before && c.after;
          return (
            <g key={id}>
              <title>
                {c.refdes} · {KIND_LABEL[c.kind] ?? c.kind} · {to.package}
                {c.distance_nm ? ` · ${(c.distance_nm / 1e6).toFixed(2)} mm 이동` : ""}
              </title>
              {/* 이동 전 자리는 파선으로 남긴다 — 어디서 왔는지가 사라지지 않게 */}
              {moved && rect(c.before!, color, false, `${id}-from`)}
              {moved && (
                <line
                  x1={px(c.before!.x_nm)}
                  y1={py(c.before!.y_nm)}
                  x2={px(c.after!.x_nm)}
                  y2={py(c.after!.y_nm)}
                  stroke={color}
                  strokeWidth={minSize / 3}
                  opacity="0.6"
                />
              )}
              {/* 삭제된 부품은 채우지 않는다. "이제 없는 것"을 실체처럼 칠하지 않는다 */}
              {rect(to, color, c.kind !== "removed", `${id}-to`)}
            </g>
          );
        })}
      </svg>

      <div className={s.mapLegend}>
        {DRAW_ORDER.filter((k2) => counts[k2]).map((k2) => (
          <span key={k2}>
            <i className={s.mapDot} style={{ background: KIND_COLOR[k2] }} />
            {KIND_LABEL[k2]} <b className="tnum">{counts[k2]}</b>
          </span>
        ))}
        {changes.length === 0 && <span>표시할 부품 변경이 없습니다.</span>}
      </div>
    </div>
  );
}
