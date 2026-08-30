import { Link } from "react-router-dom";
import type { Board } from "@/lib/cdm";
import { StatusPill, Tag } from "@/components/ui";
import { BoardFigure } from "@/components/BoardFigure";
import { formatCount, formatDimensions } from "@/lib/units";
import { revisionPath } from "@/lib/routes";
import s from "./catalog.module.css";

function BoardCard({ board }: { board: Board }) {
  const sm = board.summary;
  return (
    <Link className={s.card} to={revisionPath(board.id, board.latest_revision_id)}>
      <div className={s.cardShape}>
        {/* 큰 부품만 그린다 — 카드 크기에서 형태로 읽히는 것이 그것뿐이다. 전체 배치는 뷰어에서. */}
        {board.outline && (
          <BoardFigure outline={board.outline} components={board.landmarks} height={82} partial />
        )}
        <span className={s.cardDims}>{formatDimensions(sm.width_nm, sm.height_nm)}</span>
      </div>

      <div className={s.cardBody}>
        <div className={s.cardTop}>
          <span className={s.cardKey}>{board.board_key}</span>
          <StatusPill status={board.status} />
        </div>
        <span className={s.cardName}>{board.name}</span>
        <div className={s.cardMeta}>
          <span>{board.latest_revision_label}</span>
          <span>·</span>
          <span>{board.owner ?? "담당 미지정"}</span>
          <span>·</span>
          <span>리비전 {board.revision_count}</span>
        </div>

        {board.tags.length > 0 && (
          <div className={s.cardTags}>
            {board.tags.map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </div>
        )}

        <div className={s.cardStats}>
          <div className={s.cardStat}>
            <span className={s.cardStatValue}>{sm.layer_count}</span>
            <span className={s.cardStatLabel}>층</span>
          </div>
          <div className={s.cardStat}>
            <span className={s.cardStatValue}>{formatCount(sm.component_count)}</span>
            <span className={s.cardStatLabel}>부품</span>
          </div>
          <div className={s.cardStat}>
            <span className={s.cardStatValue}>{formatCount(sm.net_count)}</span>
            <span className={s.cardStatLabel}>넷</span>
          </div>
          <div className={s.cardStat}>
            <span className={s.cardStatValue}>{sm.complexity_score}</span>
            <span className={s.cardStatLabel}>복잡도</span>
            <div className={s.gauge} aria-hidden="true">
              <div className={s.gaugeFill} style={{ width: `${sm.complexity_score}%` }} />
            </div>
          </div>
        </div>
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
