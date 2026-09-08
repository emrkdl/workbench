import { useMemo } from "react";
import type { RevisionDetail } from "@/lib/cdm";
import { Panel } from "@/components/ui";
import { conductorNumbers } from "../revision/layers";
import type { RoutingOrder, RoutingSpec } from "./spec";
import s from "./autodesign.module.css";

/**
 * 자동 배선 조건.
 *
 * 배선 엔진에 필요한 것은 "다 이어 줘"가 아니라 **어디까지 허락하느냐**다. 어느 넷을,
 * 어느 층에, 어떤 순서로 — 이 답이 곧 제조 단가이고, 엔진은 그걸 스스로 정할 수 없다.
 *
 * 비아 종류는 여기서 묻지 않는다. 설계 파일의 적층과 비아 규격이 이미 무엇을 쓸 수 있는지
 * 말하고 있어서, 화면에서 다시 고르게 하면 두 값이 어긋날 자리를 만든다.
 *
 * 사내 라우팅 엔진의 입력이 그대로 이 항목들이다(층·넷 클래스·배선 순서).
 */

const ORDERS: [RoutingOrder, string, string][] = [
  ["auto", "엔진에 맡김", "혼잡도를 보고 스스로 정한다"],
  ["power_first", "전원 먼저", "굵은 선이 자리를 먼저 잡는다"],
  ["critical_first", "고속 먼저", "차동쌍·클럭이 최단 경로를 가진다"],
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
    </Panel>
  );
}
