import type { ComponentRow, LayerRole, RevisionDetail, StackupLayer } from "@/lib/cdm";
import { bodySize, FAMILIES, familyOf, type FamilyKey } from "@/lib/families";
import { Field, Fields, Panel, Stat, StatGrid } from "@/components/ui";
import { BoardFigure } from "@/components/BoardFigure";
import {
  formatArea,
  formatCoarse,
  formatCount,
  formatDimensions,
  formatFine,
  formatRouteLength,
} from "@/lib/units";
import { conductorNumbers, isConductor, ROLE_COLOR, ROLE_LABEL } from "./layers";
import s from "./revision.module.css";

/** 비아 종류. 뚫는 순서대로 — 관통이 가장 흔하고 마이크로가 가장 손이 많이 간다. */
const VIA_ORDER = ["through", "blind", "buried", "micro"] as const;
const VIA_LABEL: Record<string, string> = {
  through: "관통",
  blind: "블라인드",
  buried: "베리드",
  micro: "마이크로",
};


/**
 * 부품 구성 — 어느 계열이 판을 차지하고 있나.
 *
 * 오래 개수로 재다가 면적으로 옮겼다. 개수로 재면 서른 장이 전부 같은 그림이 나온다 —
 * 어느 판이든 커패시터 40~46%, 저항 20~24%, 인덕터 19~21%. 모든 판에서 같은 값이 나오는
 * 칸은 자리만 차지한다.
 *
 * 면적으로 재면 판마다 갈린다. 플렉스는 AP 하나가 판의 41% 를 먹고, RF 모듈은 커넥터가
 * 12% 를 차지하며, 전원 보드는 QFP·QFN 이 절반이다. 판의 성격이 그대로 드러난다.
 *
 * 실장률과도 이어진다 — 그쪽이 몸통이 판을 덮은 비율이고, 이쪽은 그 덮은 넓이를 계열이
 * 어떻게 나눠 가졌나이다. 두 패널이 같은 것을 다른 각도에서 말한다.
 *
 * 개수는 버리지 않고 같은 줄 끝에 둔다. 막대와 % 는 "무엇이 판을 차지하나"를, 개수는
 * "몇 개나 되나"를 답한다 — 커패시터가 넓이로는 12% 인데 개수로는 907 개라는 사실은
 * 둘을 나란히 놓아야 보인다.
 *
 * 몸통 치수는 모든 부품에 실측치가 들어 있어 추정으로 메운 값이 없다.
 */
function FamilyBreakdown({ components }: { components: ComponentRow[] }) {
  const stat = new Map<FamilyKey, { count: number; area: number }>();
  for (const c of components) {
    const k = familyOf(c);
    const [w, h] = bodySize(c);
    const cur = stat.get(k) ?? { count: 0, area: 0 };
    cur.count += 1;
    cur.area += w * h;
    stat.set(k, cur);
  }

  const rows = FAMILIES.filter((f) => (stat.get(f.key)?.count ?? 0) > 0)
    .map((f) => ({ key: f.key, label: f.label, ...stat.get(f.key)! }))
    .sort((a, b) => b.area - a.area);

  const total = rows.reduce((sum, r) => sum + r.area, 0) || 1;

  return (
    <div className={s.famList}>
      {/* 두 숫자가 다른 것을 재고 있으므로 무엇을 재는지 한 줄로 못박는다. 커패시터가
          넓이로 12% 인데 개수로 907 인 것을 설명 없이 두면 둘 중 하나를 오해한다. */}
      <div className={`${s.famRow} ${s.famHead}`}>
        <span />
        <em>면적</em>
        <em>개수</em>
      </div>
      {rows.map((r) => (
        <div key={r.key} className={s.famRow}>
          <span>{r.label}</span>
          <b className="tnum">{((r.area / total) * 100).toFixed(1)}%</b>
          <em>{formatCount(r.count)}</em>
        </div>
      ))}
    </div>
  );
}

/** 좁은 판에 들어갈 짧은 이름. 단면도 탭의 긴 이름("GND 플레인")은 여기서 줄이 넘친다. */
const STACK_LABEL: Partial<Record<LayerRole, string>> = {
  signal: "신호",
  plane_power: "전원",
  plane_gnd: "GND",
  mixed: "혼합",
};

