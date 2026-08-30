import type React from "react";
import type { ReactNode } from "react";
import type { Severity } from "@/lib/cdm";
import s from "./ui.module.css";

/* ── 상태 표시 ─────────────────────────────── */

/* 상태(초안·검토·양산·단종)는 화면에서 뺐다. 사람이 손으로 유지해야 하는 값이라 시간이
   지나면 틀리고, 틀린 상태를 배지로 못박아 보여주면 읽는 사람이 그것을 믿는다.
   승인 흐름이 붙어 상태가 시스템 안에서 바뀌게 되면 그때 다시 들여온다. */

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

export function EmptyState({
  title,
  body,
  /** 막다른 길로 두지 않는다 — 여기서 갈 수 있는 곳이 있으면 버튼 하나를 준다. */
  action,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={s.state}>
      <p className={s.stateTitle}>{title}</p>
      {body && <p className={s.stateBody}>{body}</p>}
      {action}
    </div>
  );
}
