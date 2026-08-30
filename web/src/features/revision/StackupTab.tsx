import { useMemo, useState } from "react";
import type { RevisionDetail, StackupLayer } from "@/lib/cdm";
import { DataTable, type Column } from "@/components/DataTable";
import { Panel } from "@/components/ui";
import { formatFine, toUm } from "@/lib/units";
import { conductorNumbers, isConductor, ROLE_COLOR, ROLE_LABEL, ROLE_ON_DARK } from "./layers";
import s from "./revision.module.css";

/**
 * 적층 단면도.
 *
 * 층 높이를 실제 두께에 비례시키되 동박층은 유전체보다 20배 이상 얇아서 그대로 그리면
 * 선 한 줄로 사라진다. 최소 높이를 주어 클릭·식별이 가능하게 하고, 정확한 값은 옆 표에서 읽는다.
 */
function CrossSection({
  stackup,
  numbers,
  selected,
  onSelect,
}: {
  stackup: StackupLayer[];
  numbers: Map<number, number>;
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const max = Math.max(...stackup.map((l) => l.thickness_nm), 1);

  return (
    <div className={s.section}>
      {stackup.map((l) => {
        const height = Math.max(14, Math.round((l.thickness_nm / max) * 46));
        const dark = ROLE_ON_DARK[l.role];
        return (
          <div
            key={l.index}
            className={`${s.sectionRow} ${selected === l.index ? s.sectionRowActive : ""}`}
            style={{
              height,
              background: ROLE_COLOR[l.role],
              color: dark ? "var(--surface)" : "var(--ink-2)",
              cursor: "pointer",
            }}
            onClick={() => onSelect(l.index)}
            title={`${l.name} · ${ROLE_LABEL[l.role]} · ${formatFine(l.thickness_nm)}`}
          >
            <span className={s.sectionName}>{isConductor(l) ? `L${numbers.get(l.index)}` : l.name}</span>
            {height >= 18 && <span>{ROLE_LABEL[l.role]}</span>}
            <span className={s.sectionMeta}>{toUm(l.thickness_nm).toFixed(0)} µm</span>
          </div>
        );
      })}
    </div>
  );
}

export function StackupTab({ detail }: { detail: RevisionDetail }) {
  const [selected, setSelected] = useState<number | null>(null);
  const numbers = useMemo(() => conductorNumbers(detail.stackup), [detail.stackup]);

  const columns = useMemo<Column<StackupLayer>[]>(
    () => [
      {
        key: "index",
        header: "#",
        width: "44px",
        align: "right",
        mono: true,
        render: (l) => l.index,
        sort: (a, b) => a.index - b.index,
      },
      {
        key: "layer",
        header: "층",
        width: "96px",
        mono: true,
        strong: true,
        render: (l) => (isConductor(l) ? `L${numbers.get(l.index)}` : l.name),
        search: (l) => `${l.name} ${l.source_name}`,
      },
      {
        key: "role",
        header: "역할",
        width: "122px",
        render: (l) => (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <i
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: ROLE_COLOR[l.role],
                display: "inline-block",
                flex: "none",
              }}
            />
            {ROLE_LABEL[l.role]}
          </span>
        ),
      },
      {
        key: "source",
        header: "원본 층명",
        width: "minmax(140px, 1fr)",
        mono: true,
        render: (l) => l.source_name,
        search: (l) => l.source_name,
      },
      {
        key: "thickness",
        header: "두께",
        width: "88px",
        align: "right",
        render: (l) => formatFine(l.thickness_nm),
        sort: (a, b) => a.thickness_nm - b.thickness_nm,
      },
      {
        key: "material",
        header: "재질",
        width: "120px",
        render: (l) => l.material ?? "—",
        search: (l) => l.material ?? "",
      },
      { key: "dk", header: "Dk", width: "64px", align: "right", render: (l) => l.dk?.toFixed(2) ?? "—" },
      { key: "df", header: "Df", width: "72px", align: "right", render: (l) => l.df?.toFixed(4) ?? "—" },
      {
        key: "copper",
        header: "동박",
        width: "76px",
        align: "right",
        render: (l) => (l.copper_weight_um ? `${l.copper_weight_um} µm` : "—"),
      },
      {
        key: "ratio",
        header: "동박 면적률",
        width: "104px",
        align: "right",
        render: (l) => (l.copper_area_ratio == null ? "—" : `${(l.copper_area_ratio * 100).toFixed(0)} %`),
        sort: (a, b) => (a.copper_area_ratio ?? 0) - (b.copper_area_ratio ?? 0),
      },
      {
        key: "imp",
        header: "임피던스",
        width: "128px",
        align: "right",
        render: (l) =>
          l.impedance_single_ohm
            ? `${l.impedance_single_ohm} Ω${l.impedance_diff_ohm ? ` / ${l.impedance_diff_ohm} Ω 차동` : ""}`
            : "—",
      },
    ],
    [numbers],
  );

  return (
    <div className={s.stackWrap}>
      <Panel title="단면">
        <CrossSection
          stackup={detail.stackup}
          numbers={numbers}
          selected={selected}
          onSelect={(i) => setSelected((cur) => (cur === i ? null : i))}
        />
      </Panel>

      <div className={s.stackTable}>
        <Panel title="층 사양" flush fill>
          <DataTable
            rows={detail.stackup}
            columns={columns}
            rowKey={(l) => String(l.index)}
            rowHeight={30}
            searchPlaceholder="층 이름 · 재질"
            selectedKey={selected == null ? undefined : String(selected)}
            onRowClick={(l) => setSelected((cur) => (cur === l.index ? null : l.index))}
          />
        </Panel>
      </div>
    </div>
  );
}
