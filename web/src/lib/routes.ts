/**
 * URL 생성과 해석.
 *
 * 리비전 ID 는 `{보드 슬러그}-{리비전 문자}` 형태다(예: orn-main-a1-b). URL 은 설계
 * 문서의 정보 구조를 그대로 따라 `/boards/:boardId/:rev/:tab` 로 쓴다 — 사람이 읽고
 * 손으로 고칠 수 있는 주소여야 화면 상태를 그대로 공유할 수 있다.
 */

export const TABS = [
  { key: "overview", label: "요약" },
  { key: "viewer", label: "뷰어" },
  { key: "stackup", label: "적층" },
  { key: "components", label: "부품" },
  { key: "nets", label: "넷" },
  { key: "vias", label: "비아" },
  { key: "revisions", label: "리비전" },
  { key: "files", label: "파일" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

export const isTabKey = (v: string | undefined): v is TabKey => TABS.some((t) => t.key === v);

/** 리비전 ID 에서 보드 슬러그를 떼어내 URL 조각만 남긴다. */
export function revSegment(boardId: string, revisionId: string): string {
  return revisionId.startsWith(`${boardId}-`) ? revisionId.slice(boardId.length + 1) : revisionId;
}

export const revisionId = (boardId: string, segment: string) => `${boardId}-${segment}`;

export function revisionPath(boardId: string, revisionIdOrSegment: string, tab?: TabKey): string {
  const seg = revSegment(boardId, revisionIdOrSegment);
  return `/boards/${boardId}/${seg}${tab ? `/${tab}` : ""}`;
}

export const comparePath = (a: string, b: string) => `/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`;

/**
 * 설계 지침의 탭.
 *
 * 설계 문답이 "찾아볼 곳"으로 늘어놓는 갈래와 일부러 같게 맞췄다. 챗봇이 뒤진다고
 * 말하는 것과 사람이 열어 보는 것이 다른 이름이면, 둘이 같은 것을 가리키는지 알 수 없다.
 */
export const GUIDE_TABS = [
  { key: "rules", label: "설계 룰" },
  { key: "stackup", label: "적층" },
  { key: "layout", label: "레이아웃" },
  { key: "manual", label: "매뉴얼" },
  { key: "glossary", label: "용어집" },
] as const;

export type GuideTabKey = (typeof GUIDE_TABS)[number]["key"];

export const isGuideTab = (v: string | undefined): v is GuideTabKey =>
  GUIDE_TABS.some((t) => t.key === v);

export const guidePath = (tab?: GuideTabKey) => `/guide${tab ? `/${tab}` : ""}`;
