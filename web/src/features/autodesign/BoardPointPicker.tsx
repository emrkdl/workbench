import { useMemo, useRef, useState } from "react";
import type { ComponentRow, Polygon } from "@/lib/cdm";
import { bodySize } from "@/lib/families";
import { toMm } from "@/lib/units";
import s from "./autodesign.module.css";

/**
 * 보드 외곽선 위에서 자리를 찍는다.
 *
 * 3×3 칸으로 고르던 것을 실제 판 모양으로 바꿨다. 칸은 "좌상"이 어디인지 사람마다 다르게
 * 읽히지만 — 이형 보드에서는 특히 그렇다 — 판 그림 위의 한 점은 다르게 읽힐 여지가 없다.
 *
 * 격자를 깔지 않은 것도 같은 이유다. 격자를 그리면 사람이 칸에 맞춰 찍게 되고, 그러면
 * 결국 칸을 고르는 것과 같아진다. 아무 데나 찍을 수 있어야 "이 커넥터 옆" 같은 자리를
 * 짚을 수 있다. 찍은 자리는 그대로 좌표가 되고, 엔진은 그 근처에서 자리를 찾는다.
 *
 * 좌표는 나노미터 정수다. SVG 좌표계에는 그대로 넣지 않는다 — 보드 하나가 1억 단위라
 * 렌더러가 원을 2²⁵ 근처에서 잘라 버린다. 표시용 좌표계는 긴 변을 1000 으로 줄여서 쓴다.
 */

export interface PickMark {
  refdes: string;
  x: number;
  y: number;
  /** 회전을 반영한 몸통 크기(nm). 판과 같은 배율로 그려야 자리가 말이 된다. */
  w: number;
  h: number;
  /** 계열색 — 뷰어·카드와 같은 색이라 눈이 다시 배우지 않는다. */
  color: string;
}

export function BoardPointPicker({
  outline,
  ghosts,
  marks,
  onPick,
  disabled,
}: {
  outline: Polygon[];
  /** 지금 그 자리에 있는 부품들 — 어디서 어디로 보내는지 보이게 흐리게 깔아 둔다. */
  ghosts: ComponentRow[];
  /** 자리를 지정한 부품들. */
  marks: PickMark[];
  onPick: (x: number, y: number) => void;
  disabled?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  const box = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of outline) {
      if (p.is_cutout) continue;
      for (let i = 0; i < p.points_nm.length; i += 2) {
        xs.push(p.points_nm[i]!);
        ys.push(p.points_nm[i + 1]!);
      }
    }
    if (!xs.length) return null;
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const w = Math.max(...xs) - x0 || 1;
    const h = Math.max(...ys) - y0 || 1;
    return { x0, y0, w, h };
  }, [outline]);

  if (!box) return <p className={s.hint}>보드 외형을 읽지 못했습니다.</p>;

  const { x0, y0, w, h } = box;
  // 긴 변이 1000 이 되도록 줄인 표시 좌표계. SVG 는 Y 가 아래로 자라므로 여기서만 뒤집는다.
  const k = 1000 / Math.max(w, h);
  const vw = w * k;
  const vh = h * k;
  const px = (x: number) => (x - x0) * k;
  const py = (y: number) => (h - (y - y0)) * k;

  /** 화면 좌표를 보드 좌표로. 바깥 상자의 가로세로비를 판과 같게 맞춰 두어 계산이 선형이다. */
  const toBoard = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const fx = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    const fy = Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1);
    return { x: Math.round(x0 + fx * w), y: Math.round(y0 + (1 - fy) * h) };
  };

  const points = (p: Polygon) => {
    const out: string[] = [];
    for (let i = 0; i < p.points_nm.length; i += 2) {
      out.push(`${px(p.points_nm[i]!)},${py(p.points_nm[i + 1]!)}`);
    }
    return out.join(" ");
  };

  return (
    <div className={s.pickerWrap}>
      <div className={s.pickerStage} style={{ aspectRatio: `${w} / ${h}` }}>
        <svg
          ref={svgRef}
          className={`${s.pickerSvg} ${disabled ? s.pickerOff : ""}`}
          viewBox={`0 0 ${vw} ${vh}`}
          preserveAspectRatio="none"
          role={disabled ? "img" : "button"}
          aria-label={disabled ? "보드 외형" : "보드에서 자리 찍기"}
          onMouseMove={(e) => !disabled && setHover(toBoard(e.clientX, e.clientY))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            if (disabled) return;
            const p = toBoard(e.clientX, e.clientY);
            onPick(p.x, p.y);
          }}
        >
          {outline.map((p, i) =>
            p.is_cutout ? null : <polygon key={`s${i}`} className={s.pickerBoard} points={points(p)} />,
          )}

          {/* 지금 그 자리에 있는 부품 — 어디서 옮기는지 보이라고 흐리게 깐다 */}
          {ghosts.map((c) => {
            const [bw, bh] = bodySize(c);
            const rw = Math.max(bw * k, 3);
            const rh = Math.max(bh * k, 3);
            return (
              <rect
                key={`g${c.refdes}`}
                className={s.pickerGhost}
                x={px(c.x_nm) - rw / 2}
                y={py(c.y_nm) - rh / 2}
                width={rw}
                height={rh}
              />
            );
          })}

          {outline.map((p, i) =>
            p.is_cutout ? <polygon key={`c${i}`} className={s.pickerCut} points={points(p)} /> : null,
          )}

          {/* 찍어 둔 자리 — 과녁이 아니라 그 부품의 몸통을 판과 같은 배율로 그린다.
              0402 는 100mm 판에서 2px 도 안 되므로 아주 작은 것만 최소 크기로 받쳐 준다. */}
          {marks.map((m) => {
            const rw = Math.max(m.w * k, 5);
            const rh = Math.max(m.h * k, 5);
            return (
              <g key={m.refdes} className={s.pickerMark}>
                <rect
                  x={px(m.x) - rw / 2}
                  y={py(m.y) - rh / 2}
                  width={rw}
                  height={rh}
                  style={{ fill: m.color }}
                />
                {marks.length <= 12 && (
                  <text x={px(m.x)} y={py(m.y) - rh / 2 - 8}>
                    {m.refdes}
                  </text>
                )}
              </g>
            );
          })}

          {hover && !disabled && (
            <g className={s.pickerHover}>
              <line x1={0} y1={py(hover.y)} x2={vw} y2={py(hover.y)} />
              <line x1={px(hover.x)} y1={0} x2={px(hover.x)} y2={vh} />
            </g>
          )}
        </svg>
      </div>
      <div className={s.pickerFoot}>
        {disabled ? (
          <span>부품을 고르면 자리를 찍을 수 있습니다</span>
        ) : hover ? (
          <span className={s.pickerCoord}>
            {toMm(hover.x).toFixed(1)}, {toMm(hover.y).toFixed(1)} mm
          </span>
        ) : (
          <span>판 위를 눌러 대략적인 자리를 찍으세요</span>
        )}
      </div>
    </div>
  );
}
