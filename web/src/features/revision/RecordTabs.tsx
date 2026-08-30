import { Link } from "react-router-dom";
import type { RevisionDetail } from "@/lib/cdm";
import { EmptyState, Field, Fields, Panel, SeverityTag, Tag } from "@/components/ui";
import { formatBytes, formatCoarse, formatCount, formatFine } from "@/lib/units";
import { comparePath, revisionPath } from "@/lib/routes";
import s from "./revision.module.css";

const VIA_LABEL: Record<string, string> = {
  through: "관통",
  blind: "블라인드",
  buried: "베리드",
  micro: "마이크로",
};
const DRILL_LABEL: Record<string, string> = {
  via: "비아",
  mounting: "체결",
  tooling: "툴링",
  component: "부품",
};

export function ManufacturingTab({ detail }: { detail: RevisionDetail }) {
  const rules = detail.design_rules;
  const findings = detail.drc_findings ?? [];

  return (
    <div className={s.col}>
      <div className={s.twoUp}>
        <Panel title="설계 룰">
          <Fields>
            <Field label="최소 선폭">{formatFine(rules.min_trace_width_nm)}</Field>
            <Field label="최소 간격">{formatFine(rules.min_clearance_nm)}</Field>
            <Field label="최소 드릴">{formatFine(rules.min_drill_nm)}</Field>
            <Field label="최소 애뉼러 링">
              {rules.min_annular_ring_nm ? formatFine(rules.min_annular_ring_nm) : null}
            </Field>
            <Field label="최대 종횡비">{rules.max_aspect_ratio ? `${rules.max_aspect_ratio} : 1` : null}</Field>
            <Field label="BGA 최소 피치">{rules.min_bga_pitch_nm ? formatFine(rules.min_bga_pitch_nm) : null}</Field>
            <Field label="보드 두께">{formatCoarse(detail.revision.summary.board_thickness_nm)}</Field>
            <Field label="표면 처리">{detail.surface_finish}</Field>
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

        <Panel title="비아" flush>
          <div className={s.records}>
            {detail.vias.map((v, i) => (
              <div className={s.record} key={i}>
                <Tag accent={v.kind !== "through"}>{VIA_LABEL[v.kind] ?? v.kind}</Tag>
                <span className={s.recordMsg}>
                  L{v.from_layer}–L{v.to_layer} · 드릴 {formatFine(v.drill_nm)} · 패드 {formatFine(v.pad_nm)}
                </span>
                <span className={s.recordMeta}>{formatCount(v.count)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="드릴 표" flush>
        <div className={s.records}>
          {detail.drills.map((d, i) => (
            <div className={s.record} key={i}>
              <Tag>{DRILL_LABEL[d.kind] ?? d.kind}</Tag>
              <span className={s.recordMsg}>
                Ø {formatFine(d.diameter_nm)} · {d.plated ? "도금(PTH)" : "비도금(NPTH)"}
              </span>
              <span className={s.recordMeta}>{formatCount(d.count)}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="DRC 결과"
        action={
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-4)" }}>
            CAD 툴이 낸 결과를 표시만 합니다 — 재실행하지 않습니다
          </span>
        }
        flush
      >
        {findings.length === 0 ? (
          <EmptyState title="지적 사항 없음" body="이 리비전에는 기록된 DRC 위반이 없습니다." />
        ) : (
          <div className={s.records}>
            {findings.map((f, i) => (
              <div className={s.record} key={i}>
                <SeverityTag severity={f.severity} />
                <span className={s.recordMsg}>
                  <b style={{ color: "var(--ink)" }}>{f.rule}</b> — {f.message}
                  {f.refdes && <span className="mono" style={{ color: "var(--ink-4)" }}> · {f.refdes}</span>}
                  {f.net_name && <span className="mono" style={{ color: "var(--ink-4)" }}> · {f.net_name}</span>}
                </span>
                <span className={s.recordMeta}>
                  {f.layer_index ? `L${f.layer_index}` : ""}
                  {f.x_nm != null && f.y_nm != null && ` (${formatCoarse(f.x_nm)}, ${formatCoarse(f.y_nm)})`}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

export function RevisionsTab({ detail }: { detail: RevisionDetail }) {
  const current = detail.revision.id;
  const boardId = detail.revision.board_id;
  const currentIndex = detail.lineage.findIndex((r) => r.id === current);

  return (
    <Panel
      title="리비전 계보"
      action={
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-4)" }}>
          비교는 항상 오래된 리비전 → 새 리비전 방향으로 엽니다
        </span>
      }
      flush
    >
      <div className={s.lineage}>
        {detail.lineage.map((r, i) => {
          const isCurrent = r.id === current;
          const last = i === detail.lineage.length - 1;
          // ChangeSet 은 (오래된 것, 새 것) 한 방향으로만 계산되어 있다.
          const [olderId, newerId] = currentIndex < i ? [current, r.id] : [r.id, current];
          return (
            <div key={r.id} className={`${s.lineageRow} ${isCurrent ? s.lineageCurrent : ""}`}>
              <span className={s.lineageRail} aria-hidden="true">
                <i className={`${s.lineageDot} ${isCurrent ? s.lineageDotOn : ""}`} />
                {!last && <span>│</span>}
              </span>
              <span className={s.lineageLabel}>{r.label}</span>
              <span className={s.lineageNote}>{r.note ?? (i === 0 ? "최초 등록" : "—")}</span>
              <span className={s.lineageDate}>
                {r.created_at.slice(0, 10)} · {r.author ?? "—"}
              </span>
              {isCurrent ? (
                <button type="button" className={s.linkBtn} disabled>
                  보는 중
                </button>
              ) : (
                <span style={{ display: "inline-flex", gap: 6 }}>
                  <Link className={s.linkBtn} to={comparePath(olderId, newerId)}>
                    비교
                  </Link>
                  <Link className={s.linkBtn} to={revisionPath(boardId, r.id)}>
                    열기
                  </Link>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export function FilesTab({ detail }: { detail: RevisionDetail }) {
  return (
    <div className={s.col}>
      <Panel
        title="원본 파일"
        action={
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-4)" }}>
            다운로드는 권한 확인과 감사 기록이 붙는 Phase 5부터
          </span>
        }
        flush
      >
        <div className={s.records}>
          {detail.files.map((f) => (
            <div className={s.record} key={f.id}>
              <Tag accent>{f.kind ?? "파일"}</Tag>
              <span className={s.recordMsg}>
                <b className="mono" style={{ color: "var(--ink)" }}>{f.filename}</b>
                <br />
                <span className="mono" style={{ fontSize: "var(--fs-xs)", color: "var(--ink-4)" }}>
                  sha256 {f.sha256.slice(0, 16)}… · {f.uploaded_by} · {f.uploaded_at.slice(0, 10)}
                </span>
              </span>
              <span className={s.recordMeta}>{formatBytes(f.byte_size)}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="기하 버퍼">
        <p style={{ color: "var(--ink-3)", marginBottom: "var(--sp-3)", maxWidth: "62ch", lineHeight: 1.6 }}>
          층마다 하나씩 만들어지는 <code className="mono">.blg</code> 버퍼입니다. 배선·패드·비아 좌표가 정수 배열로
          압축되어 있고, 뷰어는 이 파일을 JSON 으로 풀지 않고 그대로 GPU 버퍼에 올립니다.
        </p>
        <div className={s.records}>
          {(detail.layer_geometry ?? []).map((g) => (
            <div className={s.record} key={g.layer_index}>
              <span className="mono" style={{ color: "var(--accent-ink)", fontWeight: 600 }}>
                L{g.layer_index}
              </span>
              <span className={s.recordMsg}>
                <span className="mono" style={{ fontSize: "var(--fs-xs)", color: "var(--ink-4)" }}>
                  {g.storage_key}
                </span>
              </span>
              <span className={s.recordMeta}>
                객체 {formatCount(g.object_count)} · {formatBytes(g.byte_size)}
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
