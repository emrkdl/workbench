import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchPartDetail, fetchParts } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { Part } from "@/lib/cdm";
import { DataTable, type Column } from "@/components/DataTable";
import { EmptyState, ErrorState, Loading, Panel, Stat, StatGrid } from "@/components/ui";
import { formatCount } from "@/lib/units";
import { revisionPath } from "@/lib/routes";
import s from "./parts.module.css";

/**
 * 부품 역검색.
 *
 * "이 파트넘버를 쓰는 보드를 전부 찾아라." 단종 공지가 뜰 때마다 설계팀이 손으로 하던
 * 일이고, 여기서는 부품 마스터 조인 한 번이다. 화면을 열었을 때 아무것도 안 고른 상태의
 * 기본값이 **단종 영향 요약**인 것도 그래서다 — 대개 이 화면에 오는 이유가 그거다.
 */

const LIFECYCLE_LABEL: Record<string, string> = {
  active: "양산",
  nrnd: "신규 비권장",
  eol: "단종",
};

const LIFECYCLE_CLASS: Record<string, string> = {
  active: s.lifeActive,
  nrnd: s.lifeNrnd,
  eol: s.lifeEol,
};

function LifecycleTag({ value }: { value?: string | null }) {
  const key = value ?? "active";
  return <span className={`${s.life} ${LIFECYCLE_CLASS[key] ?? s.lifeActive}`}>{LIFECYCLE_LABEL[key] ?? key}</span>;
}

type Filter = "all" | "eol" | "nrnd" | "shared" | "single";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "eol", label: "단종" },
  { value: "nrnd", label: "신규 비권장" },
  { value: "shared", label: "2개 이상 보드" },
  { value: "single", label: "단독 사용" },
];

