import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import s from "./DataTable.module.css";

export interface Column<T> {
  key: string;
  header: string;
  /** CSS grid 트랙. 고정 폭이 기본이지만 minmax() 도 그대로 쓸 수 있다. */
  width: string;
  align?: "left" | "right";
  mono?: boolean;
  strong?: boolean;
  render: (row: T) => ReactNode;
  /** 비교 함수를 주면 헤더가 정렬 버튼이 된다. */
  sort?: (a: T, b: T) => number;
  /** 검색 대상 문자열. 주지 않으면 이 열은 검색되지 않는다. */
  search?: (row: T) => string;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  rowHeight?: number;
  onRowClick?: (row: T) => void;
  selectedKey?: string;
  searchPlaceholder?: string;
  toolbarExtra?: ReactNode;
  emptyLabel?: string;
  /** 초기 정렬 열 키. */
  defaultSort?: string;
  defaultDesc?: boolean;
}

/**
 * 가상 스크롤 표.
 *
 * 부품 2,600행 · 넷 4,000행이 흔하므로 DOM 에 전부 올리지 않는다. 열 폭은 CSS grid
 * 트랙으로 헤더와 본문이 같은 정의를 공유하고, 가로 스크롤은 표 컨테이너 안에서만
 * 일어나 페이지 본문이 옆으로 밀리지 않는다.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  rowHeight = 32,
  onRowClick,
  selectedKey,
  searchPlaceholder,
  toolbarExtra,
  emptyLabel = "표시할 항목이 없습니다.",
  defaultSort,
  defaultDesc = false,
}: Props<T>) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | undefined>(defaultSort);
  const [desc, setDesc] = useState(defaultDesc);
  const scrollRef = useRef<HTMLDivElement>(null);

  const searchable = useMemo(() => columns.filter((c) => c.search), [columns]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows;
    if (q && searchable.length) {
      out = rows.filter((r) => searchable.some((c) => c.search!(r).toLowerCase().includes(q)));
    }
    const col = columns.find((c) => c.key === sortKey);
    if (col?.sort) {
      out = [...out].sort(col.sort);
      if (desc) out.reverse();
    }
    return out;
  }, [rows, query, searchable, columns, sortKey, desc]);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  const template = columns.map((c) => c.width).join(" ");

  const toggleSort = (col: Column<T>) => {
    if (!col.sort) return;
    if (sortKey === col.key) setDesc((d) => !d);
    else {
      setSortKey(col.key);
      setDesc(false);
    }
  };

  return (
    <div className={s.wrap}>
      <div className={s.toolbar}>
        {searchable.length > 0 && (
          <input
            className={s.search}
            type="search"
            value={query}
            placeholder={searchPlaceholder ?? "검색"}
            aria-label={searchPlaceholder ?? "검색"}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        <span className={s.count}>
          {query ? `${visible.length.toLocaleString()} / ${rows.length.toLocaleString()}` : `${rows.length.toLocaleString()}개`}
        </span>
        <span className={s.spacer} />
        {toolbarExtra}
      </div>

      <div className={s.scroll} ref={scrollRef}>
        <div className={s.grid}>
          <div className={s.head} style={{ gridTemplateColumns: template }} role="row">
            {columns.map((c) => {
              const active = sortKey === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  role="columnheader"
                  aria-sort={active ? (desc ? "descending" : "ascending") : "none"}
                  className={[
                    s.th,
                    c.align === "right" ? s.thRight : "",
                    c.sort ? s.thSortable : "",
                    active ? s.thActive : "",
                  ].join(" ")}
                  onClick={() => toggleSort(c)}
                  disabled={!c.sort}
                >
                  {c.header}
                  {active && <span className={s.caret}>{desc ? "▼" : "▲"}</span>}
                </button>
              );
            })}
          </div>

          {visible.length === 0 ? (
            <p className={s.empty}>{emptyLabel}</p>
          ) : (
            <div className={s.body} style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((v) => {
                const row = visible[v.index]!;
                const key = rowKey(row);
                return (
                  <div
                    key={key}
                    role="row"
                    className={[
                      s.row,
                      onRowClick ? s.rowClickable : "",
                      selectedKey === key ? s.rowSelected : "",
                    ].join(" ")}
                    style={{ height: v.size, transform: `translateY(${v.start}px)`, gridTemplateColumns: template }}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((c) => (
                      <div
                        key={c.key}
                        role="cell"
                        className={[
                          s.td,
                          c.align === "right" ? s.tdRight : "",
                          c.mono ? s.tdMono : "",
                          c.strong ? s.tdStrong : "",
                        ].join(" ")}
                      >
                        {c.render(row)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
