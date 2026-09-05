import type { LayerRole, RevisionDetail, StackupLayer } from "@/lib/cdm";
import { Bar, Field, Fields, Panel, SeverityTag, Stat, StatGrid, Tag } from "@/components/ui";
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
 * 층 구성 — 도체층만 쌓아 놓고 각 층이 무엇을 나르는지 적는다.
 *
 * 예전에는 "신호 6 · 플레인 4" 를 막대 하나로 보여 줬는데, 그 숫자로는 **어느 자리**가
 * 플레인인지 알 수 없었다. 적층에서 중요한 것은 개수가 아니라 순서다 — 신호층이 GND 를
 * 사이에 두고 있는지, 전원과 GND 가 붙어 있는지가 판의 성질을 정한다.
 *
 * 실크·마스크·유전체는 뺐다. 여기서 묻는 것은 "무엇이 어디를 지나가나"이고 그 답은
 * 동박층에만 있다. 두께를 보러 왔다면 적층 탭에 단면도가 그대로 있다.
 *
 * 막대는 동박 면적률이다. 이것이 이 판에서 "층에 무엇이 깔려 있나"에 가장 가까운 실제
 * 값이다 — 플레인은 거의 꽉 차고 신호층은 성기다. 넷 이름이나 넷 클래스를 층별로 세어
 * 둔 값은 아직 없어서, 있는 척하지 않고 역할과 임피던스까지만 적는다.
 */
function LayerStack({ stackup }: { stackup: StackupLayer[] }) {
  const numbers = conductorNumbers(stackup);
  const rows = stackup.filter(isConductor);

  return (
    <div className={s.stack}>
      {rows.map((l) => {
        const ratio = l.copper_area_ratio;
        const imp = l.impedance_single_ohm;
        return (
          <div
            key={l.index}
            className={s.stackRow}
            title={`${l.name} · ${ROLE_LABEL[l.role]}${ratio != null ? ` · 동박 ${Math.round(ratio * 100)}%` : ""}${imp != null ? ` · ${imp}Ω` : ""}`}
          >
            <span className={s.stackNo}>L{numbers.get(l.index)}</span>
            <span className={s.stackFill}>
              <i
                style={{
                  width: `${Math.round((ratio ?? 0) * 100)}%`,
                  background: ROLE_COLOR[l.role],
                }}
              />
            </span>
            <span className={s.stackRole} style={{ color: ROLE_COLOR[l.role] }}>
              {STACK_LABEL[l.role] ?? ROLE_LABEL[l.role]}
            </span>
            {/* 임피던스를 관리하는 층에는 빠른 신호가 지난다. 어느 층이 "주요"인지를
                이 판에서 짐작할 수 있는 유일한 실제 값이다. */}
            <span className={s.stackImp}>{imp != null ? `${imp}Ω` : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

export function OverviewTab({ detail }: { detail: RevisionDetail }) {
  const { revision, design_rules: rules } = detail;
  const sm = revision.summary;

  const sideSlices = [
    { label: "Top", value: sm.component_top_count, color: "var(--accent)" },
    { label: "Bottom", value: sm.component_bottom_count, color: "var(--info)" },
  ].filter((x) => x.value > 0);

  const viaSlices = Object.entries(sm.via_by_kind).map(([kind, count], i) => ({
    label: { through: "관통", blind: "블라인드", buried: "베리드", micro: "마이크로" }[kind] ?? kind,
    value: count,
    color: ["var(--ink-3)", "var(--accent)", "var(--info)", "var(--warn)"][i] ?? "var(--line-2)",
  }));

  const drcTotal = sm.drc_error_count + sm.drc_warning_count;

  return (
    <div className={s.overview}>
      <div className={s.col}>
        <Panel title="요약">
          <StatGrid cols={4}>
            <Stat label="층수" value={sm.layer_count} hint={`신호 ${sm.signal_layer_count} · 플레인 ${sm.plane_layer_count}`} />
            <Stat label="부품" value={formatCount(sm.component_count)} hint={`Top ${sm.component_top_count} · Bot ${sm.component_bottom_count}`} />
            <Stat label="핀" value={formatCount(sm.pin_count)} hint={`BGA ${sm.bga_count}개`} />
            <Stat label="넷" value={formatCount(sm.net_count)} hint={`차동 ${sm.diff_pair_count}쌍`} />
            <Stat label="면적" value={sm.area_mm2.toFixed(0)} unit="mm²" hint={formatDimensions(sm.width_nm, sm.height_nm)} />
            <Stat label="배치 밀도" value={sm.density_per_cm2.toFixed(1)} unit="/cm²" hint="부품 수 ÷ 면적" />
            <Stat label="복잡도" value={sm.complexity_score} tone="accent" hint="0–100 상대 지표" />
            <Stat
              label="DRC"
              value={drcTotal}
              tone={sm.drc_error_count > 0 ? "crit" : undefined}
              hint={drcTotal === 0 ? "지적 없음" : `오류 ${sm.drc_error_count} · 경고 ${sm.drc_warning_count}`}
            />
          </StatGrid>
        </Panel>

        <div className={s.twoUp}>
          <Panel title="식별">
            <Fields>
              <Field label="보드 코드">
                <span className="mono">{revision.board_key}</span>
              </Field>
              <Field label="파트넘버">{detail.part_number}</Field>
              <Field label="리비전">{revision.label}</Field>
              <Field label="프로젝트">{detail.project_key}</Field>
              <Field label="제품군">{detail.product_family}</Field>
              <Field label="설계일">{revision.designed_at?.slice(0, 10)}</Field>
              <Field label="파서 버전">
                <span className="mono">{revision.parser_version}</span>
              </Field>
            </Fields>
          </Panel>

          <Panel title="물리 · 제조">
            <Fields>
              <Field label="외형 치수">{formatDimensions(sm.width_nm, sm.height_nm)}</Field>
              <Field label="면적">{formatArea(sm.area_mm2)}</Field>
              <Field label="형상">
                {sm.outline_kind === "rectangular" ? "직사각" : "이형"}
                {sm.cutout_count > 0 && ` · 컷아웃 ${sm.cutout_count}`}
              </Field>
              <Field label="보드 두께">{formatCoarse(sm.board_thickness_nm)}</Field>
              <Field label="표면 처리">{detail.surface_finish}</Field>
              <Field label="최소 선폭">{formatFine(rules.min_trace_width_nm)}</Field>
              <Field label="최소 간격">{formatFine(rules.min_clearance_nm)}</Field>
              <Field label="최소 드릴">{formatFine(rules.min_drill_nm)}</Field>
              <Field label="최대 종횡비">{rules.max_aspect_ratio ? `${rules.max_aspect_ratio} : 1` : null}</Field>
              <Field label="BGA 최소 피치">{sm.min_bga_pitch_nm ? formatFine(sm.min_bga_pitch_nm) : null}</Field>
              <Field label="특수 공정">
                {detail.special_processes.length ? (
                  <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                    {detail.special_processes.map((p) => (
                      <Tag key={p} accent>
                        {p}
                      </Tag>
                    ))}
                  </span>
                ) : null}
              </Field>
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
            막대는 동박 면적률입니다. 넷 이름과 넷 클래스를 층별로 갈라 놓은 값은 아직
            없어서, 역할과 임피던스까지만 적었습니다.
          </p>
        </Panel>
      </div>
    </div>
  );
}
