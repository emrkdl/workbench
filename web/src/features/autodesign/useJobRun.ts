import { useEffect, useMemo, useRef, useState } from "react";

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
}

const TICK_MS = 120;

export function useJobRun(stages: Stage[], estimateMs: number) {
  const [status, setStatus] = useState<JobStatus>("idle");
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (status !== "running") return;
    const id = window.setInterval(() => {
      const next = Date.now() - startedAt.current;
      setElapsed(next);
      if (next >= estimateMs) setStatus("done");
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [status, estimateMs]);

  const state = useMemo<JobState>(() => {
    const progress =
      status === "done" ? 1 : status === "running" ? Math.min(elapsed / Math.max(estimateMs, 1), 0.999) : 0;

    // 진행률이 아직 얼마 안 됐을 때의 추정은 크게 튄다. 몇 초는 지나야 말이 된다.
    const remainingMs =
      status === "running" && progress > 0.02 ? Math.round((elapsed * (1 - progress)) / progress) : null;

    let stage: Stage | null = null;
    if (status === "running" || status === "done") {
      const total = stages.reduce((sum, x) => sum + x.weight, 0) || 1;
      let acc = 0;
      for (const st of stages) {
        acc += st.weight / total;
        if (progress <= acc) {
          stage = st;
          break;
        }
      }
      stage = stage ?? stages[stages.length - 1] ?? null;
    }

    return { status, progress, remainingMs, elapsedMs: elapsed, stage };
  }, [status, elapsed, estimateMs, stages]);

  const start = () => {
    startedAt.current = Date.now();
    setElapsed(0);
    setStatus("running");
  };
  const stop = () => setStatus("stopped");
  const reset = () => {
    setElapsed(0);
    setStatus("idle");
  };

  return { ...state, start, stop, reset };
}

/** 사람이 읽는 시간. 초 단위 아래는 의미가 없고, 분을 넘으면 초는 거들 뿐이다. */
export function formatDuration(ms: number): string {
  const total = Math.max(Math.round(ms / 1000), 0);
  if (total < 60) return `${total}초`;
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return sec ? `${min}분 ${sec}초` : `${min}분`;
}
