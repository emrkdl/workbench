import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { LIVE, token } from "@/lib/api";
import { LoginPage } from "@/features/auth/LoginPage";
import { AppShell } from "@/components/AppShell";
import { CatalogPage } from "@/features/catalog/CatalogPage";
import { RevisionPage } from "@/features/revision/RevisionPage";
import { ComparePage } from "@/features/compare/ComparePage";
import { InsightsPage } from "@/features/insights/InsightsPage";
import { PartsPage } from "@/features/parts/PartsPage";
import { AutoDesignPage } from "@/features/autodesign/AutoDesignPage";
import { AskPage } from "@/features/ask/AskPage";
import { GuidePage } from "@/features/guide/GuidePage";
import { EmptyState } from "@/components/ui";

export function App() {
  // 실서버 모드에서 토큰이 없으면 로그인부터. 목데이터 모드에는 인증 자체가 없다.
  const [signedIn, setSignedIn] = useState(() => !LIVE || token() !== null);
  if (!signedIn) return <LoginPage onSignedIn={() => setSignedIn(true)} />;

  return (
    <Routes>
      {/* 로그인 화면은 주소로도 열린다. 인증이 붙기 전에도 이 화면을 손보고 확인할 수
          있어야 하고, 붙은 뒤에는 세션이 끊겼을 때 돌아올 자리가 된다. */}
      <Route path="login" element={<LoginPage onSignedIn={() => setSignedIn(true)} />} />
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/boards" replace />} />
        <Route path="boards" element={<CatalogPage />} />
        {/* 탭은 경로에 들어간다 — 화면 상태를 그대로 링크로 공유할 수 있어야 한다 */}
        <Route path="boards/:boardId/:rev" element={<RevisionPage />} />
        <Route path="boards/:boardId/:rev/:tab" element={<RevisionPage />} />
        <Route path="compare" element={<ComparePage />} />
        <Route path="guide" element={<GuidePage />} />
        <Route path="guide/:tab" element={<GuidePage />} />
        <Route path="auto" element={<AutoDesignPage />} />
        <Route path="ask" element={<AskPage />} />
        <Route path="insights" element={<InsightsPage />} />
        <Route path="parts" element={<PartsPage />} />
        <Route
          path="*"
          element={<EmptyState title="없는 주소입니다" body="좌측 메뉴에서 카탈로그로 돌아가세요." />}
        />
      </Route>
    </Routes>
  );
}
