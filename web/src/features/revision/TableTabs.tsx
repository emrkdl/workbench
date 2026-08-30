import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { ComponentRow, NetRow, RevisionDetail } from "@/lib/cdm";
import { DataTable, type Column } from "@/components/DataTable";
import { Segmented, Tag } from "@/components/ui";
import { formatCoarse, formatCount, formatRouteLength, toDeg } from "@/lib/units";
import { revisionPath } from "@/lib/routes";
import type { DisplayUnit } from "@/lib/units";

/**
 * 부품 표와 넷 표.
 *
 * 둘 다 수천 행이라 DataTable 의 가상 스크롤에 얹는다. 좌표는 나노미터 원값을 그대로
 * 정렬에 쓰고 표시할 때만 mm/mil 로 바꾼다 — 문자열로 정렬하면 10 mm 가 9 mm 앞에 선다.
 */

const SIDE_LABEL: Record<string, string> = { top: "Top", bottom: "Bottom" };

export function ComponentsTab({
  detail,
  unit,
  onUnitChange,
}: {
  detail: RevisionDetail;
  unit: DisplayUnit;
  onUnitChange: (u: DisplayUnit) => void;
}) {
  const columns = useMemo<Column<ComponentRow>[]>(
    () => [
      {
        key: "refdes",
        header: "RefDes",
        width: "92px",
        mono: true,
        strong: true,
        render: (c) => c.refdes,
        sort: (a, b) => a.refdes.localeCompare(b.refdes, undefined, { numeric: true }),
        search: (c) => c.refdes,
      },
      {
        key: "part",
        header: "파트넘버",
        width: "150px",
        mono: true,
        render: (c) => c.part_number ?? "—",
        sort: (a, b) => (a.part_number ?? "").localeCompare(b.part_number ?? ""),
        search: (c) => c.part_number ?? "",
      },
      {
        key: "value",
        header: "값",
        width: "90px",
        render: (c) => c.value ?? "—",
        sort: (a, b) => (a.value ?? "").localeCompare(b.value ?? ""),
        search: (c) => c.value ?? "",
      },
      {
        key: "package",
        header: "패키지",
        width: "124px",
        render: (c) => c.package,
        sort: (a, b) => a.package.localeCompare(b.package),
        search: (c) => c.package,
      },
      {
        key: "maker",
        header: "제조사",
        width: "minmax(130px, 200px)",
        render: (c) => c.manufacturer ?? "—",
        sort: (a, b) => (a.manufacturer ?? "").localeCompare(b.manufacturer ?? ""),
        search: (c) => c.manufacturer ?? "",
      },
      {
        key: "side",
        header: "면",
        width: "70px",
        render: (c) => SIDE_LABEL[c.side] ?? c.side,
        sort: (a, b) => a.side.localeCompare(b.side),
      },
      {
        key: "x",
        header: "X",
        width: "92px",
        align: "right",
        mono: true,
        render: (c) => formatCoarse(c.x_nm, unit),
        sort: (a, b) => a.x_nm - b.x_nm,
      },
      {
        key: "y",
        header: "Y",
        width: "92px",
        align: "right",
        mono: true,
        render: (c) => formatCoarse(c.y_nm, unit),
        sort: (a, b) => a.y_nm - b.y_nm,
      },
      {
        key: "rot",
        header: "회전",
        width: "68px",
        align: "right",
        render: (c) => `${toDeg(c.rotation_mdeg).toFixed(0)}°`,
        sort: (a, b) => a.rotation_mdeg - b.rotation_mdeg,
      },
      {
        key: "pins",
        header: "핀",
        width: "62px",
        align: "right",
        render: (c) => c.pin_count,
        sort: (a, b) => a.pin_count - b.pin_count,
      },
      {
        key: "pitch",
        header: "피치",
        width: "80px",
        align: "right",
        render: (c) => (c.pin_pitch_nm ? `${Math.round(c.pin_pitch_nm / 1000)} µm` : "—"),
        sort: (a, b) => (a.pin_pitch_nm ?? 0) - (b.pin_pitch_nm ?? 0),
      },
    ],
    [unit],
  );

  return (
    <DataTable
      rows={detail.components}
      columns={columns}
      rowKey={(c) => c.refdes}
      defaultSort="refdes"
      searchPlaceholder="RefDes · 파트넘버 · 패키지 · 값"
      toolbarExtra={
        <Segmented
          ariaLabel="좌표 단위"
          value={unit}
          onChange={onUnitChange}
          options={[
            { value: "mm", label: "mm" },
            { value: "mil", label: "mil" },
          ]}
        />
      }
      emptyLabel="이 리비전에는 부품 정보가 없습니다."
    />
  );
}

