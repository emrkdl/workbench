import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, LIVE, fetchCatalog, fetchChangeSet, fetchRevision } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { ChangeKind, ComponentChange, NetChange, RevisionDetail } from "@/lib/cdm";
import { DataTable, type Column } from "@/components/DataTable";
import { EmptyState, ErrorState, Loading, Panel, Stat, StatGrid } from "@/components/ui";
import { formatCoarse, formatCount, formatRouteLength, toDeg, toMm, NM_PER_UM } from "@/lib/units";
import { CompareBoards, type CompareView } from "./CompareBoards";
import { FieldDiffList, KindBadge, KindFilter, PinList } from "./ChangeBits";
import { PairPicker, RecentPairs, useRecentPairs } from "./PairPicker";
import s from "./compare.module.css";

type Tab = "summary" | "components" | "nets" | "stackup";

const THRESHOLDS_UM = [10, 25, 50, 100, 250, 500, 1000];

/* ── 표 ────────────────────────────────────── */

function componentColumns(unitSuffix: string): Column<ComponentChange>[] {
  const pos = (c: ComponentChange, which: "before" | "after") => {
    const snap = c[which];
    return snap ? `${toMm(snap.x_nm).toFixed(1)}, ${toMm(snap.y_nm).toFixed(1)}` : "—";
  };
  return [
    {
      key: "refdes",
      header: "RefDes",
      width: "96px",
      mono: true,
      strong: true,
      render: (c) => c.refdes,
      sort: (a, b) => a.refdes.localeCompare(b.refdes, undefined, { numeric: true }),
      search: (c) => c.refdes,
    },
    { key: "kind", header: "변경", width: "94px", render: (c) => <KindBadge kind={c.kind} />, sort: (a, b) => a.kind.localeCompare(b.kind) },
    { key: "before", header: `A 위치 (${unitSuffix})`, width: "126px", align: "right", mono: true, render: (c) => pos(c, "before") },
    { key: "after", header: `B 위치 (${unitSuffix})`, width: "126px", align: "right", mono: true, render: (c) => pos(c, "after") },
    {
      key: "distance",
      header: "이동",
      width: "92px",
      align: "right",
      render: (c) => (c.distance_nm ? formatCoarse(c.distance_nm) : "—"),
      sort: (a, b) => (a.distance_nm ?? 0) - (b.distance_nm ?? 0),
    },
    {
      key: "rotation",
      header: "회전",
      width: "78px",
      align: "right",
      render: (c) => (c.rotation_delta_mdeg ? `${toDeg(c.rotation_delta_mdeg).toFixed(0)}°` : "—"),
      sort: (a, b) => Math.abs(a.rotation_delta_mdeg ?? 0) - Math.abs(b.rotation_delta_mdeg ?? 0),
    },
    {
      key: "side",
      header: "면",
      width: "104px",
      render: (c) => {
        const from = c.before?.side;
        const to = c.after?.side;
        if (from && to && from !== to) return `${from} → ${to}`;
        return to ?? from ?? "—";
      },
    },
    {
      key: "part",
      header: "파트넘버",
      width: "minmax(200px, 1fr)",
      mono: true,
      render: (c) => {
        const from = c.before?.part_number;
        const to = c.after?.part_number;
        if (from && to && from !== to) {
          return (
            <>
              <span style={{ color: "var(--ink-3)" }}>{from}</span>
              <span style={{ color: "var(--ink-4)" }}> → </span>
              <span style={{ color: "var(--accent-ink)", fontWeight: 600 }}>{to}</span>
            </>
          );
        }
        return to ?? from ?? "—";
      },
      search: (c) => `${c.before?.part_number ?? ""} ${c.after?.part_number ?? ""}`,
    },
    {
      key: "package",
      header: "패키지",
      width: "126px",
      render: (c) => c.after?.package ?? c.before?.package ?? "—",
      search: (c) => c.after?.package ?? c.before?.package ?? "",
    },
  ];
}

