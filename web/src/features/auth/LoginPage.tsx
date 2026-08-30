import { useState } from "react";
import { login } from "@/lib/api";
import s from "./login.module.css";

/**
 * 로그인.
 *
 * 실서버(VITE_API_BASE) 모드에서만 나타난다. 목데이터 모드에는 인증이 없다 —
 * 인증할 대상이 없기 때문이지, 나중에 붙이려고 미뤄 둔 것이 아니다.
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
      <form className={s.card} onSubmit={submit}>
        <div className={s.brand}>
          <span className={s.mark}>PCB Design Workbench</span>
          <span className={s.sub}>BoardLens</span>
        </div>
        <label className={s.field}>
          <span>아이디</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
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
        {error && <p className={s.error}>{error}</p>}
        <button type="submit" className={s.submit} disabled={busy || !username || !password}>
          {busy ? "확인 중…" : "로그인"}
        </button>
        <p className={s.note}>사내 계정 연동 전까지는 관리자가 발급한 로컬 계정을 씁니다.</p>
      </form>
    </div>
  );
}
