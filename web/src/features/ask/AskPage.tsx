import { useEffect, useMemo, useState } from "react";
import { fetchCatalog, fetchManifest } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { ErrorState, Loading } from "@/components/ui";
import { formFactorOf } from "@/features/autodesign/spec";
import { ChatStream } from "./ChatStream";
import { InputDock, type Attached } from "./InputDock";
import { SourcePanel, TalksPanel } from "./SourcePanel";
import { draft } from "./draft";
import {
  LIVE_OFF,
  SCOPES,
  activeDesign,
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
  type LiveState,
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
  const [live, setLive] = useState<LiveState>(LIVE_OFF);
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

  /** 저장된 설계 쪽에서 고른 판. */
  const savedBoard = useMemo(() => boards.find((b) => b.id === boardId) ?? null, [boards, boardId]);

  /**
   * 라이브 쪽에서 지금 향하고 있는 판.
   *
   * MCP 가 붙기 전이라 값은 카탈로그에서 읽는다. 붙고 나면 이 대응은 사라지고 값이
   * 설계 툴에서 바로 온다 — 화면은 그대로다.
   */
  const design = activeDesign(live);
  const liveBoard = useMemo(
    () => (design ? (boards.find((b) => b.id === design.boardId) ?? null) : null),
    [boards, design],
  );

  /** 이번 물음이 실제로 읽을 판. */
  const board = source === "live" ? liveBoard : savedBoard;

  /**
   * 예행 연결.
   *
   * MCP 가 없으니 설계 툴에 물어볼 길이 없다. 대신 카탈로그에서 두 장을 꺼내 "열려 있는
   * 판"으로 세운다 — 목록과 오가는 흐름을 확인하기 위한 자리이고, 화면은 그 사실을
   * 숨기지 않는다. 툴이 붙으면 이 함수만 진짜 호출로 바뀐다.
   */
  const connectLive = () => {
    const open = boards.slice(0, 2);
    if (!open.length) return;
    setLive({
      tool: "Xpedition · 예행",
      designs: open.map((b) => ({ id: b.id, name: b.board_key, boardId: b.id })),
      activeId: open[0].id,
    });
  };

  const blocked =
    source === "design" && !savedBoard
      ? "오른쪽에서 저장된 설계를 먼저 고르세요."
      : source === "live" && !design
        ? "오른쪽에서 설계 툴에 연결하고 판을 고르세요."
        : null;

  /** 머리줄 한 줄 — 지금 무엇을 보고 답하는 중인가. */
  const ready = source === "docs" || board !== null;
  const targetName =
    source === "docs"
      ? "문서·룰"
      : source === "live"
        ? (design?.name ?? "라이브 디자인")
        : (savedBoard?.board_key ?? "저장된 설계");
  const targetNote =
    source === "docs"
      ? SCOPES.filter(([id]) => scopes.includes(id))
          .map(([, label]) => label)
          .join(" · ")
      : source === "live"
        ? design
          ? `${live.tool} · 열린 판 ${live.designs.length}`
          : "설계 툴에 연결되지 않음"
        : savedBoard
          ? `${savedBoard.latest_revision_label} · ${savedBoard.summary.layer_count}층 · 부품 ${savedBoard.summary.component_count.toLocaleString()} · 넷 ${savedBoard.summary.net_count.toLocaleString()}`
          : "고른 판이 없습니다";

  const send = (raw?: string) => {
    const q = (raw ?? text).trim();
    if (!q || thinking || blocked) return;

    const mine: Message = {
      id: newId(),
      role: "user",
      text: q,
      scope: [
        source === "docs" ? "문서·룰" : source === "live" ? "라이브" : "설계 데이터",
        ...(source === "docs" ? [] : [targetName]),
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
          {/* 원본의 "PCB Data Connected" 자리. 거기서는 연결 여부만 말했지만 여기서는
              **지금 무엇을 보고 답하는지**를 적는다 — 고르는 일은 오른쪽 판이 맡고,
              이 줄은 그 결과를 말한다. 물음을 던지기 직전 눈이 머무는 자리라
              "무엇에 대고 묻는 중인지"가 여기 있어야 한다. */}
          <div className={s.target}>
            <span className={`${s.dot} ${ready ? s.dotOn : ""}`} aria-hidden="true" />
            <b className={s.targetName}>{targetName}</b>
            <span className={s.targetNote}>{targetNote}</span>
          </div>

          <ChatStream
            messages={messages}
            thinking={thinking}
            samples={board ? SAMPLES_DESIGN : SAMPLES_DOCS}
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
              onSource={setSource}
              scopes={scopes}
              onScopes={setScopes}
              board={source === "live" ? liveBoard : savedBoard}
              boardId={boardId}
              onBoardId={setBoardId}
              grouped={grouped}
              live={live}
              onLive={setLive}
              onConnect={connectLive}
              manifest={manifest.data}
            />
            <div className={s.talksSlot}>
              <TalksPanel talks={talks} currentId={chat.talkId} onOpen={open} onDrop={dropTalk} />
            </div>
            <p className={s.note}>
              답변 엔진은 아직 붙지 않았습니다. <b>설계 데이터</b> 쪽 답은 이미 들어와 있는
              요약값을 실제로 읽어 온 것이고, <b>문서·룰</b> 과 <b>라이브 디자인</b> 쪽은 읽을
              것이 없어 답하지 못한다고만 말합니다. 없는 근거를 지어내지 않습니다.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
