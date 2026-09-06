import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, LIVE, fetchCatalog, fetchChangeSet, fetchRevision } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { ChangeKind, ComponentChange, NetChange, RevisionDetail } from "@/lib/cdm";
import { DataTable, type Column } from "@/components/DataTable";
import { EmptyState, ErrorState, Loading, Panel, Stat, StatGrid } from "@/components/ui";
import { formatCoarse, formatCount, formatFine, formatRouteLength, toDeg, toMm, NM_PER_UM } from "@/lib/units";
import { CompareBoards, type CompareView } from "./CompareBoards";
import { FieldDiffList, KindBadge, KindFilter, PinList } from "./ChangeBits";
import { PairPicker, RecentPairs, useRecentPairs } from "./PairPicker";
import s from "./compare.module.css";

type Tab = "summary" | "components" | "nets" | "stackup";

const THRESHOLDS_UM = [10, 25, 50, 100, 250, 500, 1000];

const VIA_KIND_LABEL: Record<string, string> = {
  through: "관통",
  blind: "블라인드",
  buried: "베리드",
  micro: "마이크로",
};

/**
 * 비아 스택 비교.
 *
 * 판이 어떤 비아를 쓸 수 있느냐는 층 구조 다음으로 큰 갈림이다. 관통만 뚫던 판에
 * 마이크로가 들어오면 HDI 공정이 붙고 값과 납기가 통째로 달라진다.
 *
 * 같은 종류라도 층 구간이 다르면 다른 스택이다 — L1–L10 관통과 L1–L4 관통은 뚫는
 * 깊이도 종횡비도 다르다. 그래서 종류와 구간을 함께 열쇠로 삼는다.
 */
function viaRows(a: RevisionDetail | null, b: RevisionDetail | null) {
  const key = (v: { kind: string; from_layer: number; to_layer: number }) =>
    `${v.kind}:${v.from_layer}-${v.to_layer}`;
  const mapA = new Map((a?.vias ?? []).map((v) => [key(v), v]));
  const mapB = new Map((b?.vias ?? []).map((v) => [key(v), v]));

  return [...new Set([...mapA.keys(), ...mapB.keys()])]
    .map((k) => {
      const va = mapA.get(k) ?? null;
      const vb = mapB.get(k) ?? null;
      const spec = vb ?? va!;
      return {
        key: k,
        kind: VIA_KIND_LABEL[spec.kind] ?? spec.kind,
        span: `L${spec.from_layer}–L${spec.to_layer}`,
        drill: spec.drill_nm,
        countA: va?.count ?? 0,
        countB: vb?.count ?? 0,
        change: !va ? ("added" as const) : !vb ? ("removed" as const) : null,
      };
    })
    .sort((x, y) => y.countB + y.countA - (x.countB + x.countA));
}

