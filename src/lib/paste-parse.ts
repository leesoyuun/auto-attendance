import { matchesName } from "./hangul";
import type { Member } from "./types";

/**
 * 채팅에 올라온 출석 텍스트를 그대로 붙여넣어 자동으로 체크하기 위한 파서.
 *
 * "출석/불참/혼뛰" 세 구획으로 나뉜 텍스트에서 이름을 뽑아 명단과 대조합니다.
 * 이름 대조는 hangul.ts 의 초성/부분일치 규칙을 그대로 따르되, 정확히 같은
 * 이름이 있으면 그것을 우선합니다(부분일치로 엉뚱한 사람이 잡히는 것을 막기 위함).
 */
export type PasteSection = "출석" | "불참" | "혼뛰";

export interface SoloPasteEntry {
  memberId: string;
  name: string;
  minutes: number;
}

export interface ParsedPaste {
  attendIds: string[];
  noShowIds: string[];
  solo: SoloPasteEntry[];
  /** 명단에서 못 찾은 토큰. */
  unmatched: { section: PasteSection; token: string }[];
  /** 부분일치로 여러 명이 걸린 토큰 — 자동으로 아무나 고르지 않고 사용자에게 알립니다. */
  ambiguous: { section: PasteSection; token: string; candidates: string[] }[];
}

const SECTION_LABELS: Record<PasteSection, string[]> = {
  출석: ["출석", "참여", "참석"],
  불참: ["불참", "노쇼", "결석"],
  혼뛰: ["혼뛰"],
};

/**
 * 줄이 구획 헤더인지 확인합니다.
 *
 * 라벨 뒤에 구분자(: ： - 공백)나 줄 끝이 와야 헤더로 인정합니다. 그렇지 않으면
 * "출석이" 같은 이름 한 글자 차이로 헤더로 오인할 수 있습니다.
 */
function detectSection(line: string): { section: PasteSection; rest: string } | null {
  const trimmed = line.trim();
  for (const [section, labels] of Object.entries(SECTION_LABELS) as [PasteSection, string[]][]) {
    for (const label of labels) {
      if (trimmed === label) return { section, rest: "" };
      if (trimmed.startsWith(label) && /^[:：\-\s]/.test(trimmed.slice(label.length))) {
        return { section, rest: trimmed.slice(label.length).replace(/^[:：\-\s]+/, "") };
      }
    }
  }
  return null;
}

function splitTokens(text: string): string[] {
  return text
    .split(/[,，\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** "이름 45분" / "이름(45)" / "이름 45" → { name, minutes } */
function splitMinutes(token: string): { name: string; minutes: number | null } {
  const match = token.match(/^(.*?)[\s(（]+(\d+)\s*분?[\s)）]*$/);
  if (!match) return { name: token, minutes: null };
  const name = match[1].trim();
  const minutes = Number(match[2]);
  if (!name || !Number.isFinite(minutes) || minutes <= 0) return { name: token, minutes: null };
  return { name, minutes };
}

function findMembers(name: string, pool: Member[]): Member[] {
  const exact = pool.filter((m) => m.name === name);
  if (exact.length > 0) return exact;
  return pool.filter((m) => matchesName(m.name, name));
}

export function parsePasteText(text: string, pool: Member[]): ParsedPaste {
  const buffers: Record<PasteSection, string[]> = { 출석: [], 불참: [], 혼뛰: [] };
  let current: PasteSection | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const detected = detectSection(rawLine);
    if (detected) {
      current = detected.section;
      if (detected.rest) buffers[current].push(detected.rest);
      continue;
    }
    if (current && rawLine.trim()) buffers[current].push(rawLine.trim());
  }

  const result: ParsedPaste = {
    attendIds: [],
    noShowIds: [],
    solo: [],
    unmatched: [],
    ambiguous: [],
  };

  function resolveNames(section: "출석" | "불참", ids: string[]) {
    for (const segment of buffers[section]) {
      for (const token of splitTokens(segment)) {
        const matches = findMembers(token, pool);
        if (matches.length === 0) result.unmatched.push({ section, token });
        else if (matches.length > 1) {
          result.ambiguous.push({ section, token, candidates: matches.map((m) => m.name) });
        } else ids.push(matches[0].id);
      }
    }
  }

  resolveNames("출석", result.attendIds);
  resolveNames("불참", result.noShowIds);

  for (const segment of buffers["혼뛰"]) {
    for (const token of splitTokens(segment)) {
      const { name, minutes } = splitMinutes(token);
      const matches = findMembers(name, pool);
      if (matches.length === 0) {
        result.unmatched.push({ section: "혼뛰", token });
        continue;
      }
      if (matches.length > 1) {
        result.ambiguous.push({ section: "혼뛰", token, candidates: matches.map((m) => m.name) });
        continue;
      }
      if (minutes === null) {
        result.unmatched.push({ section: "혼뛰", token: `${token} (시간을 못 읽음)` });
        continue;
      }
      result.solo.push({ memberId: matches[0].id, name: matches[0].name, minutes });
    }
  }

  return result;
}
