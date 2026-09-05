import type { Board } from "@/lib/cdm";
import { formatCoarse, formatCount, formatFine, formatRouteLength } from "@/lib/units";
import { revisionPath } from "@/lib/routes";
import { SCOPES, type Cite, type Message, type ScopeId, type Source, newId } from "./model";

/**
 * 답을 짓는 자리.
 *
 * 답변 엔진은 아직 붙지 않았다. 그래서 여기서 짓는 말은 **예시**다 — 다만 아무 말이나
 * 지어내지는 않는다. 설계 데이터 쪽으로 물으면 고른 판의 요약값을 진짜로 읽어서 답한다.
 * 그 숫자들은 이미 이 앱 안에 들어와 있고, 읽어 오는 데 엔진이 필요하지 않다.
 *
 * 문서 쪽은 다르다. 룰과 지침은 아직 한 장도 들어와 있지 않아서 읽을 것이 없다. 그때는
 * 아는 척하는 대신 무엇이 없어서 답할 수 없는지를 적는다. 없는 근거를 그럴듯하게 지어
 * 보여 주면 화면은 완성돼 보이지만 그 화면을 믿은 사람이 나중에 손해를 본다.
 */

/** 물음에서 무엇을 묻는지 대충 집는다. 형태소 분석이 아니라 낱말 맞추기다 — 예시니까. */
const TOPICS: [RegExp, string][] = [
  [/층|레이어|스택|적층/, "stackup"],
  [/부품|배치|실장|refdes|BGA|bga/, "parts"],
  [/넷|배선|라우팅|선폭|트레이스|길이/, "routing"],
  [/비아|via|드릴|홀/, "via"],
  [/크기|치수|면적|외형|사이즈/, "size"],
];

const topicOf = (q: string) => TOPICS.find(([re]) => re.test(q))?.[1] ?? null;

