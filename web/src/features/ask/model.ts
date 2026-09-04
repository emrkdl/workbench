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
