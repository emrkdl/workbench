import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fetchRevision } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { ErrorState, Loading, StatusPill } from "@/components/ui";
import { isTabKey, revisionId, revisionPath, TABS, type TabKey } from "@/lib/routes";
import type { DisplayUnit } from "@/lib/units";
import { OverviewTab } from "./OverviewTab";
import { StackupTab } from "./StackupTab";
import { ComponentsTab, NetsTab } from "./TableTabs";
import { FilesTab, ManufacturingTab, RevisionsTab } from "./RecordTabs";
import { ViewerTab } from "../viewer/ViewerTab";
import s from "./revision.module.css";

/** 표 탭은 남은 높이를 다 쓰고, 나머지는 페이지 스크롤에 얹힌다. */
const FULL_HEIGHT_TABS = new Set<TabKey>(["components", "nets", "viewer"]);

export function RevisionPage() {
  const { boardId = "", rev = "", tab } = useParams();
  const navigate = useNavigate();
  const [unit, setUnit] = useState<DisplayUnit>("mm");

  const id = revisionId(boardId, rev);
  const { data: detail, error, loading } = useAsync(() => fetchRevision(id), [id]);

  const active: TabKey = isTabKey(tab) ? tab : "overview";

  if (loading) return <Loading label="리비전을 불러오는 중" />;
  if (error) return <ErrorState error={error} />;
  if (!detail) return null;

  const { revision } = detail;

  return (
    <div className={s.page}>
      <header className={s.head}>
        <nav className={s.crumbs} aria-label="위치">
          <Link to="/boards">카탈로그</Link>
          <span>/</span>
          <span>{detail.product_family ?? detail.project_key ?? "보드"}</span>
        </nav>

        <div className={s.identity}>
          <span className={s.boardKey}>{revision.board_key}</span>
          <h1 className={s.boardName}>{revision.board_name}</h1>
          <StatusPill status={revision.status} />
          <span className={s.headSpacer} />
          <div className={s.revPicker}>
            <span className={s.revLabel}>리비전</span>
            <select
              className={s.revSelect}
              aria-label="리비전 선택"
              value={revision.id}
              onChange={(e) => navigate(revisionPath(revision.board_id, e.target.value, active))}
            >
              {detail.lineage.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} · {r.created_at.slice(0, 10)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={s.subline}>
          <span>{revision.author ?? "담당 미지정"}</span>
          <span className={s.sep}>·</span>
          <span>
            {revision.source_tool} {revision.source_version}
          </span>
          <span className={s.sep}>·</span>
          <span>등록 {revision.created_at.slice(0, 10)}</span>
          {revision.note && (
            <>
              <span className={s.sep}>·</span>
              <span className={s.note}>{revision.note}</span>
            </>
          )}
        </div>

        <nav className={s.tabs} aria-label="리비전 상세 탭">
          {TABS.map((t) => (
            <Link
              key={t.key}
              to={revisionPath(revision.board_id, revision.id, t.key)}
              className={[
                s.tab,
                t.key === active ? s.tabOn : "",
              ].join(" ")}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>

      <div className={`${s.body} ${FULL_HEIGHT_TABS.has(active) ? "" : s.scrollBody}`}>
        {active === "overview" && <OverviewTab detail={detail} />}
        {active === "viewer" && <ViewerTab detail={detail} unit={unit} onUnitChange={setUnit} />}
        {active === "stackup" && <StackupTab detail={detail} />}
        {active === "components" && <ComponentsTab detail={detail} unit={unit} onUnitChange={setUnit} />}
        {active === "nets" && <NetsTab detail={detail} />}
        {active === "manufacturing" && <ManufacturingTab detail={detail} />}
        {active === "revisions" && <RevisionsTab detail={detail} />}
        {active === "files" && <FilesTab detail={detail} />}
      </div>
    </div>
  );
}
