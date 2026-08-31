import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { RevisionDetail } from "@/lib/cdm";
import { formatCoarse, formatFine, type DisplayUnit } from "@/lib/units";
import { conductorNumbers, ROLE_LABEL } from "../revision/layers";
import type { Camera } from "./renderer";
import { css as familyCss, familyOf, FAMILIES, type FamilyKey } from "@/lib/families";
import {
  BoardScene,
  css,
  componentPoints,
  useLayerInfos,
  VIA_KIND_LABEL,
  VIA_KIND_ORDER,
  VIA_KIND_RGB_CSS,
  type SceneHandle,
  type Selection,
  type SideView,
  type ViewMode,
} from "./BoardScene";
import s from "./viewer.module.css";

export type { ViewMode, SideView } from "./BoardScene";

/**
 * 2D 레이아웃 뷰어.
 *
 * 카메라는 상태가 아니라 ref 다. 팬·줌은 프레임마다 일어나는데 그때마다 React 를 다시
 * 그리면 60fps 가 나오지 않는다. 화면 갱신은 rAF 루프 하나가 맡고, React 상태는 사람이
 * 실제로 선택을 바꿨을 때만 움직인다.
 */

export function ViewerTab({
  detail,
  unit,
  onUnitChange,
}: {
  detail: RevisionDetail;
  unit: DisplayUnit;
  onUnitChange: (u: DisplayUnit) => void;
}) {
  const sceneRef = useRef<SceneHandle>(null);
  const cameraRef = useRef<Camera>({ cx: 0, cy: 0, scale: 1e-5 });

  const [visible, setVisible] = useState<Record<number, boolean>>({});
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [highlightNet, setHighlightNet] = useState<number | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [measure, setMeasure] = useState<{ a: [number, number] | null; b: [number, number] | null }>({ a: null, b: null });
  const [cursorText, setCursorText] = useState("—");
  const [refdesQuery, setRefdesQuery] = useState("");
  const [params] = useSearchParams();
  // 배치도가 기본이다. 설계 리뷰에서 먼저 보는 것이 "무엇이 어디 있나"이지
  // "동박이 어떻게 깔렸나"가 아니다.
  // URL 에 실어 두면 "이 배선 좀 봐 주세요"를 링크 하나로 보낼 수 있다. 넷 강조(?net=)도
  // 같은 방식이라 동박 화면을 그대로 건네는 데 필요한 것이 다 URL 에 있다.
  const [mode, setMode] = useState<ViewMode>(() => {
    const v = params.get("view");
    return v === "copper" || v === "both" ? v : "placement";
  });
  const [sideView, setSideView] = useState<SideView>("top");
  const [labels, setLabels] = useState(true);
  const [hiddenFamilies, setHiddenFamilies] = useState<Set<FamilyKey>>(() => new Set());
  const [alpha, setAlpha] = useState(0.85);
  // 확장 — 판을 크게 보려고 여기 온 것이므로, 머리글·탭·왼쪽 레일을 전부 덮고 화면을 다 쓴다.
  const [expanded, setExpanded] = useState(false);

  const conductorNo = useMemo(() => conductorNumbers(detail.stackup), [detail.stackup]);
  const layerInfos = useLayerInfos(detail);
  const points = useMemo(() => componentPoints(detail), [detail]);

  /** 이 보드에 실제로 쓰인 비아 규격. 범례는 있는 것만 적는다. */
  const viaKindsPresent = useMemo(
    () =>
      detail.vias.map((v) => ({
        kind: VIA_KIND_ORDER.indexOf(v.kind),
        from: v.from_layer,
        to: v.to_layer,
        drill: v.drill_nm,
      })).filter((v) => v.kind >= 0),
    [detail.vias],
  );

  const familyCounts = useMemo(() => {
    const out = new Map<FamilyKey, number>();
    for (const c of detail.components) {
      if (sideView !== "both" && c.side !== sideView) continue;
      const k = familyOf(c);
      out.set(k, (out.get(k) ?? 0) + 1);
    }
    return out;
  }, [detail.components, sideView]);

  // 리비전이 바뀌면 레이어를 다 켜고 선택을 비운다. 앞 보드에서 끄고 보던 층을
  // 다음 보드에 그대로 물려주면 "왜 아무것도 안 보이지"가 된다.
  useEffect(() => {
    setVisible(Object.fromEntries(layerInfos.map((l) => [l.index, true])));
    setSelection(null);
    setHighlightNet(null);
  }, [layerInfos]);

  // 넷 표에서 "뷰어에서 보기"로 넘어오면 그 넷을 강조하고 화면을 그쪽으로 맞춘다.
  const requestedNet = params.get("net");
  useEffect(() => {
    if (!requestedNet || loaded === 0) return;
    const id = detail.nets.findIndex((n) => n.name === requestedNet);
    if (id < 0) return;
    setHighlightNet(id);

    const xs: number[] = [];
    const ys: number[] = [];
    for (const [, buffers] of sceneRef.current?.buffers() ?? []) {
      for (let i = 0; i < buffers.pads.length / 4; i += 1) {
        if (buffers.padNets[i] === id) {
          xs.push(buffers.pads[i * 4]!);
          ys.push(buffers.pads[i * 4 + 1]!);
        }
      }
    }
    const stage = sceneRef.current?.stage();
    if (xs.length && stage) {
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      const scale = Math.min(stage.clientWidth / (x1 - x0 || 1), stage.clientHeight / (y1 - y0 || 1)) * 0.7;
      cameraRef.current = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale: Math.min(scale, 0.01) };
    }
    sceneRef.current?.invalidate();
  }, [requestedNet, loaded, detail.nets]);

  const fit = () => sceneRef.current?.fit();

  const gotoRefdes = (query: string) => {
    const target = points.find((c) => c.refdes.toLowerCase() === query.trim().toLowerCase());
    if (!target) return;
    cameraRef.current = { cx: target.x, cy: target.y, scale: Math.max(cameraRef.current.scale, 5e-4) };
    setSelection({ hit: null, component: target });
    sceneRef.current?.invalidate();
  };

  const soloLayer = (index: number) => {
    const onlyThis = layerInfos.every((l) => (l.index === index) === (visible[l.index] !== false));
    setVisible(Object.fromEntries(layerInfos.map((l) => [l.index, onlyThis ? true : l.index === index])));
  };

  const shownCount = useMemo(
    () =>
      detail.components.filter(
        (c) => !hiddenFamilies.has(familyOf(c)) && (sideView === "both" || c.side === sideView),
      ).length,
    [detail.components, hiddenFamilies, sideView],
  );

  // 확장 상태에서는 Esc 로 빠져나온다. 전체 화면을 덮는 것에는 언제나 나가는 길이 있어야 한다.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const measured =
    measure.a && measure.b ? Math.hypot(measure.b[0] - measure.a[0], measure.b[1] - measure.a[1]) : null;

  const netName = (id: number | null) => (id == null ? null : detail.nets[id]?.name ?? `#${id}`);
  const totalObjects = layerInfos.reduce((sum, l) => sum + l.objectCount, 0);

  if (error) {
    return (
      <div className={s.wrap}>
        <div className={s.failure}>
          <b>레이아웃을 표시할 수 없습니다</b>
          <p style={{ maxWidth: "46ch", lineHeight: 1.6 }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${s.wrap} ${expanded ? s.wrapExpanded : ""}`}>
      <div className={s.toolbar}>
        <div className={s.seg} role="group" aria-label="보기 종류">
          {(
            [
              ["placement", "배치"],
              ["copper", "동박"],
              ["both", "둘 다"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={mode === k ? s.segOn : ""}
              aria-pressed={mode === k}
              onClick={() => setMode(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={s.seg} role="group" aria-label="보는 면">
          {(
            [
              ["top", "TOP"],
              ["bottom", "BOTTOM"],
              ["both", "양면"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={sideView === k ? s.segOn : ""}
              aria-pressed={sideView === k}
              onClick={() => setSideView(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className={s.sep} />
        <button type="button" className={s.btn} onClick={fit}>
          전체 보기
        </button>
        <label className={s.chk}>
          <input type="checkbox" checked={labels} onChange={() => setLabels((v) => !v)} />
          라벨
        </label>
        <label className={s.range} title="부품 투명도">
          α
          <input
            type="range"
            min={20}
            max={100}
            step={5}
            value={Math.round(alpha * 100)}
            onChange={(e) => setAlpha(Number(e.target.value) / 100)}
            aria-label="부품 투명도"
          />
        </label>
        <button
          type="button"
          className={`${s.btn} ${measuring ? s.btnOn : ""}`}
          onClick={() => {
            setMeasuring((v) => !v);
            setMeasure({ a: null, b: null });
          }}
        >
          거리 측정
        </button>
        <button
          type="button"
          className={s.btn}
          disabled={highlightNet === null}
          onClick={() => setHighlightNet(null)}
        >
          강조 해제
        </button>
        <span className={s.sep} />
        <input
          className={s.search}
          placeholder="RefDes 이동"
          aria-label="RefDes 로 이동"
          value={refdesQuery}
          onChange={(e) => setRefdesQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && gotoRefdes(refdesQuery)}
        />
        <button type="button" className={s.btn} onClick={() => gotoRefdes(refdesQuery)}>
          찾기
        </button>
        <span className={s.sep} />
        <button
          type="button"
          className={`${s.btn} ${unit === "mm" ? s.btnOn : ""}`}
          onClick={() => onUnitChange("mm")}
        >
          mm
        </button>
        <button
          type="button"
          className={`${s.btn} ${unit === "mil" ? s.btnOn : ""}`}
          onClick={() => onUnitChange("mil")}
        >
          mil
        </button>
        <span className={s.spacer} />
        <span className={s.hintText}>휠 확대 · 끌어서 이동 · 클릭으로 선택</span>
        <button
          type="button"
          className={`${s.btn} ${expanded ? s.btnOn : ""}`}
          title={expanded ? "축소 (Esc)" : "화면 전체로 넓히기"}
          aria-pressed={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "⤡ 축소" : "⤢ 확장"}
        </button>
      </div>

      <aside className={s.layers}>
        {mode !== "copper" && (
          <>
            <div className={s.layersHead}>
              <span>패키지 계열</span>
              <button
                type="button"
                className={s.soloBtn}
                onClick={() => setHiddenFamilies(new Set())}
                disabled={hiddenFamilies.size === 0}
              >
                모두 켜기
              </button>
            </div>
            {FAMILIES.filter((f) => familyCounts.get(f.key)).map((f) => {
              const on = !hiddenFamilies.has(f.key);
              return (
                <label key={f.key} className={`${s.layerRow} ${on ? "" : s.layerDim}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setHiddenFamilies((prev) => {
                        const next = new Set(prev);
                        if (on) next.add(f.key);
                        else next.delete(f.key);
                        return next;
                      })
                    }
                  />
                  <span className={s.swatch} style={{ background: familyCss(f.rgb) }} />
                  <span className={s.layerName}>{f.label}</span>
                  <span className={s.layerRole}>{familyCounts.get(f.key)}</span>
                </label>
              );
            })}
          </>
        )}

        {mode !== "placement" && (
        <>
        <div className={s.layersHead}>
          <span>레이어 {layerInfos.length}</span>
          <button
            type="button"
            className={s.soloBtn}
            onClick={() => setVisible(Object.fromEntries(layerInfos.map((l) => [l.index, true])))}
          >
            모두 켜기
          </button>
        </div>
        {layerInfos.map((info) => {
          const on = visible[info.index] !== false;
          return (
            <label key={info.index} className={`${s.layerRow} ${on ? "" : s.layerDim}`}>
              <input type="checkbox" checked={on} onChange={() => setVisible((v) => ({ ...v, [info.index]: !on }))} />
              <span className={s.swatch} style={{ background: css(info.color) }} />
              <span className={s.layerName}>
                {info.label}
                <span className={s.layerRole}> {ROLE_LABEL[info.role as keyof typeof ROLE_LABEL] ?? info.role}</span>
              </span>
              <button
                type="button"
                className={s.soloBtn}
                title="이 층만 보기"
                onClick={(e) => {
                  e.preventDefault();
                  soloLayer(info.index);
                }}
              >
                단독
              </button>
            </label>
          );
        })}

        {/* 비아 색은 층이 아니라 종류를 말한다. 층 목록의 색과 규칙이 다르므로 따로 적어 둔다. */}
        {viaKindsPresent.length > 0 && (
          <>
            <div className={s.layersHead}>
              <span>비아</span>
            </div>
            {viaKindsPresent.map((k) => (
              <div key={k.kind} className={s.viaRow}>
                <span className={s.viaSwatch} style={{ borderColor: VIA_KIND_RGB_CSS[k.kind] }} />
                <span className={s.layerName}>
                  {VIA_KIND_LABEL[k.kind]}
                  <span className={s.layerRole}> L{k.from}–L{k.to} · ⌀{formatFine(k.drill, unit)}</span>
                </span>
              </div>
            ))}
          </>
        )}
        </>
        )}
      </aside>

      <div className={s.stageHost}>
        <BoardScene
          ref={sceneRef}
          detail={detail}
          layers={layerInfos}
          visible={visible}
          mode={mode}
          sideView={sideView}
          labels={labels}
          alpha={alpha}
          hiddenFamilies={hiddenFamilies}
          highlightNet={highlightNet}
          selection={selection}
          unit={unit}
          camera={cameraRef}
          measuring={measuring}
          measure={measure}
          onMeasure={setMeasure}
          onSelect={(next) => {
            setSelection(next);
            setHighlightNet(next?.hit?.netId ?? null);
          }}
          onCursor={setCursorText}
          onLoadedChange={setLoaded}
          onError={setError}
          className={measuring ? s.measuring : ""}
        />

        {loaded < layerInfos.length && (
          <div className={s.loading}>
            <span>
              레이어 {loaded} / {layerInfos.length} 적재 중
            </span>
            <div className={s.progress}>
              <div
                className={s.progressFill}
                style={{ width: `${(loaded / Math.max(layerInfos.length, 1)) * 100}%` }}
              />
            </div>
          </div>
        )}

        {selection && (
          <div className={s.inspector}>
            <div className={s.inspectorHead}>
              <span>선택</span>
              <button
                type="button"
                className={s.inspectorClose}
                aria-label="닫기"
                onClick={() => {
                  setSelection(null);
                  setHighlightNet(null);
                }}
              >
                ×
              </button>
            </div>
            <dl className={s.inspectorBody}>
              {selection.component && (
                <>
                  <dt>부품</dt>
                  <dd>{selection.component.refdes}</dd>
                  <dt>패키지</dt>
                  <dd>{selection.component.package}</dd>
                  {selection.component.partNumber && (
                    <>
                      <dt>파트넘버</dt>
                      <dd>{selection.component.partNumber}</dd>
                    </>
                  )}
                  <dt>면</dt>
                  <dd>{selection.component.side}</dd>
                </>
              )}
              {selection.hit && (
                <>
                  <dt>객체</dt>
                  <dd>
                    {{ pad: "패드", via: "비아", trace: "배선", plane: "플레인" }[selection.hit.kind]}
                    {selection.hit.kind === "via" && selection.hit.viaKind !== undefined
                      ? ` (${VIA_KIND_LABEL[selection.hit.viaKind] ?? "?"})`
                      : ""}
                    {" · L"}
                    {conductorNo.get(selection.hit.layerIndex) ?? selection.hit.layerIndex}
                  </dd>
                  <dt>넷</dt>
                  <dd>{netName(selection.hit.netId) ?? "연결 없음"}</dd>
                  {selection.hit.width ? (
                    <>
                      <dt>선폭</dt>
                      <dd>{formatFine(selection.hit.width, unit)}</dd>
                    </>
                  ) : null}
                </>
              )}
            </dl>
          </div>
        )}
      </div>

      <div className={s.status}>
        <span>
          커서 <b>{cursorText}</b>
        </span>
        <span>
          배율 <b>1 px = {formatCoarse(Math.round(1 / cameraRef.current.scale), unit)}</b>
        </span>
        <span>
          {mode === "placement" ? (
            <>
              부품 <b>{shownCount.toLocaleString()}</b> / {detail.components.length.toLocaleString()}
            </>
          ) : (
            <>
              객체 <b>{totalObjects.toLocaleString()}</b>
            </>
          )}
        </span>
        {highlightNet !== null && (
          <span className={s.statusAccent}>
            넷 강조 <b>{netName(highlightNet)}</b> · {detail.nets[highlightNet]?.pin_count ?? 0}핀
          </span>
        )}
        {measured !== null && (
          <span className={s.statusAccent}>
            측정 <b>{formatCoarse(Math.round(measured), unit)}</b>
          </span>
        )}
      </div>
    </div>
  );
}
