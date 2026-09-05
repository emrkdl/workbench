import type { LayerRole, RevisionDetail, StackupLayer } from "@/lib/cdm";
import { Bar, Field, Fields, Panel, SeverityTag, Stat, StatGrid } from "@/components/ui";
import { BoardFigure } from "@/components/BoardFigure";
import {
  formatArea,
  formatCoarse,
  formatCount,
  formatDimensions,
  formatFine,
  formatRouteLength,
} from "@/lib/units";
import { conductorNumbers, isConductor, ROLE_COLOR, ROLE_LABEL } from "./layers";
import s from "./revision.module.css";

/** 상위 n개만 막대로 보여주고 나머지는 "기타"로 접는다. 꼬리가 길어 전부 그리면 못 읽는다. */
function TopBreakdown({ counts, limit = 6 }: { counts: Record<string, number>; limit?: number }) {
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, limit);
  const rest = sorted.slice(limit).reduce((sum, [, v]) => sum + v, 0);
  const max = top[0]?.[1] ?? 1;

  return (
    <div className={s.miniList}>
      {top.map(([name, count]) => (
        <div key={name} className={s.miniRow}>
          <span>{name}</span>
          <b>{formatCount(count)}</b>
          <div className={s.miniBar}>
            <div className={s.miniBarFill} style={{ width: `${(count / max) * 100}%` }} />
          </div>
        </div>
      ))}
      {rest > 0 && (
        <div className={s.miniRow}>
          <span style={{ color: "var(--ink-4)" }}>기타 {sorted.length - limit}종</span>
          <b>{formatCount(rest)}</b>
        </div>
      )}
    </div>
  );
}

/** 좁은 판에 들어갈 짧은 이름. 단면도 탭의 긴 이름("GND 플레인")은 여기서 줄이 넘친다. */
const STACK_LABEL: Partial<Record<LayerRole, string>> = {
  signal: "신호",
  plane_power: "전원",
  plane_gnd: "GND",
  mixed: "혼합",
};

/**
 * 층 구성 — 도체층을 쌓인 순서대로.
 *
 * 예전에는 "신호 6 · 플레인 4" 를 막대 하나로 보여 줬는데, 그 숫자로는 **어느 자리**가
 * 플레인인지 알 수 없었다. 적층에서 중요한 것은 개수가 아니라 순서다 — 신호층이 GND 를
 * 사이에 두고 있는지, 전원과 GND 가 붙어 있는지가 판의 성질을 정한다.
 *
 * 실크·마스크·유전체는 뺐다. 여기서 묻는 것은 "무엇이 어디를 지나가나"이고 그 답은
 * 동박층에만 있다. 두께를 보러 왔다면 적층 탭에 단면도가 그대로 있다.
 *
 * 여기 적는 것은 층 이름과 역할뿐이다. 한때 동박 면적률 막대와 임피던스 값을 함께
 * 두었는데 둘 다 실제 값이 아니었다 — 면적률은 그럴듯한 범위의 난수였고 임피던스는
 * 모든 신호층에 박아 넣은 상수라 아무것도 구분하지 못했다.
 *
 * 둘 다 언젠가 진짜로 채울 수 있다. 면적률은 층 형상(.blg)의 플레인·트레이스·패드
 * 넓이를 판 넓이로 나누면 나오고, 그 계산은 실장률처럼 넣을 때 한 번 해 두는 것이
 * 맞다. 임피던스는 계산이 아니라 설계자가 적층에 정해 둔 값이므로 파서가 읽어 와야
 * 한다. 그때까지는 자리를 비워 둔다.
 */
