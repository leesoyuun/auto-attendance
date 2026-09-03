import CheckScreen from "@/components/CheckScreen";
import SetupNotice from "@/components/SetupNotice";
import { kstToday } from "@/lib/date";
import { getStore, missingEnv } from "@/lib/store";

// 출석은 늘 바뀌므로 캐시하지 않습니다.
export const dynamic = "force-dynamic";

export default async function Page() {
  const missing = missingEnv();
  if (missing.length > 0) return <SetupNotice missing={missing} />;

  const store = getStore();
  const [members, closedMonths] = await Promise.all([
    store.listMembers(),
    store.listClosedMonths(),
  ]);

  return (
    <CheckScreen today={kstToday()} initialMembers={members} closedMonths={closedMonths} />
  );
}