/** 고른 판의 요약에서 물음에 맞는 대목을 뽑아 문장으로 만든다. 값은 전부 실제 값이다. */
function fromDesign(question: string, board: Board): { text: string; cites: Cite[] } {
  const sm = board.summary;
  const head = `${board.board_key} · ${board.latest_revision_label}`;
  const topic = topicOf(question);

  const lines: string[] = [];
  if (topic === "stackup" || topic === null) {
    lines.push(
      `층 구성은 ${sm.layer_count}층입니다 — 신호 ${sm.signal_layer_count}층, 플레인 ${sm.plane_layer_count}층. 판 두께는 ${formatCoarse(sm.board_thickness_nm)} 입니다.`,
    );
  }
  if (topic === "parts") {
    lines.push(
      `부품은 ${formatCount(sm.component_count)}개이고 TOP ${formatCount(sm.component_top_count)} · BOTTOM ${formatCount(sm.component_bottom_count)} 로 나뉩니다. 실장률은 ${sm.mount_ratio_pct.toFixed(1)}% (TOP ${sm.mount_ratio_top_pct.toFixed(1)}% · BOTTOM ${sm.mount_ratio_bottom_pct.toFixed(1)}%) 입니다.`,
    );
    if (sm.bga_count > 0) {
      lines.push(
        `BGA 는 ${sm.bga_count}개이고 최소 피치는 ${sm.min_bga_pitch_nm ? formatFine(sm.min_bga_pitch_nm) : "기록 없음"} 입니다.`,
      );
    }
  }
  if (topic === "routing") {
    lines.push(
      `넷은 ${formatCount(sm.net_count)}개, 배선 총 길이는 ${formatRouteLength(sm.total_route_length_nm)} 입니다. 최소 선폭 ${formatFine(sm.min_trace_width_nm)}, 최소 간격 ${formatFine(sm.min_clearance_nm)} 이고 차동쌍은 ${sm.diff_pair_count}쌍입니다.`,
    );
    if (sm.unrouted_count > 0) {
      lines.push(`아직 배선되지 않은 넷이 ${sm.unrouted_count}개 남아 있습니다.`);
    }
  }
  if (topic === "via") {
    const kinds = Object.entries(sm.via_by_kind)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k} ${formatCount(n)}`)
      .join(" · ");
    lines.push(`비아는 모두 ${formatCount(sm.via_total)}개입니다${kinds ? ` — ${kinds}` : ""}.`);
  }
  if (topic === "size") {
    lines.push(
      `판 크기는 ${formatCoarse(sm.width_nm)} × ${formatCoarse(sm.height_nm)}, 면적 ${sm.area_mm2.toFixed(1)} mm² 입니다. 외형은 ${sm.outline_kind}${sm.cutout_count ? `, 컷아웃 ${sm.cutout_count}개` : ""}.`,
    );
  }

  lines.push(
    "여기까지는 이미 들어와 있는 요약값을 그대로 읽은 것입니다. 이 값들을 엮어 판단하는 일(왜 이렇게 됐는지, 무엇을 고쳐야 하는지)은 답변 엔진이 붙어야 합니다.",
  );

  return {
    text: `${head} 를 읽었습니다.\n\n${lines.join("\n")}`,
    cites: [
      {
        label: `${board.board_key} · ${board.latest_revision_label}`,
        note: "요약값을 읽어 온 리비전",
        to: revisionPath(board.id, board.latest_revision_id),
      },
    ],
  };
}

function fromDocs(scopes: ScopeId[]): { text: string; cites: Cite[] } {
  const names = SCOPES.filter(([id]) => scopes.includes(id)).map(([, label]) => label);
  const where = names.length === SCOPES.length ? "모든 갈래" : names.join(" · ");

  return {
    text:
      `${where}에서 찾아보겠다고 표시해 두었습니다.\n\n` +
      "다만 룰·지침·백서는 아직 한 장도 들어와 있지 않아 실제로 뒤져 볼 것이 없습니다. " +
      "근거 없이 그럴듯한 답을 지어내면 화면은 완성돼 보여도 그 답을 믿은 사람이 손해를 봅니다.\n\n" +
      "지금 이 앱이 진짜로 답할 수 있는 것은 이미 들어와 있는 설계 데이터 쪽입니다 — " +
      "오른쪽에서 ‘이 판의 설계 데이터’ 로 바꾸고 판을 고르면 그 판의 실제 값을 읽어 드립니다.",
    cites: [],
  };
}

/** 라이브는 아직 붙지 않았다. 붙은 척하는 답을 지어내면 그 답을 지금 내 판의 것으로 믿는다. */
function fromLive(): { text: string; cites: Cite[] } {
  return {
    text:
      "라이브 디자인은 아직 설계 툴에 붙지 않았습니다.\n\n" +
      "붙고 나면 저장을 기다리지 않고 지금 열려 있는 판을 그대로 읽습니다 — 방금 옮긴 " +
      "부품과 방금 그은 선까지요. 그때까지는 이 갈래로 답할 수 있는 것이 없습니다.\n\n" +
      "지금 답할 수 있는 것은 이미 저장돼 들어와 있는 판입니다. 오른쪽에서 " +
      "‘설계 데이터’ 로 바꾸고 판을 고르면 그 판의 실제 값을 읽어 드립니다.",
    cites: [],
  };
}

export function draft({
  question,
  source,
  scopes,
  board,
}: {
  question: string;
  source: Source;
  scopes: ScopeId[];
  board: Board | null;
}): Message {
  const useDesign = source === "design" && board !== null;
  const { text, cites } =
    source === "live" ? fromLive() : useDesign ? fromDesign(question, board) : fromDocs(scopes);

  const next: { label: string; to: string }[] = [];
  if (board) {
    next.push({
      label: "리비전 상세 열기",
      to: revisionPath(board.id, board.latest_revision_id),
    });
    next.push({ label: "다른 판과 견주기", to: "/compare" });
  } else {
    next.push({ label: "카탈로그에서 판 고르기", to: "/boards" });
  }

  return { id: newId(), role: "agent", text, cites, next };
}
