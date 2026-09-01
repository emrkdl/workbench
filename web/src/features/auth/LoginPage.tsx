import { useState } from "react";
import { login } from "@/lib/api";
import { avatarOf } from "@/lib/avatar";
import s from "./login.module.css";

/**
 * 로그인.
 *
 * 왼쪽은 여기가 무엇을 하는 곳인지, 오른쪽은 들어가는 문. 사내 도구라도 처음 여는 사람은
 * 있고, 그 사람에게 아이디 칸 두 개만 던져 놓으면 자기가 무엇에 로그인하는지 알 수 없다.
 *
 * 인증 로직은 아직 붙지 않았다 — 이 화면은 생김새와 자리만 잡아 둔 것이고, 실제 확인은
 * lib/api 의 login() 이 실서버에 붙을 때 동작한다.
 */
export function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      onSignedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.wrap}>
      <div className={s.panel}>
        <section className={s.intro}>
          <div className={s.brand}>
            <span className={s.mark}>PCB Design Workbench</span>
            <span className={s.sub}>BoardLens</span>
          </div>

          <p className={s.lede}>
            사내에 쌓인 PCB 설계를 한곳에서 열람하고, 리비전 사이에 무엇이 달라졌는지
            기계적으로 견주는 곳입니다.
          </p>

          <ul className={s.points}>
            <li>
              <span className={s.pointGlyph} aria-hidden="true">▤</span>
              설계 카탈로그와 레이아웃 뷰어
            </li>
            <li>
              <span className={s.pointGlyph} aria-hidden="true">⇄</span>
              리비전·보드 간 변경 비교
            </li>
            <li>
              <span className={s.pointGlyph} aria-hidden="true">⌗</span>
              부품 역검색과 재사용 현황
            </li>
          </ul>

          <p className={s.fine}>
            사내망 전용입니다. 외부로 나가는 요청이 없고, 열람 기록은 감사 로그에 남습니다.
          </p>
        </section>

        <form className={s.form} onSubmit={submit}>
          {/* 아이디를 치는 대로 이모지가 바뀐다. 로그인 뒤 머리글에 뜰 표식이 미리 보이므로
              계정을 잘못 친 것을 들어가기 전에 알아챈다. */}
          <div className={s.who}>
            <span className={s.avatar} aria-hidden="true">
              {username ? avatarOf(username) : "○"}
            </span>
            <span className={s.whoText}>
              <b>{username || "계정을 입력하세요"}</b>
              <span>{username ? "로그인 뒤 이 표식으로 보입니다" : "사내 계정"}</span>
            </span>
          </div>

          <label className={s.field}>
            <span>아이디</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              spellCheck={false}
            />
          </label>
          <label className={s.field}>
            <span>비밀번호</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>

          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}

          <button type="submit" className={s.submit} disabled={busy || !username || !password}>
            {busy ? "확인 중…" : "로그인"}
          </button>

          <p className={s.note}>
            사내 계정 연동 전까지는 관리자가 발급한 로컬 계정을 씁니다. 비밀번호를 잊었다면
            설계 인프라 담당자에게 문의하세요.
          </p>
        </form>
      </div>
    </div>
  );
}