/** 늘었나 줄었나. 0 은 부호 없이 그냥 0 이다 — "+0" 은 변한 것처럼 읽힌다. */
const signed = (n: number) => (n === 0 ? "0" : `${n > 0 ? "+" : "−"}${formatCount(Math.abs(n))}`);

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
    {
      /* 행의 정체는 넷 이름이다. 배지가 먼저 서 있으면 "무엇이" 보다 "어떻게" 를 먼저
         읽게 되고, 목록을 훑을 때 눈이 이름을 찾아 한 칸 건너뛰어야 한다.

         A·B 두 칸으로 갈라 두었던 것도 하나로 합친다. 한 넷의 이름이 두 자리에 나뉘어
         있으면 같은 줄에서 무엇이 무엇으로 바뀐 것인지 눈으로 이어야 한다. */
      key: "name",
      header: "넷",
      /* 남는 폭을 이 칸에 주면 이름과 변경 배지가 화면 양끝으로 벌어진다. 짝지어 읽는
         둘이라 붙어 있어야 하고, 남는 폭은 아래의 핀 목록이 받는 편이 낫다. */
      width: "minmax(180px, 280px)",
      mono: true,
      strong: true,
      render: (n) =>
        n.name_a && n.name_b && n.name_a !== n.name_b ? (
          <span>
            {n.name_a} <span style={{ color: "var(--ink-4)" }}>→</span>{" "}
            <span style={{ color: "var(--accent-ink)", fontWeight: 600 }}>{n.name_b}</span>
          </span>
        ) : (
          (n.name_b ?? n.name_a ?? "—")
        ),
      sort: (a, b) =>
        (a.name_b ?? a.name_a ?? "").localeCompare(b.name_b ?? b.name_a ?? "", undefined, { numeric: true }),
      search: (n) => `${n.name_a ?? ""} ${n.name_b ?? ""}`,
    },
    {
      key: "kind",
      header: "변경",
      width: "104px",
      render: (n) => <KindBadge kind={n.kind} />,
      sort: (a, b) => a.kind.localeCompare(b.kind),
    },
    {
      key: "pins",
      header: "핀 변화",
      width: "minmax(200px, 1fr)",
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
  const [boardsExpanded, setBoardsExpanded] = useState(false);

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

  const [recent, dropRecent] = useRecentPairs(
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
  /**
   * 판 자체가 얼마나 달라졌나 — 두 리비전의 요약을 그대로 빼서 잰다.
   *
   * "바뀜/그대로" 같은 말 대신 부호 붙은 수로 적는다. 옆 칸들이 전부 수인데 여기만
   * 글이면 눈이 한 번 멈추고, 무엇보다 얼마나 바뀌었는지를 말하지 못한다.
   */
  const sumA = detailA.data?.revision.summary ?? null;
  const sumB = detailB.data?.revision.summary ?? null;
  const viaDelta = sumA && sumB ? sumB.via_total - sumA.via_total : null;
  /* 훅이 아니다 — 이 줄 위에 이른 반환이 있어서 useMemo 를 두면 렌더마다 훅 수가 달라진다.
     비아 스택은 서넛뿐이라 메모할 값도 아니다. */
  const vias = viaRows(detailA.data, detailB.data);
  const areaDelta = sumA && sumB ? sumB.area_mm2 - sumA.area_mm2 : null;
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
            {/* 손잡이를 끄는 동안 숫자가 한 자로만 이어져야 한다 — 도중에 단위가 바뀌면
                250 에서 500 으로 갔다가 갑자기 1 이 되어 눈금을 다시 읽게 된다. */}
            <span className={s.thresholdValue}>{(thresholdUm / 1000).toFixed(3)} mm</span>
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
          onDrop={dropRecent}
        />
      </header>

      <div className={s.body}>
        {!pairKey ? (
          <EmptyState
            title="비교할 두 보드를 선택하세요"
            body="위에서 A 와 B 를 각각 고릅니다. 보드를 고르면 최신 리비전이 들어오고, 그 옆에서 같은 보드의 다른 리비전으로 바꿀 수 있습니다. 같은 보드의 두 리비전, 그리고 다른 보드끼리 설계의 차이를 확인할 수 있습니다."
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
                  ["stackup", "적층 · 비아", (cs.stackup_changes?.length ?? 0) + vias.filter((v) => v.change || v.countA !== v.countB).length],
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
                      hint={`${(thresholdUm / 1000).toFixed(3)} mm 이상`}
                    />
                    <Stat label="부품 치환" value={formatCount(st.components_replaced)} hint="파트넘버 변경" />
                    <Stat label="넷 추가" value={formatCount(st.nets_added)} />
                    <Stat label="넷 삭제" value={formatCount(st.nets_removed)} />
                    {/* 판 자체가 얼마나 달라졌나. 부품 몇 개 옮긴 것과는 무게가 다른
                        변경이라 요약에 있어야 한다 — 비아가 늘면 드릴 값이 오르고,
                        외형이 바뀌면 기구가 통째로 다시 간다. */}
                    <Stat
                      label="비아"
                      value={viaDelta === null ? "—" : signed(viaDelta)}
                      hint={
                        sumA && sumB
                          ? `${formatCount(sumA.via_total)} → ${formatCount(sumB.via_total)}`
                          : undefined
                      }
                    />
                    <Stat
                      label="보드 형상"
                      value={areaDelta === null ? "—" : signed(Math.round(areaDelta))}
                      unit="mm²"
                      hint={
                        sumA && sumB
                          ? `${formatCount(Math.round(sumA.area_mm2))} → ${formatCount(Math.round(sumB.area_mm2))}`
                          : undefined
                      }
                    />
                  </StatGrid>
                  {!sameBoard && (
                    <p className={s.hint} style={{ marginTop: "var(--sp-3)" }}>
                      서로 다른 보드를 놓고 봅니다. 부품은 RefDes 로, 넷은 연결된 핀 집합으로 맞추므로 여기서 “변경”은
                      두 설계의 <b>차이</b>를 뜻합니다 — 같은 자리를 지킨 항목이 두 판의 공통 부분입니다.
                      {trimmed && ` 항목이 많아 목록은 종류·크기 순으로 ${formatCount(cs.list_limit!)}건까지만 싣습니다. 위 집계는 전체 건수입니다.`}
                    </p>
                  )}
                </Panel>

                <Panel
                  title="비교 뷰어"
                  action={
                    /* 확장은 패널 전체를 화면 가득 펼치는 일이라 패널 머리에 둔다. 나란히·
                       겹쳐보기·라벨은 판을 어떻게 그릴지에 대한 것이라 판 위 도구 막대로
                       내려보냈다 — 배치·동박·면 고르기와 같은 줄에 있어야 손이 짧다. */
                    <span className={s.filters}>
                      <button
                        type="button"
                        className={s.filterChip}
                        title="화면 전체로 넓히기"
                        onClick={() => setBoardsExpanded(true)}
                      >
                        ⤢ 확장
                      </button>
                    </span>
                  }
                >
                  <CompareBoards
                    view={boardView}
                    onViewChange={setBoardView}
                    labels={boardLabels}
                    onLabelsChange={setBoardLabels}
                    expanded={boardsExpanded}
                    onExpandedChange={setBoardsExpanded}
                    changes={components}
                    detailA={detailA.data}
                    detailB={detailB.data}
                    labelA={labelA}
                    labelB={labelB}
                    height={460}
                  />
                  {/* 나란히 보기는 눌러 보면 아는 것들이라 적지 않는다. 겹쳐보기는
                      파선과 채움이 무엇을 뜻하는지 그림만 봐서는 알 수 없어 남긴다. */}
                  {boardView === "overlay" && (
                    <p className={s.hint} style={{ marginTop: "var(--sp-3)" }}>
                      이전 위치는 파선, 이후 위치는 채움입니다. 미세한 이동을 확인할 때는 겹쳐 놓는 편이 정확하지만,
                      판이 둘 다 보이지 않아 넓은 범위의 변화는 놓치기 쉽습니다.
                    </p>
                  )}
                </Panel>

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

                <Panel title="비아">
                  {/* 어떤 비아를 쓸 수 있느냐가 층 구조 다음으로 큰 갈림이다. 관통만
                      뚫던 판에 마이크로가 들어오면 HDI 공정이 붙고 값과 납기가 통째로
                      달라진다. 종류마다 몇 개 뚫었는지의 증감까지 함께 본다. */}
                  <dl className={s.viaType}>
                    <dt>비아 타입</dt>
                    <dd>
                      <span className="mono">—</span> → <span className="mono">—</span>
                      <span className={s.viaTypeNote}>All stack · B Type 등 · 설계 데이터에서 읽어 올 값</span>
                    </dd>
                  </dl>

                  {vias.length === 0 ? (
                    <p className={s.hint}>비아 정보가 없습니다.</p>
                  ) : (
                    <div className={s.viaList}>
                      <div className={`${s.viaRow} ${s.viaHead}`}>
                        <span>종류</span>
                        <span>구간</span>
                        <span>드릴</span>
                        <span>A</span>
                        <span>B</span>
                        <span>증감</span>
                      </div>
                      {vias.map((v) => (
                        <div key={v.key} className={s.viaRow}>
                          <span>
                            {v.kind}
                            {v.change && <KindBadge kind={v.change} />}
                          </span>
                          <span className="mono">{v.span}</span>
                          <span className="mono">{formatFine(v.drill)}</span>
                          <span className="mono">{formatCount(v.countA)}</span>
                          <span className="mono">{formatCount(v.countB)}</span>
                          <b className="mono">{signed(v.countB - v.countA)}</b>
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
