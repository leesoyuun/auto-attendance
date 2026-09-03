import { addMonths, kstStamp, kstToday, monthOf, shiftDays } from "../date";
import { nextMemberId } from "../roster";
import type {
  AttendanceRecord,
  DayEntry,
  EventKind,
  IsoDate,
  IsoMonth,
  Member,
  SoloRun,
} from "../types";
import { MonthClosedError, type AttendanceStore, type DaySnapshot } from "./types";

/**
 * 개발용 목 저장소. 프로세스 메모리에만 있으므로 서버를 재시작하면 초기화됩니다.
 *
 * 날짜를 고정값으로 박지 않고 오늘을 기준으로 만듭니다. 그래야 언제 열어봐도
 * "지난주 기록 수정"과 "확정된 달 잠금"을 실제로 눌러볼 수 있습니다.
 */
export class MockStore implements AttendanceStore {
  private members: Member[];
  private records: AttendanceRecord[];
  private soloRuns: SoloRun[];
  private closedMonths: IsoMonth[];

  constructor(today: IsoDate = kstToday()) {
    const leftOn = shiftDays(today, -3);
    this.members = [
      { id: "M001", name: "주원", joinedOn: "2026-01-05", leftOn: null },
      { id: "M002", name: "중현", joinedOn: "2026-01-05", leftOn: null },
      { id: "M003", name: "푸름", joinedOn: "2026-01-05", leftOn: null },
      { id: "M004", name: "세정", joinedOn: "2026-01-12", leftOn: null },
      { id: "M005", name: "세종", joinedOn: "2026-01-12", leftOn: null },
      { id: "M006", name: "효신", joinedOn: "2026-02-02", leftOn: null },
      { id: "M007", name: "유주", joinedOn: "2026-02-02", leftOn: null },
      { id: "M008", name: "상일", joinedOn: "2026-03-09", leftOn: null },
      { id: "M009", name: "가형", joinedOn: "2026-03-09", leftOn: null },
      { id: "M010", name: "소정", joinedOn: "2026-04-06", leftOn: null },
      { id: "M011", name: "형섭", joinedOn: "2026-04-06", leftOn: null },
      // 탈퇴 예시 — 오늘은 검색에 안 나오지만 지난 날짜에는 나옵니다.
      { id: "M012", name: "윤아", joinedOn: "2026-02-01", leftOn },
      { id: "M013", name: "하늘", joinedOn: "2026-05-04", leftOn: null },
      { id: "M014", name: "다온", joinedOn: "2026-05-04", leftOn: null },
      { id: "M015", name: "지호", joinedOn: "2026-05-18", leftOn: null },
      { id: "M016", name: "은비", joinedOn: "2026-06-01", leftOn: null },
      { id: "M017", name: "태윤", joinedOn: "2026-06-01", leftOn: null },
      { id: "M018", name: "소율", joinedOn: "2026-06-15", leftOn: null },
      { id: "M019", name: "재민", joinedOn: "2026-07-06", leftOn: null },
      { id: "M020", name: "나린", joinedOn: "2026-07-06", leftOn: null },
      { id: "M021", name: "시우", joinedOn: "2026-07-20", leftOn: null },
      { id: "M022", name: "예린", joinedOn: "2026-08-03", leftOn: null },
      { id: "M023", name: "도현", joinedOn: "2026-08-03", leftOn: null },
      { id: "M024", name: "하람", joinedOn: "2026-08-17", leftOn: null },
    ];

    const stamp = kstStamp();
    const week1 = shiftDays(today, -7);
    const week2 = shiftDays(today, -14);

    const make = (
      date: IsoDate,
      kind: EventKind,
      entries: Array<[string, "참여" | "노쇼", boolean]>,
    ): AttendanceRecord[] =>
      entries.map(([memberId, state, flag]) => ({
        memberId,
        date,
        kind,
        state,
        reviewed: state === "참여" ? flag : false,
        excused: state === "노쇼" ? flag : false,
        recordedAt: stamp,
      }));

    this.records = [
      ...make(week1, "일반", [
        ["M002", "참여", true],
        ["M003", "참여", true],
        ["M004", "참여", false],
        ["M010", "참여", true],
        ["M011", "노쇼", true],
        ["M013", "참여", true],
      ]),
      ...make(week2, "정기", [
        ["M001", "참여", true],
        ["M002", "참여", true],
        ["M005", "참여", true],
        ["M006", "참여", false],
        ["M009", "참여", true],
        ["M012", "노쇼", false],
      ]),
    ];

    this.soloRuns = [
      { memberId: "M002", date: shiftDays(today, -5), minutes: 52 },
      { memberId: "M002", date: shiftDays(today, -3), minutes: 45 },
      { memberId: "M003", date: shiftDays(today, -4), minutes: 38 }, // 40분 미달 — 인정 안 됨
    ];

    // 두 달 전을 확정된 달로 둡니다. 일수로 빼면 오늘이 월 중순일 때
    // 수정 시연용 지난주 기록까지 같이 잠기는 날이 생깁니다.
    this.closedMonths = [monthOf(addMonths(today, -2))];
  }

  async listMembers(): Promise<Member[]> {
    return [...this.members];
  }

  async addMember(name: string, joinedOn: IsoDate): Promise<Member> {
    const member: Member = {
      id: nextMemberId(this.members),
      name,
      joinedOn,
      leftOn: null,
    };
    this.members.push(member);
    return member;
  }

  async getDay(date: IsoDate): Promise<DaySnapshot | null> {
    const rows = this.records.filter((r) => r.date === date);
    if (rows.length === 0) return null;
    return {
      date,
      kind: rows[0].kind,
      entries: rows.map((r) => ({
        memberId: r.memberId,
        state: r.state,
        reviewed: r.reviewed,
        excused: r.excused,
      })),
    };
  }

  async listRecords(): Promise<AttendanceRecord[]> {
    return [...this.records];
  }

  async listSoloRuns(): Promise<SoloRun[]> {
    return [...this.soloRuns];
  }

  async saveDay(date: IsoDate, kind: EventKind, entries: DayEntry[]): Promise<void> {
    const month = monthOf(date);
    if (this.closedMonths.includes(month)) throw new MonthClosedError(month);

    const stamp = kstStamp();
    const kept = this.records.filter((r) => r.date !== date);
    const previous = new Map(
      this.records.filter((r) => r.date === date).map((r) => [r.memberId, r]),
    );

    this.records = [
      ...kept,
      ...entries.map<AttendanceRecord>((entry) => {
        const before = previous.get(entry.memberId);
        return {
          memberId: entry.memberId,
          date,
          kind,
          state: entry.state,
          reviewed: entry.state === "참여" ? entry.reviewed : false,
          excused: entry.state === "노쇼" ? entry.excused : false,
          // 최초 기록 시각은 유지하고 수정 시각을 따로 남깁니다.
          recordedAt: before?.recordedAt ?? stamp,
          updatedAt: before ? stamp : undefined,
        };
      }),
    ];
  }

  async listClosedMonths(): Promise<IsoMonth[]> {
    return [...this.closedMonths];
  }
}