/**
 * 층 구성 — 도체층을 쌓인 순서대로.
 *
 * 예전에는 "신호 6 · 플레인 4" 를 막대 하나로 보여 줬는데, 그 숫자로는 **어느 자리**가
 * 플레인인지 알 수 없었다. 적층에서 중요한 것은 개수가 아니라 순서다 — 신호층이 GND 를
 * 사이에 두고 있는지, 전원과 GND 가 붙어 있는지가 판의 성질을 정한다.
 *
 * 실크·마스크·유전체는 뺐다. 여기서 묻는 것은 "무엇이 어디를 지나가나"이고 그 답은
 * 동박층에만 있다. 두께를 보러 왔다면 적층 탭에 단면도가 그대로 있다.
 *
 * 여기 적는 것은 층 이름과 역할뿐이다. 한때 동박 면적률 막대와 임피던스 값을 함께
 * 두었는데 둘 다 실제 값이 아니었다 — 면적률은 그럴듯한 범위의 난수였고 임피던스는
 * 모든 신호층에 박아 넣은 상수라 아무것도 구분하지 못했다.
 *
 * 둘 다 언젠가 진짜로 채울 수 있다. 면적률은 층 형상(.blg)의 플레인·트레이스·패드
 * 넓이를 판 넓이로 나누면 나오고, 그 계산은 실장률처럼 넣을 때 한 번 해 두는 것이
 * 맞다. 임피던스는 계산이 아니라 설계자가 적층에 정해 둔 값이므로 파서가 읽어 와야
 * 한다. 그때까지는 자리를 비워 둔다.
 */
function LayerStack({ stackup }: { stackup: StackupLayer[] }) {
  const numbers = conductorNumbers(stackup);
  const rows = stackup.filter(isConductor);

  return (
    <div className={s.stack}>
      {rows.map((l) => (
        <div key={l.index} className={s.stackRow} title={`${l.name} · ${ROLE_LABEL[l.role]}`}>
          <span className={s.stackNo}>L{numbers.get(l.index)}</span>
          {/* 띠의 색이 곧 정보다. 열 줄을 훑으면 신호-GND-신호-신호-GND-전원 하는
              결이 한눈에 잡히고, 그것이 이 판에서 적층에 대해 말할 수 있는 전부다. */}
          <span
            className={s.stackBand}
            style={{
              background: `color-mix(in srgb, ${ROLE_COLOR[l.role]} 30%, transparent)`,
              borderColor: ROLE_COLOR[l.role],
            }}
          >
            <b style={{ color: ROLE_COLOR[l.role] }}>{STACK_LABEL[l.role] ?? ROLE_LABEL[l.role]}</b>
          </span>
        </div>
      ))}
    </div>
  );
}

