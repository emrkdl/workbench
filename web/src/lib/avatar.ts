/**
 * 사용자 표식 — 계정 이름에서 이모지 하나를 뽑는다.
 *
 * 사진을 올리게 하려면 저장소와 업로드 경로가 필요하고, 머리글자를 쓰면 김·이·박이 전부
 * 같은 글자로 보인다. 이모지는 아무것도 저장하지 않으면서 서로 확실히 다르다.
 *
 * 같은 계정이면 어느 화면에서든 언제나 같은 이모지가 나와야 한다. 그래서 난수가 아니라
 * 계정 이름의 해시로 고른다 — 서버에 값을 두지 않아도 브라우저마다 같은 결과가 나온다.
 */

const FACES = [
  "🦊", "🐧", "🦉", "🐢", "🦁", "🐨", "🦄", "🐙",
  "🦜", "🐝", "🦥", "🐬", "🦅", "🐳", "🦌", "🐼",
];

/** 짧은 문자열용 FNV-1a. 짧고 고르게 흩어지면 충분하다. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function avatarOf(username: string | null | undefined): string {
  if (!username) return "○";
  return FACES[hash(username) % FACES.length]!;
}

/** 이모지 뒤에 깔 색. 같은 이모지가 겹쳐도 사람이 갈린다. */
export function avatarHue(username: string | null | undefined): number {
  if (!username) return 0;
  return hash(`${username}#hue`) % 360;
}
