import styles from "./SetupNotice.module.css";

/**
 * 시트 환경변수가 없을 때 띄우는 안내.
 *
 * 예외를 그냥 던지면 프로덕션 빌드에서는 Next.js 가 메시지를 감춰서 "Application
 * error" 만 보입니다. 무엇이 빠졌는지 화면에 적어야 고칠 수 있습니다.
 */
export default function SetupNotice({ missing }: { missing: string[] }) {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>시트에 연결되지 않았습니다</h1>
        <p className={styles.body}>
          아래 환경변수가 없어서 구글 시트를 읽을 수 없습니다. 값을 넣기 전에는 명단도
          기록도 불러오지 못합니다.
        </p>
        <ul className={styles.list}>
          {missing.map((key) => (
            <li key={key} className={styles.key}>
              {key}
            </li>
          ))}
        </ul>
        <p className={styles.hint}>
          Vercel 은 <b>배포 시점에</b> 환경변수를 주입합니다. 값을 이미 넣으셨다면
          재배포해야 반영됩니다. 로컬이라면 <code>.env.local</code> 을 만들고 개발
          서버를 다시 시작하세요.
        </p>
        <p className={styles.doc}>설정 절차는 기획서 8·9절에 있습니다.</p>
      </div>
    </main>
  );
}
