import type { ChangeKind, FieldChange } from "@/lib/cdm";
import s from "./compare.module.css";

export const KIND_LABEL: Record<ChangeKind, string> = {
  added: "추가",
  removed: "삭제",
  moved: "이동",
  rotated: "회전",
  flipped: "면 이동",
  replaced: "치환",
  renamed: "이름 변경",
  rewired: "회로 변경",
  spec_changed: "사양 변경",
  inserted: "삽입",
};

const KIND_CLASS: Record<ChangeKind, string> = {
  added: s.kAdded,
  removed: s.kRemoved,
  moved: s.kMoved,
  rotated: s.kRotated,
  flipped: s.kFlipped,
  replaced: s.kReplaced,
  renamed: s.kRenamed,
  rewired: s.kRewired,
  spec_changed: s.kSpec,
  inserted: s.kInserted,
};

export const KindBadge = ({ kind }: { kind: ChangeKind }) => (
  <span className={`${s.kind} ${KIND_CLASS[kind]}`}>{KIND_LABEL[kind]}</span>
);

/**
 * 변경 종류 필터. 0건인 종류는 눌러도 소용없으므로 아예 내보내지 않는다.
 *
 * 열쇠 종류를 밖에서 정한다 — 부품은 CDM 의 ChangeKind 를 다 쓰지만 넷은 그중 네 갈래만
 * 쓴다. 두 표가 같은 생김새의 필터를 쓰되 세는 것은 다르다.
 */
export function KindFilter<K extends ChangeKind>({
  counts,
  selected,
  onChange,
  total,
}: {
  counts: Partial<Record<K, number>>;
  selected: K | null;
  onChange: (kind: K | null) => void;
  total: number;
}) {
  const kinds = (Object.keys(counts) as K[]).filter((k) => counts[k]);
  return (
    <div className={s.filters}>
      <button
        type="button"
        className={`${s.filterChip} ${selected === null ? s.filterChipOn : ""}`}
        onClick={() => onChange(null)}
      >
        전체 {total}
      </button>
      {kinds.map((k) => (
        <button
          key={k}
          type="button"
          className={`${s.filterChip} ${selected === k ? s.filterChipOn : ""}`}
          aria-pressed={selected === k}
          onClick={() => onChange(selected === k ? null : k)}
        >
          {KIND_LABEL[k]} {counts[k]}
        </button>
      ))}
    </div>
  );
}

/** 좌우 대비 목록. 왼쪽이 A, 오른쪽이 B이며 바뀐 값만 들어온다. */
export function FieldDiffList({ fields }: { fields: FieldChange[] }) {
  return (
    <div className={s.fieldDiff}>
      {fields.map((f) => (
        <div key={f.path} style={{ display: "contents" }}>
          <span className={s.fdLabel}>{f.label}</span>
          <span className={s.fdBefore}>{f.before}</span>
          <span className={s.fdArrow}>→</span>
          <span className={s.fdAfter}>{f.after}</span>
        </div>
      ))}
    </div>
  );
}

export function PinList({ added, removed }: { added?: string[] | null; removed?: string[] | null }) {
  const a = added ?? [];
  const r = removed ?? [];
  if (!a.length && !r.length) return <span style={{ color: "var(--ink-4)" }}>—</span>;
  const shown = [...r.slice(0, 4).map((p) => ({ p, add: false })), ...a.slice(0, 4).map((p) => ({ p, add: true }))];
  const hidden = a.length + r.length - shown.length;
  return (
    <span className={s.pins}>
      {shown.map(({ p, add }) => (
        <span key={`${add}-${p}`} className={add ? s.pinAdd : s.pinDel}>
          {p}
        </span>
      ))}
      {hidden > 0 && <span style={{ color: "var(--ink-4)", fontSize: "var(--fs-xs)" }}>+{hidden}</span>}
    </span>
  );
}
