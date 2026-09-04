import type { MockManifest } from "@/lib/api";
import type { Board } from "@/lib/cdm";
import { Panel } from "@/components/ui";
import { formatCount } from "@/lib/units";
import { SCOPES, type ScopeId, type Source, type Talk } from "./model";
import s from "./ask.module.css";

/**
 * 무엇을 보고 답할까.
 *
 * 원본에는 "문서 지식(RAG) / 레이아웃 조회" 두 갈래가 있었다. 이 앱에도 그 둘이 그대로
 * 있다 — 다만 뒤쪽은 Xpedition 을 실시간으로 들여다보는 것이 아니라 **이미 들어와 있는
 * 판의 설계 데이터**다. 무엇이 실제로 있는지가 다르므로 이름도 그렇게 바꿨다.
 */
export function SourcePanel({
  source,
  onSource,
  scopes,
  onScopes,
  board,
  manifest,
}: {
  source: Source;
  onSource: (v: Source) => void;
  scopes: ScopeId[];
  onScopes: (v: ScopeId[]) => void;
  board: Board | null;
  manifest: MockManifest | null;
}) {
  const isDocs = source === "docs";

  const toggle = (id: ScopeId) => {
    const next = scopes.includes(id) ? scopes.filter((x) => x !== id) : [...scopes, id];
    // 하나도 안 고른 상태는 "아무 데서도 찾지 말라"는 뜻이 되어 버린다. 마지막 하나는 남긴다.
    onScopes(next.length ? next : scopes);
  };

  return (
    <>
      <Panel title="무엇을 보고 답할까">
        <div className={s.srcSeg} role="group" aria-label="답변 근거">
          <button
            type="button"
            className={isDocs ? s.srcOn : ""}
            aria-pressed={isDocs}
            onClick={() => onSource("docs")}
          >
            <b>문서·룰</b>
            <span>쌓인 지침에서</span>
          </button>
          <button
            type="button"
            className={!isDocs ? s.srcOn : ""}
            aria-pressed={!isDocs}
            onClick={() => onSource("design")}
          >
            <b>설계 데이터</b>
            <span>고른 판에서</span>
          </button>
        </div>

        <p className={s.hint}>
          {isDocs
            ? "설계 룰·적층 지침·매뉴얼처럼 쌓인 글에서 근거를 찾아 답합니다."
            : "고른 판에 실제로 들어 있는 값(층·부품·넷·비아)을 읽어 답합니다."}
        </p>

        {isDocs ? (
          <div className={s.scopes}>
            <div className={s.scopeHead}>
              <span className={s.fieldLabel}>찾아볼 곳</span>
              <span className={s.scopeCount}>
                {scopes.length}/{SCOPES.length}
              </span>
            </div>
            {SCOPES.map(([id, label, desc]) => {
              const on = scopes.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={`${s.scope} ${on ? s.scopeOn : ""}`}
                  aria-pressed={on}
                  onClick={() => toggle(id)}
                >
                  <span className={s.scopeMark} aria-hidden="true">
                    {on ? "✓" : ""}
                  </span>
                  <span className={s.scopeText}>
                    <b>{label}</b>
                    <span>{desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : board ? (
          <dl className={s.facts}>
            <dt>대상</dt>
            <dd>
              <b>{board.board_key}</b> {board.latest_revision_label}
            </dd>
            <dt>층</dt>
            <dd>
              {board.summary.layer_count}층 (신호 {board.summary.signal_layer_count})
            </dd>
            <dt>부품</dt>
            <dd>{formatCount(board.summary.component_count)}개</dd>
            <dt>넷</dt>
            <dd>{formatCount(board.summary.net_count)}개</dd>
            <dt>비아</dt>
            <dd>{formatCount(board.summary.via_total)}개</dd>
          </dl>
        ) : (
          <p className={s.warn}>위에서 판을 먼저 고르세요. 고른 판이 없으면 읽을 값이 없습니다.</p>
        )}

        {/* 원본의 "로컬 연결" 3줄을 여기로 옮겼다. 그쪽은 Xpedition·LLM·Knowledge DB 가
            붙었는지를 점으로 알려 주었는데, 지어낸 초록 점을 띄우는 대신 이 앱에 정말로
            들어와 있는 것만 있다고 적는다. */
        }
        <div className={s.have}>
          <span className={s.fieldLabel}>지금 있는 것</span>
          <Have
            on
            label="설계 데이터"
            note={
              manifest
                ? `보드 ${manifest.board_count} · 리비전 ${manifest.revision_count}`
                : "카탈로그에 들어와 있음"
            }
          />
          <Have on={false} label="문서·룰" note="아직 한 장도 들어오지 않음" />
          <Have on={false} label="답변 엔진" note="아직 붙지 않음" />
        </div>
      </Panel>
    </>
  );
}

function Have({ on, label, note }: { on: boolean; label: string; note: string }) {
  return (
    <div className={`${s.haveRow} ${on ? s.haveOn : ""}`}>
      <span className={s.haveDot} aria-hidden="true" />
      <b>{label}</b>
      <span>{note}</span>
    </div>
  );
}

/**
 * 지난 대화.
 *
 * 원본은 머리줄의 아이콘 뒤에 드롭다운으로 숨겨 두었다. 숨기면 있는 줄도 모른다 —
 * 오른쪽 아래는 어차피 비어 있으니 펼쳐 둔다. 지난 물음은 다음 물음의 실마리가 된다.
 */
export function TalksPanel({
  talks,
  currentId,
  onOpen,
  onDrop,
}: {
  talks: Talk[];
  currentId: string;
  onOpen: (id: string) => void;
  onDrop: (id: string) => void;
}) {
  return (
    <Panel title="지난 대화">
      {talks.length === 0 ? (
        <p className={s.hint}>아직 없습니다. 대화를 시작하면 여기에 쌓입니다.</p>
      ) : (
        <div className={s.talks}>
          {talks.map((t) => (
            <div key={t.id} className={`${s.talkRow} ${t.id === currentId ? s.talkOn : ""}`}>
              <button type="button" className={s.talkOpen} onClick={() => onOpen(t.id)}>
                <b>{t.title}</b>
                <span>
                  {t.boardKey ? `${t.boardKey} · ` : ""}
                  {new Date(t.at).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })} ·{" "}
                  {t.messages.length}줄
                </span>
              </button>
              <button
                type="button"
                className={s.talkDrop}
                aria-label={`${t.title} 지우기`}
                onClick={() => onDrop(t.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
