import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import type { Message } from "./model";
import s from "./ask.module.css";

/**
 * 오간 말.
 *
 * 원본은 말풍선 옆에 아바타(ME / 로봇 아이콘)를 두었다. 여기서는 뺐다 — 이 화면에서
 * 말하는 쪽은 둘뿐이라 좌우로 갈라 놓는 것만으로 누구 말인지 헷갈릴 일이 없고, 아바타는
 * 한 줄짜리 물음에도 40px 짜리 자리를 계속 차지한다. 대신 작은 이름표를 붙였다.
 */
export function ChatStream({
  messages,
  thinking,
  samples,
  onSample,
}: {
  messages: Message[];
  thinking: boolean;
  samples: string[];
  onSample: (q: string) => void;
}) {
  const foot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    foot.current?.scrollIntoView({ block: "end" });
  }, [messages, thinking]);

  if (messages.length === 0 && !thinking) {
    return (
      <div className={s.stream}>
        <div className={s.blank}>
          <p className={s.blankTitle}>무엇을 알고 싶으세요?</p>
          <p className={s.blankBody}>
            쌓인 설계에 대해 물어보세요. 오른쪽에서 <b>무엇을 보고 답할지</b>와 <b>어느 판</b>인지를
            먼저 정하면 답이 그만큼 좁아집니다.
          </p>
          {/* 빈 화면에 커서만 깜빡이면 사람은 무엇을 물어도 되는지 모른다. 물을 수 있는
              것의 폭을 예시 몇 개로 보여 주는 편이 설명 한 문단보다 빠르다. */}
          <div className={s.samples}>
            {samples.map((q) => (
              <button key={q} type="button" className={s.sample} onClick={() => onSample(q)}>
                {q}
              </button>
            ))}
          </div>
        </div>
        <div ref={foot} />
      </div>
    );
  }

  return (
    <div className={s.stream}>
      <div className={s.turns}>
        {messages.map((m) => (m.role === "user" ? <Ask key={m.id} m={m} /> : <Answer key={m.id} m={m} />))}
        {thinking && (
          <div className={s.turn}>
            <span className={s.who}>답</span>
            <div className={`${s.bubble} ${s.thinking}`}>
              읽는 중
              <span className={s.dots} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        )}
      </div>
      <div ref={foot} />
    </div>
  );
}

function Ask({ m }: { m: Message }) {
  return (
    <div className={`${s.turn} ${s.turnMine}`}>
      <span className={s.who}>나</span>
      <div className={`${s.bubble} ${s.bubbleMine}`}>
        <p className={s.text}>{m.text}</p>
        {/* 물을 때 무엇이 걸려 있었는지 함께 남긴다. 나중에 대화를 다시 읽을 때
            "왜 이렇게 답했지"의 절반은 그때의 조건이 설명한다. */}
        {(m.scope?.length || m.files?.length) && (
          <div className={s.chips}>
            {m.scope?.map((c) => (
              <span key={c} className={s.chip}>
                {c}
              </span>
            ))}
            {m.files?.map((f) => (
              <span key={f} className={`${s.chip} ${s.chipFile}`}>
                {f}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Answer({ m }: { m: Message }) {
  return (
    <div className={s.turn}>
      <span className={s.who}>답</span>
      <div className={s.bubble}>
        <p className={s.text}>{m.text}</p>

        {m.cites && m.cites.length > 0 && (
          <div className={s.cites}>
            <span className={s.citeLabel}>근거</span>
            {m.cites.map((c) =>
              c.to ? (
                <Link key={c.label} to={c.to} className={s.cite}>
                  <b>{c.label}</b>
                  <span>{c.note}</span>
                </Link>
              ) : (
                <span key={c.label} className={s.cite}>
                  <b>{c.label}</b>
                  <span>{c.note}</span>
                </span>
              ),
            )}
          </div>
        )}

        {/* 원본은 여기에 "승인 후 실행 / 거절" 을 두었다. 이 앱은 CAD 를 직접 돌리지
            않으므로 승인할 것이 없다 — 대신 이 앱 안에서 실제로 갈 수 있는 곳을 준다. */}
        {m.next && m.next.length > 0 && (
          <div className={s.next}>
            {m.next.map((n) => (
              <Link key={n.to} to={n.to} className={s.nextBtn}>
                {n.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
