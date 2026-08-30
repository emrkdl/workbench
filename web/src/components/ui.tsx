import type React from "react";
import type { ReactNode } from "react";
import type { LifecycleStatus, Polygon, Severity } from "@/lib/cdm";
import s from "./ui.module.css";

/* ── 상태 표시 ─────────────────────────────── */

const STATUS_LABEL: Record<LifecycleStatus, string> = {
  draft: "초안",
  review: "검토",
  released: "양산",
  obsolete: "단종",
};

const STATUS_CLASS: Record<LifecycleStatus, string> = {
  draft: s.pillDraft,
  review: s.pillReview,
  released: s.pillReleased,
  obsolete: s.pillObsolete,
};

export function StatusPill({ status }: { status: LifecycleStatus }) {
  return <span className={`${s.pill} ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>;
}

export const statusLabel = (status: LifecycleStatus) => STATUS_LABEL[status];

const SEVERITY_LABEL: Record<Severity, string> = { error: "오류", warning: "경고", info: "참고" };
const SEVERITY_CLASS: Record<Severity, string> = {
  error: s.sevError,
  warning: s.sevWarning,
  info: s.sevInfo,
};

export function SeverityTag({ severity }: { severity: Severity }) {
  return <span className={`${s.sev} ${SEVERITY_CLASS[severity]}`}>{SEVERITY_LABEL[severity]}</span>;
}

export function Tag({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return <span className={accent ? `${s.tag} ${s.tagAccent}` : s.tag}>{children}</span>;
}

/* ── 수치 ──────────────────────────────────── */

export function Stat({
  label,
  value,
  unit,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  tone?: "accent" | "crit";
}) {
  const toneClass = tone === "accent" ? s.statAccent : tone === "crit" ? s.statCrit : "";
  return (
    <div className={`${s.stat} ${toneClass}`}>
      <span className={s.statLabel}>{label}</span>
      <span className={s.statValue}>
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {hint && <span className={s.statHint}>{hint}</span>}
    </div>
  );
}

/** 열 수를 고정한다. 자동 채움에 맡기면 항목 8개가 7 + 1 로 갈라져 마지막 줄이 비어 보인다. */
export const StatGrid = ({ children, cols = 4 }: { children: ReactNode; cols?: number }) => (
  <div className={s.statGrid} style={{ "--stat-cols": cols } as React.CSSProperties}>
    {children}
  </div>
);

/* ── 라벨/값 ───────────────────────────────── */

export const Fields = ({ children }: { children: ReactNode }) => <dl className={s.fields}>{children}</dl>;

export function Field({ label, children }: { label: string; children: ReactNode }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <>
      <dt className={s.fieldLabel}>{label}</dt>
      <dd className={`${s.fieldValue} ${empty ? s.muted : ""}`}>{empty ? "—" : children}</dd>
    </>
  );
}

/* ── 패널 ──────────────────────────────────── */

export function Panel({
  title,
  action,
  children,
  flush,
  fill,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  /** 표처럼 자체 여백을 가진 내용을 넣을 때 패널 안쪽 패딩을 없앤다. */
  flush?: boolean;
  /** 내용이 남은 높이를 전부 쓰게 한다. 가상 스크롤 표를 담을 때 필요하다. */
  fill?: boolean;
}) {
  return (
    <section className={`${s.panel} ${fill ? s.panelFill : ""}`}>
      {title && (
        <header className={s.panelHead}>
          <h2 className={s.panelTitle}>{title}</h2>
          {action}
        </header>
      )}
      <div className={flush ? s.panelBodyFlush : s.panelBody}>{children}</div>
    </section>
  );
}

/* ── 비율 막대 ─────────────────────────────── */

export interface BarSlice {
  label: string;
  value: number;
  color: string;
}

/** 층 구성이나 패키지 분포처럼 "무엇이 얼마나 차지하는가"를 한 줄로 보여준다. */
export function Bar({ slices }: { slices: BarSlice[] }) {
  const total = slices.reduce((sum, x) => sum + x.value, 0) || 1;
  return (
    <div>
      <div className={s.bar}>
        {slices.map((x) => (
          <div
            key={x.label}
            className={s.barSeg}
            style={{ width: `${(x.value / total) * 100}%`, background: x.color }}
            title={`${x.label} ${x.value}`}
          />
        ))}
      </div>
      <div className={s.barLegend}>
        {slices.map((x) => (
          <span key={x.label}>
            <i className={s.barDot} style={{ background: x.color }} />
            {x.label} <b className="tnum">{x.value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── 세그먼트 토글 ─────────────────────────── */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className={s.segmented} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`${s.segBtn} ${o.value === value ? s.segBtnOn : ""}`}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── 상태 블록 ─────────────────────────────── */

export const Loading = ({ label = "불러오는 중" }: { label?: string }) => (
  <div className={s.state}>
    <div className={s.spinner} />
    <p className={s.stateBody}>{label}</p>
  </div>
);

export function ErrorState({ error }: { error: Error }) {
  return (
    <div className={`${s.state} ${s.stateCrit}`}>
      <p className={s.stateTitle}>데이터를 불러오지 못했습니다</p>
      <p className={s.stateBody}>
        {error.message} 목데이터를 아직 만들지 않았다면 <code className="mono">python tools/mockgen/main.py</code> 를
        실행하세요.
      </p>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body?: ReactNode }) {
  return (
    <div className={s.state}>
      <p className={s.stateTitle}>{title}</p>
      {body && <p className={s.stateBody}>{body}</p>}
    </div>
  );
}

/* ── 보드 외형 ─────────────────────────────── */

/**
 * 보드 외형 폴리곤을 그린다. 컷아웃은 배경색으로 덮어 구멍처럼 보이게 한다.
 * 카탈로그 카드와 Overview 에서 "이 보드가 어떻게 생겼나"를 즉시 알려준다.
 */
export function BoardOutline({ outline, height = 64 }: { outline: Polygon[]; height?: number }) {
  const solids = outline.filter((p) => !p.is_cutout);
  const cuts = outline.filter((p) => p.is_cutout);
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
  const vw = w * k;
  const vh = h * k;
  const pad = 1000 * 0.04;

  // SVG 는 Y 가 아래로 자라므로 뒤집는다. 좌표계 규약(Y 상방향)은 데이터 쪽에 남긴다.
  const path = (p: Polygon) => {
    const pts: string[] = [];
    for (let i = 0; i < p.points_nm.length; i += 2) {
      pts.push(`${(p.points_nm[i]! - x0) * k},${(h - (p.points_nm[i + 1]! - y0)) * k}`);
    }
    return pts.join(" ");
  };

  return (
    <svg
      className={s.outline}
      viewBox={`${-pad} ${-pad} ${vw + pad * 2} ${vh + pad * 2}`}
      style={{ height: `${height}px` }}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="보드 외형"
    >
      {solids.map((p, i) => (
        <polygon key={`s${i}`} className={s.outlineFill} points={path(p)} />
      ))}
      {cuts.map((p, i) => (
        <polygon key={`c${i}`} className={s.outlineCut} points={path(p)} />
      ))}
    </svg>
  );
}
