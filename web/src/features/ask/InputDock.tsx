import { useRef, useState, type KeyboardEvent } from "react";
import { formatBytes } from "@/lib/units";
import s from "./ask.module.css";

export interface Attached {
  name: string;
  byteSize: number;
}

/**
 * 묻는 자리.
 *
 * Enter 로 보내고 Shift+Enter 로 줄을 바꾼다 — 원본과 같다. 줄이 늘면 상자도 늘지만
 * 다섯 줄에서 멈춘다. 그 위로는 대화가 밀려 올라가 방금 받은 답이 화면 밖으로 나간다.
 */
export function InputDock({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  files,
  onAttach,
  onDetach,
  blocked,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  files: Attached[];
  onAttach: (list: FileList | null) => void;
  onDetach: (name: string) => void;
  /** 지금 보낼 수 없는 까닭. 없으면 보낼 수 있다. */
  blocked: string | null;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const grow = () => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  };

  const send = () => {
    if (busy || blocked || !value.trim()) return;
    onSend();
    const el = box.current;
    if (el) el.style.height = "auto";
  };

  const key = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    send();
  };

  return (
    <div
      className={`${s.dock} ${over ? s.dockOver : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onAttach(e.dataTransfer.files);
      }}
    >
      {files.length > 0 && (
        <div className={s.attached}>
          {files.map((f) => (
            <span key={f.name} className={s.attach}>
              <b>{f.name}</b>
              <span>{formatBytes(f.byteSize)}</span>
              <button type="button" aria-label={`${f.name} 빼기`} onClick={() => onDetach(f.name)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className={s.dockRow}>
        <input
          ref={pick}
          type="file"
          multiple
          className={s.hiddenInput}
          onChange={(e) => {
            onAttach(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className={s.iconBtn}
          title="자료 붙이기"
          aria-label="자료 붙이기"
          onClick={() => pick.current?.click()}
        >
          ＋
        </button>
        <textarea
          ref={box}
          rows={1}
          className={s.input}
          value={value}
          placeholder="설계에 대해 물어보세요"
          onChange={(e) => {
            onChange(e.target.value);
            grow();
          }}
          onKeyDown={key}
        />
        <button
          type="button"
          className={busy ? `${s.sendBtn} ${s.stopBtn}` : s.sendBtn}
          onClick={busy ? onStop : send}
          disabled={!busy && (!value.trim() || blocked !== null)}
        >
          {busy ? "중지" : "보내기"}
        </button>
      </div>

      <div className={s.dockFoot}>
        {blocked ? <span className={s.blocked}>{blocked}</span> : <span />}
        <span className={s.keyHint}>Enter 로 보내기 · Shift+Enter 줄바꿈</span>
      </div>
    </div>
  );
}
