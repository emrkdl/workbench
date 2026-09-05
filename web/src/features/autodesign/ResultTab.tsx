import { useMemo, useState } from "react";
import { fetchRevision } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { Board, RevisionDetail } from "@/lib/cdm";
import type { DisplayUnit } from "@/lib/units";
import { Panel } from "@/components/ui";
import { ViewerTab } from "../viewer/ViewerTab";
import { CompareBoards, type CompareView } from "../compare/CompareBoards";
import { formatDuration, type JobState } from "./useJobRun";
import s from "./autodesign.module.css";

/**
 * 결과 — 맡긴 일이 판을 어떻게 바꿨는가.
 *
 * 결과를 본다는 것은 "판이 어떻게 생겼나"가 아니라 **"엔진이 무엇을 바꿨나"**다. 그래서
 * 판 하나를 띄우는 대신 비교 화면을 그대로 쓴다 — 실행 전과 후를 한 카메라로 나란히,
 * 또는 겹쳐 놓고 α 로 비쳐 본다. 비교에 이미 있는 조작(층 끄기·넷 강조·확장)도 딸려 온다.
 *
 * 지금은 엔진이 없어 후(後)가 전(前)과 같다. 그래서 이 화면은 **예행의 결과**를 그린다 —
 * 판은 실제로 달라지지 않았고, 화면은 그 사실을 숨기지 않는다. 엔진이 붙으면 오른쪽에
 * 넘겨줄 리비전만 바뀌고 이 화면은 그대로다.
 */
