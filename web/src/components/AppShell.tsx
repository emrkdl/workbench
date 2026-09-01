import type React from "react";
import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { fetchManifest, LIVE, setToken, whoami } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { forget, useRecentBoards } from "@/lib/recent";
import { avatarHue, avatarOf } from "@/lib/avatar";
import { revisionPath } from "@/lib/routes";
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

const NAV: { label: string; items: NavEntry[] }[] = [
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
          <span className={s.brandSub}>BoardLens</span>
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
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `${s.navItem} ${isActive ? s.navItemOn : ""}`}
              >
                <span className={s.navGlyph} aria-hidden="true">
                  {item.glyph}
                </span>
                {item.label}
                {item.soon && <span className={s.navSoon}>예정</span>}
              </NavLink>
            ))}
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