function netColumns(): Column<NetChange>[] {
  return [
    { key: "kind", header: "변경", width: "104px", render: (n) => <KindBadge kind={n.kind} />, sort: (a, b) => a.kind.localeCompare(b.kind) },
    {
      key: "a",
      header: "A 넷",
      width: "minmax(160px, 1fr)",
      mono: true,
      strong: true,
      render: (n) => n.name_a ?? "—",
      sort: (a, b) => (a.name_a ?? "").localeCompare(b.name_a ?? "", undefined, { numeric: true }),
      search: (n) => n.name_a ?? "",
    },
    {
      key: "b",
      header: "B 넷",
      width: "minmax(160px, 1fr)",
      mono: true,
      render: (n) =>
        n.name_b && n.name_b !== n.name_a ? (
          <span style={{ color: "var(--accent-ink)", fontWeight: 600 }}>{n.name_b}</span>
        ) : (
          n.name_b ?? "—"
        ),
      search: (n) => n.name_b ?? "",
    },
    {
      key: "pins",
      header: "핀 변화",
      width: "minmax(200px, 300px)",
      render: (n) => <PinList added={n.pins_added} removed={n.pins_removed} />,
      sort: (a, b) =>
        (a.pins_added?.length ?? 0) + (a.pins_removed?.length ?? 0) -
        ((b.pins_added?.length ?? 0) + (b.pins_removed?.length ?? 0)),
    },
    {
      key: "delta",
      header: "핀 증감",
      width: "92px",
      align: "right",
      render: (n) => {
        const d = (n.pins_added?.length ?? 0) - (n.pins_removed?.length ?? 0);
        if (d === 0) return "0";
        return <span style={{ color: d > 0 ? "var(--ok)" : "var(--crit)", fontWeight: 600 }}>{d > 0 ? `+${d}` : d}</span>;
      },
      sort: (a, b) =>
        ((a.pins_added?.length ?? 0) - (a.pins_removed?.length ?? 0)) -
        ((b.pins_added?.length ?? 0) - (b.pins_removed?.length ?? 0)),
    },
    {
      key: "length",
      header: "배선 길이 변화",
      width: "128px",
      align: "right",
      render: (n) => {
        const d = n.length_delta_nm;
        if (d == null || d === 0) return "—";
        return `${d > 0 ? "+" : "−"}${formatRouteLength(Math.abs(d))}`;
      },
      sort: (a, b) => (a.length_delta_nm ?? 0) - (b.length_delta_nm ?? 0),
    },
  ];
}

/* ── 페이지 ────────────────────────────────── */

