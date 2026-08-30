import { useMemo } from "react";
import type { ComponentRow, Polygon } from "@/lib/cdm";
import { bodySize, css, familyOf, FAMILY_BY_KEY } from "@/lib/families";
import s from "./BoardFigure.module.css";

/**
 * 보드 그림 — 외형 + 부품 몸통.
 *
 * 카탈로그 카드, 요약 탭의 외형, 그밖에 "이 보드가 어떻게 생겼나"를 한눈에 보여줘야 하는
 * 자리에서 쓴다. 뷰어의 배치도와 같은 계열색을 쓰므로, 카드에서 본 보드를 뷰어에서 열어도
 * 같은 그림이 이어진다.
 *
 * 외곽선만 그리던 것을 부품까지 그리도록 바꾼 이유는 단순하다 — 빈 사각형은 어느 보드나
 * 똑같이 생겼다. 큰 IC 와 커넥터의 배치가 보드를 알아보게 하는 것이다.
 *
 * SVG 로 그린다. 정적이고 상호작용이 없어 캔버스를 쓸 이유가 없고, 벡터라 카드가 어떤
 * 크기로 늘어나도 선명하다.
 */

export function BoardFigure({
  outline,
  components,
  height = 64,
  /** 부품 목록이 전체가 아니라 큰 것 몇 개일 때 표시에 반영한다. */
  partial = false,
  className,
}: {
  outline: Polygon[] | null | undefined;
  components: ComponentRow[] | null | undefined;
  height?: number;
  partial?: boolean;
  className?: string;
}) {
  const view = useMemo(() => {
    const solids = (outline ?? []).filter((p) => !p.is_cutout);
    const xs = solids.flatMap((p) => p.points_nm.filter((_, i) => i % 2 === 0));
    const ys = solids.flatMap((p) => p.points_nm.filter((_, i) => i % 2 === 1));
    if (!xs.length || !ys.length) return null;
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const w = Math.max(...xs) - x0 || 1;
    const h = Math.max(...ys) - y0 || 1;
    // 나노미터 원값을 SVG 좌표로 쓰면 값이 1억 단위가 되어 렌더러가 흔들린다.
    // 표시 좌표계는 긴 변이 1000 이 되도록 줄여서 쓴다.
    const k = 1000 / Math.max(w, h);
    return { x0, y0, h, k, vw: w * k, vh: h * k, pad: 1000 * 0.03 };
  }, [outline]);

  if (!view) return null;
  const { x0, y0, h, k, vw, vh, pad } = view;

  // SVG 는 Y 가 아래로 자란다. 좌표계 규약(Y 상방향)은 데이터 쪽에 남기고 여기서만 뒤집는다.
  const px = (x: number) => (x - x0) * k;
  const py = (y: number) => (h - (y - y0)) * k;
  const points = (p: Polygon) => {
    const out: string[] = [];
    for (let i = 0; i < p.points_nm.length; i += 2) {
      out.push(`${px(p.points_nm[i]!)},${py(p.points_nm[i + 1]!)}`);
    }
    return out.join(" ");
  };

  // 아주 작은 부품도 점 하나로는 남는다. 0 이 되면 "여기 아무것도 없다"로 읽힌다.
  const minSize = 1000 / 320;
  // 큰 것을 먼저 그려 작은 것이 그 위에 오게 한다
  const ordered = [...(components ?? [])].sort((a, b) => {
    const [aw, ah] = bodySize(a);
    const [bw, bh] = bodySize(b);
    return bw * bh - aw * ah;
  });

  return (
    <svg
      className={`${s.figure} ${className ?? ""}`}
      viewBox={`${-pad} ${-pad} ${vw + pad * 2} ${vh + pad * 2}`}
      style={{ height: `${height}px` }}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={
        components?.length
          ? `보드 외형과 부품 배치${partial ? " (주요 부품)" : ""} — 부품 ${components.length}개`
          : "보드 외형"
      }
    >
      {(outline ?? []).map((p, i) =>
        p.is_cutout ? null : <polygon key={`s${i}`} className={s.board} points={points(p)} />,
      )}

      {ordered.map((c) => {
        const [bw, bh] = bodySize(c);
        const w = Math.max(bw * k, minSize);
        const hh = Math.max(bh * k, minSize);
        return (
          <rect
            key={c.refdes}
            x={px(c.x_nm) - w / 2}
            y={py(c.y_nm) - hh / 2}
            width={w}
            height={hh}
            fill={css(FAMILY_BY_KEY.get(familyOf(c))!.rgb)}
            opacity={0.88}
          />
        );
      })}

      {/* 컷아웃은 부품 위에 얹어야 구멍으로 읽힌다 */}
      {(outline ?? []).map((p, i) =>
        p.is_cutout ? <polygon key={`c${i}`} className={s.cutout} points={points(p)} /> : null,
      )}
    </svg>
  );
}
