import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchChangeSet, fetchChangeSetIndex, fetchRevision } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { ChangeKind, ChangeSetRef, ComponentChange, NetChange } from "@/lib/cdm";
import { DataTable, type Column } from "@/components/DataTable";
import { EmptyState, ErrorState, Loading, Panel, Stat, StatGrid } from "@/components/ui";
import { formatCoarse, formatCount, formatRouteLength, toDeg, toMm, NM_PER_UM } from "@/lib/units";
import { CompareBoards, type CompareView } from "./CompareBoards";
import { FieldDiffList, KindBadge, KindFilter, PinList } from "./ChangeBits";
import s from "./compare.module.css";

type Tab = "summary" | "components" | "nets" | "stackup";

const THRESHOLDS_UM = [10, 25, 50, 100, 250, 500, 1000];

/* ── 좌측 목록 ─────────────────────────────── */

function Picker({
  pairs,
  selected,
  onSelect,
}: {
  pairs: ChangeSetRef[];
  selected: string | null;
  onSelect: (ref: ChangeSetRef) => void;
}) {
  const revisions = pairs.filter((p) => p.kind === "revision");
  const generations = pairs.filter((p) => p.kind === "generation");

  const byBoard = useMemo(() => {
    const map = new Map<string, ChangeSetRef[]>();
    for (const p of revisions) {
      const list = map.get(p.board_key) ?? [];
      list.push(p);
      map.set(p.board_key, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [revisions]);

  const item = (p: ChangeSetRef) => {
    const key = `${p.revision_a_id}__${p.revision_b_id}`;
    const st = p.stats;
    const comp = st.components_added + st.components_removed + st.components_moved + st.components_replaced;
    const net = st.nets_added + st.nets_removed + st.nets_renamed + st.nets_rewired;
    const total = Math.max(comp + net, 1);
    return (
      <button
        key={key}
        type="button"
        className={`${s.pickerItem} ${selected === key ? s.pickerItemOn : ""}`}
        onClick={() => onSelect(p)}
      >
        <span className={s.pickerPair}>
          <span className={`${s.side} ${s.sideA}`}>{p.label_a}</span>
          <span className={s.arrow}>→</span>
          <span className={`${s.side} ${s.sideB}`}>{p.label_b}</span>
        </span>
        <span className={s.pickerCounts}>
          부품 {formatCount(comp)} · 넷 {formatCount(net)}
          {st.layers_changed > 0 && ` · 적층 ${st.layers_changed}`}
        </span>
        {/* 변경 규모를 한 줄로 — 목록에서 "어느 리비전이 많이 바뀌었나"를 먼저 본다 */}
        <span className={s.pickerMag}>
          <i className={s.pickerMagSeg} style={{ width: `${(comp / total) * 100}%`, background: "var(--accent)" }} />
          <i className={s.pickerMagSeg} style={{ width: `${(net / total) * 100}%`, background: "var(--info)" }} />
        </span>
      </button>
    );
  };

  return (
    <aside className={s.picker} aria-label="비교 목록">
      {generations.length > 0 && (
        <div className={s.pickerGroup}>
          <div className={s.pickerLabel}>
            <span>세대 비교</span>
            <span>{generations.length}</span>
          </div>
          {generations.map(item)}
        </div>
      )}
      <div className={s.pickerGroup}>
        <div className={s.pickerLabel}>
          <span>리비전 비교</span>
          <span>{revisions.length}</span>
        </div>
      </div>
      {byBoard.map(([boardKey, list]) => (
        <div className={s.pickerGroup} key={boardKey}>
          <div className={s.pickerBoard}>{boardKey}</div>
          {list.map(item)}
        </div>
      ))}
    </aside>
  );
}

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

  const index = useAsync(fetchChangeSetIndex, []);

  const a = params.get("a");
  const b = params.get("b");
  const pairKey = a && b ? `${a}__${b}` : null;

  const changeset = useAsync(
    () => (a && b ? fetchChangeSet(a, b) : Promise.resolve(null)),
    [a, b],
  );

  // 두 판을 각자 그리려면 각자의 부품 목록이 필요하다. ChangeSet 은 바뀐 것만 담는다.
  const details = useAsync(
    () => (a && b ? Promise.all([fetchRevision(a), fetchRevision(b)]) : Promise.resolve(null)),
    [a, b],
  );

  const ref = useMemo(
    () => index.data?.pairs.find((p) => p.revision_a_id === a && p.revision_b_id === b) ?? null,
    [index.data, a, b],
  );


  // 임계값은 미리 계산된 10 µm 위로만 올릴 수 있다. 내리려면 서버가 다시 계산해야 한다.
  const components = useMemo(() => {
    const all = changeset.data?.component_changes ?? [];
    const min = thresholdUm * NM_PER_UM;
    return all.filter((c) => c.kind !== "moved" || (c.distance_nm ?? 0) >= min);
  }, [changeset.data, thresholdUm]);

  const nets = changeset.data?.net_changes ?? [];

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

  const select = (r: ChangeSetRef) => {
    setParams({ a: r.revision_a_id, b: r.revision_b_id, tab, boards: boardView });
    setCompKind(null);
    setNetKind(null);
  };

  if (index.loading) return <Loading label="비교 목록을 불러오는 중" />;
  if (index.error) return <ErrorState error={index.error} />;

  const cs = changeset.data;
  const st = cs?.stats;

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>비교</h1>
        {ref ? (
          <span className={s.pairLabel}>
            <span className={`${s.side} ${s.sideA}`}>{ref.label_a}</span>
            <span className={s.arrow}>→</span>
            <span className={`${s.side} ${s.sideB}`}>{ref.label_b}</span>
            <span style={{ color: "var(--ink-3)", fontSize: "var(--fs-sm)" }}>{ref.board_name}</span>
          </span>
        ) : (
          <span style={{ color: "var(--ink-3)", fontSize: "var(--fs-sm)" }}>
            왼쪽에서 비교할 조합을 고르세요
          </span>
        )}
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
      </header>

      <Picker pairs={index.data?.pairs ?? []} selected={pairKey} onSelect={select} />

      <div className={s.body}>
        {!pairKey ? (
          <EmptyState
            title="비교할 두 리비전을 고르세요"
            body="왼쪽 목록은 이미 계산되어 캐시된 비교입니다. 같은 보드의 리비전 쌍과, 같은 계열 다음 세대 보드와의 비교가 들어 있습니다."
          />
        ) : changeset.loading ? (
          <Loading label="변경 내역을 계산 결과에서 불러오는 중" />
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
                    detailA={details.data?.[0] ?? null}
                    detailB={details.data?.[1] ?? null}
                    labelA={ref?.label_a ?? "A"}
                    labelB={ref?.label_b ?? "B"}
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
