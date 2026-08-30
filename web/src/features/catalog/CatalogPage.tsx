import type React from "react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchCatalog } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { Board } from "@/lib/cdm";
import { DataTable, type Column } from "@/components/DataTable";
import { EmptyState, ErrorState, Loading, Segmented } from "@/components/ui";
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

/**
 * 제품군 라벨.
 *
 * 글자만 있으면 30줄짜리 표에서 같은 계열끼리 묶여 보이지 않는다. 색을 입히면 훑는 눈이
 * 먼저 덩어리를 잡는다.
 *
 * 색은 카탈로그 전체의 제품군을 이름순으로 세워 배정한다. 걸러낸 목록이 아니라 전체에서
 * 뽑으므로 필터를 걸어도 색이 바뀌지 않는다. 새 제품군이 하나 생기면 그 뒤 색이 한 칸씩
 * 밀리는데, 색은 알아보기 위한 보조 표시이지 데이터가 아니므로 그 정도는 감수한다.
 */
function FamilyTag({ family, hue }: { family?: string | null; hue: Map<string, number> }) {
  if (!family) return <span className={s.muted}>—</span>;
  return (
    <span className={s.familyTag} style={{ "--cat-h": hue.get(family) ?? 0 } as React.CSSProperties}>
      {family}
    </span>
  );
}

/** 비아 종류 — 뷰어와 같은 색을 쓴다. 두 화면을 오가는 사람이 색을 다시 배우지 않도록. */
const VIA_LABEL: Record<string, string> = {
  through: "관통",
  blind: "블라인드",
  buried: "베리드",
  micro: "마이크로",
};
const VIA_ORDER = ["through", "blind", "buried", "micro"];
const VIA_COLOR: Record<string, string> = {
  through: "#9aa3ad",
  blind: "#7f97b0",
  buried: "#6f8496",
  micro: "#3fa88c",
};

/** 가장 어려운 공정이 무엇인지로 줄 세운다. 관통만 < 블라인드 < 베리드 < 마이크로. */
function viaRank(counts?: Record<string, number> | null): number {
  const keys = Object.keys(counts ?? {});
  return keys.length ? Math.max(...keys.map((k) => VIA_ORDER.indexOf(k) + 1)) : 0;
}

function ViaKinds({ counts }: { counts?: Record<string, number> | null }) {
  const kinds = VIA_ORDER.filter((k) => (counts?.[k] ?? 0) > 0);
  if (!kinds.length) return <span className={s.muted}>—</span>;
  return (
    <span className={s.viaKinds}>
      {kinds.map((k) => (
        <span key={k} className={s.viaKind} title={`${VIA_LABEL[k]} ${counts![k]!.toLocaleString()}개`}>
          <i style={{ background: VIA_COLOR[k] }} />
          {VIA_LABEL[k]}
        </span>
      ))}
    </span>
  );
}

function columns(familyHue: Map<string, number>): Column<Board>[] {
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
      key: "rev",
      header: "최신",
      width: "72px",
      render: (b) => b.latest_revision_label,
      sort: (a, b) => a.revision_count - b.revision_count,
    },
    {
      key: "family",
      header: "제품군",
      width: "112px",
      render: (b) => <FamilyTag family={b.product_family} hue={familyHue} />,
      sort: (a, b) => (a.product_family ?? "").localeCompare(b.product_family ?? ""),
      search: (b) => b.product_family ?? "",
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
      key: "via",
      header: "비아",
      width: "minmax(150px, 176px)",
      render: (b) => <ViaKinds counts={b.summary.via_by_kind} />,
      // 제조 난이도 순으로 줄 세운다 — 관통만 쓰는 보드와 마이크로비아를 쓰는 보드는
      // 만들 수 있는 업체가 다르다.
      sort: (a, b) => viaRank(a.summary.via_by_kind) - viaRank(b.summary.via_by_kind),
      search: (b) => Object.keys(b.summary.via_by_kind ?? {}).map((k) => VIA_LABEL[k] ?? k).join(" "),
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
  /** 제품군 → 색상. 전체 목록에서 뽑으므로 필터를 걸어도 색이 흔들리지 않는다. */
  const familyHue = useMemo(() => {
    const names = [...new Set(boards.map((b) => b.product_family).filter(Boolean) as string[])].sort();
    // 있는 제품군 수만큼 색상환을 고르게 나눈다. 여섯이면 60°씩 벌어져 서로 헷갈릴 일이
    // 없다. 열둘을 넘으면 색이 되풀이되는데, 그쯤 되면 색상각을 더 쪼개도 어차피 구분이
    // 안 되므로 그때부터는 이름이 구분을 맡는다.
    const slots = Math.min(names.length, 12) || 1;
    return new Map(names.map((n, i) => [n, Math.round(((i % slots) * 360) / slots + 15) % 360]));
  }, [boards]);
  const cols = useMemo(() => columns(familyHue), [familyHue]);

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
          placeholder="보드 코드 · 이름 · 파트넘버"
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
