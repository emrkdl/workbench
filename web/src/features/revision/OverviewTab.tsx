import type { RevisionDetail } from "@/lib/cdm";
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
import { ROLE_COLOR } from "./layers";
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

export function OverviewTab({ detail }: { detail: RevisionDetail }) {
  const { revision, design_rules: rules } = detail;
  const sm = revision.summary;

  const layerSlices = [
    { label: "신호", value: sm.signal_layer_count, color: ROLE_COLOR.signal },
    { label: "플레인", value: sm.plane_layer_count, color: ROLE_COLOR.plane_gnd },
  ].filter((x) => x.value > 0);

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
              <Field label="설계자">{revision.author}</Field>
              <Field label="설계일">{revision.designed_at?.slice(0, 10)}</Field>
              <Field label="CAD 툴">
                {revision.source_tool} {revision.source_version}
              </Field>
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

        <Panel title="층 구성">
          <Bar slices={layerSlices} />
        </Panel>

        <Panel title="부품 배치 면">
          <Bar slices={sideSlices} />
        </Panel>
      </div>
    </div>
  );
}
