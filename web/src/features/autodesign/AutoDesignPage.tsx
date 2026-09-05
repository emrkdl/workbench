import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fetchCatalog, fetchRevision } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { ErrorState, Loading, Panel } from "@/components/ui";
import { AUTO_TABS, autoPath, isAutoTab, type AutoTabKey } from "@/lib/routes";
import { SourceCard } from "./SourceCard";
import { ResultTab } from "./ResultTab";
import { PlacementPanel } from "./PlacementPanel";
import { RoutingPanel } from "./RoutingPanel";
import { EMPTY_SPEC, toRequest, type AutoDesignSpec } from "./spec";
import { formatDuration, startJob, stopJob, useJobRun, type Stage } from "./useJobRun";
import s from "./autodesign.module.css";

/**
 * 자동 레이아웃.
 *
 * 이름을 "자동 설계"에서 옮겼다. 설계라고 하면 회로(스키매틱)까지 포함하는 것처럼
 * 들리는데 이 화면은 회로를 손대지 않는다 — 부품을 놓고 선을 잇는 일만 한다. 실무에서
 * 그 일을 통칭하는 말이 레이아웃이다.
 *
 * 이 화면은 배치도 배선도 하지 않는다 — 그 일은 따로 도는 엔진의 몫이다. 여기서 하는 것은
 * **무엇을 어떤 조건으로 맡길지 사람이 빠짐없이 적게 하는 일**이다. 엔진에 "알아서 해 줘"만
 * 던지면 커넥터가 판 한가운데로 가고, 관통 비아가 뚫려서는 안 될 자리에 뚫린다. 사람만
 * 아는 제약을 옮겨 적는 자리가 없으면 결과를 손으로 다시 고치게 되고, 그러면 자동화한
 * 보람이 없다.
 *
 * 화면은 위에서 아래로 한 줄기다 — 무엇을(대상) · 무엇을 맡길지(배치/배선) · 어떻게(조건) ·
 * 확인(요청서). 왼쪽에 요청서가 계속 붙어 있어서, 조건을 만질 때마다 무엇이 달라지는지
 * 그 자리에서 보인다.
 */

