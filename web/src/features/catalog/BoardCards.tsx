import { Link } from "react-router-dom";
import type { Board } from "@/lib/cdm";
import { StatusPill } from "@/components/ui";
import { BoardFigure } from "@/components/BoardFigure";
import { revisionPath } from "@/lib/routes";
import s from "./catalog.module.css";

/**
 * 카드 보기.
 *
 * 표 보기와 역할을 나눈다. 표는 숫자를 견주는 자리이고, 카드는 **생김새로 찾는** 자리다 —
 * "가로로 긴 그 플렉스", "가운데 큰 BGA 두 개 박힌 그 보드". 그래서 카드에는 보드 외형과
 * 부품 배치만 두고, 층수·부품 수·복잡도 같은 숫자는 표에 맡긴다. 같은 값을 두 곳에서
 * 반복하면 카드가 표의 못난 복제가 된다.
 */

function BoardCard({ board }: { board: Board }) {
  return (
    <Link
      className={s.card}
      to={revisionPath(board.id, board.latest_revision_id)}
      title={`${board.board_key} · ${board.name}`}
    >
      <div className={s.cardShape}>
        {/* 큰 부품만 그린다 — 카드 크기에서 형태로 읽히는 것이 그것뿐이다. 전체 배치는 뷰어에서. */}
        <BoardFigure outline={board.outline} components={board.landmarks} height={132} partial />
      </div>
      <div className={s.cardBody}>
        <span className={s.cardKey}>{board.board_key}</span>
        <span className={s.cardName}>{board.name}</span>
        <StatusPill status={board.status} />
      </div>
    </Link>
  );
}

export function BoardCards({ boards }: { boards: Board[] }) {
  return (
    <div className={s.cards}>
      {boards.map((b) => (
        <BoardCard key={b.id} board={b} />
      ))}
    </div>
  );
}
