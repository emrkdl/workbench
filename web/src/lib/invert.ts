import type { ChangeKind, ChangeSet, ComponentChange, FieldChange, NetChange, StackupChange } from "./cdm";

/**
 * ChangeSet 의 A/B 를 뒤집는다.
 *
 * diff 는 방향이 있다 — A→B 에서 추가된 부품은 B→A 에서는 삭제된 부품이다. 그런데 두
 * 방향은 서로의 거울상이라 한쪽만 계산해 두면 나머지는 여기서 만들 수 있다. 목데이터가
 * 조합마다 한 방향만 담는 것도 이 때문이고(양방향이면 파일이 두 배가 된다), 사용자가
 * 어느 쪽을 A 로 골랐든 화면이 답할 수 있는 것도 이 때문이다.
 *
 * 거울상이 되지 않는 값이 하나 있다: 목록을 상위 N 건으로 자를 때(list_limit) 잘려나간
 * 항목은 되살아나지 않는다. 하지만 자르는 기준이 종류와 크기라 A→B 에서 큰 변경은
 * B→A 에서도 큰 변경이고, 전체 건수는 stats 가 들고 있으므로 요약은 어느 방향에서나 같다.
 */

const KIND_MIRROR: Partial<Record<ChangeKind, ChangeKind>> = {
  added: "removed",
  removed: "added",
};

const mirrorKind = (k: ChangeKind): ChangeKind => KIND_MIRROR[k] ?? k;

const swapField = (f: FieldChange): FieldChange => ({ ...f, before: f.after, after: f.before });

const swapComponent = (c: ComponentChange): ComponentChange => ({
  ...c,
  kind: mirrorKind(c.kind),
  before: c.after ?? null,
  after: c.before ?? null,
  // 거리는 부호가 없지만 회전은 있다
  rotation_delta_mdeg: c.rotation_delta_mdeg == null ? c.rotation_delta_mdeg : -c.rotation_delta_mdeg,
});

const swapNet = (n: NetChange): NetChange => ({
  ...n,
  kind: mirrorKind(n.kind),
  name_a: n.name_b ?? null,
  name_b: n.name_a ?? null,
  pins_added: n.pins_removed ?? null,
  pins_removed: n.pins_added ?? null,
  length_delta_nm: n.length_delta_nm == null ? n.length_delta_nm : -n.length_delta_nm,
});

const swapStackup = (l: StackupChange): StackupChange => ({
  ...l,
  kind: mirrorKind(l.kind),
  fields: l.fields?.map(swapField) ?? null,
});

export function invertChangeSet(cs: ChangeSet): ChangeSet {
  const st = cs.stats;
  return {
    ...cs,
    revision_a_id: cs.revision_b_id,
    revision_b_id: cs.revision_a_id,
    stats: {
      ...st,
      components_added: st.components_removed,
      components_removed: st.components_added,
      nets_added: st.nets_removed,
      nets_removed: st.nets_added,
      pins_added: st.pins_removed,
      pins_removed: st.pins_added,
    },
    header_changes: cs.header_changes?.map(swapField) ?? null,
    rule_changes: cs.rule_changes?.map(swapField) ?? null,
    component_changes: cs.component_changes?.map(swapComponent) ?? null,
    net_changes: cs.net_changes?.map(swapNet) ?? null,
    stackup_changes: cs.stackup_changes?.map(swapStackup) ?? null,
  };
}
