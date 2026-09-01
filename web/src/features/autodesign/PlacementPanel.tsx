import { useMemo, useState } from "react";
import type { Board, ComponentRow, RevisionDetail } from "@/lib/cdm";
import { DataTable, type Column } from "@/components/DataTable";
import { Panel } from "@/components/ui";
import { familyOf, FAMILIES, css as familyCss, FAMILY_BY_KEY, type FamilyKey } from "@/lib/families";
import { formatFine } from "@/lib/units";
import {
  DEFAULT_RULE,
  REGIONS,
  type ComponentRule,
  type PlaceRotation,
  type PlaceSide,
  type PlacementSpec,
  type RegionKey,
} from "./spec";
import s from "./autodesign.module.css";

/**
 * 자동 배치 조건.
 *
 * 엔진에 "알아서 해 줘"만 던지면 커넥터가 판 한가운데로 가고 안테나가 금속 옆에 붙는다.
 * 사람이 아는 제약 — 이 부품은 이 면에, 이건 여기 근처에, 이건 아예 건드리지 말 것 — 을
 * 빠짐없이 적게 하는 것이 이 화면의 일이다.
 *
 * 부품을 하나씩 고르게 두되, 고른 것 전부에 한 번에 조건을 먹이는 길도 같이 둔다.
 * BGA 하나가 아니라 커넥터 열두 개에 같은 조건을 주는 일이 훨씬 흔하다.
 */

const SIDES: [PlaceSide, string][] = [["keep", "유지"], ["top", "TOP"], ["bottom", "BOTTOM"]];
const ROTATIONS: [PlaceRotation, string][] = [
  ["keep", "유지"], ["free", "자유"], [0, "0°"], [90, "90°"], [180, "180°"], [270, "270°"],
];

