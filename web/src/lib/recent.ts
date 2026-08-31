import { useSyncExternalStore } from "react";

/**
 * 최근 본 보드.
 *
 * 보드가 쌓일수록 사람은 결국 같은 몇 장을 오간다 — 지금 붙잡고 있는 과제의 보드,
 * 그것과 견주는 이전 세대, 부품을 빌려 온 옆 보드. 1,000장짜리 카탈로그에서 그 서너 장을
 * 매번 검색해 찾는 것은 낭비다.
 *
 * 브라우저에만 남긴다. 사람마다 보는 것이 다르므로 서버가 알아야 할 값이 아니고,
 * 폐쇄망에서 서버 상태를 늘리지 않는 편이 낫다.
 */

const KEY = "boardlens.recent";
const LIMIT = 6;

export interface RecentBoard {
  boardId: string;
  boardKey: string;
  name: string;
  /** 마지막으로 본 리비전의 URL 조각. 보던 리비전으로 그대로 돌아가게 한다. */
  seg: string;
}

let cache: RecentBoard[] | null = null;
const listeners = new Set<() => void>();

function read(): RecentBoard[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as RecentBoard[];
    cache = Array.isArray(raw) ? raw.filter((b) => b && b.boardId && b.boardKey) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: RecentBoard[]) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 저장이 막혀도 이번 세션은 동작해야 한다 */
  }
  for (const fn of listeners) fn();
}

/** 방금 본 보드를 맨 앞으로. 같은 보드를 다시 보면 리비전만 갱신된다. */
export function remember(board: RecentBoard) {
  const prev = read();
  const head = prev[0];
  if (head && head.boardId === board.boardId && head.seg === board.seg) return;
  write([board, ...prev.filter((b) => b.boardId !== board.boardId)].slice(0, LIMIT));
}

export function forget(boardId: string) {
  write(read().filter((b) => b.boardId !== boardId));
}

export function useRecentBoards(): RecentBoard[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    read,
    () => [],
  );
}
