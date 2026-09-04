import { useSyncExternalStore } from "react";

/**
 * 설계 문답 — 무엇을 주고받는가.
 *
 * 원본(Xpedition Agent)의 QnA Bot 을 이 앱의 말로 옮겼다. 그쪽은 로컬 agent 가 Xpedition 을
 * 붙들고 있는 도구라 "PCB Data 연결됨" 같은 것을 물어야 했지만, 여기는 이미 보드 서른 장이
 * 들어와 있는 카탈로그다. 그래서 "연결 상태"를 묻는 대신 **어느 판에 대한 질문인가**를
 * 고르게 한다 — 같은 자리에 놓이지만 가리키는 것이 다르다.
 */

export type Role = "user" | "agent";

/** 무엇을 보고 답할 것인가. 원본의 "응답 데이터 소스"를 이 앱이 실제로 가진 둘로 좁혔다. */
export type Source = "docs" | "design";

/**
 * 문서 쪽에서 찾아볼 곳.
 *
 * 원본의 여섯 갈래를 그대로 두되 이름을 이 앱의 말로 바꿨다. "설계 사례"는 원본에서는
 * 어딘가에 쌓여 있을 문서였지만 여기서는 카탈로그 그 자체다.
 */
export const SCOPES = [
  ["rule", "설계 룰", "선폭·간격·임피던스 같은 지켜야 할 값"],
  ["stackup", "적층 지침", "층 배분과 두께, 재질 선택"],
  ["manual", "레이아웃 지침", "부품 배치와 배선의 사내 관례"],
  ["case", "과거 설계 사례", "카탈로그에 쌓인 판들에서 찾는다"],
  ["term", "용어·백서", "말이 가리키는 것을 먼저 맞춘다"],
] as const;

export type ScopeId = (typeof SCOPES)[number][0];

/** 답이 짚은 근거 한 줄. 갈 곳이 있으면 눌러서 간다. */
export interface Cite {
  label: string;
  note: string;
  to?: string;
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  /** 물을 때 걸려 있던 조건. 나중에 읽을 때 "무엇을 보고 답한 것인지"가 남아야 한다. */
  scope?: string[];
  files?: string[];
  cites?: Cite[];
  /** 답이 권하는 다음 걸음. 이 앱 안에서 실제로 갈 수 있는 곳만 적는다. */
  next?: { label: string; to: string }[];
}

/* ── 지난 대화 ─────────────────────────────────
   원본은 머리줄의 드롭다운 안에 숨겨 두었는데, 그러면 있는 줄도 모른다. 오른쪽에 늘
   펼쳐 둔다 — 어차피 그 자리는 비어 있고, 지난 질문은 다음 질문의 실마리가 된다.

   브라우저에만 남긴다. 사람마다 묻는 것이 다르므로 서버가 알아야 할 값이 아니고,
   폐쇄망에서 서버 상태를 늘리지 않는 편이 낫다. */

const KEY = "boardforge.ask.sessions";
const LIMIT = 20;

export interface Talk {
  id: string;
  title: string;
  /** ISO 문자열. 마지막으로 손댄 때. */
  at: string;
  boardKey: string | null;
  messages: Message[];
}

let cache: Talk[] | null = null;
const listeners = new Set<() => void>();

function read(): Talk[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Talk[];
    cache = Array.isArray(raw) ? raw.filter((t) => t && t.id && Array.isArray(t.messages)) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: Talk[]) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 저장이 막혀도 이번 세션은 동작해야 한다 */
  }
  for (const fn of listeners) fn();
}

/** 첫 질문이 곧 제목이다. 따로 이름을 붙이라고 하면 아무도 붙이지 않는다. */
export function titleOf(messages: Message[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "빈 대화";
  return first.text.length > 40 ? `${first.text.slice(0, 40)}…` : first.text;
}

export function keepTalk(talk: Talk) {
  if (talk.messages.length === 0) return;
  write([talk, ...read().filter((t) => t.id !== talk.id)].slice(0, LIMIT));
}

export function dropTalk(id: string) {
  write(read().filter((t) => t.id !== id));
}

export function useTalks(): Talk[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    read,
    () => [],
  );
}

export const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/* ── 지금 오가는 대화 ───────────────────────────
   화면 안이 아니라 모듈에 둔다. 물어 놓고 답을 기다리는 동안 사람은 카탈로그를 뒤지러
   가는데, 상태가 화면에 매여 있으면 그 순간 화면이 사라지면서 짓던 답도 함께 사라진다.
   물어본 사람은 답이 오지 않은 이유를 알 길이 없다.

   여기 두면 화면을 떠나도 답은 도착하고, 돌아왔을 때 그 자리에 있다. 왼쪽 메뉴는
   같은 것을 들여다보며 짓는 중인지, 다 됐는지를 알린다. */

export interface ChatState {
  talkId: string;
  messages: Message[];
  /** 답을 짓는 중. */
  thinking: boolean;
  /** 화면을 떠난 사이에 도착한 답의 수. 돌아와서 보면 0 이 된다. */
  unread: number;
  boardKey: string | null;
}

const blankChat = (): ChatState => ({
  talkId: newId(),
  messages: [],
  thinking: false,
  unread: 0,
  boardKey: null,
});

let chat: ChatState = blankChat();
const chatEars = new Set<() => void>();
let chatTimer = 0;
/** 문답 화면이 지금 이 대화를 보고 있는가. 보고 있으면 도착한 답을 "안 읽음"으로 세지 않는다. */
let watching = 0;

function setChat(next: ChatState) {
  chat = next;
  for (const fn of chatEars) fn();
}

/**
 * 묻는다.
 *
 * 답은 이미 지어서 넘겨받는다 — 엔진이 없으니 지을 것이 시간밖에 없고, 무엇을 보고
 * 답할지(고른 판, 찾아볼 곳)는 **물은 시점의 것**이어야 하기 때문이다. 기다리는 동안
 * 사람이 조건을 바꿔도 방금 던진 물음의 답이 따라 바뀌면 안 된다.
 */
export function askChat(question: Message, answer: Message, delayMs: number, boardKey: string | null) {
  window.clearTimeout(chatTimer);
  const waiting = [...chat.messages, question];
  setChat({ ...chat, messages: waiting, thinking: true, boardKey });

  chatTimer = window.setTimeout(() => {
    const done = [...waiting, answer];
    setChat({
      ...chat,
      messages: done,
      thinking: false,
      unread: watching > 0 ? 0 : chat.unread + 1,
    });
    keepTalk({
      id: chat.talkId,
      title: titleOf(done),
      at: new Date().toISOString(),
      boardKey,
      messages: done,
    });
  }, delayMs);
}

export function stopChat() {
  window.clearTimeout(chatTimer);
  setChat({ ...chat, thinking: false });
}

export function resetChat() {
  window.clearTimeout(chatTimer);
  setChat(blankChat());
}

export function loadChat(talk: Talk) {
  window.clearTimeout(chatTimer);
  setChat({
    talkId: talk.id,
    messages: talk.messages,
    thinking: false,
    unread: 0,
    boardKey: talk.boardKey,
  });
}

/** 문답 화면이 붙어 있는 동안 부른다. 보고 있는 답은 안 읽은 답이 아니다. */
export function watchChat(): () => void {
  watching += 1;
  if (chat.unread) setChat({ ...chat, unread: 0 });
  return () => {
    watching -= 1;
  };
}

export function useChat(): ChatState {
  return useSyncExternalStore(
    (fn) => {
      chatEars.add(fn);
      return () => {
        chatEars.delete(fn);
      };
    },
    () => chat,
    () => chat,
  );
}