export function OverviewTab({ detail }: { detail: RevisionDetail }) {
  const { revision, design_rules: rules } = detail;
  const sm = revision.summary;
  /** 어떤 비아를 뚫었나. 마이크로·베리드가 섞이면 HDI 공정이 붙고 값이 뛴다. */
  const viaKinds = VIA_ORDER.filter((k) => (sm.via_by_kind[k] ?? 0) > 0)
    .map((k) => `${VIA_LABEL[k]} ${formatCount(sm.via_by_kind[k])}`)
    .join(" · ");

  /** 적층에 쓰인 동박 두께. 대개 한 가지지만 바깥 층만 두껍게 가는 판이 있다. */
  const copperWeights = [
    ...new Set(
      detail.stackup
        .map((l) => l.copper_weight_um)
        .filter((v): v is number => typeof v === "number"),
    ),
  ]
    .sort((a, b) => a - b)
    .map((v) => `${v} µm`)
    .join(" · ");

  /** 가장 나중 리비전. 지금 보고 있는 것이 옛 리비전일 수 있으므로 따로 찾는다. */
  const latest = detail.lineage.reduce<(typeof detail.lineage)[number] | null>(
    (a, b) => (a && a.created_at >= b.created_at ? a : b),
    null,
  );

  return (
    <div className={s.overview}>
      <div className={s.col}>
        <Panel title="요약">
          {/* 윗줄은 판 자체 — 어떻게 생겼고 어떻게 만들고 몇 번을 고쳤나.
              아랫줄은 그 위에 실린 것 — 부품·핀·넷·비아. 여덟 개를 한 줄로 늘어놓으면
              성격이 다른 숫자들이 섞여 눈이 어디서 끊어야 할지 모른다. */}
          <StatGrid cols={4}>
            {/* 신호/플레인 개수는 바로 아래 층 구성이 순서까지 보여 주므로 중복이다.
                두께가 층수와 한 쌍이다 — 제조사가 함께 묻는 값이고, 층수가 같아도
                두께가 다르면 층 사이 간격이 달라 다른 판이 된다. */}
            <Stat label="층수" value={sm.layer_count} hint={formatCoarse(sm.board_thickness_nm)} />
            <Stat
              label="면적"
              value={sm.area_mm2.toFixed(0)}
              unit="mm²"
              hint={formatDimensions(sm.width_nm, sm.height_nm)}
            />
            {/* 비아 스택 구성. 설계 데이터에서 읽어 올 값이고 아직 연결되지 않았다. */}
            <Stat label="비아 타입" value="—" hint="All stack · B Type 등" />
            {/* 몇 번을 고쳐 온 판인가. 리비전이 하나뿐인 판과 여섯 번 돈 판은 같은
                크기라도 다른 물건이다 — 뒤엣것은 그만큼 손이 많이 간 자리가 있다. */}
            <Stat
              label="리비전"
              value={detail.lineage.length}
              hint={latest ? `최종 ${latest.label}` : undefined}
            />

            <Stat
              label="부품"
              value={formatCount(sm.component_count)}
              hint={`Top ${sm.component_top_count} · Bot ${sm.component_bottom_count}`}
            />
            <Stat label="핀" value={formatCount(sm.pin_count)} hint={`BGA ${sm.bga_count}개`} />
            {/* 넷 수는 판이 얼마나 얽혀 있는지를 말하고, 배선 길이는 그 얽힘이 실제로
                얼마나 그어졌는지를 말한다. 둘은 따로 논다 — 넷이 적어도 길게 돌아가는
                판이 있고 그 반대도 있다. */}
            <Stat
              label="넷"
              value={formatCount(sm.net_count)}
              hint={formatRouteLength(sm.total_route_length_nm)}
            />
            {/* GND 비아 수는 형상 버퍼에만 있고 요약에는 아직 없다. 자리만 잡아 둔다. */}
            <Stat label="비아" value={formatCount(sm.via_total)} hint="GND nn개" />
          </StatGrid>
        </Panel>

        <div className={s.twoUp}>
          <Panel title="식별">
            {/* 왼쪽은 이번 리비전에서 무엇을 고쳤나, 오른쪽은 이 판이 무엇인가.
                고친 내용을 먼저 읽는 자리에 둔다 — 같은 판의 리비전을 여럿 열어 놓고
                오갈 때 알고 싶은 것은 모델명이 아니라 무엇이 달라졌나이다. */}
            <div className={s.identGrid}>
              <div className={s.identNotes}>
                <span className={s.identLabel}>수정사항</span>
                {revision.note ? (
                  <p className={s.identNote}>{revision.note}</p>
                ) : (
                  /* 아직 여러 줄로 적어 두는 자리가 없다. 리비전마다 무엇을 고쳐야 하고
                     무엇을 고쳤는지가 여기 쌓이면, 리비전 목록이 곧 변경 이력이 된다. */
                  <p className={s.identEmpty}>적힌 수정사항이 없습니다</p>
                )}
              </div>

              <Fields tight>
                <Field label="모델명">
                  <span className="mono">{revision.board_key}</span>
                </Field>
                {/* 경성·연성·경연성. 판을 다루는 방식이 통째로 갈리는 값이라 모델명 바로
                    다음에 온다. 설계 데이터에 이 구분이 따로 들어 있지 않아 자리만 잡아 둔다. */}
                <Field label="PCB 종류">—</Field>
                <Field label="리비전">{revision.label}</Field>
                <Field label="제품군">{detail.product_family}</Field>
                {/* 어느 솔루션의 판인가. AP 부품이 정해지면 층수도 적층도 배치도 그것을
                    따라가므로, 비슷한 판을 찾을 때 가장 먼저 맞춰 보는 값이다.
                    설계 데이터에서 읽어 올 값이고 아직 연결되지 않았다. */}
                <Field label="솔루션">—</Field>
                {/* 의뢰자와 의뢰일은 아직 어디에도 없다. 의뢰라는 개념 자체가 설계 데이터에
                    들어 있지 않고, 사람이 시스템에 적어 넣어야 생기는 값이다. 자리만 잡아 둔다. */}
                <Field label="의뢰자">—</Field>
                <Field label="의뢰일">—</Field>
                <Field label="설계자">{revision.author}</Field>
                <Field label="등록일">{revision.created_at.slice(0, 10)}</Field>
              </Fields>
            </div>
          </Panel>

          {/* "물리 · 제조" 라고 부르니 담을 수 있는 것이 치수와 룰뿐이었다. 표면 처리도
              비아 구성도 공정도 다 이 판의 사양인데 이름이 먼저 막았다. 식별과 짝이 되는
              이름으로 넓힌다 — 저쪽이 무엇이고 누가 만들었나라면, 이쪽은 어떤 판인가다. */}
          <Panel title="사양">
            <Fields tight>
              <Field label="외형 치수">{formatDimensions(sm.width_nm, sm.height_nm)}</Field>
              <Field label="면적">{formatArea(sm.area_mm2)}</Field>
              <Field label="보드 두께">{formatCoarse(sm.board_thickness_nm)}</Field>
              {/* 동박 두께는 층마다 다를 수 있다. 바깥 층만 두껍게 가는 판이 흔해서
                  하나로 뭉개지 않고 쓰인 값을 다 적는다 — 견적에 그대로 들어간다. */}
              <Field label="동박 두께">{copperWeights}</Field>
              <Field label="최소 선폭">{formatFine(rules.min_trace_width_nm)}</Field>
              <Field label="최소 간격">{formatFine(rules.min_clearance_nm)}</Field>
              <Field label="비아 구성">{viaKinds}</Field>
            </Fields>
          </Panel>
        </div>

        <div className={s.twoUp}>
          <Panel title="부품 구성">
            <FamilyBreakdown components={detail.components} />
          </Panel>
          <Panel title="배선">
            {/* 총량에서 시작해 한 넷의 몫으로 내려가고, 무엇을 나르는 넷인지로 옮겼다가,
                마지막에 판 전체를 다시 넓이로 본다. 큰 데서 작은 데로 갔다가 다시 큰
                데로 — 읽는 눈이 한 방향으로 흐른다. */}
            <Fields tight>
              <Field label="총 배선 길이">{formatRouteLength(sm.total_route_length_nm)}</Field>
              {/* 한 넷이 평균 얼마나 멀리 도는가. 넷이 적어도 길게 돌아가는 판이 있고
                  그 반대도 있어서, 총 길이만으로는 어느 쪽인지 알 수 없다. */}
              <Field label="넷당 길이">
                {formatRouteLength(sm.total_route_length_nm / Math.max(sm.net_count, 1))}
              </Field>
              {/* 한 넷이 층을 몇 번 갈아탔나. 판 크기와 무관해서 배선이 얼마나 얽혀
                  돌았는지를 판끼리 견줄 수 있다. */}
              <Field label="넷당 비아">{(sm.via_total / Math.max(sm.net_count, 1)).toFixed(1)}개</Field>
              <Field label="차동쌍">{sm.diff_pair_count}쌍</Field>
              <Field label="전원 넷">{sm.power_net_count}개</Field>
              {/* 판 넓이로 나눈 값이라 크기가 지워진다. 총수는 큰 판이면 그냥 커지지만
                  밀도는 얼마나 빽빽하게 뚫었는지를 말하고, 그것이 드릴 값과 배선 혼잡을
                  가른다. 서른 장에서 16 부터 75 까지 갈린다. */}
              <Field label="비아 밀도">
                {(sm.via_total / Math.max(sm.area_mm2 / 100, 0.01)).toFixed(1)}개/cm²
              </Field>
            </Fields>
          </Panel>
        </div>

      </div>

      <div className={s.col}>
        <Panel title="배치">
          <div className={s.shapeBox}>
            {/* 여기서는 부품 전체를 그린다 — 상세 화면은 이미 목록을 들고 있다. */}
            <BoardFigure outline={detail.outline} components={detail.components} height={210} />
          </div>
          <div style={{ marginTop: "var(--sp-3)" }}>
            <Fields>
              <Field label="치수">{formatDimensions(sm.width_nm, sm.height_nm)}</Field>
              <Field label="면적">{formatArea(sm.area_mm2)}</Field>
              <Field label="부품">{formatCount(sm.component_count)}개</Field>
            </Fields>
          </div>
        </Panel>

        <Panel title="실장률">
          <Stat
            label="전체"
            value={sm.mount_ratio_pct.toFixed(1)}
            unit="%"
          />
          {/* 막대의 전체 길이가 기판 면적이다. 두 조각의 합이 실장률이고 남는 자리가 빈 면적 —
              분모가 양면 다 같은 기판이라 TOP 과 BOTTOM 을 그대로 이어 붙일 수 있다. */}
          <div className={s.mountBar} style={{ marginTop: "var(--sp-3)" }}>
            <div
              className={s.mountTop}
              style={{ width: `${Math.min(sm.mount_ratio_top_pct, 100)}%` }}
              title={`TOP ${sm.mount_ratio_top_pct.toFixed(1)}%`}
            />
            <div
              className={s.mountBottom}
              style={{ width: `${Math.min(sm.mount_ratio_bottom_pct, 100 - sm.mount_ratio_top_pct)}%` }}
              title={`BOTTOM ${sm.mount_ratio_bottom_pct.toFixed(1)}%`}
            />
          </div>
          <div className={s.mountLegend}>
            <span>
              <i className={s.mountTop} />
              TOP <b className="tnum">{sm.mount_ratio_top_pct.toFixed(1)}%</b>
              <em>{formatCount(sm.component_top_count)}개</em>
            </span>
            <span>
              <i className={s.mountBottom} />
              BOTTOM <b className="tnum">{sm.mount_ratio_bottom_pct.toFixed(1)}%</b>
              <em>{formatCount(sm.component_bottom_count)}개</em>
            </span>
          </div>
        </Panel>

        <Panel title="층 구성">
          <LayerStack stackup={detail.stackup} />
        </Panel>
      </div>
    </div>
  );
}
