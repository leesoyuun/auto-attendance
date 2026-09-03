import { matchesName } from "./hangul";
import type { IsoDate, Member } from "./types";

/**
 * 그 날짜에 이미 가입해 있었는지.
 *
 * 나간 사람은 명단에서 지우므로 탈퇴 여부는 볼 것이 없습니다. 가입일만 봅니다 —
 * 가입 전 주에 미참여 경고를 소급하면 부당하기 때문입니다.
 */
export function isActiveOn(member: Member, date: IsoDate): boolean {
  return member.joinedOn <= date;
}

/**
 * 그 날짜 기준으로 명단에 있던 사람만 반환합니다.
 *
 * "현재 회원"이 아니라 "선택한 날짜 기준"이라는 점이 중요합니다. 지난달 기록을
 * 고칠 때 그때 있던 멤버가 검색되지 않으면 수정 자체가 불가능합니다.
 */
export function activeMembersOn(members: Member[], date: IsoDate): Member[] {
  return members.filter((m) => isActiveOn(m, date));
}

export function searchMembers(members: Member[], query: string): Member[] {
  return members.filter((m) => matchesName(m.name, query));
}

export function memberMap(members: Member[]): Map<string, Member> {
  return new Map(members.map((m) => [m.id, m]));
}

/** 다음 회원ID를 만듭니다. 기존 최대값 +1 이라 재사용되지 않습니다. */
export function nextMemberId(members: Member[]): string {
  const max = members.reduce((acc, m) => {
    const n = Number(m.id.replace(/^M/, ""));
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return `M${String(max + 1).padStart(3, "0")}`;
}