function LayerStack({ stackup }: { stackup: StackupLayer[] }) {
  const numbers = conductorNumbers(stackup);
  const rows = stackup.filter(isConductor);

  return (
    <div className={s.stack}>
      {rows.map((l) => (
        <div key={l.index} className={s.stackRow} title={`${l.name} · ${ROLE_LABEL[l.role]}`}>
          <span className={s.stackNo}>L{numbers.get(l.index)}</span>
          {/* 띠의 색이 곧 정보다. 열 줄을 훑으면 신호-GND-신호-신호-GND-전원 하는
              결이 한눈에 잡히고, 그것이 이 판에서 적층에 대해 말할 수 있는 전부다. */}
          <span
            className={s.stackBand}
            style={{
              background: `color-mix(in srgb, ${ROLE_COLOR[l.role]} 30%, transparent)`,
              borderColor: ROLE_COLOR[l.role],
            }}
          >
            <b style={{ color: ROLE_COLOR[l.role] }}>{STACK_LABEL[l.role] ?? ROLE_LABEL[l.role]}</b>
          </span>
        </div>
      ))}
    </div>
  );
}

export function OverviewTab({ detail }: { detail: RevisionDetail }) {
  const { revision, design_rules: rules } = detail;
  const sm = revision.summary;
  /** 가장 나중 리비전. 지금 보고 있는 것이 옛 리비전일 수 있으므로 따로 찾는다. */
  const latest = detail.lineage.reduce<(typeof detail.lineage)[number] | null>(
    (a, b) => (a && a.created_at >= b.created_at ? a : b),
    null,
  );

  const sideSlices = [
    { label: "Top", value: sm.component_top_count, color: "var(--accent)" },
    { label: "Bottom", value: sm.component_bottom_count, color: "var(--info)" },
  ].filter((x) => x.value > 0);

  const viaSlices = Object.entries(sm.via_by_kind).map(([kind, count], i) => ({
    label: { through: "관통", blind: "블라인드", buried: "베리드", micro: "마이크로" }[kind] ?? kind,
    value: count,
    color: ["var(--ink-3)", "var(--accent)", "var(--info)", "var(--warn)"][i] ?? "var(--line-2)",
  }));

  return (
    <div className={s.overview}>
      <div className={s.col}>
        <Panel title="요약">
          {/* 윗줄은 판 자체 — 어떻게 생겼고 어떻게 만들고 몇 번을 고쳤나.
              아랫줄은 그 위에 실린 것 — 부품·핀·넷·비아. 여덟 개를 한 줄로 늘어놓으면
              성격이 다른 숫자들이 섞여 눈이 어디서 끊어야 할지 모른다. */}
          <StatGrid cols={4}>
            {/* 신호/플레인 개수는 바로 아래 층 구성이 순서까지 보여 주므로 중복이다.
                두께가 층수와 한 쌍이다 — 제조사가 함께 묻는 값이고, 층수가 같아도
                두께가 다르면 층 사이 간격이 달라 다른 판이 된다. */}
            <Stat label="층수" value={sm.layer_count} hint={formatCoarse(sm.board_thickness_nm)} />
            <Stat
              label="면적"
              value={sm.area_mm2.toFixed(0)}
              unit="mm²"
              hint={formatDimensions(sm.width_nm, sm.height_nm)}
            />
            {/* 비아 스택 구성. 설계 데이터에서 읽어 올 값이고 아직 연결되지 않았다. */}
            <Stat label="비아 타입" value="—" hint="All stack · B Type 등" />
            {/* 몇 번을 고쳐 온 판인가. 리비전이 하나뿐인 판과 여섯 번 돈 판은 같은
                크기라도 다른 물건이다 — 뒤엣것은 그만큼 손이 많이 간 자리가 있다. */}
            <Stat
              label="리비전"
              value={detail.lineage.length}
              hint={latest ? `최종 ${latest.label}` : undefined}
            />

            <Stat
              label="부품"
              value={formatCount(sm.component_count)}
              hint={`Top ${sm.component_top_count} · Bot ${sm.component_bottom_count}`}
            />
            <Stat label="핀" value={formatCount(sm.pin_count)} hint={`BGA ${sm.bga_count}개`} />
            {/* 넷 수는 판이 얼마나 얽혀 있는지를 말하고, 배선 길이는 그 얽힘이 실제로
                얼마나 그어졌는지를 말한다. 둘은 따로 논다 — 넷이 적어도 길게 돌아가는
                판이 있고 그 반대도 있다. */}
            <Stat
              label="넷"
              value={formatCount(sm.net_count)}
              hint={formatRouteLength(sm.total_route_length_nm)}
            />
            {/* GND 비아 수는 형상 버퍼에만 있고 요약에는 아직 없다. 자리만 잡아 둔다. */}
            <Stat label="비아" value={formatCount(sm.via_total)} hint="GND nn개" />
          </StatGrid>
        </Panel>

        <div className={s.twoUp}>
          <Panel title="식별">
            {/* 왼쪽은 이번 리비전에서 무엇을 고쳤나, 오른쪽은 이 판이 무엇인가.
                고친 내용을 먼저 읽는 자리에 둔다 — 같은 판의 리비전을 여럿 열어 놓고
                오갈 때 알고 싶은 것은 모델명이 아니라 무엇이 달라졌나이다. */}
            <div className={s.identGrid}>
              <div className={s.identNotes}>
                <span className={s.identLabel}>수정사항</span>
                {revision.note ? (
                  <p className={s.identNote}>{revision.note}</p>
                ) : (
                  /* 아직 여러 줄로 적어 두는 자리가 없다. 리비전마다 무엇을 고쳐야 하고
                     무엇을 고쳤는지가 여기 쌓이면, 리비전 목록이 곧 변경 이력이 된다. */
                  <p className={s.identEmpty}>적힌 수정사항이 없습니다</p>
                )}
              </div>

              <Fields tight>
                <Field label="모델명">
                  <span className="mono">{revision.board_key}</span>
                </Field>
                <Field label="리비전">{revision.label}</Field>
                <Field label="제품군">{detail.product_family}</Field>
                {/* 의뢰자와 의뢰일은 아직 어디에도 없다. 의뢰라는 개념 자체가 설계 데이터에
                    들어 있지 않고, 사람이 시스템에 적어 넣어야 생기는 값이다. 자리만 잡아 둔다. */}
                <Field label="의뢰자">—</Field>
                <Field label="의뢰일">—</Field>
                <Field label="설계자">{revision.author}</Field>
                <Field label="등록일">{revision.created_at.slice(0, 10)}</Field>
              </Fields>
            </div>
          </Panel>

          <Panel title="물리 · 제조">
            <Fields tight>
              <Field label="외형 치수">{formatDimensions(sm.width_nm, sm.height_nm)}</Field>
              <Field label="면적">{formatArea(sm.area_mm2)}</Field>
              <Field label="보드 두께">{formatCoarse(sm.board_thickness_nm)}</Field>
              <Field label="최소 선폭">{formatFine(rules.min_trace_width_nm)}</Field>
              <Field label="최소 간격">{formatFine(rules.min_clearance_nm)}</Field>
            </Fields>
          </Panel>
        </div>

        <div className={s.twoUp}>
          <Panel title="패키지 분포">
            <TopBreakdown counts={sm.package_counts} />
          </Panel>
          <Panel title="배선">
            <Fields>
              <Field label="총 배선 길이">{formatRouteLength(sm.total_route_length_nm)}</Field>
              <Field label="차동쌍">{sm.diff_pair_count}쌍</Field>
              <Field label="전원 넷">{sm.power_net_count}개</Field>
              <Field label="미배선">
                {sm.unrouted_count > 0 ? (
                  <span style={{ color: "var(--crit)", fontWeight: 600 }}>{sm.unrouted_count}개</span>
                ) : (
                  "없음"
                )}
              </Field>
              <Field label="비아 총수">{formatCount(sm.via_total)}</Field>
              <Field label="홀 총수">{formatCount(sm.hole_count)}</Field>
            </Fields>
            {viaSlices.length > 1 && (
              <div style={{ marginTop: "var(--sp-4)" }}>
                <Bar slices={viaSlices} />
              </div>
            )}
          </Panel>
        </div>

        {/* 제조 탭이 없어지면서 갈 곳을 잃은 DRC 지적 목록. 요약의 지적 건수 옆에
            "무엇이 걸렸나"가 없으면 그 숫자로 할 수 있는 일이 없다. */}
        {(detail.drc_findings?.length ?? 0) > 0 && (
          <Panel
            title="DRC 지적"
            action={
              <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-4)" }}>
                CAD 툴이 낸 결과를 표시만 합니다 — 재실행하지 않습니다
              </span>
            }
            flush
          >
            <div className={s.records}>
              {detail.drc_findings!.map((f, i) => (
                <div className={s.record} key={i}>
                  <SeverityTag severity={f.severity} />
                  <span className={s.recordMsg}>
                    <b style={{ color: "var(--ink)" }}>{f.rule}</b> — {f.message}
                    {f.refdes && <span className="mono" style={{ color: "var(--ink-4)" }}> · {f.refdes}</span>}
                    {f.net_name && <span className="mono" style={{ color: "var(--ink-4)" }}> · {f.net_name}</span>}
                  </span>
                  <span className={s.recordMeta}>{f.layer_index ? `L${f.layer_index}` : ""}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {(detail.warnings?.length ?? 0) > 0 && (
          <Panel title="인제스트 경고" flush>
            <div className={s.records}>
              {detail.warnings!.map((w, i) => (
                <div className={s.record} key={i}>
                  <SeverityTag severity={w.severity} />
                  <span className={s.recordMsg}>
                    {w.message} <span className="mono" style={{ color: "var(--ink-4)" }}>({w.code})</span>
                  </span>
                  <span className={s.recordMeta}>{w.count}건</span>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>

      <div className={s.col}>
        <Panel title="배치">
          <div className={s.shapeBox}>
            {/* 여기서는 부품 전체를 그린다 — 상세 화면은 이미 목록을 들고 있다. */}
            <BoardFigure outline={detail.outline} components={detail.components} height={210} />
          </div>
          <div style={{ marginTop: "var(--sp-3)" }}>
            <Fields>
              <Field label="치수">{formatDimensions(sm.width_nm, sm.height_nm)}</Field>
              <Field label="면적">{formatArea(sm.area_mm2)}</Field>
              <Field label="부품">{formatCount(sm.component_count)}개</Field>
            </Fields>
          </div>
        </Panel>

        <Panel title="실장률">
          <Stat
            label="전체"
            value={sm.mount_ratio_pct.toFixed(1)}
            unit="%"
            hint="부품 몸통이 기판을 덮는 비율"
          />
          {/* 막대의 전체 길이가 기판 면적이다. 두 조각의 합이 실장률이고 남는 자리가 빈 면적 —
              분모가 양면 다 같은 기판이라 TOP 과 BOTTOM 을 그대로 이어 붙일 수 있다. */}
          <div className={s.mountBar} style={{ marginTop: "var(--sp-3)" }}>
            <div
              className={s.mountTop}
              style={{ width: `${Math.min(sm.mount_ratio_top_pct, 100)}%` }}
              title={`TOP ${sm.mount_ratio_top_pct.toFixed(1)}%`}
            />
            <div
              className={s.mountBottom}
              style={{ width: `${Math.min(sm.mount_ratio_bottom_pct, 100 - sm.mount_ratio_top_pct)}%` }}
              title={`BOTTOM ${sm.mount_ratio_bottom_pct.toFixed(1)}%`}
            />
          </div>
          <div className={s.mountLegend}>
            <span>
              <i className={s.mountTop} />
              TOP <b className="tnum">{sm.mount_ratio_top_pct.toFixed(1)}%</b>
              <em>{formatCount(sm.component_top_count)}개</em>
            </span>
            <span>
              <i className={s.mountBottom} />
              BOTTOM <b className="tnum">{sm.mount_ratio_bottom_pct.toFixed(1)}%</b>
              <em>{formatCount(sm.component_bottom_count)}개</em>
            </span>
            <span className={s.mountFree}>
              빈 자리 <b className="tnum">{Math.max(100 - sm.mount_ratio_pct, 0).toFixed(1)}%</b>
            </span>
          </div>
        </Panel>

        <Panel title="부품 배치 면">
          <Bar slices={sideSlices} />
        </Panel>

        <Panel title="층 구성">
          <LayerStack stackup={detail.stackup} />
          <p className={s.stackNote}>
            층별로 어떤 넷이 얼마나 지나가는지는 아직 세어 두지 않았습니다. 지금 말할 수
            있는 것은 쌓인 순서와 층의 역할까지입니다.
          </p>
        </Panel>
      </div>
    </div>
  );
}
