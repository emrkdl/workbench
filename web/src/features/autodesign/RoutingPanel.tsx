import { useMemo } from "react";
import type { RevisionDetail } from "@/lib/cdm";
import { Panel } from "@/components/ui";
import { conductorNumbers } from "../revision/layers";
import { formatFine } from "@/lib/units";
import type { RoutingEffort, RoutingOrder, RoutingSpec } from "./spec";
import s from "./autodesign.module.css";

/**
 * 자동 배선 조건.
 *
 * 배선 엔진에 필요한 것은 "다 이어 줘"가 아니라 **어디까지 허락하느냐**다. 어느 층을 써도
 * 되는지, 마이크로비아를 뚫어도 되는지, 넷 하나에 비아를 몇 개까지 허용하는지 — 이 답이
 * 곧 제조 단가이고, 엔진은 그걸 스스로 정할 수 없다.
 *
 * 사내 라우팅 엔진의 입력이 그대로 이 항목들이다(스팬·층·비아 종류·넷 클래스).
 */

const VIA_KINDS: [string, string, string][] = [
  ["through", "관통", "가장 싸고 가장 자리를 많이 먹는다"],
  ["blind", "블라인드", "바깥 층에서 안쪽 몇 층까지"],
  ["buried", "베리드", "안쪽 층끼리만"],
  ["micro", "마이크로", "HDI. 단가가 올라간다"],
];

const ORDERS: [RoutingOrder, string, string][] = [
  ["auto", "엔진에 맡김", "혼잡도를 보고 스스로 정한다"],
  ["power_first", "전원 먼저", "굵은 선이 자리를 먼저 잡는다"],
  ["critical_first", "고속 먼저", "차동쌍·클럭이 최단 경로를 가진다"],
];

const EFFORTS: [RoutingEffort, string, string][] = [
  ["fast", "빠르게", "한 번 훑는다. 완주율이 낮다"],
  ["balanced", "보통", "막힌 넷만 다시 푼다"],
  ["thorough", "끝까지", "밀어내기를 반복한다. 오래 걸린다"],
];

