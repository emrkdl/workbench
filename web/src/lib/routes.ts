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
 * 자동 레이아웃의 탭.
 *
 * 조건을 짜는 일과 결과를 보는 일은 **시간이 다르다** — 하나가 끝나야 다음이 있다. 둘을
 * 한 화면에 나란히 놓으면 조건은 세로로 길고 판은 넓어야 해서 둘 다 좁아지고, 정작
 * 동시에 볼 일은 거의 없다. 그래서 탭으로 가른다.
 */
export const AUTO_TABS = [
  { key: "spec", label: "조건" },
  { key: "result", label: "결과" },
] as const;

export type AutoTabKey = (typeof AUTO_TABS)[number]["key"];

export const isAutoTab = (v: string | undefined): v is AutoTabKey =>
  AUTO_TABS.some((t) => t.key === v);

export const autoPath = (tab?: AutoTabKey) => `/auto${tab && tab !== "spec" ? `/${tab}` : ""}`;

/**
 * 설계 지침의 탭.
 *
 * 갈래마다 문서가 따로 있으므로 탭 하나가 문서 하나를 받는다. 이름은 사내에서 그 문서를
 * 부르는 이름 그대로다 — 화면에서만 통하는 이름을 새로 지으면 같은 것을 두 이름으로
 * 부르게 된다.
 */
export const GUIDE_TABS = [
  { key: "manual", label: "매뉴얼" },
  { key: "stackup", label: "Stack up" },
  { key: "si", label: "SI Rule" },
  { key: "pi", label: "PI Spec" },
  { key: "clearance", label: "부품 클리어런스" },
  { key: "dfm", label: "DFM Rule" },
] as const;

export type GuideTabKey = (typeof GUIDE_TABS)[number]["key"];

export const isGuideTab = (v: string | undefined): v is GuideTabKey =>
  GUIDE_TABS.some((t) => t.key === v);

export const guidePath = (tab?: GuideTabKey) => `/guide${tab ? `/${tab}` : ""}`;
