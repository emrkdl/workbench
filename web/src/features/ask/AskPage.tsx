import { useEffect, useMemo, useRef, useState } from "react";
import { fetchCatalog, fetchManifest } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { ErrorState, Loading } from "@/components/ui";
import { FORM_FACTORS, formFactorOf } from "@/features/autodesign/spec";
import { ChatStream } from "./ChatStream";
import { InputDock, type Attached } from "./InputDock";
import { SourcePanel, TalksPanel } from "./SourcePanel";
import { draft } from "./draft";
import {
  SCOPES,
  askChat,
  dropTalk,
  loadChat,
  newId,
  resetChat,
  stopChat,
  titleOf,
  useChat,
  useTalks,
  watchChat,
  type Message,
  type ScopeId,
  type Source,
} from "./model";
import s from "./ask.module.css";

const ALL_SCOPES = SCOPES.map(([id]) => id) as ScopeId[];

const SAMPLES_DESIGN = [
  "이 판은 몇 층이고 어떻게 나뉘어 있나요?",
  "부품이 몇 개고 앞뒤로 어떻게 갈리나요?",
  "비아는 몇 개고 종류별로 어떻게 되나요?",
  "최소 선폭과 간격이 얼마인가요?",
];

const SAMPLES_DOCS = [
  "8층에서 임피던스 50 Ω 을 맞추려면 선폭을 얼마로 잡나요?",
  "0.4 mm 피치 BGA 는 몇 층부터 뺄 수 있나요?",
  "마이크로비아를 쓸 때 지켜야 할 간격은?",
  "비슷한 크기의 전원 보드를 예전에 만든 적이 있나요?",
];

/** 사람이 읽는 답을 짓는 데 걸리는 시간. 실제 엔진이 붙으면 이 값은 사라진다. */
const THINK_MS = 2400;

/**
 * 설계 문답.
 *
 * 원본(Xpedition Agent)의 QnA Bot 을 이 앱의 말로 옮겨 왔다. 옮기면서 세 가지가 달라졌다.
 *
 * 하나. 원본의 "PCB Data 연결" 은 목록 세 줄짜리 가짜였지만 여기서는 진짜 카탈로그를
 * 고른다 — 고르면 그 판의 실제 값이 바로 옆에 뜬다.
 *
 * 둘. 원본은 진행 단계 타임라인을 왼쪽 판 하나에 상시로 펼쳐 두었다. 여기서는 뺐다.
 * 이 앱의 왼쪽은 이미 메뉴가 쓰고 있고, 무엇보다 그 타임라인은 사람이 자주 들여다보는
 * 것이 아니라 "일하고 있음"을 보여 주는 장치였다. 그 일은 답 하나가 대신한다.
 *
 * 셋. "승인 후 실행 / 거절" 은 원본이 CAD 를 직접 돌리기 때문에 필요했다. 이 앱은 그러지
 * 않으므로 승인할 것이 없다 — 대신 답이 이 앱 안에서 갈 수 있는 곳을 권한다.
 */
