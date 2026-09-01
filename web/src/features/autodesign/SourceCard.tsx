import { useRef, useState } from "react";
import type { Board } from "@/lib/cdm";
import { formatBytes } from "@/lib/units";
import type { Source } from "./spec";
import s from "./autodesign.module.css";

/**
 * 무엇을 맡길 것인가 — 설계 파일 고르기.
 *
 * 두 갈래를 나란히 둔다. 새 파일을 올리는 길과, 이미 이 시스템에 들어와 있는 리비전을
 * 고르는 길이다. 둘을 하나로 합치지 않은 이유는 지금 HKP 문법이 아직 붙지 않아서다 —
 * 파일을 올려도 그 안의 부품 목록을 읽지 못하고, 부품을 골라야 하는 아래 단계가 통째로
 * 막힌다. 그 사실을 숨기지 않고 화면에 적어 둔다.
 */
export function SourceCard({
  boards,
  source,
  onChange,
}: {
  boards: Board[];
  source: Source | null;
  onChange: (next: Source | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (file: File | null | undefined) => {
    if (!file) return;
    onChange({ kind: "upload", fileName: file.name, byteSize: file.size });
  };

  return (
    <div className={s.sourceGrid}>
      <div
        className={`${s.drop} ${over ? s.dropOver : ""} ${source?.kind === "upload" ? s.dropFilled : ""}`}
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
        {source?.kind === "upload" ? (
          <>
            <span className={s.dropGlyph} aria-hidden="true">▦</span>
            <span className={s.dropName}>{source.fileName}</span>
            <span className={s.dropMeta}>{formatBytes(source.byteSize ?? 0)}</span>
            <span className={s.dropActions}>
              <button type="button" className={s.linkBtn} onClick={() => fileRef.current?.click()}>
                다른 파일
              </button>
              <button type="button" className={s.linkBtn} onClick={() => onChange(null)}>
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

      <div className={s.pickBoard}>
        <span className={s.fieldLabel}>또는 이미 들어와 있는 리비전</span>
        <select
          className={s.select}
          value={source?.kind === "revision" ? source.revisionId : ""}
          onChange={(e) => {
            const b = boards.find((x) => x.latest_revision_id === e.target.value);
            onChange(
              b
                ? {
                    kind: "revision",
                    revisionId: b.latest_revision_id,
                    boardKey: b.board_key,
                    boardName: b.name,
                  }
                : null,
            );
          }}
        >
          <option value="">고르지 않음</option>
          {boards.map((b) => (
            <option key={b.id} value={b.latest_revision_id}>
              {b.board_key} · {b.name} ({b.latest_revision_label})
            </option>
          ))}
        </select>
        <p className={s.hint}>
          {source?.kind === "upload" ? (
            <>
              올린 파일은 <b>아직 열어 보지 못합니다</b> — HKP 문법이 붙기 전이라 부품 목록을
              읽어 낼 수 없습니다. 아래에서 부품을 골라 조건을 주려면 이미 들어와 있는
              리비전을 함께 고르세요.
            </>
          ) : (
            "여기서 고른 리비전의 부품·넷·적층을 읽어 아래 조건을 채웁니다."
          )}
        </p>
      </div>
    </div>
  );
}
