import Link from "next/link";

import { kstToday, monthOf } from "@/lib/date";
import { withFirstSeenJoinDates } from "@/lib/roster";
import { RULES, monthlySummary } from "@/lib/scoring";
import { getStore } from "@/lib/store";
import styles from "./summary.module.css";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ month?: string }>;
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

export default async function SummaryPage({ searchParams }: Props) {
  const params = await searchParams;
  const month =
    params.month && MONTH_PATTERN.test(params.month) ? params.month : monthOf(kstToday());

  const store = getStore();
  const [members, records, soloRuns, closedMonths] = await Promise.all([
    store.listMembers(),
    store.listRecords(),
    store.listSoloRuns(),
    store.listClosedMonths(),
  ]);

  // 시트에 가입일 열이 없어서, 기록에 처음 등장한 날로 보정합니다.
  // 보정하지 않으면 최근 가입자에게 가입 전 주의 경고가 소급됩니다.
  const dated = withFirstSeenJoinDates(members, records, kstToday());
  const rows = monthlySummary(dated, records, soloRuns, month);
  const closed = closedMonths.includes(month);
  const eligible = rows.filter((r) => r.raffleEligible).length;
  const candidates = rows.filter((r) => r.expulsionCandidate);

  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <h1 className={styles.title}>{month} 집계</h1>
        <span className={styles.chip}>
          {closed ? "확정됨" : "확정 전"} · 추첨 기준 {RULES.raffleThreshold}점
        </span>
      </header>

      <p className={styles.summaryLine}>
        추첨 자격 <b>{eligible}명</b> · 퇴출 대상 <b>{candidates.length}명</b>
      </p>

      <ul className={styles.list}>
        {rows.map((row) => (
          <li
            key={row.member.id}
            className={`${styles.row} ${row.expulsionCandidate ? styles.rowOut : ""}`}
          >
            <span className={styles.who}>
              <span className={styles.name}>{row.member.name}</span>
              {row.raffleEligible && (
                <span className={`${styles.badge} ${styles.badgeDraw}`}>추첨 자격</span>
              )}
              {row.expulsionCandidate ? (
                <span className={`${styles.badge} ${styles.badgeOut}`}>퇴출 대상</span>
              ) : (
                row.warnings > 0 && (
                  <span className={`${styles.badge} ${styles.badgeWarn}`}>
                    경고 {row.warnings}
                  </span>
                )
              )}
            </span>
            <span
              className={`${styles.points} ${
                row.points >= RULES.raffleThreshold
                  ? styles.pointsGood
                  : row.points < 0
                    ? styles.pointsBad
                    : ""
              }`}
            >
              {row.points}점
            </span>
          </li>
        ))}
      </ul>

      {candidates.length > 0 && (
        <section className={styles.reasons}>
          <h2 className={styles.reasonsTitle}>퇴출 대상 판정 근거</h2>
          <p className={styles.guard}>
            <b>자동으로 처리되지 않습니다.</b> 표시만 하고, 실제 결정은 근거를 확인한 뒤에
            직접 하셔야 합니다.
          </p>
          {candidates.map((row) => (
            <div key={row.member.id} className={styles.reasonBlock}>
              <h3 className={styles.reasonName}>{row.member.name}</h3>
              <ul className={styles.reasonList}>
                {row.reasons.map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <p className={styles.footLink}>
        <Link href="/">← 출석 체크로</Link> · <Link href="/solo">혼뛰 후기</Link>
      </p>
    </main>
  );
}
