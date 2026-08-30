import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./App";
import "./styles/global.css";

// 폐쇄망에서는 nginx 재작성 규칙 없이 정적 파일만 얹는 경우가 많다.
// HashRouter 면 새로고침과 딥링크가 서버 설정과 무관하게 동작한다.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
