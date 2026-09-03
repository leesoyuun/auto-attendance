/**
 * 한글 초성 검색.
 *
 * 명단이 늘면 전원을 훑는 대신 검색해서 찍게 되므로, `ㅈㅇ` 만 쳐도 `주원` 이
 * 나와야 실용적입니다. 사전이나 형태소 분석이 필요 없고, 한글 음절 코드를
 * 588로 나눈 몫이 초성 인덱스라는 산술만으로 됩니다.
 */

const CHO = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

const SYLLABLE_START = 0xac00;
const SYLLABLE_END = 0xd7a3;
const SYLLABLES_PER_CHO = 588;

const JAMO_START = 0x3131;
const JAMO_END = 0x314e;

/** "주원" → "ㅈㅇ" */
export function initials(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    out +=
      code >= SYLLABLE_START && code <= SYLLABLE_END
        ? CHO[Math.floor((code - SYLLABLE_START) / SYLLABLES_PER_CHO)]
        : ch;
  }
  return out;
}

/** 질의가 자모만으로 이뤄졌는지 — 그렇다면 초성 검색으로 처리합니다. */
export function isInitialsQuery(query: string): boolean {
  if (!query.length) return false;
  for (const ch of query) {
    const code = ch.codePointAt(0)!;
    if (code < JAMO_START || code > JAMO_END) return false;
  }
  return true;
}

/**
 * 이름이 질의에 걸리는지. 초성이든 부분 문자열이든 이름 어디에서나 일치하면 됩니다.
 * 앞에서만 맞추도록 좁히면 `원` 으로 `주원` 을 못 찾습니다.
 */
export function matchesName(name: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  return isInitialsQuery(q) ? initials(name).includes(q) : name.includes(q);
}
