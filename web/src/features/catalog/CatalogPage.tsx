import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchCatalog } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { Board } from "@/lib/cdm";
import { DataTable, type Column } from "@/components/DataTable";
import { EmptyState, ErrorState, Loading, Segmented, StatusPill, Tag } from "@/components/ui";
import { formatArea, formatCount, formatDimensions, formatFine } from "@/lib/units";
import { revisionPath } from "@/lib/routes";
import { FacetPanel } from "./FacetPanel";
import { BoardCards } from "./BoardCards";
import {
  applyFilters,
  EMPTY_FILTERS,
  liveFacets,
  SORT_OPTIONS,
  sortBoards,
  type CatalogFilters,
  type SortKey,
} from "./filters";
import s from "./catalog.module.css";

type View = "table" | "cards";

function columns(): Column<Board>[] {
  return [
    {
      key: "board_key",
      header: "보드",
      width: "170px",
      mono: true,
      strong: true,
      render: (b) => b.board_key,
      sort: (a, b) => a.board_key.localeCompare(b.board_key),
      search: (b) => b.board_key,
    },
    {
      key: "name",
      header: "이름",
      width: "minmax(200px, 1fr)",
      render: (b) => b.name,
      sort: (a, b) => a.name.localeCompare(b.name),
      search: (b) => b.name,
    },
    {
      key: "status",
      header: "상태",
      width: "84px",
      render: (b) => <StatusPill status={b.status} />,
      sort: (a, b) => a.status.localeCompare(b.status),
    },
    {
      key: "rev",
      header: "최신",
      width: "72px",
      render: (b) => b.latest_revision_label,
      sort: (a, b) => a.revision_count - b.revision_count,
    },
    {
      key: "family",
      header: "제품군",
      width: "96px",
      render: (b) => b.product_family ?? "—",
      sort: (a, b) => (a.product_family ?? "").localeCompare(b.product_family ?? ""),
      search: (b) => b.product_family ?? "",
    },
    {
      key: "owner",
      header: "설계자",
      width: "88px",
      render: (b) => b.owner ?? "—",
      sort: (a, b) => (a.owner ?? "").localeCompare(b.owner ?? ""),
      search: (b) => b.owner ?? "",
    },
    {
      key: "layers",
      header: "층",
      width: "56px",
      align: "right",
      render: (b) => b.summary.layer_count,
      sort: (a, b) => a.summary.layer_count - b.summary.layer_count,
    },
    {
      key: "size",
      header: "치수",
      width: "152px",
      align: "right",
      mono: true,
      render: (b) => formatDimensions(b.summary.width_nm, b.summary.height_nm),
      sort: (a, b) => a.summary.area_mm2 - b.summary.area_mm2,
    },
    {
      key: "area",
      header: "면적",
      width: "112px",
      align: "right",
      render: (b) => formatArea(b.summary.area_mm2),
      sort: (a, b) => a.summary.area_mm2 - b.summary.area_mm2,
    },
    {
      key: "components",
      header: "부품",
      width: "76px",
      align: "right",
      render: (b) => formatCount(b.summary.component_count),
      sort: (a, b) => a.summary.component_count - b.summary.component_count,
    },
    {
      key: "nets",
      header: "넷",
      width: "76px",
      align: "right",
      render: (b) => formatCount(b.summary.net_count),
      sort: (a, b) => a.summary.net_count - b.summary.net_count,
    },
    {
      key: "density",
      header: "밀도",
      width: "88px",
      align: "right",
      render: (b) => `${b.summary.density_per_cm2.toFixed(1)}/cm²`,
      sort: (a, b) => a.summary.density_per_cm2 - b.summary.density_per_cm2,
    },
    {
      key: "trace",
      header: "최소 선폭",
      width: "92px",
      align: "right",
      render: (b) => formatFine(b.summary.min_trace_width_nm),
      sort: (a, b) => a.summary.min_trace_width_nm - b.summary.min_trace_width_nm,
    },
    {
      key: "complexity",
      header: "복잡도",
      width: "80px",
      align: "right",
      render: (b) => b.summary.complexity_score,
      sort: (a, b) => a.summary.complexity_score - b.summary.complexity_score,
    },
    {
      key: "tool",
      header: "CAD",
      width: "96px",
      render: (b) => b.source_tool,
      sort: (a, b) => a.source_tool.localeCompare(b.source_tool),
      search: (b) => b.source_tool,
    },
    {
      key: "tags",
      header: "태그",
      width: "minmax(120px, 160px)",
      render: (b) => (b.tags.length ? b.tags.map((t) => <Tag key={t}>{t}</Tag>) : "—"),
      search: (b) => b.tags.join(" "),
    },
    {
      key: "updated",
      header: "갱신",
      width: "96px",
      align: "right",
      mono: true,
      render: (b) => b.updated_at.slice(0, 10),
      sort: (a, b) => a.updated_at.localeCompare(b.updated_at),
    },
  ];
}

export function CatalogPage() {
  const { data, error, loading } = useAsync(fetchCatalog, []);
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>("updated");
  // 보기 방식은 URL 에 둔다 — 표와 카드는 같은 목록을 다르게 읽는 방법이고,
  // 어느 쪽으로 보라고 링크를 건넬 수 있어야 한다.
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") === "cards" ? "cards" : "table") as View;
  const setView = (next: View) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === "table") p.delete("view");
      else p.set("view", next);
      return p;
    }, { replace: true });
  const navigate = useNavigate();

  const boards = data?.items ?? [];
  const facets = useMemo(() => liveFacets(boards, filters), [boards, filters]);
  const results = useMemo(() => sortBoards(applyFilters(boards, filters), sort), [boards, filters, sort]);
  const cols = useMemo(columns, []);

  if (loading) return <Loading label="카탈로그를 불러오는 중" />;
  if (error) return <ErrorState error={error} />;

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>카탈로그</h1>
        <span className={s.resultCount}>
          <b>{results.length}</b> / {boards.length}개 보드
        </span>
        <span className={s.headSpacer} />
        <input
          className={s.search}
          type="search"
          placeholder="보드 코드 · 이름 · 파트넘버 · 설계자"
          aria-label="보드 검색"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
        />
        <select
          className={s.select}
          aria-label="정렬"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Segmented
          ariaLabel="보기 방식"
          value={view}
          onChange={setView}
          options={[
            { value: "table", label: "표" },
            { value: "cards", label: "카드" },
          ]}
        />
      </header>

      <FacetPanel filters={filters} facets={facets} onChange={setFilters} />

      <div className={s.results}>
        {results.length === 0 ? (
          <EmptyState
            title="조건에 맞는 보드가 없습니다"
            body="필터를 하나씩 해제하거나 검색어를 지워 보세요. 각 선택지 옆 숫자는 그 조건을 골랐을 때의 결과 수입니다."
          />
        ) : view === "cards" ? (
          <BoardCards boards={results} />
        ) : (
          <div className={s.tableWrap}>
            <DataTable
              rows={results}
              columns={cols}
              rowKey={(b) => b.id}
              searchPlaceholder="표 안에서 검색"
              onRowClick={(b) => navigate(revisionPath(b.id, b.latest_revision_id))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
