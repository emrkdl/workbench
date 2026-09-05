import type { MockManifest } from "@/lib/api";
import type { Board } from "@/lib/cdm";
import { Panel } from "@/components/ui";
import { formatCount } from "@/lib/units";
import { FORM_FACTORS } from "@/features/autodesign/spec";
import { SCOPES, type ScopeId, type Source, type Talk } from "./model";
import s from "./ask.module.css";

const SOURCES: [Source, string][] = [
  ["docs", "문서·룰"],
  ["design", "설계 데이터"],
  ["live", "라이브 디자인"],
];

const BLURB: Record<Source, string> = {
  docs: "SI Rule·Stackup·Layout Manual 처럼 쌓인 글에서 근거를 찾아 답합니다.",
  design: "이미 저장돼 들어와 있는 판의 실제 값(층·부품·넷·비아)을 읽어 답합니다.",
  live: "설계 툴에 지금 떠 있는 판에 직접 붙어, 저장하기 전 상태 그대로를 읽어 답합니다.",
};

/**
 * 무엇을 보고 답할까.
 *
 * 셋으로 가른다. **문서·룰**은 사람이 써 놓은 글, **설계 데이터**는 이미 저장돼 이 앱에
 * 들어와 있는 판, **라이브 디자인**은 지금 설계자의 CAD 에 떠 있는 판이다.
 *
 * 같은 물음에 셋이 다른 것을 답한다 — "이 선폭 괜찮나?"에 문서는 규정을, 저장된 판은
 * 전례를, 라이브는 지금 이 순간을 답한다. 그래서 무엇을 보고 답할지가 물음보다 먼저다.
 *
 * 고른 갈래의 하위 선택만 펼친다. 셋을 한꺼번에 늘어놓으면 지금 아무 뜻도 없는 조건이
 * 화면의 절반을 차지한다.
 */
export function SourcePanel({
  source,
  onSource,
  scopes,
  onScopes,
  board,
  boardId,
  onBoardId,
  grouped,
  manifest,
}: {
  source: Source;
  onSource: (v: Source) => void;
  scopes: ScopeId[];
  onScopes: (v: ScopeId[]) => void;
  board: Board | null;
  boardId: string;
  onBoardId: (id: string) => void;
  /** 폼팩터로 묶은 보드 목록. 서른 장을 한 줄로 늘어놓으면 고르다가 엉뚱한 것을 짚는다. */
  grouped: [string, Board[]][];
  manifest: MockManifest | null;
}) {
  const toggle = (id: ScopeId) => {
    const next = scopes.includes(id) ? scopes.filter((x) => x !== id) : [...scopes, id];
    // 하나도 안 고른 상태는 "아무 데서도 찾지 말라"는 뜻이 되어 버린다. 마지막 하나는 남긴다.
    onScopes(next.length ? next : scopes);
  };

  return (
    <Panel title="무엇을 보고 답할까">
      <div className={s.srcSeg} role="group" aria-label="답변 근거">
        {SOURCES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={source === id ? s.srcOn : ""}
            aria-pressed={source === id}
            onClick={() => onSource(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <p className={s.hint}>{BLURB[source]}</p>

      {source === "docs" && (
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
                /* 설명은 화면에서 뺐다 — 세 줄이 두 줄씩 차지하면 오른쪽 판이 설명으로
                   가득 찬다. 한 번 읽으면 그만인 말이라 손끝에만 남긴다. */
                title={desc}
                onClick={() => toggle(id)}
              >
                <span className={s.scopeMark} aria-hidden="true">
                  {on ? "✓" : ""}
                </span>
                <b>{label}</b>
              </button>
            );
          })}
        </div>
      )}

      {source === "design" && (
        <div className={s.pickBox}>
          <label className={s.pickField}>
            <span className={s.fieldLabel}>저장된 설계</span>
            <select value={boardId} onChange={(e) => onBoardId(e.target.value)}>
              <option value="">고르지 않음</option>
              {grouped.map(([key, list]) => (
                <optgroup key={key} label={`${FORM_FACTORS[key] ?? key} (${list.length})`}>
                  {list.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.board_key} · {b.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {board ? (
            <dl className={s.facts}>
              <dt>리비전</dt>
              <dd>{board.latest_revision_label}</dd>
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
            <p className={s.warn}>고른 판이 없으면 읽을 값이 없습니다.</p>
          )}
        </div>
      )}

      {source === "live" && (
        <div className={s.pickBox}>
          {/* 아직 붙지 않았다. 자리만 잡아 두되 붙은 척하지 않는다 — 연결됐다고 적힌
              화면에서 답을 받으면, 그 답이 지금 내 판을 읽고 나온 것이라고 믿는다. */}
          <div className={s.liveRow}>
            <span className={s.liveDot} aria-hidden="true" />
            <b>연결되지 않음</b>
            <button type="button" className={s.liveBtn} disabled title="아직 붙지 않았습니다">
              연결
            </button>
          </div>
          <dl className={s.facts}>
            <dt>연결 방식</dt>
            <dd>MCP</dd>
            <dt>설계 툴</dt>
            <dd>—</dd>
            <dt>열린 판</dt>
            <dd>—</dd>
          </dl>
          <p className={s.hint}>
            설계 툴이 MCP 서버로 지금 열려 있는 판을 내주면, 저장을 기다리지 않고 그 판을
            읽습니다. 방금 옮긴 부품과 방금 그은 선까지 물어볼 수 있게 됩니다.
            <b> 아직 붙지 않았습니다.</b>
          </p>
        </div>
      )}

      {/* 원본의 "로컬 연결" 3줄을 여기로 옮겼다. 그쪽은 Xpedition·LLM·Knowledge DB 가
          붙었는지를 점으로 알려 주었는데, 지어낸 초록 점을 띄우는 대신 이 앱에 정말로
          들어와 있는 것만 있다고 적는다. */}
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
        <Have on={false} label="라이브 디자인" note="MCP 아직 붙지 않음" />
        <Have on={false} label="답변 엔진" note="아직 붙지 않음" />
      </div>
    </Panel>
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
    <Panel title="지난 대화" fill>
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
