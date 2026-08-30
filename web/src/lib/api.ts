/**
 * 데이터 접근 계층.
 *
 * 목데이터와 실제 bl-core 를 한 파일에서 가른다. 화면들은 여기서 나오는 타입만 알고 그
 * 타입은 cdm/schema 에서 생성된 것이므로, 어느 쪽을 보든 화면 코드는 바뀌지 않는다.
 *
 *   VITE_API_BASE 없음  → tools/mockgen 이 만든 정적 JSON (기본값)
 *   VITE_API_BASE 있음  → 그 주소의 REST API + Bearer 토큰
 *
 * 두 모드가 같은 계약을 지키는지는 backend/tests/test_api.py 가 지킨다.
 */

import type {
  BoardPage,
  ChangeSet,
  ChangeSetIndex,
  PartDetail,
  PartIndex,
  PortfolioStats,
  RevisionDetail,
} from "./cdm";

const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";
export const LIVE = API_BASE !== "";
const MOCK_BASE = `${import.meta.env.BASE_URL}mock`;

const TOKEN_KEY = "boardlens.token";

export function token(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(value: string | null) {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 사생활 보호 모드에서 저장이 막혀도 이번 세션은 동작해야 한다 */
  }
  inflight.clear();
}

export interface MockManifest {
  generated_at: string;
  seed: number;
  cdm_version: string;
  parser_version: string;
  board_count: number;
  revision_count: number;
  component_total: number;
  net_total: number;
  part_count: number;
  changeset_count: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class Unauthorized extends ApiError {}

/** 같은 리소스를 여러 컴포넌트가 동시에 요구해도 요청은 한 번만 나간다. */
const inflight = new Map<string, Promise<unknown>>();

async function request<T>(url: string): Promise<T> {
  const cached = inflight.get(url);
  if (cached) return cached as Promise<T>;

  const promise = (async () => {
    const headers: Record<string, string> = {};
    const t = token();
    if (LIVE && t) headers.Authorization = `Bearer ${t}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      inflight.delete(url);
      if (res.status === 401) throw new Unauthorized("로그인이 필요합니다.", 401, url);
      if (res.status === 403) throw new ApiError("이 자료를 볼 권한이 없습니다.", 403, url);
      throw new ApiError(
        res.status === 404 ? "요청한 데이터를 찾을 수 없습니다." : `서버 응답 ${res.status}`,
        res.status,
        url,
      );
    }
    return (await res.json()) as T;
  })();

  inflight.set(url, promise);
  return promise;
}

/** 목/실서버의 주소 차이를 여기 한 곳에 모은다. */
const endpoint = {
  manifest: () => `${MOCK_BASE}/index.json`,
  catalog: () => (LIVE ? `${API_BASE}/api/catalog` : `${MOCK_BASE}/catalog.json`),
  revision: (id: string) => (LIVE ? `${API_BASE}/api/revisions/${id}` : `${MOCK_BASE}/revisions/${id}.json`),
  changesetIndex: () => (LIVE ? `${API_BASE}/api/changesets` : `${MOCK_BASE}/changesets/index.json`),
  changeset: (a: string, b: string) =>
    LIVE ? `${API_BASE}/api/changesets/${a}/${b}` : `${MOCK_BASE}/changesets/${a}__${b}.json`,
  parts: () => (LIVE ? `${API_BASE}/api/parts` : `${MOCK_BASE}/parts/index.json`),
  part: (id: string) => (LIVE ? `${API_BASE}/api/parts/${id}` : `${MOCK_BASE}/parts/${id}.json`),
  insights: () => (LIVE ? `${API_BASE}/api/insights` : `${MOCK_BASE}/insights.json`),
};

export const fetchCatalog = () => request<BoardPage>(endpoint.catalog());
export const fetchRevision = (revisionId: string) => request<RevisionDetail>(endpoint.revision(revisionId));
export const fetchChangeSetIndex = () => request<ChangeSetIndex>(endpoint.changesetIndex());
export const fetchChangeSet = (a: string, b: string) => request<ChangeSet>(endpoint.changeset(a, b));
export const fetchParts = () => request<PartIndex>(endpoint.parts());
export const fetchPartDetail = (partId: string) => request<PartDetail>(endpoint.part(partId));
export const fetchInsights = () => request<PortfolioStats>(endpoint.insights());

/** 목데이터 생성 정보. 실서버 모드에서는 표시할 것이 없다. */
export const fetchManifest = async (): Promise<MockManifest | null> =>
  LIVE ? null : request<MockManifest>(endpoint.manifest());

/**
 * 레이어 기하 버퍼(.blg)의 주소.
 *
 * 목 모드에서는 정적 파일을 바로 받는다. 실서버에서는 권한을 확인하는 얇은 통로를
 * 지나지만, 어느 쪽이든 JSON 직렬화는 없다 — 받은 바이트가 그대로 GPU 로 간다.
 */
export function geometryUrl(revisionId: string, layerIndex: number, storageKey: string): string {
  return LIVE ? `${API_BASE}/api/geometry/${revisionId}/${layerIndex}` : `${MOCK_BASE}/${storageKey}`;
}

export interface Session {
  token: string;
  username: string;
  display_name: string;
  role: string;
  projects: string[];
}

export async function login(username: string, password: string): Promise<Session> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new ApiError("아이디 또는 비밀번호가 맞지 않습니다.", res.status, "/api/auth/login");
  const session = (await res.json()) as Session;
  setToken(session.token);
  return session;
}

export async function whoami(): Promise<Session | null> {
  if (!LIVE || !token()) return null;
  try {
    return await request<Session>(`${API_BASE}/api/auth/me`);
  } catch {
    return null;
  }
}