export function RoutingPanel({
  detail,
  spec,
  onChange,
}: {
  detail: RevisionDetail | null;
  spec: RoutingSpec;
  onChange: (next: RoutingSpec) => void;
}) {
  const conductorNo = useMemo(
    () => (detail ? conductorNumbers(detail.stackup) : new Map<number, number>()),
    [detail],
  );

  /** 배선을 깔 수 있는 층 — 플레인은 뺀다. 전원면에 신호를 태우는 설계는 여기서 다루지 않는다. */
  const signalLayers = useMemo(
    () =>
      (detail?.stackup ?? [])
        .filter((l) => l.role === "signal" || l.role === "mixed")
        .map((l) => ({ index: l.index, no: conductorNo.get(l.index) ?? l.index, name: l.name })),
    [detail, conductorNo],
  );

  const netClasses = useMemo(() => {
    const out = new Map<string, number>();
    for (const n of detail?.nets ?? []) {
      const k = n.net_class ?? "SIG";
      out.set(k, (out.get(k) ?? 0) + 1);
    }
    return [...out.entries()].sort((a, b) => b[1] - a[1]);
  }, [detail]);

  const toggleIn = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <Panel title="자동 배선">
      <div className={s.row}>
        <div className={s.seg} role="group" aria-label="배선 범위">
          {([["all", "모든 넷"], ["classes", "고른 넷 클래스만"]] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={spec.scope === k ? s.segOn : ""}
              aria-pressed={spec.scope === k}
              onClick={() => onChange({ ...spec, scope: k })}
            >
              {label}
            </button>
          ))}
        </div>
        <label className={s.check}>
          <input
            type="checkbox"
            checked={spec.keepRouted}
            onChange={() => onChange({ ...spec, keepRouted: !spec.keepRouted })}
          />
          이미 배선된 넷은 건드리지 않기
        </label>
      </div>

      {spec.scope === "classes" && (
        <div className={s.famFilter}>
          {netClasses.length === 0 && <span className={s.hint}>리비전을 고르면 넷 클래스가 나옵니다.</span>}
          {netClasses.map(([cls, n]) => {
            const on = spec.netClasses.includes(cls);
            return (
              <button
                key={cls}
                type="button"
                className={`${s.famChip} ${on ? s.famChipOn : ""}`}
                onClick={() => onChange({ ...spec, netClasses: toggleIn(spec.netClasses, cls) })}
              >
                {cls}
                <b>{n}</b>
              </button>
            );
          })}
        </div>
      )}

      <div className={s.subHead}>
        <span>쓸 층</span>
        <span className={s.spacer} />
        <span className={s.subNote}>
          {spec.layers.length === 0 ? "고르지 않으면 엔진이 정합니다" : `${spec.layers.length}개 층 허용`}
        </span>
      </div>
      <div className={s.famFilter}>
        {signalLayers.length === 0 && <span className={s.hint}>리비전을 고르면 적층이 나옵니다.</span>}
        {signalLayers.map((l) => {
          const on = spec.layers.includes(l.no);
          return (
            <button
              key={l.index}
              type="button"
              className={`${s.famChip} ${on ? s.famChipOn : ""}`}
              title={l.name}
              onClick={() => onChange({ ...spec, layers: toggleIn(spec.layers, l.no) })}
            >
              L{l.no}
            </button>
          );
        })}
      </div>

      <div className={s.subHead}>
        <span>허용할 비아</span>
      </div>
      <div className={s.optionList}>
        {VIA_KINDS.map(([key, label, why]) => {
          const on = spec.viaKinds.includes(key);
          return (
            <label key={key} className={`${s.optionRow} ${on ? s.optionRowOn : ""}`}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => onChange({ ...spec, viaKinds: toggleIn(spec.viaKinds, key) })}
              />
              <span className={s.optionLabel}>{label}</span>
              <span className={s.optionWhy}>{why}</span>
            </label>
          );
        })}
      </div>

      <div className={s.row}>
        <label className={s.numField}>
          넷 하나당 최대 비아
          <input
            type="number"
            min={0}
            max={64}
            placeholder="제한 없음"
            value={spec.maxViasPerNet ?? ""}
            onChange={(e) =>
              onChange({ ...spec, maxViasPerNet: e.target.value === "" ? null : Number(e.target.value) })
            }
          />
          개
        </label>
        <label className={s.check}>
          <input
            type="checkbox"
            checked={spec.diffPairs}
            onChange={() => onChange({ ...spec, diffPairs: !spec.diffPairs })}
          />
          차동쌍을 짝으로 배선
        </label>
        <label className={s.check}>
          <input
            type="checkbox"
            checked={spec.lengthMatch}
            onChange={() => onChange({ ...spec, lengthMatch: !spec.lengthMatch })}
          />
          길이 맞춤(사행 배선) 허용
        </label>
      </div>

      <div className={s.twoUp}>
        <div>
          <span className={s.fieldLabel}>배선 순서</span>
          <div className={s.optionList}>
            {ORDERS.map(([key, label, why]) => (
              <label key={key} className={`${s.optionRow} ${spec.order === key ? s.optionRowOn : ""}`}>
                <input
                  type="radio"
                  name="routing-order"
                  checked={spec.order === key}
                  onChange={() => onChange({ ...spec, order: key })}
                />
                <span className={s.optionLabel}>{label}</span>
                <span className={s.optionWhy}>{why}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <span className={s.fieldLabel}>얼마나 물고 늘어질까</span>
          <div className={s.optionList}>
            {EFFORTS.map(([key, label, why]) => (
              <label key={key} className={`${s.optionRow} ${spec.effort === key ? s.optionRowOn : ""}`}>
                <input
                  type="radio"
                  name="routing-effort"
                  checked={spec.effort === key}
                  onChange={() => onChange({ ...spec, effort: key })}
                />
                <span className={s.optionLabel}>{label}</span>
                <span className={s.optionWhy}>{why}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {detail && (
        <p className={s.hint}>
          선폭·간격은 이 리비전의 설계 룰을 그대로 씁니다 — 최소 선폭{" "}
          <b>{formatFine(detail.design_rules.min_trace_width_nm)}</b>, 최소 간격{" "}
          <b>{formatFine(detail.design_rules.min_clearance_nm)}</b>, 최소 드릴{" "}
          <b>{formatFine(detail.design_rules.min_drill_nm)}</b>. 룰을 바꾸려면 설계 파일 쪽에서
          바꿔야 합니다 — 여기서 덮어쓰면 화면의 값과 실제 보드가 어긋납니다.
        </p>
      )}
    </Panel>
  );
}
