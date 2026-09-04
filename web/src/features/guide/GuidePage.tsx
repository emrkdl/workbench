import { Link, useParams } from "react-router-dom";
import { GUIDE_TABS, guidePath, isGuideTab, type GuideTabKey } from "@/lib/routes";
import { DOCS } from "./docs";
import s from "./guide.module.css";

/**
 * 설계 지침.
 *
 * 사내 매뉴얼·룰·가이드를 한자리에서 본다. 갈래마다 문서가 따로 있으므로 탭으로 나누고,
 * 탭 하나가 문서 하나를 받는다.
 *
 * 탭 이름은 설계 문답의 "찾아볼 곳"과 일부러 같게 맞췄다 — 챗봇이 뒤진다고 말하는 것과
 * 사람이 열어 보는 것이 다른 이름이면 둘이 같은 것을 가리키는지 알 수 없다.
 *
 * 지금은 어느 탭에도 문서가 걸려 있지 않다. 채우는 법은 docs.ts 에 적어 두었다.
 */
export function GuidePage() {
  const { tab } = useParams();
  const active: GuideTabKey = isGuideTab(tab) ? tab : "rules";
  const html = DOCS[active];

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>설계 지침</h1>
        <span className={s.lede}>사내 매뉴얼과 룰, 설계 가이드</span>

        <nav className={s.tabs} aria-label="설계 지침 탭">
          {GUIDE_TABS.map((t) => (
            <Link
              key={t.key}
              to={guidePath(t.key)}
              className={`${s.tab} ${t.key === active ? s.tabOn : ""}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>

      <div className={s.body}>
        {html ? (
          // 사내에서 쓴 문서를 그대로 붙인다. docs.ts 의 주의사항을 볼 것.
          <article className={s.doc} dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className={s.blank}>
            <p className={s.blankTitle}>아직 문서가 걸려 있지 않습니다</p>
            <p className={s.blankBody}>
              이 탭에 <b>{GUIDE_TABS.find((t) => t.key === active)?.label}</b> 문서가 들어옵니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
