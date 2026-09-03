import SetupNotice from "@/components/SetupNotice";
import SoloRuns from "@/components/SoloRuns";
import { kstToday } from "@/lib/date";
import { RULES } from "@/lib/scoring";
import { getStore, missingEnv } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function SoloPage() {
  const missing = missingEnv();
  if (missing.length > 0) return <SetupNotice missing={missing} />;

  const store = getStore();
  const [members, runs] = await Promise.all([store.listMembers(), store.listSoloRuns()]);

  return (
    <SoloRuns
      today={kstToday()}
      members={members}
      initialRuns={runs}
      minMinutes={RULES.soloMinMinutes}
      points={RULES.soloPoints}
      weeklyCap={RULES.weeklySoloCap}
    />
  );
}
