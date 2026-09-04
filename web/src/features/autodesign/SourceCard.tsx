import { useMemo, useRef, useState } from "react";
import type { Board } from "@/lib/cdm";
import { formatBytes, formatFine } from "@/lib/units";
import {
  FORM_FACTORS,
  formFactorOf,
  PLACEHOLDER_MODEL,
  type ReferenceSpec,
  type Source,
} from "./spec";
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
  source: Source;
  reference: ReferenceSpec;
  onSourceChange: (next: Source) => void;
  onReferenceChange: (next: ReferenceSpec) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [form, setForm] = useState("");
  const [model, setModel] = useState("");

  /**
   * 끌어다 놓은 것을 전부 받는다. 예전에는 첫 파일만 집었는데, 여러 개를 놓은 사람은
   * 나머지가 조용히 사라진 것을 알아채지 못한다.
   *
   * 이름과 크기가 같은 것은 같은 파일로 본다 — 두 번 끌어다 놓아도 목록이 불어나지 않는다.
   */
  const take = (list: FileList | null) => {
    const added = Array.from(list ?? []);
    if (!added.length) return;
    const seen = new Set(source.files.map((f) => `${f.name}:${f.byteSize}`));
    const next = [...source.files];
    for (const f of added) {
      const key = `${f.name}:${f.size}`;
      if (seen.has(key)) continue;
      seen.add(key);
      next.push({ name: f.name, byteSize: f.size });
    }
    // 모델명은 파일 안에 있다. 아직 열어 볼 수 없어 임시 값으로 자리만 잡아 둔다.
    onSourceChange({ files: next, model: source.model ?? PLACEHOLDER_MODEL });
  };

  const drop = (name: string, byteSize: number) => {
    const next = source.files.filter((f) => !(f.name === name && f.byteSize === byteSize));
    onSourceChange({ files: next, model: next.length ? source.model : null });
  };

  /** 있는 폼팩터만, 많은 것부터. 없는 종류를 목록에 두면 고르고 나서 빈 화면을 본다. */
  const forms = useMemo(() => {
    const out = new Map<string, number>();
    for (const b of boards) {
      const key = formFactorOf(b.board_key);
      if (key) out.set(key, (out.get(key) ?? 0) + 1);
    }
    return [...out.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [boards]);

  const models = useMemo(
    () => (form ? boards.filter((b) => formFactorOf(b.board_key) === form) : []),
    [boards, form],
  );

  const picked = useMemo(
    () => boards.filter((b) => reference.revisionIds.includes(b.latest_revision_id)),
    [boards, reference.revisionIds],
  );

  const toggle = (revisionId: string) =>
    onReferenceChange({
      ...reference,
      revisionIds: reference.revisionIds.includes(revisionId)
        ? reference.revisionIds.filter((id) => id !== revisionId)
        : [...reference.revisionIds, revisionId],
    });

  return (
    <div className={s.sourceGrid}>
      <div className={s.fileCol}>
        {/* 파일 이름보다 모델명이 먼저다. 이름은 사람이 바꿔 붙이지만 파일 속 모델명은
            그렇지 않으므로, 정말로 무엇을 맡기는지는 그쪽이 말한다. */}
        <div className={`${s.modelBox} ${source.model ? s.modelBoxOn : ""}`}>
          <span className={s.modelLabel}>모델</span>
          <span className={s.modelName}>{source.model ?? "파일을 올리면 여기에 들어옵니다"}</span>
          {source.model && <span className={s.modelNote}>파서가 붙기 전까지는 임시 값입니다</span>}
        </div>

        <div
          className={`${s.drop} ${over ? s.dropOver : ""} ${source.files.length ? s.dropFilled : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            take(e.dataTransfer.files);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".hkp,.HKP"
            multiple
            className={s.hiddenInput}
            onChange={(e) => {
              take(e.target.files);
              // 같은 파일을 다시 고를 수 있어야 한다 — 값이 남아 있으면 change 가 안 뜬다.
              e.target.value = "";
            }}
          />

          {/* 파일이 들어오면 안내는 물러나고 그 자리를 목록이 받는다. 이미 올린 사람에게
              "여기에 끌어다 놓으세요"를 계속 보여 줄 이유가 없다. 상자는 그대로 놓는 자리라
              끌어다 놓기는 목록 위에서도 그대로 된다. */}
          {source.files.length === 0 ? (
            <>
              <span className={s.dropGlyph} aria-hidden="true">⬓</span>
              <span className={s.dropName}>HKP 파일을 여기에 끌어다 놓기</span>
              <button type="button" className={s.dropBtn} onClick={() => fileRef.current?.click()}>
                파일 선택
              </button>
            </>
          ) : (
            <div className={s.fileList}>
              {source.files.map((f) => (
                <div className={s.fileRow} key={`${f.name}:${f.byteSize}`}>
                  <span className={s.fileName}>{f.name}</span>
                  <span className={s.fileSize}>{formatBytes(f.byteSize)}</span>
                  <button
                    type="button"
                    aria-label={`${f.name} 빼기`}
                    title="목록에서 빼기"
                    onClick={() => drop(f.name, f.byteSize)}
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className={s.fileFoot}>
                <span>
                  {source.files.length}개 ·{" "}
                  {formatBytes(source.files.reduce((sum, f) => sum + f.byteSize, 0))}
                </span>
                <span className={s.spacer} />
                <button type="button" className={s.linkBtn} onClick={() => fileRef.current?.click()}>
                  파일 추가
                </button>
                <button
                  type="button"
                  className={s.linkBtn}
                  onClick={() => onSourceChange({ files: [], model: null })}
                >
                  모두 지우기
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        <span className={s.fieldLabel}>과거 설계 참조</span>
        <div className={s.refBox}>
          {/* 반영/미반영 — 참조를 "쓴다/안 쓴다"로 못박는다. 체크박스는 무엇이 기본인지
              애매한데, 이건 결과가 크게 달라지는 갈림길이라 두 갈래를 다 보여 준다. */}
          <div className={s.seg} role="group" aria-label="과거 설계 참조">
            {([[true, "반영"], [false, "미반영"]] as const).map(([v, label]) => (
              <button
                key={label}
                type="button"
                className={reference.enabled === v ? s.segOn : ""}
                aria-pressed={reference.enabled === v}
                onClick={() => onReferenceChange({ ...reference, enabled: v })}
              >
                {label}
              </button>
            ))}
          </div>

          {reference.enabled ? (
            <>
              {/* 폼팩터로 먼저 좁히고 그 안에서 모델을 고른다. 서른 장을 한 줄로 늘어놓으면
                  메인보드를 찾다가 플렉스를 고른다. */}
              <div className={s.pickSteps}>
                <label className={s.step}>
                  <span>1. 폼팩터</span>
                  <select
                    value={form}
                    onChange={(e) => {
                      setForm(e.target.value);
                      setModel("");
                    }}
                  >
                    <option value="">고르세요</option>
                    {forms.map(([key, count]) => (
                      <option key={key} value={key}>
                        {FORM_FACTORS[key] ?? key} ({count})
                      </option>
                    ))}
                  </select>
                </label>
                <label className={s.step}>
                  <span>2. 모델</span>
                  <select
                    value={model}
                    disabled={!form}
                    onChange={(e) => {
                      const id = e.target.value;
                      setModel("");
                      if (id && !reference.revisionIds.includes(id)) {
                        onReferenceChange({ ...reference, revisionIds: [...reference.revisionIds, id] });
                      }
                    }}
                  >
                    <option value="">{form ? "고르세요" : "폼팩터를 먼저"}</option>
                    {models.map((b) => (
                      <option
                        key={b.id}
                        value={b.latest_revision_id}
                        disabled={reference.revisionIds.includes(b.latest_revision_id)}
                      >
                        {b.board_key} · {b.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {picked.length > 0 ? (
                <div className={s.pickedList}>
                  {picked.map((b) => (
                    <span key={b.id} className={s.picked}>
                      <b>{b.board_key}</b>
                      <span>
                        {b.summary.layer_count}층 · {b.summary.component_count.toLocaleString()}개 ·{" "}
                        {formatFine(b.summary.min_trace_width_nm)}
                      </span>
                      <button
                        type="button"
                        aria-label={`${b.board_key} 참조에서 빼기`}
                        onClick={() => toggle(b.latest_revision_id)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className={s.hint}>고른 모델이 없습니다. 위에서 폼팩터와 모델을 차례로 고르세요.</p>
              )}

              <p className={s.hint}>
                고른 보드에서 <b>같은 파트넘버 부품의 상대 위치와 방향</b>, 그리고 층 배분과
                비아 규격을 뽑아 참고합니다. 잘 돌던 블록을 물려주려는 것이지 판 전체를
                베끼는 것이 아닙니다.
              </p>
            </>
          ) : (
            <p className={s.hint}>
              참고 없이 맡기면 엔진이 룰만 보고 처음부터 짭니다. 비슷한 판을 이미 만들어
              봤다면 반영하는 편이 결과가 낫습니다.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
