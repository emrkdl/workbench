import { Link } from "react-router-dom";
import type { RevisionDetail } from "@/lib/cdm";
import { Bar, EmptyState, Panel, Stat, StatGrid, Tag } from "@/components/ui";
import { formatBytes, formatCount, formatFine } from "@/lib/units";
import { comparePath, revisionPath } from "@/lib/routes";
import s from "./revision.module.css";

/** 제조 난이도 순. 카탈로그 표와 뷰어의 비아 색이 같은 순서를 쓴다. */
const VIA_ORDER = ["through", "blind", "buried", "micro"];
const VIA_LABEL: Record<string, string> = {
  through: "관통",
  blind: "블라인드",
  buried: "베리드",
  micro: "마이크로",
};
const VIA_COLOR: Record<string, string> = {
  through: "#9aa3ad",
  blind: "#7f97b0",
  buried: "#6f8496",
  micro: "#3fa88c",
};
const DRILL_LABEL: Record<string, string> = {
  via: "비아",
  mounting: "체결",
  tooling: "툴링",
  component: "부품",
};

/**
 * 비아 탭.
 *
 * 예전에는 "제조" 라는 이름으로 설계 룰·비아·드릴·DRC 를 한데 담았는데, 이 시스템은
 * 제조를 다루지 않는다. 설계 룰과 표면 처리는 요약 탭의 물리 항목이 이미 들고 있으므로,
 * 남는 것 중 따로 볼 값이 있는 비아와 그 구멍만 여기 모았다.
 *
 * 비아는 층을 넘는 유일한 통로이고, 종류가 무엇이냐에 따라 만들 수 있는 업체와 단가가
 * 갈린다 — 관통만 쓰는 6층과 마이크로비아를 쓰는 6층은 같은 보드가 아니다.
 */
export function ViasTab({ detail }: { detail: RevisionDetail }) {
  const sm = detail.revision.summary;
  const rules = detail.design_rules;
  const byKind = sm.via_by_kind ?? {};
  const kinds = VIA_ORDER.filter((k) => (byKind[k] ?? 0) > 0);

  return (
    <div className={s.col}>
      <Panel title="비아 요약">
        <StatGrid cols={4}>
          <Stat label="비아 총수" value={formatCount(sm.via_total)} />
          <Stat label="드릴 홀" value={formatCount(sm.hole_count)} hint="기구홀 포함" />
          <Stat label="최소 드릴" value={formatFine(rules.min_drill_nm)} />
          <Stat
            label="최대 종횡비"
            value={rules.max_aspect_ratio ? `${rules.max_aspect_ratio} : 1` : "—"}
            hint="두께 ÷ 드릴 지름"
          />
        </StatGrid>
        {kinds.length > 0 && (
          <div style={{ marginTop: "var(--sp-4)" }}>
            <Bar
              slices={kinds.map((k) => ({
                label: VIA_LABEL[k] ?? k,
                value: byKind[k] ?? 0,
                color: VIA_COLOR[k] ?? "var(--ink-4)",
              }))}
            />
          </div>
        )}
      </Panel>

      <Panel title="비아 규격" flush>
        {detail.vias.length === 0 ? (
          <EmptyState title="비아 규격이 없습니다" body="이 리비전에는 기록된 비아 사양이 없습니다." />
        ) : (
          <div className={s.records}>
            {detail.vias.map((v, i) => (
              <div className={s.record} key={i}>
                <Tag accent={v.kind !== "through"}>{VIA_LABEL[v.kind] ?? v.kind}</Tag>
                <span className={s.recordMsg}>
                  L{v.from_layer}–L{v.to_layer} · 드릴 {formatFine(v.drill_nm)} · 패드 {formatFine(v.pad_nm)}
                  {v.pad_nm > v.drill_nm && (
                    <span style={{ color: "var(--ink-4)" }}>
                      {" "}· 애뉼러 링 {formatFine(Math.round((v.pad_nm - v.drill_nm) / 2))}
                    </span>
                  )}
                </span>
                <span className={s.recordMeta}>{formatCount(v.count)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

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