const CLASS_LABEL: Record<string, string> = {
  power: "전원",
  ground: "GND",
  differential: "차동",
  high_speed: "고속",
};

export function NetsTab({ detail }: { detail: RevisionDetail }) {
  const viewerBase = revisionPath(detail.revision.board_id, detail.revision.id, "viewer");
  const columns = useMemo<Column<NetRow>[]>(
    () => [
      {
        key: "open",
        header: "",
        width: "64px",
        render: (n) => (
          <Link
            to={`${viewerBase}?net=${encodeURIComponent(n.name)}`}
            title={`뷰어에서 ${n.name} 강조`}
            style={{ color: "var(--accent-ink)", fontSize: "var(--fs-xs)" }}
            onClick={(e) => e.stopPropagation()}
          >
            뷰어 →
          </Link>
        ),
      },
      {
        key: "name",
        header: "넷 이름",
        width: "minmax(180px, 1fr)",
        mono: true,
        strong: true,
        render: (n) => (
          <>
            {n.name}
            {n.unrouted && (
              <span style={{ color: "var(--crit)", marginLeft: 6, fontSize: "var(--fs-xs)" }}>미배선</span>
            )}
          </>
        ),
        sort: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
        search: (n) => n.name,
      },
      {
        key: "class",
        header: "분류",
        width: "96px",
        render: (n) => (n.net_class ? <Tag>{CLASS_LABEL[n.net_class] ?? n.net_class}</Tag> : "—"),
        sort: (a, b) => (a.net_class ?? "").localeCompare(b.net_class ?? ""),
        search: (n) => n.net_class ?? "",
      },
      {
        key: "pins",
        header: "핀",
        width: "68px",
        align: "right",
        render: (n) => formatCount(n.pin_count),
        sort: (a, b) => a.pin_count - b.pin_count,
      },
      {
        key: "length",
        header: "배선 길이",
        width: "108px",
        align: "right",
        render: (n) => formatRouteLength(n.length_nm),
        sort: (a, b) => a.length_nm - b.length_nm,
      },
      {
        key: "vias",
        header: "비아",
        width: "68px",
        align: "right",
        render: (n) => n.via_count,
        sort: (a, b) => a.via_count - b.via_count,
      },
      {
        key: "width",
        header: "선폭",
        width: "80px",
        align: "right",
        render: (n) => (n.width_nm ? `${Math.round(n.width_nm / 1000)} µm` : "—"),
        sort: (a, b) => (a.width_nm ?? 0) - (b.width_nm ?? 0),
      },
      {
        key: "layers",
        header: "경유 층",
        width: "116px",
        mono: true,
        render: (n) => (n.layer_span?.length ? n.layer_span.map((l) => `L${l}`).join(" ") : "—"),
        sort: (a, b) => (a.layer_span?.length ?? 0) - (b.layer_span?.length ?? 0),
      },
      {
        key: "partner",
        header: "차동 상대",
        width: "minmax(140px, 180px)",
        mono: true,
        render: (n) => n.diff_partner ?? "—",
        search: (n) => n.diff_partner ?? "",
      },
    ],
    [viewerBase],
  );

  return (
    <DataTable
      rows={detail.nets}
      columns={columns}
      rowKey={(n) => n.name}
      defaultSort="pins"
      defaultDesc
      searchPlaceholder="넷 이름 · 분류"
      emptyLabel="이 리비전에는 넷 정보가 없습니다."
    />
  );
}
