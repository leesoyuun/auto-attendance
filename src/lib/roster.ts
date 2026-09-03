import { matchesName } from "./hangul";
import type { IsoDate, Member } from "./types";

/**
 * 활동 기간은 가입일부터 탈퇴일까지(양쪽 포함)입니다.
 *
 * 탈퇴일 당일을 빼면 마지막 날 러닝에 나왔어도 기록을 넣을 수 없게 됩니다.
 */
export function isActiveOn(member: Member, date: IsoDate): boolean {
  if (member.joinedOn > date) return false;
  return member.leftOn === null || member.leftOn >= date;
}

/**
 * 그 날짜에 활동 중이던 사람만 반환합니다.
 *
 * 현재 활동 회원이 아니라 "선택한 날짜 기준"이라는 점이 중요합니다. 지난달
 * 기록을 고치는데 그때 있던 멤버가 검색되지 않으면 수정 자체가 불가능합니다.
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