export function ComparePage() {
  const [params, setParams] = useSearchParams();
  // 탭과 임계값은 URL 에 둔다. "이 부품 변경 목록 좀 봐 주세요"를 링크 하나로 보낼 수 있어야 한다.
  const tab = (params.get("tab") ?? "summary") as Tab;
  const setTab = (next: Tab) => setParams((prev) => {
    const p = new URLSearchParams(prev);
    p.set("tab", next);
    return p;
  }, { replace: true });
  const [thresholdUm, setThresholdUm] = useState(10);
  const [compKind, setCompKind] = useState<ChangeKind | null>(null);
  const [netKind, setNetKind] = useState<ChangeKind | null>(null);
  // 기본은 나란히 보기. 겹쳐보기는 미세한 이동을 확인할 때 쓰는 옵션이다.
  // 탭과 마찬가지로 URL 에 둔다 — "이 겹쳐보기 좀 봐 주세요"를 링크로 보낼 수 있어야 한다.
  const boardView = (params.get("boards") ?? "side") as CompareView;
  const setBoardView = (next: CompareView) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("boards", next);
      return p;
    }, { replace: true });
  const [boardLabels, setBoardLabels] = useState(true);

  // 비교 대상은 URL 이 들고 있다. 화면 상태로 두면 "이 비교 좀 봐 주세요"를 링크로 못 보낸다.
  const a = params.get("a");
  const b = params.get("b");
  const pairKey = a && b ? `${a}__${b}` : null;

  const catalog = useAsync(fetchCatalog, []);
  const boards = useMemo(
    () => [...(catalog.data?.items ?? [])].sort((x, y) => x.board_key.localeCompare(y.board_key)),
    [catalog.data],
  );

  // 두 판을 각자 그리려면 각자의 부품 목록이 필요하다 — ChangeSet 은 바뀐 것만 담는다.
  // 한쪽씩 따로 받는다. 한 짝만 골라 둔 동안에도 그쪽 계보는 이미 화면에 있어야 한다.
  const detailA = useAsync(() => (a ? fetchRevision(a) : Promise.resolve(null)), [a]);
  const detailB = useAsync(() => (b ? fetchRevision(b) : Promise.resolve(null)), [b]);

  const changeset = useAsync(
    // 같은 리비전끼리는 물어볼 것이 없다. 요청도 보내지 않는다.
    () => (a && b && a !== b ? fetchChangeSet(a, b) : Promise.resolve(null)),
    [a, b],
  );

  const setSide = (side: "a" | "b", revisionId: string) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set(side, revisionId);
      return p;
    });

  const swap = () =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      const [x, y] = [p.get("a"), p.get("b")];
      if (x && y) {
        p.set("a", y);
        p.set("b", x);
      }
      return p;
    });

  // 같은 보드의 두 리비전이면 라벨은 리비전만으로 충분하다. 다른 보드끼리면 보드 코드가 앞에 와야
  // 어느 판인지 알 수 있다.
  const label = (d: RevisionDetail | null, other: RevisionDetail | null, fallback: string) => {
    if (!d) return fallback;
    const same = other?.revision.board_id === d.revision.board_id;
    return same ? d.revision.label : `${d.revision.board_key} ${d.revision.label}`;
  };
  const labelA = label(detailA.data, detailB.data, "A");
  const labelB = label(detailB.data, detailA.data, "B");
  const sameBoard =
    !!detailA.data && !!detailB.data && detailA.data.revision.board_id === detailB.data.revision.board_id;

  const recent = useRecentPairs(
    a && b && detailA.data && detailB.data ? { a, b, label: `${labelA} → ${labelB}` } : null,
  );

  // 임계값은 미리 계산된 10 µm 위로만 올릴 수 있다. 내리려면 서버가 다시 계산해야 한다.
  const components = useMemo(() => {
    const all = changeset.data?.component_changes ?? [];
    const min = thresholdUm * NM_PER_UM;
    return all.filter((c) => c.kind !== "moved" || (c.distance_nm ?? 0) >= min);
  }, [changeset.data, thresholdUm]);

  const nets = changeset.data?.net_changes ?? [];
  // 다른 보드끼리는 변경이 수천 건이라 서버가 목록을 상위 N 건으로 자른다. 잘렸다는 사실을
  // 말해 주지 않으면 표의 끝이 곧 전부라고 읽힌다.
  const trimmed =
    changeset.data?.list_limit != null &&
    (changeset.data.component_changes?.length ?? 0) + (changeset.data.net_changes?.length ?? 0) >=
      changeset.data.list_limit;

  const compCounts = useMemo(() => {
    const out: Partial<Record<ChangeKind, number>> = {};
    for (const c of components) out[c.kind] = (out[c.kind] ?? 0) + 1;
    return out;
  }, [components]);

  const netCounts = useMemo(() => {
    const out: Partial<Record<ChangeKind, number>> = {};
    for (const n of nets) out[n.kind] = (out[n.kind] ?? 0) + 1;
    return out;
  }, [nets]);

  const shownComponents = compKind ? components.filter((c) => c.kind === compKind) : components;
  const shownNets = netKind ? nets.filter((n) => n.kind === netKind) : nets;
  const compCols = useMemo(() => componentColumns("mm"), []);
  const netCols = useMemo(netColumns, []);

  // 목데이터에 없는 조합. 실서버는 어느 조합이든 계산하므로 이 갈래로 오지 않는다.
  const missingPair = !LIVE && changeset.error instanceof ApiError && changeset.error.status === 404;
  const latestPair =
    missingPair && detailA.data && detailB.data
      ? {
          a: boards.find((x) => x.id === detailA.data!.revision.board_id)?.latest_revision_id ?? "",
          b: boards.find((x) => x.id === detailB.data!.revision.board_id)?.latest_revision_id ?? "",
          tab,
          boards: boardView,
        }
      : null;

  if (catalog.loading) return <Loading label="보드 목록을 불러오는 중" />;
  if (catalog.error) return <ErrorState error={catalog.error} />;

  const cs = changeset.data;
  const st = cs?.stats;

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>비교</h1>
        <PairPicker
          boards={boards}
          detailA={detailA.data}
          detailB={detailB.data}
          loading={detailA.loading || detailB.loading}
          onPick={setSide}
          onSwap={swap}
        />
        <span className={s.headSpacer} />
        {cs && (
          <label className={s.threshold}>
            이동 임계값
            <input
              type="range"
              min={0}
              max={THRESHOLDS_UM.length - 1}
              step={1}
              value={THRESHOLDS_UM.indexOf(thresholdUm)}
              onChange={(e) => setThresholdUm(THRESHOLDS_UM[Number(e.target.value)]!)}
              aria-label="이동 임계값"
            />
            <span className={s.thresholdValue}>
              {thresholdUm >= 1000 ? `${thresholdUm / 1000} mm` : `${thresholdUm} µm`}
            </span>
          </label>
        )}
        <RecentPairs
          pairs={recent}
          current={pairKey}
          onSelect={(pair) =>
            setParams((prev) => {
              const p = new URLSearchParams(prev);
              p.set("a", pair.a);
              p.set("b", pair.b);
              return p;
            })
          }
        />
      </header>

      <div className={s.body}>
        {!pairKey ? (
          <EmptyState
            title="비교할 두 리비전을 고르세요"
            body="위에서 A 와 B 를 각각 고릅니다. 보드를 고르면 최신 리비전이 들어오고, 그 옆에서 같은 보드의 다른 리비전으로 바꿀 수 있습니다. 같은 보드의 두 리비전이면 무엇이 달라졌는지를, 다른 보드끼리면 두 설계가 얼마나 겹치는지를 봅니다."
          />
        ) : a === b ? (
          <EmptyState
            title="같은 리비전입니다"
            body="A 와 B 에 서로 다른 리비전을 고르세요."
          />
        ) : changeset.loading ? (
          <Loading label="변경 내역을 계산 결과에서 불러오는 중" />
        ) : missingPair ? (
          /* 목데이터는 조합을 미리 만들어 둔 것이라 빈 칸이 있다. 실서버에는 없는 상황이므로
             오류로 다루지 않고, 대신 있는 조합으로 가는 길을 준다. */
          <EmptyState
            title="이 조합은 목데이터에 없습니다"
            body="목데이터에는 같은 보드의 모든 리비전 쌍과, 보드끼리는 최신 리비전 쌍만 들어 있습니다. 실서버는 어느 두 리비전이든 요청받은 자리에서 계산합니다."
            action={
              latestPair && (
                <button type="button" className={s.filterChip} onClick={() => setParams(latestPair)}>
                  두 보드의 최신끼리 비교
                </button>
              )
            }
          />
        ) : changeset.error ? (
          <ErrorState error={changeset.error} />
        ) : !cs || !st ? null : (
          <>
            <nav className={s.tabs} aria-label="비교 항목">
              {(
                [
                  ["summary", "요약", null],
                  ["components", "부품", components.length],
                  ["nets", "넷", nets.length],
                  ["stackup", "적층 · 사양", (cs.stackup_changes?.length ?? 0) + (cs.header_changes?.length ?? 0) + (cs.rule_changes?.length ?? 0)],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  className={`${s.tab} ${tab === key ? s.tabOn : ""}`}
                  onClick={() => setTab(key)}
                >
                  {label}
                  {count !== null && <span className={s.tabCount}>{formatCount(count)}</span>}
                </button>
              ))}
            </nav>

            {tab === "summary" && (
              <div className={s.scroll}>
                <Panel title="변경 요약">
                  <StatGrid cols={4}>
                    <Stat label="부품 추가" value={formatCount(st.components_added)} tone={st.components_added ? "accent" : undefined} />
                    <Stat label="부품 삭제" value={formatCount(st.components_removed)} tone={st.components_removed ? "crit" : undefined} />
                    <Stat
                      label="부품 이동"
                      value={formatCount(compCounts.moved ?? 0)}
                      hint={`${thresholdUm >= 1000 ? `${thresholdUm / 1000} mm` : `${thresholdUm} µm`} 이상`}
                    />
                    <Stat label="부품 치환" value={formatCount(st.components_replaced)} hint="파트넘버 변경" />
                    <Stat label="넷 추가" value={formatCount(st.nets_added)} />
                    <Stat label="넷 삭제" value={formatCount(st.nets_removed)} />
                    <Stat
                      label="이름만 변경"
                      value={formatCount(st.nets_renamed)}
                      hint="회로는 그대로"
                    />
                    <Stat
                      label="회로 변경"
                      value={formatCount(st.nets_rewired)}
                      tone={st.nets_rewired ? "crit" : undefined}
                      hint={`핀 +${st.pins_added} / −${st.pins_removed}`}
                    />
                  </StatGrid>
                  <p className={s.hint} style={{ marginTop: "var(--sp-4)" }}>
                    <b>이름만 변경</b>과 <b>회로 변경</b>이 나뉘는 이유는 넷을 이름이 아니라 연결된 핀 집합의 해시로
                    매칭하기 때문입니다. 리뷰에서 실제로 봐야 하는 것은 회로 변경 쪽이고, 이름만 바뀐 넷은 접어둘 수 있습니다.
                    {st.layers_changed > 0 && ` 적층도 ${st.layers_changed}건 달라졌습니다.`}
                  </p>
                  {!sameBoard && (
                    <p className={s.hint} style={{ marginTop: "var(--sp-3)" }}>
                      서로 다른 보드를 놓고 봅니다. 부품은 RefDes 로, 넷은 연결된 핀 집합으로 맞추므로 여기서 “변경”은
                      두 설계의 <b>차이</b>를 뜻합니다 — 같은 자리를 지킨 항목이 두 판의 공통 부분입니다.
                      {trimmed && ` 항목이 많아 목록은 종류·크기 순으로 ${formatCount(cs.list_limit!)}건까지만 싣습니다. 위 집계는 전체 건수입니다.`}
                    </p>
                  )}
                </Panel>

                <Panel
                  title="보드 맞대어 보기"
                  action={
                    <span className={s.filters}>
                      <button
                        type="button"
                        className={`${s.filterChip} ${boardView === "side" ? s.filterChipOn : ""}`}
                        aria-pressed={boardView === "side"}
                        onClick={() => setBoardView("side")}
                      >
                        나란히
                      </button>
                      <button
                        type="button"
                        className={`${s.filterChip} ${boardView === "overlay" ? s.filterChipOn : ""}`}
                        aria-pressed={boardView === "overlay"}
                        onClick={() => setBoardView("overlay")}
                      >
                        겹쳐보기
                      </button>
                      <button
                        type="button"
                        className={`${s.filterChip} ${boardLabels ? s.filterChipOn : ""}`}
                        aria-pressed={boardLabels}
                        onClick={() => setBoardLabels((v) => !v)}
                      >
                        라벨
                      </button>
                    </span>
                  }
                >
                  <CompareBoards
                    view={boardView}
                    labels={boardLabels}
                    changes={components}
                    detailA={detailA.data}
                    detailB={detailB.data}
                    labelA={labelA}
                    labelB={labelB}
                    height={380}
                  />
                  <p className={s.hint} style={{ marginTop: "var(--sp-3)" }}>
                    {boardView === "side" ? (
                      <>
                        두 판이 <b>같은 배율</b>을 씁니다 — 배율이 다르면 크기 비교가 성립하지 않습니다. 팬·줌도 함께
                        움직입니다. 바뀌지 않은 부품은 눌러서 배경으로 보냈습니다.
                      </>
                    ) : (
                      <>
                        이전 위치는 파선, 이후 위치는 채움입니다. 미세한 이동을 확인할 때는 겹쳐 놓는 편이 정확하지만,
                        판이 둘 다 보이지 않아 넓은 범위의 변화는 놓치기 쉽습니다.
                      </>
                    )}{" "}
                    배선 기하 비교는 <code style={{ margin: "0 4px" }}>.blg</code> 버퍼가 만들어지는 Phase 2
                    이후입니다.
                  </p>
                </Panel>

                <div className={s.twoUp}>
                  <Panel title="사양 변경">
                    {(cs.header_changes?.length ?? 0) + (cs.rule_changes?.length ?? 0) === 0 ? (
                      <p className={s.hint}>보드 사양과 설계 룰은 동일합니다.</p>
                    ) : (
                      <FieldDiffList fields={[...(cs.header_changes ?? []), ...(cs.rule_changes ?? [])]} />
                    )}
                  </Panel>
                  <Panel title="적층 변경">
                    {(cs.stackup_changes?.length ?? 0) === 0 ? (
                      <p className={s.hint}>적층 구조는 동일합니다.</p>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
                        {cs.stackup_changes!.map((c) => (
                          <div key={`${c.index}-${c.kind}`}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                              <span className="mono" style={{ fontWeight: 600 }}>
                                {c.layer_name ?? `#${c.index}`}
                              </span>
                              <KindBadge kind={c.kind} />
                            </div>
                            {c.fields?.length ? <FieldDiffList fields={c.fields} /> : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>
                </div>
              </div>
            )}

            {tab === "components" && (
              <div className={s.tableHost}>
                <DataTable
                  rows={shownComponents}
                  columns={compCols}
                  rowKey={(c) => `${c.refdes}-${c.kind}`}
                  defaultSort="distance"
                  defaultDesc
                  searchPlaceholder="RefDes · 파트넘버 · 패키지"
                  toolbarExtra={
                    <KindFilter counts={compCounts} selected={compKind} onChange={setCompKind} total={components.length} />
                  }
                  emptyLabel="이 조건에서 달라진 부품이 없습니다."
                />
              </div>
            )}

            {tab === "nets" && (
              <div className={s.tableHost}>
                <DataTable
                  rows={shownNets}
                  columns={netCols}
                  rowKey={(n) => `${n.kind}-${n.name_a ?? ""}-${n.name_b ?? ""}`}
                  defaultSort="pins"
                  defaultDesc
                  searchPlaceholder="넷 이름"
                  toolbarExtra={<KindFilter counts={netCounts} selected={netKind} onChange={setNetKind} total={nets.length} />}
                  emptyLabel="이 조건에서 달라진 넷이 없습니다."
                />
              </div>
            )}

            {tab === "stackup" && (
              <div className={s.scroll}>
                <Panel title="보드 사양">
                  {(cs.header_changes?.length ?? 0) === 0 ? (
                    <p className={s.hint}>변경 없음</p>
                  ) : (
                    <FieldDiffList fields={cs.header_changes!} />
                  )}
                </Panel>
                <Panel title="설계 룰">
                  {(cs.rule_changes?.length ?? 0) === 0 ? (
                    <p className={s.hint}>변경 없음</p>
                  ) : (
                    <FieldDiffList fields={cs.rule_changes!} />
                  )}
                </Panel>
                <Panel title={`적층 (${cs.stackup_changes?.length ?? 0}건)`}>
                  {(cs.stackup_changes?.length ?? 0) === 0 ? (
                    <p className={s.hint}>변경 없음</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
                      {cs.stackup_changes!.map((c) => (
                        <div key={`${c.index}-${c.kind}`}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                            <span className="mono" style={{ fontWeight: 600 }}>
                              {c.layer_name ?? `#${c.index}`}
                            </span>
                            <KindBadge kind={c.kind} />
                          </div>
                          {c.fields?.length ? <FieldDiffList fields={c.fields} /> : null}
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