function PartDetailPanel({ partId }: { partId: string }) {
  const { data, error, loading } = useAsync(() => fetchPartDetail(partId), [partId]);

  if (loading) return <Loading label="사용처를 찾는 중" />;
  if (error) return <ErrorState error={error} />;
  if (!data) return null;

  const { part, usages } = data;
  const byBoard = new Map<string, typeof usages>();
  for (const u of usages) {
    const list = byBoard.get(u.board_key) ?? [];
    list.push(u);
    byBoard.set(u.board_key, list);
  }
  const released = usages.filter((u) => u.status === "released");

  return (
    <div className={s.detail}>
      <div className={s.detailHead}>
        <span className={s.detailMpn}>{part.mpn_display}</span>
        <LifecycleTag value={part.lifecycle} />
      </div>
      <div className={s.detailMeta}>
        {part.manufacturer ?? "제조사 미상"} · 정규형 <code>{part.mpn_normalized}</code>
      </div>

      <StatGrid cols={3}>
        <Stat label="사용 보드" value={part.board_count} />
        <Stat label="총 수량" value={formatCount(part.total_quantity)} />
        <Stat
          label="양산 리비전"
          value={released.length}
          tone={part.lifecycle === "eol" && released.length > 0 ? "crit" : undefined}
        />
      </StatGrid>

      {part.lifecycle === "eol" && released.length > 0 && (
        <div className={s.alert}>
          <b>단종 부품이 양산 보드에 들어 있습니다.</b> 아래 {released.length}개 양산 리비전이 대체품 검토 대상입니다.
        </div>
      )}

      <div className={s.usages}>
        {[...byBoard.entries()].map(([boardKey, list]) => (
          <div key={boardKey} className={s.usageBoard}>
            <div className={s.usageBoardHead}>
              <span className={s.usageKey}>{boardKey}</span>
              <span className={s.usageName}>{list[0]!.board_name}</span>
            </div>
            {list.map((u) => (
              <div key={u.revision_id} className={s.usageRow}>
                <Link
                  className={s.usageLink}
                  to={`${revisionPath(u.revision_id.replace(/-[a-z]$/, ""), u.revision_id)}/components`}
                >
                  {u.revision_label}
                </Link>
                <span className={s.usageQty}>{u.quantity}개</span>
                <span className={s.refdes} title={u.refdes_list.join(", ")}>
                  {u.refdes_list.slice(0, 8).join(" ")}
                  {u.refdes_list.length > 8 && ` +${u.refdes_list.length - 8}`}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PartsPage() {
  const { data, error, loading } = useAsync(fetchParts, []);
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>("all");
  const selected = params.get("part");

  const parts = data?.parts ?? [];

  // 링크로 들어왔는데 그 부품이 목록에 없으면 선택을 지운다 — 빈 패널만 남는 것을 막는다.
  useEffect(() => {
    if (selected && parts.length && !parts.some((p) => p.id === selected)) {
      setParams({}, { replace: true });
    }
  }, [selected, parts, setParams]);

  const rows = useMemo(() => {
    switch (filter) {
      case "eol":
        return parts.filter((p) => p.lifecycle === "eol");
      case "nrnd":
        return parts.filter((p) => p.lifecycle === "nrnd");
      case "shared":
        return parts.filter((p) => p.board_count > 1);
      case "single":
        return parts.filter((p) => p.board_count === 1);
      default:
        return parts;
    }
  }, [parts, filter]);

  const risk = useMemo(() => {
    const eol = parts.filter((p) => p.lifecycle === "eol");
    return {
      eol: eol.length,
      eolShared: eol.filter((p) => p.board_count > 1).length,
      eolQuantity: eol.reduce((sum, p) => sum + p.total_quantity, 0),
      nrnd: parts.filter((p) => p.lifecycle === "nrnd").length,
    };
  }, [parts]);

  const columns = useMemo<Column<Part>[]>(
    () => [
      {
        key: "mpn",
        header: "파트넘버",
        width: "minmax(160px, 1fr)",
        mono: true,
        strong: true,
        render: (p) => p.mpn_display,
        sort: (a, b) => a.mpn_display.localeCompare(b.mpn_display),
        search: (p) => `${p.mpn_display} ${p.mpn_normalized}`,
      },
      {
        key: "maker",
        header: "제조사",
        width: "minmax(130px, 180px)",
        render: (p) => p.manufacturer ?? "—",
        sort: (a, b) => (a.manufacturer ?? "").localeCompare(b.manufacturer ?? ""),
        search: (p) => p.manufacturer ?? "",
      },
      {
        key: "life",
        header: "수명",
        width: "104px",
        render: (p) => <LifecycleTag value={p.lifecycle} />,
        sort: (a, b) => (a.lifecycle ?? "").localeCompare(b.lifecycle ?? ""),
      },
      {
        key: "boards",
        header: "사용 보드",
        width: "92px",
        align: "right",
        render: (p) => p.board_count,
        sort: (a, b) => a.board_count - b.board_count,
      },
      {
        key: "qty",
        header: "총 수량",
        width: "92px",
        align: "right",
        render: (p) => formatCount(p.total_quantity),
        sort: (a, b) => a.total_quantity - b.total_quantity,
      },
    ],
    [],
  );

  if (loading) return <Loading label="부품 마스터를 불러오는 중" />;
  if (error) return <ErrorState error={error} />;

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>부품 역검색</h1>
        <span className={s.sub}>파트넘버 하나로 그것을 쓰는 보드를 전부 찾습니다</span>
        <span className={s.spacer} />
        <div className={s.filters}>
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`${s.filterChip} ${filter === f.value ? s.filterChipOn : ""}`}
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      <div className={s.list}>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(p) => p.id}
          defaultSort="boards"
          defaultDesc
          searchPlaceholder="파트넘버 · 제조사"
          selectedKey={selected ?? undefined}
          onRowClick={(p) => setParams({ part: p.id })}
          emptyLabel="조건에 맞는 부품이 없습니다."
        />
      </div>

      <aside className={s.side}>
        {selected ? (
          <PartDetailPanel partId={selected} />
        ) : (
          <div className={s.summary}>
            <Panel title="단종 영향">
              <StatGrid cols={2}>
                <Stat label="단종 부품" value={risk.eol} tone={risk.eol ? "crit" : undefined} />
                <Stat label="2개 이상 보드" value={risk.eolShared} hint="영향 범위가 넓은 것" />
                <Stat label="누적 수량" value={formatCount(risk.eolQuantity)} />
                <Stat label="신규 비권장" value={risk.nrnd} />
              </StatGrid>
              <p className={s.note}>
                왼쪽에서 부품을 고르면 그 부품이 들어간 보드·리비전과 RefDes 까지 나옵니다. 단종 공지를 받았을 때
                제일 먼저 보는 화면입니다.
              </p>
            </Panel>

            <Panel title="정규화" >
              <p className={s.note}>
                같은 부품이 <code>GRM188R71H104KA93D</code> 와 <code>GRM188R71H104KA93</code> 로 들어오면 다른 부품이
                되고, 그 순간 역검색은 조용히 절반만 답합니다. 공백·하이픈·포장 접미사를 제거한 정규형으로 묶고,
                제거 규칙은 코드가 아니라 데이터로 관리합니다.
              </p>
            </Panel>
          </div>
        )}
      </aside>

      {rows.length === 0 && filter !== "all" && (
        <EmptyState title="해당하는 부품이 없습니다" body="다른 조건을 골라 보세요." />
      )}
    </div>
  );
}
