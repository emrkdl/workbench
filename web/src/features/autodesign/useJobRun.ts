import { useMemo, useSyncExternalStore } from "react";

/**
 * 작업 진행 상태.
 *
 * 엔진이 아직 붙지 않아 지금은 여기서 시계를 돌린다 — **예행**이다. 다만 화면이 읽는
 * 값의 모양은 실제와 같게 두었다: 단계 목록, 0~1 진행률, 그리고 남은 시간. 엔진이 붙으면
 * 진행률의 출처만 바뀌고 화면은 그대로다.
 *
 * 남은 시간은 총 시간에서 빼는 것이 아니라 **지금까지 걸린 시간과 진행률로 되짚어** 낸다.
 * 실제 엔진은 총 시간을 모른 채 진행률만 흘려보내기 때문이다. 예행에서도 같은 식을 쓰면
 * 엔진이 붙었을 때 이 계산을 다시 짤 일이 없다.
 *
 * 상태를 화면 안이 아니라 **모듈에** 둔다. 맡긴 일은 몇 분씩 걸리고 그동안 사람은 카탈로그를
 * 뒤지러 간다 — 화면을 떠나면 시계가 멈추는 것이 아니라, 떠나 있는 동안에도 왼쪽 메뉴가
 * 진행률을 들고 있어야 한다. 돌아가는 작업은 어차피 하나뿐이라 하나만 담는다.
 */

export interface Stage {
  key: string;
  label: string;
  /** 이 단계가 전체에서 차지하는 몫. 합이 1 일 필요는 없다 — 비율로만 쓴다. */
  weight: number;
}

export type JobStatus = "idle" | "running" | "done" | "stopped";

export interface JobState {
  status: JobStatus;
  /** 0~1 */
  progress: number;
  /** 남은 시간(ms). 아직 가늠할 수 없으면 null. */
  remainingMs: number | null;
  elapsedMs: number;
  stage: Stage | null;
  /** 시작할 때 정해진 단계 목록. 도중에 화면에서 조건을 바꿔도 돌던 작업의 단계는 그대로다. */
  stages: Stage[];
}

const TICK_MS = 120;

interface Run {
  status: JobStatus;
  elapsed: number;
  estimateMs: number;
  stages: Stage[];
}

const IDLE: Run = { status: "idle", elapsed: 0, estimateMs: 1, stages: [] };

let run: Run = IDLE;
let startedAt = 0;
let timer = 0;
const listeners = new Set<() => void>();

function set(next: Run) {
  run = next;
  for (const fn of listeners) fn();
}

function halt() {
  if (!timer) return;
  window.clearInterval(timer);
  timer = 0;
}

export function startJob(stages: Stage[], estimateMs: number) {
  halt();
  startedAt = Date.now();
  set({ status: "running", elapsed: 0, estimateMs: Math.max(estimateMs, 1), stages });
  timer = window.setInterval(() => {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= run.estimateMs) {
      halt();
      set({ ...run, status: "done", elapsed: run.estimateMs });
      return;
    }
    set({ ...run, elapsed });
  }, TICK_MS);
}

export function stopJob() {
  halt();
  set({ ...run, status: "stopped" });
}

export function resetJob() {
  halt();
  set(IDLE);
}

function derive(r: Run): JobState {
  const progress =
    r.status === "done" ? 1 : r.status === "running" ? Math.min(r.elapsed / r.estimateMs, 0.999) : 0;

  // 진행률이 아직 얼마 안 됐을 때의 추정은 크게 튄다. 몇 초는 지나야 말이 된다.
  const remainingMs =
    r.status === "running" && progress > 0.02 ? Math.round((r.elapsed * (1 - progress)) / progress) : null;

  let stage: Stage | null = null;
  if (r.status === "running" || r.status === "done") {
    const total = r.stages.reduce((sum, x) => sum + x.weight, 0) || 1;
    let acc = 0;
    for (const st of r.stages) {
      acc += st.weight / total;
      if (progress <= acc) {
        stage = st;
        break;
      }
    }
    stage = stage ?? r.stages[r.stages.length - 1] ?? null;
  }

  return { status: r.status, progress, remainingMs, elapsedMs: r.elapsed, stage, stages: r.stages };
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/**
 * 돌아가는 작업을 들여다본다. 어디서 불러도 같은 하나를 본다 — 작업을 맡긴 화면도,
 * 그 화면을 떠난 사람에게 진행률을 알려 주는 왼쪽 메뉴도.
 */
export function useJobRun(): JobState {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => run,
    () => IDLE,
  );
  return useMemo(() => derive(snapshot), [snapshot]);
}

/** 사람이 읽는 시간. 초 단위 아래는 의미가 없고, 분을 넘으면 초는 거들 뿐이다. */
export function formatDuration(ms: number): string {
  const total = Math.max(Math.round(ms / 1000), 0);
  if (total < 60) return `${total}초`;
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return sec ? `${min}분 ${sec}초` : `${min}분`;
}
