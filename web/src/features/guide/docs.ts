import type { GuideTabKey } from "@/lib/routes";

/**
 * 탭에 채워 넣을 문서.
 *
 * 사내 지침은 이미 HTML 로 있고, 나중에 그것을 여기에 걸면 된다. 두 가지 방법이 있다.
 *
 *   1) 파일을 이 폴더에 두고 그대로 가져온다 (Vite 의 ?raw — 번들에 문자열로 들어간다)
 *        import rules from "./docs/rules.html?raw";
 *        export const DOCS = { rules, ... };
 *
 *   2) 문서를 자주 갈아 끼운다면 서버에서 받아 온다. 그때는 이 상수를 걷어내고
 *      GuidePage 에서 fetch 로 바꾼다 — 화면 쪽은 문자열 하나만 보므로 그대로다.
 *
 * 넣기 전까지는 null 이고, 화면은 "아직 안 들어왔다"고 적는다.
 *
 * 여기 들어오는 HTML 은 그대로 화면에 붙는다(dangerouslySetInnerHTML). 사내에서 쓴
 * 문서라 그렇게 두지만, 바깥에서 받은 HTML 을 이 자리에 그대로 흘려 넣지는 말 것.
 */
export const DOCS: Record<GuideTabKey, string | null> = {
  rules: null,
  stackup: null,
  layout: null,
  manual: null,
  glossary: null,
};
