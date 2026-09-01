import { useMemo, useRef, useState } from "react";
import type { Board } from "@/lib/cdm";
import { formatBytes, formatFine } from "@/lib/units";
import type { ReferenceSpec, Source } from "./spec";
import s from "./autodesign.module.css";

/**
 * 무엇을 맡길 것인가 — 설계 파일과, 무엇을 참고하게 할 것인가.
 *
 * 두 가지를 나란히 둔 이유는 둘 다 "재료"이기 때문이다. 왼쪽은 이번에 손댈 판이고,
 * 오른쪽은 그 판을 어떻게 짤지 참고할 지난 판들이다. 엔진은 빈 종이에서 시작하는 것보다
 * 잘 돌던 설계를 흉내 내는 편이 훨씬 낫다 — 전원부 배치나 층 배분처럼 회사마다 굳어진
 * 방식이 있고, 그것은 룰로 적기 어렵지만 지난 보드에는 남아 있다.
 */
export function SourceCard({
  boards,
  source,
  reference,
  onSourceChange,
  onReferenceChange,
}: {
  boards: Board[];
  source: Source | null;
  reference: ReferenceSpec;
  onSourceChange: (next: Source | null) => void;
  onReferenceChange: (next: ReferenceSpec) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [query, setQuery] = useState("");

  const take = (file: File | null | undefined) => {
    if (!file) return;
    onSourceChange({ kind: "upload", fileName: file.name, byteSize: file.size });
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return boards;
    return boards.filter(
      (b) => b.board_key.toLowerCase().includes(q) || b.name.toLowerCase().includes(q),
    );
  }, [boards, query]);

  const toggle = (revisionId: string) =>
    onReferenceChange({
      ...reference,
      revisionIds: reference.revisionIds.includes(revisionId)
        ? reference.revisionIds.filter((id) => id !== revisionId)
        : [...reference.revisionIds, revisionId],
    });

  return (
    <div className={s.sourceGrid}>
      <div>
        <span className={s.fieldLabel}>설계 파일</span>
        <div
          className={`${s.drop} ${over ? s.dropOver : ""} ${source ? s.dropFilled : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            take(e.dataTransfer.files?.[0]);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".hkp,.HKP"
            className={s.hiddenInput}
            onChange={(e) => take(e.target.files?.[0])}
          />
          {source ? (
            <>
              <span className={s.dropGlyph} aria-hidden="true">▦</span>
              <span className={s.dropName}>{source.fileName}</span>
              <span className={s.dropMeta}>{formatBytes(source.byteSize ?? 0)}</span>
              <span className={s.dropActions}>
                <button type="button" className={s.linkBtn} onClick={() => fileRef.current?.click()}>
                  다른 파일
                </button>
                <button type="button" className={s.linkBtn} onClick={() => onSourceChange(null)}>
                  지우기
                </button>
              </span>
            </>
          ) : (
            <>
              <span className={s.dropGlyph} aria-hidden="true">⬓</span>
              <span className={s.dropName}>HKP 파일을 여기에 끌어다 놓기</span>
              <button type="button" className={s.dropBtn} onClick={() => fileRef.current?.click()}>
                파일 선택
              </button>
            </>
          )}
        </div>
      </div>

      <div>
        <span className={s.fieldLabel}>과거 설계 참조</span>
        <div className={s.refBox}>
          <label className={s.check}>
            <input
              type="checkbox"
              checked={reference.enabled}
              onChange={() => onReferenceChange({ ...reference, enabled: !reference.enabled })}
            />
            지난 보드를 참고하게 한다
          </label>

          {reference.enabled ? (
            <>
              <p className={s.hint}>
                고른 보드에서 <b>같은 파트넘버 부품의 상대 위치와 방향</b>, 그리고 층 배분과
                비아 규격을 뽑아 참고합니다. 잘 돌던 블록을 물려주려는 것이지 판 전체를
                베끼는 것이 아닙니다.
              </p>
              <input
                className={s.refSearch}
                type="search"
                placeholder="보드 코드 · 이름"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className={s.refList}>
                {shown.map((b) => {
                  const on = reference.revisionIds.includes(b.latest_revision_id);
                  return (
                    <label key={b.id} className={`${s.refItem} ${on ? s.refItemOn : ""}`}>
                      <input type="checkbox" checked={on} onChange={() => toggle(b.latest_revision_id)} />
                      <span className={s.refKey}>{b.board_key}</span>
                      <span className={s.refName}>{b.name}</span>
                      <span className={s.refMeta}>
                        {b.summary.layer_count}층 · {b.summary.component_count.toLocaleString()}개 ·{" "}
                        {formatFine(b.summary.min_trace_width_nm)}
                      </span>
                    </label>
                  );
                })}
                {shown.length === 0 && <p className={s.hint}>찾는 보드가 없습니다.</p>}
              </div>
              <div className={s.refFoot}>
                <span>{reference.revisionIds.length}장 선택</span>
                <span className={s.spacer} />
                <button
                  type="button"
                  className={s.linkBtn}
                  disabled={!reference.revisionIds.length}
                  onClick={() => onReferenceChange({ ...reference, revisionIds: [] })}
                >
                  선택 해제
                </button>
              </div>
            </>
          ) : (
            <p className={s.hint}>
              참고 없이 맡기면 엔진이 룰만 보고 처음부터 짭니다. 비슷한 판을 이미 만들어
              봤다면 켜는 편이 결과가 낫습니다.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