export function ResultTab({
  job,
  detail,
  loading,
  hasPreview,
  boards,
  referenceIds,
  onRun,
  canRun,
}: {
  job: JobState;
  detail: RevisionDetail | null;
  loading: boolean;
  hasPreview: boolean;
  /** 견줄 판을 고를 때 쓰는 카탈로그 전체. */
  boards: Board[];
  /** 조건에서 과거 참조로 고른 판들. 견주고 싶은 판은 대개 이 안에 있다. */
  referenceIds: string[];
  onRun: () => void;
  canRun: boolean;
}) {
  const [view, setView] = useState<CompareView>("side");
  const [labels, setLabels] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [unit, setUnit] = useState<DisplayUnit>("mm");
  /**
   * 무엇과 견줄 것인가. null 이면 **실행 전**, 곧 맡긴 판 자신이다.
   *
   * 기본은 자기 자신이다 — 결과를 보는 첫 물음은 늘 "내 판이 어떻게 달라졌나"이지
   * "남의 판과 어떻게 다른가"가 아니다. 다만 두 번째 물음도 흔해서(전 세대는 어떻게
   * 짰더라, 옆 모델은 이 블록을 어디에 뒀더라) 다른 판으로 갈아 끼울 수 있게 둔다.
   */
  const [withId, setWithId] = useState<string | null>(null);

  const refBoards = useMemo(
    () => boards.filter((b) => referenceIds.includes(b.latest_revision_id)),
    [boards, referenceIds],
  );

  const other = useAsync(
    () => (withId ? fetchRevision(withId) : Promise.resolve(null)),
    [withId],
  );

  // 판을 고르지 않았으면 그릴 것이 없다. HKP 를 열 수 없어 미리보기 리비전이 판을 대신한다.
  if (!hasPreview) {
    return (
      <Blank
        title="볼 판이 없습니다"
        body="올린 HKP 는 파서가 붙기 전까지 열어 볼 수 없습니다. 화면 맨 위의 ‘대신 볼 판’ 에서 이미 들어와 있는 리비전을 고르면 그 판으로 결과 화면을 확인할 수 있습니다."
      />
    );
  }

  if (loading) return <Blank title="판을 읽는 중" />;
  if (!detail) return <Blank title="판을 읽지 못했습니다" />;

  if (job.status === "running") {
    return (
      <div className={s.runningPane}>
        <div className={s.runningBar}>
          <div className={s.runningFill} style={{ width: `${Math.round(job.progress * 100)}%` }} />
        </div>
        <p className={s.runningPct}>{Math.round(job.progress * 100)}%</p>
        <p className={s.runningStage}>{job.stage?.label ?? "준비 중"}</p>
        <p className={s.runningEta}>
          {job.remainingMs !== null ? `남은 시간 약 ${formatDuration(job.remainingMs)}` : "남은 시간 가늠 중"}
        </p>
      </div>
    );
  }

  // 아직 돌리지 않았거나 멈췄으면 **지금 판**을 그대로 보여준다. 빈 상자를 띄우면
  // "결과를 보러 왔는데 볼 것이 없다"로 끝나지만, 실행 전 상태를 보여 주면 돌리기 전에
  // 무엇을 손댈지 눈으로 정할 수 있고 돌린 뒤에 무엇이 달라졌는지 견줄 기준도 생긴다.
  if (job.status !== "done") {
    const stopped = job.status === "stopped";
    return (
      <div className={s.resultPane}>
        <p className={s.resultNote}>
          <span>
            {stopped
              ? "중간에 멈췄습니다. 멈춘 작업의 결과는 남지 않습니다 — 아래는 실행 전 상태의 판입니다."
              : "아직 돌리지 않았습니다. 아래는 실행 전 상태의 판이고, 실행하면 이 자리에 전후를 맞대어 놓습니다."}
          </span>
          <button type="button" className={s.runBtn} disabled={!canRun} onClick={onRun}>
            {stopped ? "다시 실행" : "작업 실행"}
          </button>
        </p>
        <div className={s.viewerBox}>
          <ViewerTab detail={detail} unit={unit} onUnitChange={setUnit} />
        </div>
      </div>
    );
  }

  // 왼쪽에 세울 판. 고른 것이 없으면 맡긴 판 자신(실행 전)이다.
  const left = withId ? other.data : detail;
  const leftLabel = withId
    ? other.data
      ? `${other.data.revision.board_key} · ${other.data.revision.label}`
      : "불러오는 중"
    : "실행 전";
  /** 참조 목록에 없는 판을 골랐을 때만 고르개가 그 값을 들고 있는다. */
  const otherPick = withId && !referenceIds.includes(withId) ? withId : "";

  return (
    <div className={s.resultPane}>
      <p className={s.resultNote}>
        {withId ? (
          <span>
            왼쪽은 견주려고 고른 판이고 오른쪽이 이번 작업의 결과입니다. 엔진이 붙기 전이라
            오른쪽은 아직 <b>실행 전 그대로</b>입니다.
          </span>
        ) : (
          <span>
            엔진이 아직 붙지 않아 <b>오른쪽은 왼쪽과 같은 판</b>입니다. 예행이 흐른 시간만큼
            진행률이 찼을 뿐 판은 달라지지 않았습니다 — 엔진이 붙으면 이 자리에 결과
            리비전이 들어오고 화면은 그대로입니다.
          </span>
        )}
      </p>

      <Panel
        title="맞대어 보기"
        action={
          /* 확장은 패널 전체를 화면 가득 펼치는 일이라 패널 머리에 둔다 — 비교 화면과 같다. */
          <button
            type="button"
            className={s.expandBtn}
            title="화면 전체로 넓히기"
            onClick={() => setExpanded(true)}
          >
            ⤢ 확장
          </button>
        }
        flush
      >
        {/* 무엇과 견줄 것인가.
            기본은 실행 전(맡긴 판 자신)이다 — 결과를 보는 첫 물음은 늘 "내 판이 어떻게
            달라졌나"다. 그 옆에 조건에서 이미 고른 과거 참조 판들을 바로 꺼내 둔다.
            거기에도 없으면 카탈로그에서 아무 판이나 고른다. */}
        <div className={s.cmpBar}>
          <span className={s.cmpLabel}>비교 대상</span>
          <div className={s.seg} role="group" aria-label="비교 대상">
            <button
              type="button"
              className={withId === null ? s.segOn : ""}
              aria-pressed={withId === null}
              onClick={() => setWithId(null)}
            >
              실행 전
            </button>
            {refBoards.map((b) => (
              <button
                key={b.id}
                type="button"
                className={withId === b.latest_revision_id ? s.segOn : ""}
                aria-pressed={withId === b.latest_revision_id}
                title={`${b.board_key} · ${b.name} (과거 참조)`}
                onClick={() => setWithId(b.latest_revision_id)}
              >
                {b.board_key}
              </button>
            ))}
          </div>
          <select
            className={s.cmpPick}
            aria-label="다른 보드와 견주기"
            value={otherPick}
            onChange={(e) => setWithId(e.target.value || null)}
          >
            <option value="">다른 보드…</option>
            {boards.map((b) => (
              <option key={b.id} value={b.latest_revision_id}>
                {b.board_key} · {b.name}
              </option>
            ))}
          </select>
          {refBoards.length === 0 && (
            <span className={s.cmpHint}>조건에서 과거 참조를 고르면 여기에 바로 뜹니다</span>
          )}
        </div>

        <CompareBoards
          view={view}
          onViewChange={setView}
          labels={labels}
          onLabelsChange={setLabels}
          expanded={expanded}
          onExpandedChange={setExpanded}
          changes={[]}
          detailA={left}
          detailB={detail}
          labelA={leftLabel}
          labelB="자동 레이아웃 결과"
          unit={unit}
          height={460}
        />
      </Panel>
    </div>
  );
}

function Blank({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className={s.resultBlank}>
      <p className={s.resultBlankTitle}>{title}</p>
      {body && <p className={s.resultBlankBody}>{body}</p>}
      {action}
    </div>
  );
}
