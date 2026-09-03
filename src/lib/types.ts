/**
 * 출석은 참여와 노쇼 두 가지만 기록합니다.
 *
 * "미정"(신청 안 함)은 상태가 아니라 기록의 부재입니다. 그날 행이 없는 사람이
 * 곧 미참여이므로 저장할 것이 없습니다. 다만 경고 판정은 여전히
 * "그 주에 참여 기록이 없는 사람"을 알아야 하므로, 명단에서 참여자를 빼서
 * 계산합니다. (roster.ts, scoring.ts 참고)
 */
export type AttendanceState = "참여" | "노쇼";

/**
 * 면책은 따로 저장하지 않습니다.
 *
 * 노쇼를 찍었다가 취소하면 그 기록이 사라지고, 그게 곧 면책입니다. 별도 플래그를
 * 두면 시트에 담을 자리가 없는데(셀 하나에 점수만 들어감), 취소로 처리하면
 * 자리가 필요 없습니다. 잘못 찍은 것을 되돌리는 일과 같은 동작이라 헷갈릴 것도
 * 없습니다.
 */

/** 정기러닝은 점수 규칙이 달라서 날짜와 함께 구분을 저장합니다. */
export type EventKind = "정기" | "일반";

/** YYYY-MM-DD */
export type IsoDate = string;
/** YYYY-MM */
export type IsoMonth = string;

export interface Member {
  /** 절대 바뀌지 않는 키. 이름을 키로 쓰면 개명·동명이인·오타에 과거 기록이 끊깁니다. */
  id: string;
  /** 표시용. 언제든 바뀔 수 있습니다. */
  name: string;
  /**
   * 가입일. 이 날짜 이전 주는 경고 판정에서 빠집니다.
   *
   * 탈퇴일은 두지 않습니다. 나간 사람은 명단에서 행을 지우는 방식이라
   * 명단에 있으면 활동 중, 없으면 끝입니다. 지운 뒤에도 과거 출석 로그에는
   * 회원ID가 남으므로(고아 기록), 집계는 명단에 없는 ID를 건너뜁니다.
   */
  joinedOn: IsoDate;
}

export interface AttendanceRecord {
  memberId: string;
  date: IsoDate;
  kind: EventKind;
  state: AttendanceState;
  recordedAt: string;
  updatedAt?: string;
}

/** 혼뛰 후기 — 40분 이상만 인정합니다. */
export interface SoloRun {
  memberId: string;
  date: IsoDate;
  minutes: number;
}

/** 체크 화면에서 저장할 때 넘기는 한 사람 분량. */
export interface DayEntry {
  memberId: string;
  state: AttendanceState;
}