export function AutoDesignPage() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const active: AutoTabKey = isAutoTab(tab) ? tab : "spec";

  const [spec, setSpec] = useState<AutoDesignSpec>(EMPTY_SPEC);
  const catalog = useAsync(fetchCatalog, []);

  const boards = useMemo(
    () => [...(catalog.data?.items ?? [])].sort((a, b) => a.board_key.localeCompare(b.board_key)),
    [catalog.data],
  );

  // 파서가 붙기 전까지 부품 목록을 대신 읽어 올 자리. 올린 HKP 는 열어 볼 수 없으므로
  // 이미 들어와 있는 리비전으로 화면을 채워 본다 — 임시 발판이고, 파서가 붙으면 사라진다.
  const detail = useAsync(
    () => (spec.previewRevisionId ? fetchRevision(spec.previewRevisionId) : Promise.resolve(null)),
    [spec.previewRevisionId],
  );

  /**
   * 대신 볼 판.
   *
   * 파서가 붙기 전까지 올린 HKP 는 열어 볼 수 없다. 그러면 부품 목록도 판 그림도 없어
   * 이 화면에서 할 수 있는 일이 없다 — 조건을 짜 볼 수도, 결과를 확인할 수도 없다.
   *
   * 그래서 이미 들어와 있는 리비전 하나를 판 대신 세운다. 이것을 고르면 파일이 없어도
   * 배치 조건을 짜고 실행해 결과 화면까지 볼 수 있다. 임시 발판이고, 파서가 붙으면
   * 이 고르개는 사라진다.
   */
  const previewPicker = (
    <label className={s.previewPick} title="HKP 를 열 수 없는 동안, 이미 들어와 있는 판으로 화면을 확인합니다">
      <span>대신 볼 판</span>
      <select
        value={spec.previewRevisionId ?? ""}
        onChange={(e) => setSpec({ ...spec, previewRevisionId: e.target.value || null })}
      >
        <option value="">고르지 않음</option>
        {boards.map((b) => (
          <option key={b.id} value={b.latest_revision_id}>
            {b.board_key} · {b.name}
          </option>
        ))}
      </select>
    </label>
  );

  const request = useMemo(() => toRequest(spec), [spec]);

  /** 맡긴 일에 따라 단계가 달라진다. 배선을 끄면 배선 단계가 아예 없다. */
  const stages = useMemo<Stage[]>(() => {
    const out: Stage[] = [
      { key: "read", label: "설계 읽기", weight: 1 },
      { key: "rules", label: "제약 확인", weight: 1 },
    ];
    if (spec.modes.place) out.push({ key: "place", label: "부품 배치", weight: 6 });
    if (spec.modes.route) out.push({ key: "route", label: "배선", weight: 14 });
    out.push({ key: "check", label: "규칙 검사", weight: 2 });
    return out;
  }, [spec.modes.place, spec.modes.route]);

  /**
   * 예상 소요. 판이 클수록 오래 걸린다 — 부품 수와 넷 수로 가늠한다. 미리보기 리비전이
   * 없으면 중간 규모를 가정한다.
   */
  const estimateMs = useMemo(() => {
    const sm = detail.data?.revision.summary;
    const comps = sm?.component_count ?? 600;
    const nets = sm?.net_count ?? 700;
    return Math.round(3000 + (spec.modes.place ? comps * 6 : 0) + (spec.modes.route ? nets * 14 : 0));
  }, [detail.data, spec.modes.place, spec.modes.route]);

  const job = useJobRun();

  /** 실행을 누른 사람은 결과를 보러 온 것이다. 조건 화면에 남겨 두면 스스로 탭을 옮겨야 한다. */
  const run = () => {
    startJob(stages, estimateMs);
    navigate(autoPath("result"));
  };

  const problems = useMemo(() => {
    const out: string[] = [];
    // 파서가 붙기 전까지는 둘 중 하나면 된다 — 올린 파일이거나, 대신 볼 판이거나.
    // 파일만 요구하면 열지도 못할 파일을 올려야 화면을 볼 수 있는 꼴이 된다.
    if (!spec.source.files.length && !spec.previewRevisionId)
      out.push("설계 파일을 올리거나, 맨 위에서 ‘대신 볼 판’ 을 고르세요.");
    if (spec.reference.enabled && spec.reference.revisionIds.length === 0)
      out.push("과거 설계를 참조하기로 했는데 참조할 보드를 고르지 않았습니다.");
    if (!spec.modes.place && !spec.modes.route) out.push("배치와 배선 중 적어도 하나는 맡겨야 합니다.");
    if (spec.modes.place && spec.placement.scope === "selected" && spec.placement.refdes.length === 0)
      out.push("‘고른 부품만’ 을 골랐는데 부품을 하나도 고르지 않았습니다.");
    if (spec.modes.route && spec.routing.scope === "classes" && spec.routing.netClasses.length === 0)
      out.push("‘고른 넷 클래스만’ 을 골랐는데 클래스를 하나도 고르지 않았습니다.");
    return out;
  }, [spec]);

  if (catalog.loading) return <Loading label="보드 목록을 불러오는 중" />;
  if (catalog.error) return <ErrorState error={catalog.error} />;

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>자동 레이아웃</h1>
        {/* 무엇을 맡길지가 이 화면의 첫 갈림길이다 — 이 둘에 따라 아래 조건이 통째로
            나타나고 사라진다. 그래서 맨 위에 두되, 자리는 조금만 쓴다. */}
        <div className={s.modeBar}>
          <ModePill
            on={spec.modes.place}
            glyph="▦"
            label="자동 배치"
            onToggle={() => setSpec({ ...spec, modes: { ...spec.modes, place: !spec.modes.place } })}
          />
          <ModePill
            on={spec.modes.route}
            glyph="⌁"
            label="자동 배선"
            onToggle={() => setSpec({ ...spec, modes: { ...spec.modes, route: !spec.modes.route } })}
          />
        </div>
        {!spec.modes.place && !spec.modes.route && (
          <span className={s.warn}>둘 다 끄면 엔진에 맡길 일이 없습니다.</span>
        )}
        <span className={s.spacer} />
        {/* 미리보기 고르개는 배치 패널 안에 있었는데, 결과 탭에도 같은 판이 필요해서
            화면 머리로 올렸다. 어느 판을 두고 이야기하는지는 페이지 전체의 조건이다. */}
        {previewPicker}
        <button type="button" className={s.linkBtn} onClick={() => setSpec(EMPTY_SPEC)}>
          모두 지우기
        </button>

        {/* 조건을 짜는 일과 결과를 보는 일은 시간이 다르다. 실행을 누르면 결과 쪽으로
            넘어가고, 조건은 그대로 남아 있어 고쳐서 다시 돌릴 수 있다. */}
        <nav className={s.tabs} aria-label="자동 레이아웃 탭">
          {AUTO_TABS.map((t) => (
            <Link
              key={t.key}
              to={autoPath(t.key)}
              className={`${s.tab} ${t.key === active ? s.tabOn : ""}`}
            >
              {t.label}
              {t.key === "result" && job.status === "done" && <i className={s.tabDot} aria-hidden="true" />}
            </Link>
          ))}
        </nav>
      </header>

      <div className={s.body}>
        {active === "result" ? (
          <div className={s.col}>
            <ResultTab
              job={job}
              detail={detail.data}
              loading={detail.loading}
              hasPreview={spec.previewRevisionId !== null}
              unit="mm"
              canRun={problems.length === 0}
              onRun={run}
            />
          </div>
        ) : (
        <div className={s.col}>
          <Panel title="대상">
            <SourceCard
              boards={boards}
              source={spec.source}
              reference={spec.reference}
              onSourceChange={(source) => setSpec({ ...spec, source })}
              onReferenceChange={(reference) => setSpec({ ...spec, reference })}
            />
          </Panel>

          {detail.loading && <Loading label="리비전을 읽는 중" />}

          {spec.modes.place && (
            <PlacementPanel
              detail={detail.data}
              spec={spec.placement}
              onChange={(placement) => setSpec({ ...spec, placement })}
            />
          )}

          {spec.modes.route && (
            <RoutingPanel
              detail={detail.data}
              spec={spec.routing}
              onChange={(routing) => setSpec({ ...spec, routing })}
            />
          )}
        </div>
        )}

        {/* 요청서는 계속 붙어 있다. 조건을 만질 때마다 무엇이 달라지는지 그 자리에서 보인다. */}
        <aside className={s.side}>
          <div className={s.sideStick}>
            <Panel title={active === "result" ? "결과" : "요청서"}>
              {/* 조건 탭에서는 무엇을 맡길지, 결과 탭에서는 무엇이 나왔는지. 실행 단추와
                  진행률은 두 탭에 똑같이 남는다 — 어느 쪽을 보고 있든 멈추거나 다시
                  돌릴 수 있어야 한다. */}
              {active === "result" ? (
                <dl className={s.summary}>
                  <dt>판</dt>
                  <dd>{detail.data ? detail.data.revision.board_key : "—"}</dd>
                  <dt>맡긴 일</dt>
                  <dd>
                    {[spec.modes.place && "배치", spec.modes.route && "배선"]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </dd>
                  <dt>걸린 시간</dt>
                  <dd>{job.status === "done" ? formatDuration(job.elapsedMs) : "—"}</dd>
                  <dt>바뀐 것</dt>
                  {/* 엔진이 없으니 배치한 부품 수도 DRC 건수도 없다. 그럴듯한 숫자를 적어
                      두면 그것을 결과로 알고 보고에 옮겨 적는 사람이 생긴다. */}
                  <dd>없음 · 예행</dd>
                </dl>
              ) : (
              <dl className={s.summary}>
                <dt>대상</dt>
                <dd>
                  {spec.source.files.length ? (
                    <>
                      <b className={s.summaryModel}>{spec.source.model ?? "모델 미상"}</b>
                      <span className={s.summaryFiles}>파일 {spec.source.files.length}개</span>
                    </>
                  ) : detail.data ? (
                    <>
                      <b className={s.summaryModel}>{detail.data.revision.board_key}</b>
                      <span className={s.summaryFiles}>대신 볼 판</span>
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
                <dt>참조</dt>
                <dd>
                  {spec.reference.enabled
                    ? spec.reference.revisionIds.length
                      ? `${spec.reference.revisionIds.length}장`
                      : "켬 (고른 보드 없음)"
                    : "안 함"}
                </dd>
                <dt>맡길 일</dt>
                <dd>
                  {[spec.modes.place && "배치", spec.modes.route && "배선"].filter(Boolean).join(" · ") || "—"}
                </dd>
                {spec.modes.place && (
                  <>
                    <dt>배치 대상</dt>
                    <dd>
                      {spec.placement.scope === "all" ? "판 전체" : `${spec.placement.refdes.length}개 부품`}
                    </dd>
                  </>
                )}
                {spec.modes.route && (
                  <>
                    <dt>배선 대상</dt>
                    <dd>
                      {spec.routing.scope === "all" ? "모든 넷" : `${spec.routing.netClasses.length}개 클래스`}
                      {spec.routing.layers.length > 0 && ` · L${spec.routing.layers.join(", L")}`}
                    </dd>
                  </>
                )}
              </dl>
              )}

              {job.status === "idle" &&
                (problems.length > 0 ? (
                  <ul className={s.problems}>
                    {problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                ) : (
                  <p className={s.ready}>실행할 준비가 됐습니다.</p>
                ))}

              {job.status === "running" ? (
                <button type="button" className={`${s.submit} ${s.stop}`} onClick={stopJob}>
                  중지
                </button>
              ) : (
                <button
                  type="button"
                  className={s.submit}
                  disabled={job.status === "idle" && problems.length > 0}
                  onClick={run}
                >
                  {job.status === "idle" ? "작업 실행" : "다시 실행"}
                </button>
              )}

              {(job.status === "running" || job.status === "done") && (
                <div className={s.progress}>
                  <div className={s.progressBar}>
                    <div
                      className={`${s.progressFill} ${job.status === "done" ? s.progressDone : ""}`}
                      style={{ width: `${Math.round(job.progress * 100)}%` }}
                    />
                  </div>
                  <div className={s.progressText}>
                    <b>{Math.round(job.progress * 100)}%</b>
                    <span>{job.status === "done" ? "완료" : job.stage?.label}</span>
                    <span className={s.spacer} />
                    <span className={s.progressEta}>
                      {job.status === "done"
                        ? `${formatDuration(job.elapsedMs)} 걸림`
                        : job.remainingMs !== null
                          ? `남은 시간 약 ${formatDuration(job.remainingMs)}`
                          : "남은 시간 가늠 중"}
                    </span>
                  </div>
                  <ol className={s.stageList}>
                    {job.stages.map((st, at) => {
                      const now = job.stage ? job.stages.indexOf(job.stage) : -1;
                      const cls =
                        job.status === "done" || at < now ? s.stageDone : at === now ? s.stageNow : s.stageWait;
                      return (
                        <li key={st.key} className={cls}>
                          {st.label}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}

              {job.status === "stopped" && (
                <p className={s.stoppedNote}>중간에 멈췄습니다. 결과는 남지 않습니다.</p>
              )}

              <p className={s.hint}>
                배치·배선 엔진은 아직 붙지 않아 지금 실행은 <b>예행</b>입니다 — 시간만 흐르고
                판은 달라지지 않습니다. 엔진이 붙으면 진행률의 출처만 바뀌고 이 화면은
                그대로입니다.
              </p>
            </Panel>

            {/* 넘길 값은 조건 탭의 것이다. 결과를 보는 자리에 요청서 원문까지 두면
                오른쪽이 두 이야기를 한꺼번에 한다. */}
            {active === "spec" && (
              <Panel title="엔진에 넘길 값" flush>
                <pre className={s.json}>{JSON.stringify(request, null, 2)}</pre>
              </Panel>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** 작고 또렷하게. 켜져 있으면 액센트로 채우고, 꺼져 있으면 테두리만 남긴다. */
function ModePill({
  on,
  glyph,
  label,
  onToggle,
}: {
  on: boolean;
  glyph: string;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button type="button" className={`${s.modePill} ${on ? s.modePillOn : ""}`} aria-pressed={on} onClick={onToggle}>
      <span className={s.modePillGlyph} aria-hidden="true">{glyph}</span>
      {label}
      <span className={`${s.switch} ${on ? s.switchOn : ""}`} aria-hidden="true">
        <i />
      </span>
    </button>
  );
}
