import { useMemo, useState } from "react";
import type { ComponentRow, RevisionDetail } from "@/lib/cdm";
import { DataTable, type Column } from "@/components/DataTable";
import { Panel } from "@/components/ui";
import { bodySize, familyOf, FAMILIES, css as familyCss, FAMILY_BY_KEY, type FamilyKey } from "@/lib/families";
import { toMm } from "@/lib/units";
import {
  DEFAULT_RULE,
  DENSITIES,
  type ComponentRule,
  type PlaceRotation,
  type PlaceSide,
  type PlacementSpec,
} from "./spec";
import { BoardPointPicker, type PickMark } from "./BoardPointPicker";
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
  spec,
  onChange,
  preview,
}: {
  detail: RevisionDetail | null;
  spec: PlacementSpec;
  onChange: (next: PlacementSpec) => void;
  /** 파서가 붙기 전까지 부품 목록을 대신 읽어 올 자리. 임시 발판이다. */
  preview: React.ReactNode;
}) {
  const [family, setFamily] = useState<FamilyKey | null>(null);
  /** 판을 눌렀을 때 그 자리를 받을 부품. 비어 있으면 고른 것 전부가 받는다. */
  const [focus, setFocus] = useState<string | null>(null);
  const density = DENSITIES.find(([k]) => k === spec.density);



  const byRefdes = useMemo(
    () => new Map((detail?.components ?? []).map((c) => [c.refdes, c])),
    [detail],
  );

  const marks = useMemo<PickMark[]>(
    () =>
      spec.refdes
        .map((refdes) => {
          const rule = spec.rules[refdes];
          const c = byRefdes.get(refdes);
          if (!rule?.position || !c) return null;
          // bodySize 는 지금 놓인 회전을 반영한다. 조건으로 회전을 못박았으면 그쪽이 이긴다.
          const [bw, bh] = bodySize(c);
          const turned =
            typeof rule.rotation === "number" &&
            Math.round(rule.rotation / 90) % 2 !== Math.round(c.rotation_mdeg / 90_000) % 2;
          const family = FAMILY_BY_KEY.get(familyOf(c))!;
          return {
            refdes,
            x: rule.position.x,
            y: rule.position.y,
            w: turned ? bh : bw,
            h: turned ? bw : bh,
            color: familyCss(family.rgb),
          };
        })
        .filter((m): m is PickMark => m !== null),
    [spec.refdes, spec.rules, byRefdes],
  );
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
      <Panel title="자동 배치" action={preview}>
        <p className={s.hint}>
          올린 HKP 는 <b>문법이 붙기 전까지 열어 볼 수 없어</b> 부품 목록이 나오지 않습니다.
          화면을 확인하려면 오른쪽에서 이미 들어와 있는 리비전을 골라 부품 목록을 대신
          띄우세요 — 파서가 붙으면 이 자리는 사라집니다.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="자동 배치" action={preview}>
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
        <span className={s.densityWrap}>
          <span className={s.fieldLabel}>밀도</span>
          <span className={s.seg} role="group" aria-label="밀도 등급">
            {DENSITIES.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={spec.density === key ? s.segOn : ""}
                aria-pressed={spec.density === key}
                onClick={() => onChange({ ...spec, density: key })}
              >
                {label}
              </button>
            ))}
          </span>
        </span>
      </div>

      {/* 고른 등급이 무엇을 뜻하는지 한 줄. 등급 이름만으로는 "극밀도"가 얼마나 빽빽한지 모른다. */}
      {density && (
        <p className={s.densityNote}>
          <b>{density[1]}</b> — {density[2]} <span>부품 간 {density[3]}</span>
        </p>
      )}

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
            <span className={s.subNote}>
              {focus
                ? `판을 누르면 ${focus} 의 자리가 정해집니다`
                : `판을 누르면 고른 ${spec.refdes.length}개 모두에 먹입니다`}
            </span>
          </div>

          <div className={s.placeGrid}>
            <div className={s.placeRules}>
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
                  const on = focus === refdes;
                  return (
                    // 줄 어디를 눌러도 그 부품만 판에서 자리를 받는다. 아무 줄도 안 눌렀으면
                    // 찍은 자리가 고른 것 전부에 먹는다. 안쪽의 조작(고르개·체크·단추)을 누른
                    // 것은 빼야 한다 — 회전을 바꾸려다 초점까지 옮겨지면 손이 어긋난다.
                    <div
                      className={`${s.ruleRow} ${on ? s.ruleRowOn : ""}`}
                      key={refdes}
                      role="button"
                      tabIndex={0}
                      aria-pressed={on}
                      title={on ? "이 부품만 찍기 해제" : "이 부품만 자리 찍기"}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("select, input, button")) return;
                        setFocus(on ? null : refdes);
                      }}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setFocus(on ? null : refdes);
                        }
                      }}
                    >
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
                          const v: PlaceRotation =
                            raw === "keep" || raw === "free" ? raw : (Number(raw) as PlaceRotation);
                          setRule(refdes, { rotation: v });
                        }}
                      >
                        {ROTATIONS.map(([v, label]) => (
                          <option key={String(v)} value={String(v)}>{label}</option>
                        ))}
                      </select>
                      {rule.position ? (
                        <button
                          type="button"
                          className={s.posChip}
                          title="자리 지우기"
                          onClick={() => setRule(refdes, { position: null })}
                        >
                          {toMm(rule.position.x).toFixed(1)}, {toMm(rule.position.y).toFixed(1)}
                          <i>×</i>
                        </button>
                      ) : (
                        <span className={s.posNone}>자리 맡김</span>
                      )}
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
            </div>

            <div className={s.placeBoard}>
              <BoardPointPicker
                outline={detail.outline}
                components={detail.components}
                selected={selected}
                marks={marks}
                onPick={(x, y) => {
                  if (focus) setRule(focus, { position: { x, y } });
                  else applyToSelected({ position: { x, y } });
                }}
              />
            </div>
          </div>
        </>
      )}

    </Panel>
  );
}
