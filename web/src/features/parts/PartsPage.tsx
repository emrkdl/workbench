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
 * "이 파트넘버를 쓰는 보드를 전부 찾아라." 설계팀이 손으로 하던 일이고, 여기서는 부품
 * 마스터 조인 한 번이다.
 *
 * 수명 상태(단종·신규 비권장)는 다루지 않는다. 설계 파일에 없는 값이라 구매 시스템의
 * 부품 마스터가 붙기 전에는 알 수 없고, 모르는 것을 화면이 아는 척하면 그 화면을 믿고
 * 내린 판단이 틀린다. 그래서 아무것도 안 고른 기본 상태는 **부품 마스터가 어떻게 생겼나**
 * — 몇 종이 몇 장에 걸쳐 쓰이는지, 어느 제조사에 얼마나 기대고 있는지 — 를 보여 준다.
 */

type Filter = "all" | "shared" | "single";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "전체" },
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

  return (
    <div className={s.detail}>
      <div className={s.detailHead}>
        <span className={s.detailMpn}>{part.mpn_display}</span>
      </div>
      <div className={s.detailMeta}>
        {part.manufacturer ?? "제조사 미상"} · 정규형 <code>{part.mpn_normalized}</code>
      </div>

      <StatGrid cols={3}>
        <Stat label="사용 보드" value={part.board_count} />
        <Stat label="쓰인 리비전" value={usages.length} />
        <Stat label="총 수량" value={formatCount(part.total_quantity)} />
      </StatGrid>

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
      case "shared":
        return parts.filter((p) => p.board_count > 1);
      case "single":
        return parts.filter((p) => p.board_count === 1);
      default:
        return parts;
    }
  }, [parts, filter]);

  /**
   * 부품 마스터의 생김새.
   *
   * 두 가지만 본다. 하나는 **얼마나 돌려쓰는가** — 한 장에만 들어간 부품이 절반을
   * 넘으면 같은 기능을 보드마다 다른 부품으로 풀고 있다는 뜻이고, 그만큼 구매·재고가
   * 늘어난다. 다른 하나는 **어디에 기대고 있는가** — 종수와 수량은 대개 반대로 간다.
   * 종수는 적은데 수량이 몰린 제조사가 끊기면 그 순간 모든 보드가 멈춘다.
   */
  const shape = useMemo(() => {
    const makers = new Map<string, { parts: number; quantity: number }>();
    for (const p of parts) {
      const key = p.manufacturer ?? "제조사 미상";
      const acc = makers.get(key) ?? { parts: 0, quantity: 0 };
      acc.parts += 1;
      acc.quantity += p.total_quantity;
      makers.set(key, acc);
    }
    const quantity = parts.reduce((sum, p) => sum + p.total_quantity, 0);
    return {
      shared: parts.filter((p) => p.board_count > 1).length,
      single: parts.filter((p) => p.board_count === 1).length,
      quantity,
      makers: [...makers.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.quantity - a.quantity),
    };
  }, [parts]);

  const columns = useMemo<Column<Part>[]>(
    () => [
      {
        key: "mpn",
        header: "파트넘버",
        width: "minmax(160px, 240px)",
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
      /* 남는 폭을 받아 두는 빈 칸. 어느 칸에 1fr 을 주든 그 뒤가 통째로 오른쪽 끝까지
         밀려나는데, 맨 끝에서 받으면 칸들이 왼쪽에서부터 나란히 선다. */
      { key: "pad", header: "", width: "minmax(0, 1fr)", render: () => null },
    ],
    [],
  );

  if (loading) return <Loading label="부품 마스터를 불러오는 중" />;
  if (error) return <ErrorState error={error} />;

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>부품 역검색</h1>
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
            <Panel title="부품 마스터">
              <StatGrid cols={2}>
                <Stat label="전체 부품" value={formatCount(parts.length)} hint="MPN 정규화 후" />
                <Stat label="누적 수량" value={formatCount(shape.quantity)} />
                <Stat
                  label="2개 이상 보드"
                  value={formatCount(shape.shared)}
                  tone="accent"
                  hint={parts.length ? `${Math.round((shape.shared / parts.length) * 100)}%` : undefined}
                />
                <Stat label="단독 사용" value={formatCount(shape.single)} hint="표준화 후보" />
              </StatGrid>
            </Panel>

            <Panel title="제조사">
              <div className={s.makers}>
                {shape.makers.map((m) => (
                  <div key={m.name} className={s.maker}>
                    <span className={s.makerName}>{m.name}</span>
                    <span className={s.makerBar} aria-hidden="true">
                      <i style={{ width: `${(m.quantity / (shape.makers[0]?.quantity || 1)) * 100}%` }} />
                    </span>
                    <span className={s.makerNum}>{formatCount(m.parts)}종</span>
                    <span className={s.makerNum}>{formatCount(m.quantity)}개</span>
                  </div>
                ))}
              </div>
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
