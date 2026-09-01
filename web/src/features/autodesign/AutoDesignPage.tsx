import { useMemo, useState } from "react";
import { fetchCatalog, fetchRevision } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { ErrorState, Loading, Panel } from "@/components/ui";
import { SourceCard } from "./SourceCard";
import { PlacementPanel } from "./PlacementPanel";
import { RoutingPanel } from "./RoutingPanel";
import { EMPTY_SPEC, toRequest, type AutoDesignSpec } from "./spec";
import s from "./autodesign.module.css";

/**
 * 자동 설계.
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

const PROMPT_EXAMPLES = [
  "커넥터는 보드 가장자리에 붙이고 안테나 주변 5mm 는 비워 둘 것",
  "전원부는 좌하단에 모으고 스위칭 소자와 인덕터는 서로 붙일 것",
  "고속 차동쌍은 층을 바꾸지 말고 L1 으로만 뺄 것",
  "이전 세대 보드와 커넥터 위치를 같게 맞출 것",
];

export function AutoDesignPage() {
  const [spec, setSpec] = useState<AutoDesignSpec>(EMPTY_SPEC);
  const catalog = useAsync(fetchCatalog, []);

  const boards = useMemo(
    () => [...(catalog.data?.items ?? [])].sort((a, b) => a.board_key.localeCompare(b.board_key)),
    [catalog.data],
  );

  // 대상이 리비전일 때만 부품·넷·적층을 읽어 올 수 있다. 올린 HKP 는 문법이 붙기 전까지
  // 열어 볼 수 없다 — 그 사실은 SourceCard 가 화면에 적어 둔다.
  const revisionId = spec.source?.kind === "revision" ? spec.source.revisionId ?? null : null;
  const detail = useAsync(
    () => (revisionId ? fetchRevision(revisionId) : Promise.resolve(null)),
    [revisionId],
  );

  const request = useMemo(() => toRequest(spec), [spec]);

  const problems = useMemo(() => {
    const out: string[] = [];
    if (!spec.source) out.push("설계 파일이나 리비전을 고르지 않았습니다.");
    if (!spec.modes.place && !spec.modes.route) out.push("배치와 배선 중 적어도 하나는 맡겨야 합니다.");
    if (spec.modes.place && spec.placement.scope === "selected" && spec.placement.refdes.length === 0)
      out.push("‘고른 부품만’ 을 골랐는데 부품을 하나도 고르지 않았습니다.");
    if (spec.modes.route && spec.routing.scope === "classes" && spec.routing.netClasses.length === 0)
      out.push("‘고른 넷 클래스만’ 을 골랐는데 클래스를 하나도 고르지 않았습니다.");
    if (spec.modes.route && spec.routing.viaKinds.length === 0)
      out.push("허용한 비아가 하나도 없습니다 — 층을 넘을 방법이 없습니다.");
    return out;
  }, [spec]);

  if (catalog.loading) return <Loading label="보드 목록을 불러오는 중" />;
  if (catalog.error) return <ErrorState error={catalog.error} />;

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>자동 설계</h1>
        <span className={s.lede}>배치와 배선을 엔진에 맡기기 위한 조건을 적습니다.</span>
        <span className={s.spacer} />
        <button type="button" className={s.linkBtn} onClick={() => setSpec(EMPTY_SPEC)}>
          모두 지우기
        </button>
      </header>

      <div className={s.body}>
        <div className={s.col}>
          <Panel title="대상">
            <SourceCard
              boards={boards}
              source={spec.source}
              onChange={(source) => setSpec({ ...spec, source })}
            />
          </Panel>

          <Panel title="무엇을 맡길까">
            {/* 둘 다 켠 것이 기본이다. 따로 돌리는 것은 한쪽이 이미 끝났을 때뿐이다. */}
            <div className={s.modeGrid}>
              <ModeCard
                on={spec.modes.place}
                title="자동 배치"
                glyph="▦"
                body="부품을 판 위에 놓는다. 면·회전·대략적 위치를 조건으로 준다."
                onToggle={() => setSpec({ ...spec, modes: { ...spec.modes, place: !spec.modes.place } })}
              />
              <ModeCard
                on={spec.modes.route}
                title="자동 배선"
                glyph="⌁"
                body="넷을 잇는다. 쓸 층과 허용할 비아가 곧 제조 단가다."
                onToggle={() => setSpec({ ...spec, modes: { ...spec.modes, route: !spec.modes.route } })}
              />
            </div>
            {!spec.modes.place && !spec.modes.route && (
              <p className={s.warn}>둘 다 끄면 엔진에 맡길 일이 없습니다.</p>
            )}
          </Panel>

          <Panel title="지시문">
            <textarea
              className={s.prompt}
              rows={4}
              placeholder="아래 조건으로 다 담기지 않는 것을 문장으로 적습니다. 예: 안테나 주변은 비워 둘 것"
              value={spec.prompt}
              onChange={(e) => setSpec({ ...spec, prompt: e.target.value })}
            />
            <div className={s.examples}>
              {PROMPT_EXAMPLES.map((text) => (
                <button
                  key={text}
                  type="button"
                  className={s.exampleChip}
                  onClick={() =>
                    setSpec({ ...spec, prompt: spec.prompt ? `${spec.prompt}\n${text}` : text })
                  }
                >
                  + {text}
                </button>
              ))}
            </div>
            <p className={s.hint}>
              아래 조건표로 적을 수 있는 것은 조건표에 적으세요. 문장은 기계가 해석해야 하고,
              해석은 틀릴 수 있습니다 — 조건표의 값은 틀리지 않습니다.
            </p>
          </Panel>

          {detail.loading && <Loading label="리비전을 읽는 중" />}

          {spec.modes.place && (
            <PlacementPanel
              detail={detail.data}
              boards={boards}
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

        {/* 요청서는 계속 붙어 있다. 조건을 만질 때마다 무엇이 달라지는지 그 자리에서 보인다. */}
        <aside className={s.side}>
          <div className={s.sideStick}>
            <Panel title="요청서">
              <dl className={s.summary}>
                <dt>대상</dt>
                <dd>
                  {spec.source
                    ? spec.source.kind === "upload"
                      ? spec.source.fileName
                      : `${spec.source.boardKey} · ${spec.source.boardName}`
                    : "—"}
                </dd>
                <dt>맡길 일</dt>
                <dd>
                  {[spec.modes.place && "배치", spec.modes.route && "배선"].filter(Boolean).join(" · ") || "—"}
                </dd>
                {spec.modes.place && (
                  <>
                    <dt>배치 대상</dt>
                    <dd>
                      {spec.placement.scope === "all"
                        ? "판 전체"
                        : `${spec.placement.refdes.length}개 부품`}
                      {spec.placement.reference.enabled &&
                        ` · 참조 ${spec.placement.reference.revisionIds.length}장`}
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
                    <dt>비아</dt>
                    <dd>{spec.routing.viaKinds.join(" · ") || "없음"}</dd>
                  </>
                )}
              </dl>

              {problems.length > 0 ? (
                <ul className={s.problems}>
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : (
                <p className={s.ready}>보낼 준비가 됐습니다.</p>
              )}

              <button type="button" className={s.submit} disabled title="엔진 연결은 아직입니다">
                작업 보내기
              </button>
              <p className={s.hint}>
                배치·배선 엔진은 아직 붙지 않았습니다. 지금 이 화면이 만드는 것은 아래 요청서
                하나이고, 엔진이 붙으면 이 값을 그대로 넘깁니다.
              </p>
            </Panel>

            <Panel title="엔진에 넘길 값" flush>
              <pre className={s.json}>{JSON.stringify(request, null, 2)}</pre>
            </Panel>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ModeCard({
  on,
  title,
  glyph,
  body,
  onToggle,
}: {
  on: boolean;
  title: string;
  glyph: string;
  body: string;
  onToggle: () => void;
}) {
  return (
    <button type="button" className={`${s.modeCard} ${on ? s.modeCardOn : ""}`} aria-pressed={on} onClick={onToggle}>
      <span className={s.modeGlyph} aria-hidden="true">{glyph}</span>
      <span className={s.modeText}>
        <b>{title}</b>
        <span>{body}</span>
      </span>
      <span className={`${s.switch} ${on ? s.switchOn : ""}`} aria-hidden="true">
        <i />
      </span>
    </button>
  );
}
