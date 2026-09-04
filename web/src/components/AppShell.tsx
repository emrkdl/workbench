import type React from "react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { fetchManifest, LIVE, setToken, whoami } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { forget, useRecentBoards } from "@/lib/recent";
import { avatarHue, avatarOf } from "@/lib/avatar";
import { revisionPath } from "@/lib/routes";
import { formatDuration, useJobRun } from "@/features/autodesign/useJobRun";
import s from "./AppShell.module.css";

type Theme = "system" | "light" | "dark";
const THEME_KEY = "boardlens.theme";
const THEME_GLYPH: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" };
const THEME_LABEL: Record<Theme, string> = { system: "시스템 설정", light: "밝은 화면", dark: "어두운 화면" };

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem(THEME_KEY) as Theme) || "system";
    } catch {
      return "system";
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* 사생활 보호 모드 등에서 저장이 막혀도 화면은 정상 동작해야 한다 */
    }
  }, [theme]);

  const cycle = () => setTheme((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system"));
  return { theme, cycle };
}

interface NavEntry {
  to: string;
  glyph: string;
  label: string;
  soon?: boolean;
}

/**
 * 메뉴.
 *
 * 앞의 두 개는 나머지와 하는 일이 다르다 — 쌓인 것을 들여다보는 대신 시켜서 새로
 * 만들어 낸다(하나는 배치를, 하나는 답을). 한동안 그 둘만 카드로 따로 세워 두었는데,
 * 셋이 되니 레일 하나에 생김새가 셋이 되어 급조한 것처럼 보였다.
 *
 * 그래서 다시 한 벌로 되돌린다. 다르다는 것은 **맨 위라는 자리와 무리 이름**이 말하고,
 * 생김새는 나머지와 같은 줄을 쓴다. 눈에 띄어야 한다고 언어를 하나 더 만들 이유는 없다 —
 * 다른 것들이 모두 조용하면 조금만 달라도 충분히 눈에 띈다.
 */
const NAV: { label: string; items: NavEntry[]; lead?: boolean }[] = [
  {
    label: "에이전트",
    lead: true,
    items: [
      { to: "/auto", glyph: "✳", label: "자동 레이아웃" },
      { to: "/ask", glyph: "?", label: "설계 문답" },
    ],
  },
  {
    label: "설계 자산",
    items: [
      { to: "/boards", glyph: "▤", label: "카탈로그" },
      { to: "/compare", glyph: "⇄", label: "비교" },
    ],
  },
  {
    label: "분석",
    items: [
      { to: "/insights", glyph: "◱", label: "인사이트" },
      { to: "/parts", glyph: "⌗", label: "부품 역검색" },
    ],
  },
];

export function AppShell() {
  const { theme, cycle } = useTheme();
  const recent = useRecentBoards();
  const { data: manifest } = useAsync(fetchManifest, []);
  const { data: session } = useAsync(whoami, []);

  return (
    <div className={s.shell}>
      <header className={s.header}>
        <div className={s.brand}>
          <span className={s.brandMark}>PCB Design Workbench</span>
          <span className={s.brandSub}>BoardForge</span>
        </div>

        <span className={s.headerSpacer} />
        {LIVE ? (
          <span className={s.env} title="실제 bl-core 에 연결되어 있습니다">
            <i className={s.envDot} style={{ background: "var(--ok)" }} />
            연결됨
          </span>
        ) : (
          <span className={s.env} title="아직 실제 DB와 HKP 파서가 붙지 않았습니다. 화면은 목데이터로 동작합니다.">
            <i className={s.envDot} />
            목데이터
            {manifest && ` · CDM ${manifest.cdm_version}`}
          </span>
        )}

        {/* 사용자 자리. 로그인 여부와 상관없이 늘 같은 크기로 잡아 둔다 — 로그인 뒤에
            자리가 새로 생기면 그 옆의 단추들이 통째로 밀린다. */}
        <div className={s.user}>
          <span
            className={`${s.avatar} ${session ? s.avatarOn : ""}`}
            style={session ? ({ "--cat-h": avatarHue(session.username) } as React.CSSProperties) : undefined}
            aria-hidden="true"
          >
            {session ? avatarOf(session.username) : "○"}
          </span>
          <span className={s.userText}>
            <b>{session ? session.display_name : "로그인 안 됨"}</b>
            <span>{session ? session.role : LIVE ? "세션 확인 중" : "목데이터 모드"}</span>
          </span>
        </div>

        {LIVE && session && (
          <button
            type="button"
            className={s.iconBtn}
            title="로그아웃"
            aria-label="로그아웃"
            onClick={() => {
              setToken(null);
              window.location.reload();
            }}
          >
            ⏻
          </button>
        )}
        <button
          type="button"
          className={s.iconBtn}
          onClick={cycle}
          title={`화면 테마: ${THEME_LABEL[theme]}`}
          aria-label={`화면 테마 전환 (현재: ${THEME_LABEL[theme]})`}
        >
          {THEME_GLYPH[theme]}
        </button>
      </header>

      <nav className={s.rail} aria-label="주요 메뉴">
        {NAV.map((group) => (
          <div className={s.navGroup} key={group.label}>
            <span className={s.navLabel}>{group.label}</span>
            {group.items.map((item) =>
              item.to === "/auto" ? (
                <AutoRow key={item.to} item={item} lead={group.lead} />
              ) : (
                <NavRow key={item.to} item={item} lead={group.lead} />
              ),
            )}
          </div>
        ))}

        {/* 보드가 쌓일수록 사람은 결국 같은 몇 장을 오간다. 메뉴가 넷뿐이라 남는 자리를
            장식으로 메우는 대신, 그 몇 장으로 바로 가는 길을 둔다. */}
        {recent.length > 0 && (
          <div className={s.navGroup}>
            <span className={s.navLabel}>최근 본 보드</span>
            {recent.map((b) => (
              <div className={s.recentRow} key={b.boardId}>
                <NavLink
                  to={revisionPath(b.boardId, b.seg)}
                  className={({ isActive }) => `${s.recentItem} ${isActive ? s.recentItemOn : ""}`}
                  title={`${b.boardKey} · ${b.name}`}
                >
                  <span className={s.recentKey}>{b.boardKey}</span>
                  <span className={s.recentName}>{b.name}</span>
                </NavLink>
                <button
                  type="button"
                  className={s.recentDrop}
                  title="목록에서 빼기"
                  aria-label={`${b.boardKey} 를 최근 목록에서 빼기`}
                  onClick={() => forget(b.boardId)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={s.railFoot}>
          {manifest ? (
            <>
              보드 <b>{manifest.board_count}</b> · 리비전 <b>{manifest.revision_count}</b>
              <br />
              부품 <b>{manifest.component_total.toLocaleString()}</b> · 넷{" "}
              <b>{manifest.net_total.toLocaleString()}</b>
              <br />
              고유 부품 <b>{manifest.part_count}</b>종
              <br />
              생성 {manifest.generated_at.slice(0, 10)}
            </>
          ) : LIVE ? (
            <>
              bl-core 연결됨
              <br />
              {session ? `${session.username} · ${session.role}` : "세션 확인 중…"}
            </>
          ) : (
            "목데이터 확인 중…"
          )}
        </div>
      </nav>

      <main className={s.main}>
        <Outlet />
      </main>
    </div>
  );
}

/**
 * 메뉴 한 줄.
 *
 * 앞무리(에이전트)라고 해서 다른 상자를 쓰지 않는다. 쉬고 있을 때 아주 옅은 바탕을
 * 깔고 글리프에 강조색을 주는 것이 전부다 — 나머지가 모두 조용하므로 이만큼이면 눈에
 * 걸린다. 켜졌을 때의 표시(왼쪽 막대 + 강조 바탕)는 모든 줄이 똑같이 쓴다.
 */
function NavRow({
  item,
  lead,
  badge,
  foot,
}: {
  item: NavEntry;
  lead?: boolean;
  badge?: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        `${s.navItem} ${lead ? s.navLead : ""} ${isActive ? s.navItemOn : ""}`
      }
    >
      <span className={s.navGlyph} aria-hidden="true">
        {item.glyph}
      </span>
      <span className={s.navText}>{item.label}</span>
      {badge ?? (item.soon ? <span className={s.navSoon}>예정</span> : null)}
      {foot}
    </NavLink>
  );
}

/**
 * 자동 레이아웃 — 작업이 돌면 진행률을 이 줄이 들고 있는다.
 *
 * 배치·배선은 몇 분이 걸리고 그동안 사람은 다른 화면으로 간다. 떠나 있는 동안 얼마나
 * 됐는지 보려고 매번 돌아오게 할 이유가 없다 — 어느 화면에 있든 보이는 자리가 여기다.
 *
 * 자리는 돌 때만 넓어진다. 쉬는 동안에도 진행률 자리를 비워 두면 레일이 늘 한 줄 뜬
 * 채로 있고, 그 한 줄이 이 줄만 다른 물건처럼 보이게 만든다.
 */
function AutoRow({ item, lead }: { item: NavEntry; lead?: boolean }) {
  const job = useJobRun();
  const running = job.status === "running";
  const busy = running || job.status === "done";
  const pct = Math.round(job.progress * 100);
  if (!busy) return <NavRow item={item} lead={lead} />;

  return (
    <NavRow
      item={item}
      lead={lead}
      badge={
        <span className={`${s.navPct} ${running ? "" : s.navPctDone}`}>{pct}%</span>
      }
      foot={
        <span className={s.navRun}>
          <span
            className={s.navBar}
            role="progressbar"
            aria-label="자동 레이아웃 진행률"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span className={running ? "" : s.navBarDone} style={{ width: `${pct}%` }} />
          </span>
          <span className={s.navEta}>
            {!running
              ? "완료"
              : job.remainingMs !== null
                ? `${formatDuration(job.remainingMs)} 남음`
                : "남은 시간 가늠 중"}
          </span>
        </span>
      }
    />
  );
}
