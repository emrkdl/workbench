import { useEffect, useState } from "react";
import type { Board, RevisionDetail } from "@/lib/cdm";
import s from "./compare.module.css";

/**
 * 비교할 두 리비전 고르기.
 *
 * 미리 만들어 둔 조합 목록에서 고르는 것이 아니라, 보드와 리비전을 한쪽씩 직접 고른다.
 * 무엇과 무엇을 견줄지는 설계자가 아는 것이고, 시스템이 정해 준 조합만 볼 수 있다면
 * 정작 궁금한 비교는 못 하게 된다.
 *
 * 리비전 목록은 그 보드 상세 응답에 실려 오는 계보(lineage)에서 나온다. 카탈로그는
 * 보드마다 최신 리비전만 알고 있어서, 보드를 고르면 일단 최신을 띄우고 상세가 도착한
 * 뒤에 나머지 리비전이 채워진다. 어차피 판을 그리려면 상세를 받아야 하므로 요청이
 * 늘지는 않는다.
 */

function Side({
  side,
  boards,
  detail,
  loading,
  onPick,
}: {
  side: "a" | "b";
  boards: Board[];
  detail: RevisionDetail | null;
  loading: boolean;
  onPick: (revisionId: string) => void;
}) {
  const boardId = detail?.revision.board_id ?? "";
  const lineage = detail?.lineage ?? [];

  return (
    <div className={s.pickSide}>
      <span className={`${s.side} ${side === "a" ? s.sideA : s.sideB}`}>{side.toUpperCase()}</span>
      <select
        className={s.pickSelect}
        value={boardId}
        aria-label={`${side.toUpperCase()} 보드`}
        onChange={(e) => {
          const next = boards.find((b) => b.id === e.target.value);
          if (next) onPick(next.latest_revision_id);
        }}
      >
        <option value="" disabled>
          보드 선택…
        </option>
        {boards.map((b) => (
          <option key={b.id} value={b.id}>
            {b.board_key} · {b.name}
          </option>
        ))}
      </select>
      <select
        className={`${s.pickSelect} ${s.pickRev}`}
        value={detail?.revision.id ?? ""}
        aria-label={`${side.toUpperCase()} 리비전`}
        disabled={lineage.length === 0}
        onChange={(e) => onPick(e.target.value)}
      >
        {lineage.length === 0 && <option value="">{loading ? "불러오는 중…" : "리비전"}</option>}
        {lineage.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label} · {r.created_at.slice(0, 10)}
          </option>
        ))}
      </select>
    </div>
  );
}

export function PairPicker({
  boards,
  detailA,
  detailB,
  loading,
  onPick,
  onSwap,
}: {
  boards: Board[];
  detailA: RevisionDetail | null;
  detailB: RevisionDetail | null;
  loading: boolean;
  onPick: (side: "a" | "b", revisionId: string) => void;
  onSwap: () => void;
}) {
  return (
    <div className={s.pick} aria-label="비교 대상 선택">
      <Side side="a" boards={boards} detail={detailA} loading={loading} onPick={(id) => onPick("a", id)} />
      <button
        type="button"
        className={s.swap}
        title="A 와 B 를 맞바꿉니다"
        aria-label="A 와 B 맞바꾸기"
        disabled={!detailA || !detailB}
        onClick={onSwap}
      >
        ⇄
      </button>
      <Side side="b" boards={boards} detail={detailB} loading={loading} onPick={(id) => onPick("b", id)} />
    </div>
  );
}

/* ── 최근에 본 조합 ─────────────────────────── */

const RECENT_KEY = "boardlens.compare.recent";
const RECENT_MAX = 6;

export interface RecentPair {
  a: string;
  b: string;
  label: string;
}

const pairKey = (p: RecentPair) => `${p.a}__${p.b}`;

/**
 * 최근 조합을 기억해 둔다. 조합이 목록에서 사라진 대신, 방금 보던 비교로 돌아가는 길은
 * 남아 있어야 한다. 브라우저에만 저장하므로 사람마다 자기가 보던 것이 남는다.
 *
 * 지우는 길도 함께 준다. 자동으로 쌓이는 목록은 스스로 지울 수 없으면 금세 쓸모없는
 * 조합으로 차고, 그러면 여섯 칸이 다 낭비된다.
 */
export function useRecentPairs(current: RecentPair | null): [RecentPair[], (key: string) => void] {
  const [recent, setRecent] = useState<RecentPair[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as RecentPair[];
      return Array.isArray(raw) ? raw.filter((p) => p && p.a && p.b) : [];
    } catch {
      return [];
    }
  });

  const save = (next: RecentPair[]) => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* 저장이 막혀도 이번 세션은 동작해야 한다 */
    }
    return next;
  };

  const drop = (key: string) => setRecent((prev) => save(prev.filter((p) => pairKey(p) !== key)));

  const key = current ? pairKey(current) : null;
  useEffect(() => {
    if (!current || !key) return;
    setRecent((prev) => {
      if (prev[0]?.a === current.a && prev[0]?.b === current.b) return prev;
      return save([current, ...prev.filter((p) => pairKey(p) !== key)].slice(0, RECENT_MAX));
    });
    // current 는 매 렌더 새 객체다. 조합이 실제로 바뀐 경우에만 돌린다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, current?.label]);

  return [recent, drop];
}

export function RecentPairs({
  pairs,
  current,
  onSelect,
  onDrop,
}: {
  pairs: RecentPair[];
  current: string | null;
  onSelect: (pair: RecentPair) => void;
  onDrop: (key: string) => void;
}) {
  if (pairs.length === 0) return null;
  return (
    <div className={s.recent}>
      <span className={s.recentLabel}>최근</span>
      {pairs.map((p) => {
        const key = pairKey(p);
        // 버튼 안에 버튼을 넣을 수 없어 칩을 감싸는 껍데기를 하나 둔다.
        return (
          <span key={key} className={`${s.recentChip} ${current === key ? s.recentChipOn : ""}`}>
            <button type="button" className={s.recentPick} onClick={() => onSelect(p)}>
              {p.label}
            </button>
            <button
              type="button"
              className={s.recentDrop}
              title="최근 목록에서 빼기"
              aria-label={`${p.label} 를 최근 목록에서 빼기`}
              onClick={() => onDrop(key)}
            >
              ×
            </button>
          </span>
        );
      })}
    </div>
  );
}