export function PlacementPanel({
  detail,
  boards,
  spec,
  onChange,
}: {
  detail: RevisionDetail | null;
  boards: Board[];
  spec: PlacementSpec;
  onChange: (next: PlacementSpec) => void;
}) {
  const [family, setFamily] = useState<FamilyKey | null>(null);
  const selected = useMemo(() => new Set(spec.refdes), [spec.refdes]);

  const rows = useMemo(() => {
    const all = detail?.components ?? [];
    return family ? all.filter((c) => familyOf(c) === family) : all;
  }, [detail, family]);

  const familyCounts = useMemo(() => {
    const out = new Map<FamilyKey, number>();
    for (const c of detail?.components ?? []) {
      const k = familyOf(c);
      out.set(k, (out.get(k) ?? 0) + 1);
    }
    return out;
  }, [detail]);

  const toggle = (refdes: string) => {
    const next = new Set(selected);
    if (next.has(refdes)) next.delete(refdes);
    else next.add(refdes);
    onChange({ ...spec, refdes: [...next], scope: next.size ? "selected" : spec.scope });
  };

  const setAll = (list: string[]) => onChange({ ...spec, refdes: list, scope: list.length ? "selected" : spec.scope });

  /** 고른 부품 전부에 같은 조건을 먹인다. 하나씩 누르는 것은 열둘이 넘으면 못 할 일이다. */
  const applyToSelected = (patch: Partial<ComponentRule>) => {
    const rules = { ...spec.rules };
    for (const refdes of spec.refdes) rules[refdes] = { ...(rules[refdes] ?? DEFAULT_RULE), ...patch };
    onChange({ ...spec, rules });
  };

  const setRule = (refdes: string, patch: Partial<ComponentRule>) =>
    onChange({
      ...spec,
      rules: { ...spec.rules, [refdes]: { ...(spec.rules[refdes] ?? DEFAULT_RULE), ...patch } },
    });

  const columns = useMemo<Column<ComponentRow>[]>(
    () => [
      {
        key: "pick",
        header: "",
        width: "34px",
        render: (c) => (
          <input
            type="checkbox"
            checked={selected.has(c.refdes)}
            onChange={() => toggle(c.refdes)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`${c.refdes} 고르기`}
          />
        ),
      },
      {
        key: "refdes",
        header: "RefDes",
        width: "92px",
        mono: true,
        strong: true,
        render: (c) => c.refdes,
        sort: (a, b) => a.refdes.localeCompare(b.refdes, undefined, { numeric: true }),
        search: (c) => c.refdes,
      },
      {
        key: "family",
        header: "계열",
        width: "116px",
        render: (c) => {
          const f = FAMILY_BY_KEY.get(familyOf(c))!;
          return (
            <span className={s.famTag}>
              <i style={{ background: familyCss(f.rgb) }} />
              {f.label}
            </span>
          );
        },
        search: (c) => FAMILY_BY_KEY.get(familyOf(c))!.label,
      },
      {
        key: "package",
        header: "패키지",
        width: "minmax(110px, 1fr)",
        render: (c) => c.package,
        search: (c) => c.package,
      },
      {
        key: "part",
        header: "파트넘버",
        width: "minmax(140px, 1fr)",
        mono: true,
        render: (c) => c.part_number ?? "—",
        search: (c) => c.part_number ?? "",
      },
      { key: "side", header: "현재 면", width: "80px", render: (c) => c.side },
      {
        key: "pins",
        header: "핀",
        width: "60px",
        align: "right",
        render: (c) => c.pin_count,
        sort: (a, b) => a.pin_count - b.pin_count,
      },
    ],
    [selected],
  );

  if (!detail) {
    return (
      <Panel title="자동 배치">
        <p className={s.hint}>
          부품을 고르려면 먼저 위에서 <b>리비전을 고르세요</b>. 올린 HKP 는 문법이 붙기
          전까지 열어 볼 수 없어 부품 목록이 나오지 않습니다.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="자동 배치">
      <div className={s.row}>
        <div className={s.seg} role="group" aria-label="배치 범위">
          {([["all", "판 전체 다시 배치"], ["selected", "고른 부품만"]] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={spec.scope === k ? s.segOn : ""}
              aria-pressed={spec.scope === k}
              onClick={() => onChange({ ...spec, scope: k })}
            >
              {label}
            </button>
          ))}
        </div>
        <label className={s.check}>
          <input
            type="checkbox"
            checked={spec.keepPlaced}
            onChange={() => onChange({ ...spec, keepPlaced: !spec.keepPlaced })}
          />
          이미 놓인 부품은 그대로 두기
        </label>
        <label className={s.numField}>
          부품 간 최소 간격
          <input
            type="number"
            min={0}
            max={2000}
            step={10}
            value={spec.clearanceUm}
            onChange={(e) => onChange({ ...spec, clearanceUm: Number(e.target.value) })}
          />
          µm
        </label>
      </div>

      {/* ── 부품 고르기 ── */}
      <div className={s.subHead}>
        <span>부품 고르기</span>
        <span className={s.subCount}>
          {spec.refdes.length}개 선택 / {detail.components.length.toLocaleString()}개
        </span>
        <span className={s.spacer} />
        <button type="button" className={s.linkBtn} onClick={() => setAll(rows.map((c) => c.refdes))}>
          보이는 것 모두
        </button>
        <button type="button" className={s.linkBtn} disabled={!spec.refdes.length} onClick={() => setAll([])}>
          선택 해제
        </button>
      </div>

      <div className={s.famFilter}>
        <button
          type="button"
          className={`${s.famChip} ${family === null ? s.famChipOn : ""}`}
          onClick={() => setFamily(null)}
        >
          전체
        </button>
        {FAMILIES.filter((f) => familyCounts.get(f.key)).map((f) => (
          <button
            key={f.key}
            type="button"
            className={`${s.famChip} ${family === f.key ? s.famChipOn : ""}`}
            onClick={() => setFamily(family === f.key ? null : f.key)}
          >
            <i style={{ background: familyCss(f.rgb) }} />
            {f.label}
            <b>{familyCounts.get(f.key)}</b>
          </button>
        ))}
      </div>

      <div className={s.tableBox}>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(c) => c.refdes}
          onRowClick={(c) => toggle(c.refdes)}
          searchPlaceholder="RefDes · 패키지 · 파트넘버"
          defaultSort="pins"
          defaultDesc
          emptyLabel="이 조건에 맞는 부품이 없습니다."
        />
      </div>

      {/* ── 고른 부품의 조건 ── */}
      {spec.refdes.length > 0 && (
        <>
          <div className={s.subHead}>
            <span>고른 부품에 줄 조건</span>
            <span className={s.spacer} />
            <span className={s.subNote}>아래 값을 누르면 고른 {spec.refdes.length}개에 한 번에 먹입니다</span>
          </div>

          <div className={s.bulkGrid}>
            <div className={s.bulkRow}>
              <span className={s.fieldLabel}>배치 면</span>
              <div className={s.seg}>
                {SIDES.map(([v, label]) => (
                  <button key={v} type="button" onClick={() => applyToSelected({ side: v })}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className={s.bulkRow}>
              <span className={s.fieldLabel}>회전</span>
              <div className={s.seg}>
                {ROTATIONS.map(([v, label]) => (
                  <button key={String(v)} type="button" onClick={() => applyToSelected({ rotation: v })}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className={s.bulkRow}>
              <span className={s.fieldLabel}>대략적 위치</span>
              <RegionPad value={null} onPick={(region) => applyToSelected({ region })} />
              <button type="button" className={s.linkBtn} onClick={() => applyToSelected({ lock: true })}>
                움직이지 않기
              </button>
              <button type="button" className={s.linkBtn} onClick={() => applyToSelected({ ...DEFAULT_RULE })}>
                조건 지우기
              </button>
            </div>
          </div>

          <div className={s.ruleList}>
            {spec.refdes.map((refdes) => {
              const rule = spec.rules[refdes] ?? DEFAULT_RULE;
              return (
                <div className={s.ruleRow} key={refdes}>
                  <span className={s.ruleRef}>{refdes}</span>
                  <select
                    className={s.miniSelect}
                    value={rule.side}
                    aria-label={`${refdes} 배치 면`}
                    onChange={(e) => setRule(refdes, { side: e.target.value as PlaceSide })}
                  >
                    {SIDES.map(([v, label]) => (
                      <option key={v} value={v}>{label}</option>
                    ))}
                  </select>
                  <select
                    className={s.miniSelect}
                    value={String(rule.rotation)}
                    aria-label={`${refdes} 회전`}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const v: PlaceRotation = raw === "keep" || raw === "free" ? raw : (Number(raw) as PlaceRotation);
                      setRule(refdes, { rotation: v });
                    }}
                  >
                    {ROTATIONS.map(([v, label]) => (
                      <option key={String(v)} value={String(v)}>{label}</option>
                    ))}
                  </select>
                  <RegionPad
                    value={rule.region}
                    onPick={(region) => setRule(refdes, { region: rule.region === region ? null : region })}
                  />
                  <label className={s.check}>
                    <input
                      type="checkbox"
                      checked={rule.lock}
                      onChange={() => setRule(refdes, { lock: !rule.lock })}
                    />
                    고정
                  </label>
                  <button
                    type="button"
                    className={s.dropBtn2}
                    aria-label={`${refdes} 선택 해제`}
                    onClick={() => toggle(refdes)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── 이전 데이터 참조 ── */}
      <div className={s.subHead}>
        <span>이전 설계 참조</span>
      </div>
      <label className={s.check}>
        <input
          type="checkbox"
          checked={spec.reference.enabled}
          onChange={() =>
            onChange({ ...spec, reference: { ...spec.reference, enabled: !spec.reference.enabled } })
          }
        />
        비슷한 이전 보드의 배치를 참고하게 한다
      </label>
      {spec.reference.enabled && (
        <>
          <p className={s.hint}>
            고른 보드에서 <b>같은 파트넘버 부품의 상대 위치와 방향</b>을 뽑아 참고합니다. 잘
            돌던 전원부·RF 블록의 배치를 그대로 물려주려는 것이지, 판 전체를 베끼는 것이
            아닙니다.
          </p>
          <div className={s.refList}>
            {boards
              .filter((b) => b.latest_revision_id !== detail.revision.id)
              .map((b) => {
                const on = spec.reference.revisionIds.includes(b.latest_revision_id);
                return (
                  <label key={b.id} className={`${s.refItem} ${on ? s.refItemOn : ""}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        onChange({
                          ...spec,
                          reference: {
                            ...spec.reference,
                            revisionIds: on
                              ? spec.reference.revisionIds.filter((id) => id !== b.latest_revision_id)
                              : [...spec.reference.revisionIds, b.latest_revision_id],
                          },
                        })
                      }
                    />
                    <span className={s.refKey}>{b.board_key}</span>
                    <span className={s.refName}>{b.name}</span>
                    <span className={s.refMeta}>
                      {b.summary.layer_count}층 · {b.summary.component_count.toLocaleString()}개 ·{" "}
                      {formatFine(b.summary.min_trace_width_nm)}
                    </span>
                  </label>
                );
              })}
          </div>
        </>
      )}
    </Panel>
  );
}

/** 3×3 자리 고르개. "대략적 위치"에 좌표를 요구하면 사람이 답할 수 없다. */
function RegionPad({ value, onPick }: { value: RegionKey | null; onPick: (region: RegionKey) => void }) {
  return (
    <span className={s.regionPad} role="group" aria-label="대략적 위치">
      {REGIONS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          className={`${s.regionCell} ${value === key ? s.regionCellOn : ""}`}
          title={label}
          aria-label={label}
          aria-pressed={value === key}
          onClick={() => onPick(key)}
        />
      ))}
    </span>
  );
}