export function AskPage() {
  const catalog = useAsync(fetchCatalog, []);
  const manifest = useAsync(fetchManifest, []);
  const talks = useTalks();

  // 오간 말은 이 화면 밖(모듈)에 있다. 물어 놓고 다른 화면으로 가도 답은 도착한다.
  const chat = useChat();
  const { messages, thinking } = chat;

  const [boardId, setBoardId] = useState("");
  const [source, setSource] = useState<Source>("docs");
  const [scopes, setScopes] = useState<ScopeId[]>(ALL_SCOPES);
  const [files, setFiles] = useState<Attached[]>([]);
  const [text, setText] = useState("");

  // 보고 있는 동안 도착한 답은 "안 읽은 답"이 아니다. 메뉴의 표시는 떠나 있었을 때만 뜬다.
  useEffect(() => watchChat(), []);

  const boards = useMemo(
    () => [...(catalog.data?.items ?? [])].sort((a, b) => a.board_key.localeCompare(b.board_key)),
    [catalog.data],
  );

  /** 폼팩터로 묶어 고르게 한다. 서른 장을 한 줄로 늘어놓으면 메인보드를 찾다가 플렉스를 고른다. */
  const grouped = useMemo(() => {
    const out = new Map<string, typeof boards>();
    for (const b of boards) {
      const key = formFactorOf(b.board_key) || "기타";
      out.set(key, [...(out.get(key) ?? []), b]);
    }
    return [...out.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [boards]);

  const board = useMemo(() => boards.find((b) => b.id === boardId) ?? null, [boards, boardId]);

  // 판을 고르면 그 판의 값을 읽는 쪽이 자연스럽다. 고르고 나서 왜 문서만 뒤지는지
  // 다시 설명하게 하는 대신 한 번 옮겨 준다 — 사람이 되돌릴 수 있으니 무례하지 않다.
  const touched = useRef(false);
  useEffect(() => {
    if (boardId && !touched.current) setSource("design");
  }, [boardId]);

  const blocked =
    source === "design" && !board ? "설계 데이터를 보려면 위에서 판을 먼저 고르세요." : null;

  const send = (raw?: string) => {
    const q = (raw ?? text).trim();
    if (!q || thinking || blocked) return;

    const mine: Message = {
      id: newId(),
      role: "user",
      text: q,
      scope: [
        source === "docs" ? "문서·룰" : "설계 데이터",
        ...(board ? [board.board_key] : []),
      ],
      files: files.map((f) => f.name),
    };
    // 답은 물은 그 자리에서 짓고, 도착만 늦춘다. 기다리는 동안 사람이 조건을 바꿔도
    // 방금 던진 물음의 답이 따라 바뀌면 안 된다.
    askChat(mine, draft({ question: q, source, scopes, board }), THINK_MS, board?.board_key ?? null);
    setText("");
  };

  const fresh = () => {
    resetChat();
    setFiles([]);
    setText("");
  };

  const open = (id: string) => {
    const t = talks.find((x) => x.id === id);
    if (t) loadChat(t);
  };

  /** 대화를 글로 내린다. 결정의 근거가 된 문답은 화면 밖으로 나가 회의록에 붙는다. */
  const save = () => {
    const body = messages
      .map((m) => {
        const who = m.role === "user" ? "물음" : "답";
        const head = m.scope?.length ? `[${who} · ${m.scope.join(" · ")}]` : `[${who}]`;
        const cites = m.cites?.length ? `\n근거: ${m.cites.map((c) => c.label).join(", ")}` : "";
        return `${head}\n${m.text}${cites}`;
      })
      .join("\n\n");
    const blob = new Blob([`설계 문답 — ${titleOf(messages)}\n\n${body}\n`], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `설계문답-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const attach = (list: FileList | null) => {
    const added = Array.from(list ?? []);
    if (!added.length) return;
    const seen = new Set(files.map((f) => f.name));
    setFiles([
      ...files,
      ...added.filter((f) => !seen.has(f.name)).map((f) => ({ name: f.name, byteSize: f.size })),
    ]);
  };

  if (catalog.loading) return <Loading label="보드 목록을 불러오는 중" />;
  if (catalog.error) return <ErrorState error={catalog.error} />;

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>설계 문답</h1>
        <span className={s.lede}>쌓인 설계에 대해 묻고 근거와 함께 답을 받습니다</span>
        <span className={s.spacer} />
        <button type="button" className={s.linkBtn} onClick={save} disabled={messages.length === 0}>
          내보내기
        </button>
        <button type="button" className={s.linkBtn} onClick={fresh} disabled={messages.length === 0}>
          새 대화
        </button>
      </header>

      <div className={s.body}>
        <div className={s.chat}>
          {/* 원본의 "PCB Data Connected" 자리. 점 하나로 연결 여부만 말하던 것을,
              고른 판이 무엇이고 어떤 판인지까지 한 줄에 적는 것으로 바꿨다. */}
          <div className={s.target}>
            <span className={`${s.dot} ${board ? s.dotOn : ""}`} aria-hidden="true" />
            <label className={s.pick}>
              <span className={s.srOnly}>질문할 보드</span>
              <select
                value={boardId}
                onChange={(e) => {
                  touched.current = false;
                  setBoardId(e.target.value);
                }}
              >
                <option value="">판을 고르지 않음</option>
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
            <span className={s.targetNote}>
              {board
                ? `${board.latest_revision_label} · ${board.summary.layer_count}층 · 부품 ${board.summary.component_count.toLocaleString()} · 넷 ${board.summary.net_count.toLocaleString()}`
                : "고른 판이 없습니다 — 문서·룰만 보고 답합니다"}
            </span>
          </div>

          <ChatStream
            messages={messages}
            thinking={thinking}
            samples={source === "design" && board ? SAMPLES_DESIGN : SAMPLES_DOCS}
            onSample={(q) => send(q)}
          />

          <InputDock
            value={text}
            onChange={setText}
            onSend={() => send()}
            onStop={stopChat}
            busy={thinking}
            files={files}
            onAttach={attach}
            onDetach={(name) => setFiles(files.filter((f) => f.name !== name))}
            blocked={blocked}
          />
        </div>

        <aside className={s.side}>
          <div className={s.sideStick}>
            <SourcePanel
              source={source}
              onSource={(v) => {
                touched.current = true;
                setSource(v);
              }}
              scopes={scopes}
              onScopes={setScopes}
              board={board}
              manifest={manifest.data}
            />
            <TalksPanel talks={talks} currentId={chat.talkId} onOpen={open} onDrop={dropTalk} />
            <p className={s.note}>
              답변 엔진은 아직 붙지 않았습니다. <b>설계 데이터</b> 쪽 답은 이미 들어와 있는
              요약값을 실제로 읽어 온 것이고, <b>문서·룰</b> 쪽은 읽을 문서가 없어 답하지
              못한다고만 말합니다. 없는 근거를 지어내지 않습니다.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
