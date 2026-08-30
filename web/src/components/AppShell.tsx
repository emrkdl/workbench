import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { fetchManifest, LIVE, setToken, whoami } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
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
            {session ? `${session.display_name} · ${session.role}` : "연결됨"}
          </span>
        ) : (
          <span className={s.env} title="아직 실제 DB와 HKP 파서가 붙지 않았습니다. 화면은 목데이터로 동작합니다.">
            <i className={s.envDot} />
            목데이터
            {manifest && ` · CDM ${manifest.cdm_version}`}
          </span>
        )}
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
