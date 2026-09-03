import type {
  AttendanceRecord,
  DayEntry,
  EventKind,
  IsoDate,
  IsoMonth,
  Member,
  SoloRun,
} from "../types";

/**
 * 저장소 인터페이스.
 *
 * UI와 계산은 이 인터페이스만 알고 있어서, 구글 시트를 붙이든 목 데이터를 쓰든
 * 화면 코드를 고칠 필요가 없습니다. 개발 중에는 MockStore, 실제로는 GoogleSheetsStore.
 */
export interface AttendanceStore {
  listMembers(): Promise<Member[]>;
  addMember(name: string, joinedOn: IsoDate): Promise<Member>;

  /** 그 날짜에 저장된 기록. 과거 수정 화면이 이걸로 화면을 복원합니다. */
  getDay(date: IsoDate): Promise<DaySnapshot | null>;
  /** 전체 기록. 점수·경고는 이력 전체를 봐야 계산됩니다. */
  listRecords(): Promise<AttendanceRecord[]>;
  listSoloRuns(): Promise<SoloRun[]>;
  /** 혼뛰 후기를 추가합니다. 40분 미달도 기록은 남고 점수 계산에서만 빠집니다. */
  addSoloRun(run: SoloRun): Promise<void>;
  /** 잘못 넣은 혼뛰 후기를 지웁니다. 되돌릴 방법이 있어야 합니다. */
  deleteSoloRun(run: SoloRun): Promise<boolean>;

  /**
   * 그 날짜의 기록을 저장합니다. 같은 날짜·같은 사람의 행이 있으면 새 행을
   * 쌓지 않고 갱신합니다. 중복 행이 생기면 점수가 두 번 계산됩니다.
   */
  saveDay(date: IsoDate, kind: EventKind, entries: DayEntry[]): Promise<void>;

  /** 확정된 달은 읽기 전용입니다. 고치면 끝난 추첨 결과가 뒤집힙니다. */
  listClosedMonths(): Promise<IsoMonth[]>;

  /**
   * 그 달의 시트 탭이 있는지. 없으면 화면에 "새 달 추가" 버튼이 뜹니다.
   * 자동으로 만들지 않는 이유는, 탭 생성이 시트를 바꾸는 일이라 사람이
   * 의도적으로 눌러야 하기 때문입니다.
   */
  hasMonthTab(month: IsoMonth): Promise<boolean>;
  createMonthTab(month: IsoMonth): Promise<{ created: boolean; reason?: string }>;

  /**
   * 캐시를 버립니다. 시트를 직접 고친 뒤 앱에 반영할 때 씁니다.
   *
   * **시트가 원본입니다.** 앱은 요청 수를 줄이려고 명단과 탭 배치를 캐시하는데,
   * 그 사이 사람이 시트를 고치면 앱이 옛 값을 보게 됩니다. 동기화 버튼이
   * 이걸 호출합니다.
   */
  refresh(): Promise<void>;
}

export interface DaySnapshot {
  date: IsoDate;
  kind: EventKind;
  entries: DayEntry[];
}

export class MonthClosedError extends Error {
  constructor(public readonly month: IsoMonth) {
    super(`${month} 은 확정된 달입니다. 확정을 해제한 뒤에 수정할 수 있습니다.`);
    this.name = "MonthClosedError";
  }
}
