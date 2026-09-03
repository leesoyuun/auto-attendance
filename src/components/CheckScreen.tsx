"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { dayOfWeek, monthOf } from "@/lib/date";
import { matchesName } from "@/lib/hangul";
import { activeMembersOn } from "@/lib/roster";
import type { AttendanceState, DayEntry, EventKind, IsoDate, Member } from "@/lib/types";
import styles from "./CheckScreen.module.css";

type Marks = Record<string, AttendanceState>;

interface Props {
  today: IsoDate;
  initialMembers: Member[];
  closedMonths: string[];
}

interface DayResponse {
  snapshot: { date: IsoDate; kind: EventKind; entries: DayEntry[] } | null;
  closed: boolean;
  monthTabExists: boolean;
  month: string;
  error?: string;
}

export default function CheckScreen({ today, initialMembers, closedMonths }: Props) {
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [date, setDate] = useState<IsoDate>(today);
  const [kind, setKind] = useState<EventKind>("일반");
  const [marks, setMarks] = useState<Marks>({});
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [loadedFrom, setLoadedFrom] = useState<IsoDate | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "info"; text: string } | null>(
    null,
  );

  // 확정된 달은 서버가 다시 확인해주지만, 화면도 미리 알고 있어야 버튼을 잠글 수 있습니다.
  const [closed, setClosed] = useState(() => closedMonths.includes(monthOf(today)));
  // 그 달 시트 탭이 없으면 저장할 곳이 없습니다. 추가 버튼을 띄웁니다.
  const [monthTabMissing, setMonthTabMissing] = useState(false);

  const requestId = useRef(0);

  /** 날짜가 바뀌면 그날 저장된 기록을 불러와 화면을 채웁니다. */
  const loadDay = useCallback(async (target: IsoDate) => {
    const id = ++requestId.current;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/day/${target}`, { cache: "no-store" });
      const data = (await response.json()) as DayResponse;
      // 빠르게 날짜를 여러 번 바꿨을 때 늦게 온 응답이 화면을 덮지 않게 합니다.
      if (id !== requestId.current) return;

      if (!response.ok) {
        setMessage({ tone: "warn", text: data.error ?? "기록을 불러오지 못했습니다." });
        return;
      }

      setClosed(data.closed);
      setMonthTabMissing(data.monthTabExists === false);
      if (data.snapshot) {
        const next: Marks = {};
        for (const entry of data.snapshot.entries) next[entry.memberId] = entry.state;
        setMarks(next);
        setKind(data.snapshot.kind);
        setLoadedFrom(target);
      } else {
        setMarks({});
        setKind("일반");
        setLoadedFrom(null);
      }
    } catch {
      if (id === requestId.current) {
        setMessage({ tone: "warn", text: "서버에 연결하지 못했습니다." });
      }
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadDay(date);
  }, [date, loadDay]);

  const pool = useMemo(() => activeMembersOn(members, date), [members, date]);

  const visible = useMemo(() => {
    const q = query.trim();
    if (q) return pool.filter((m) => matchesName(m.name, q));
    if (showAll) return pool;
    // 검색창이 비어 있으면 이번에 찍은 사람만 — 저장 전 검토용 화면입니다.
    return pool.filter((m) => marks[m.id]);
  }, [pool, query, showAll, marks]);

  const counts = useMemo(() => {
    let attend = 0;
    let noShow = 0;
    for (const member of pool) {
      const mark = marks[member.id];
      if (mark === "참여") attend += 1;
      else if (mark === "노쇼") noShow += 1;
    }
    return { attend, noShow };
  }, [pool, marks]);

  const marked = counts.attend + counts.noShow;
  const editing = loadedFrom === date;

  function setState(memberId: string, state: AttendanceState) {
    if (closed) return;
    setMessage(null);
    setMarks((prev) => {
      const next = { ...prev };
      // 같은 버튼을 다시 누르면 해제됩니다. 저장하면 그 칸이 비워지므로,
      // 노쇼를 취소하는 것이 곧 면책이고 잘못 찍은 것을 되돌리는 방법입니다.
      if (next[memberId] === state) delete next[memberId];
      else next[memberId] = state;
      return next;
    });
  }

  /**
   * 시트에서 다시 읽어옵니다.
   *
   * 시트가 원본입니다. 누군가 시트를 직접 고쳤을 때 앱이 캐시된 옛 값을 계속
   * 보여주지 않도록, 명단과 그 날 기록을 함께 새로 가져옵니다.
   * 화면에서 아직 저장하지 않은 체크는 시트 값으로 덮입니다.
   */
  async function sync() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      const data = (await response.json()) as {
        members?: Member[];
        snapshot?: { kind: EventKind; entries: DayEntry[] } | null;
        closed?: boolean;
        monthTabExists?: boolean;
        error?: string;
      };
      if (!response.ok) {
        setMessage({ tone: "warn", text: data.error ?? "동기화하지 못했습니다." });
        return;
      }

      if (data.members) setMembers(data.members);
      setClosed(data.closed === true);
      setMonthTabMissing(data.monthTabExists === false);

      if (data.snapshot) {
        const next: Marks = {};
        for (const entry of data.snapshot.entries) next[entry.memberId] = entry.state;
        setMarks(next);
        setKind(data.snapshot.kind);
        setLoadedFrom(date);
        setMessage({
          tone: "ok",
          text: `시트에서 ${data.snapshot.entries.length}명, 명단 ${data.members?.length ?? 0}명을 가져왔습니다.`,
        });
      } else {
        setMarks({});
        setKind("일반");
        setLoadedFrom(null);
        setMessage({
          tone: "ok",
          text: `시트를 다시 읽었습니다. 이 날 기록은 없습니다. (명단 ${data.members?.length ?? 0}명)`,
        });
      }
    } catch {
      setMessage({ tone: "warn", text: "서버에 연결하지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  async function addMember() {
    const name = query.trim();
    if (!name || closed) return;
    setBusy(true);
    try {
      const response = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, joinedOn: date }),
      });
      const data = (await response.json()) as { member?: Member; error?: string };
      if (!response.ok || !data.member) {
        setMessage({ tone: "warn", text: data.error ?? "추가하지 못했습니다." });
        return;
      }
      setMembers((prev) => [...prev, data.member!]);
      setMarks((prev) => ({ ...prev, [data.member!.id]: "참여" }));
      setQuery("");
      setMessage({ tone: "ok", text: `${data.member.name} 을 명단에 추가했습니다.` });
    } finally {
      setBusy(false);
    }
  }

  async function createMonthTab() {
    const month = monthOf(date);
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/month-tab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });
      const data = (await response.json()) as { created?: boolean; error?: string };
      if (!response.ok) {
        setMessage({ tone: "warn", text: data.error ?? "탭을 만들지 못했습니다." });
        return;
      }
      setMonthTabMissing(false);
      setMessage({ tone: "ok", text: `${month} 탭을 시트에 추가했습니다.` });
      await loadDay(date);
    } catch {
      setMessage({ tone: "warn", text: "서버에 연결하지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (closed || marked === 0) return;
    setBusy(true);
    setMessage(null);
    // 명단에 있는 사람만 저장합니다. 나간 사람을 명단에서 지우면 과거 기록에
    // 회원ID만 남는데, 그 고아 행까지 다시 쓰면 화면 숫자와 저장 결과가 어긋납니다.
    const known = new Set(pool.map((m) => m.id));
    const entries: DayEntry[] = Object.entries(marks)
      .filter(([memberId]) => known.has(memberId))
      .map(([memberId, state]) => ({ memberId, state }));

    try {
      const response = await fetch(`/api/day/${date}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, entries }),
      });
      const data = (await response.json()) as { saved?: number; error?: string };
      if (!response.ok) {
        setMessage({ tone: "warn", text: data.error ?? "저장하지 못했습니다." });
        return;
      }
      setLoadedFrom(date);
      setMessage({ tone: "ok", text: `${data.saved ?? entries.length}명 저장했습니다.` });
    } catch {
      setMessage({ tone: "warn", text: "서버에 연결하지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  const unknownName = query.trim().length > 0 && visible.length === 0 && !closed;

  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>출석 체크</h1>
          <button
            type="button"
            className={styles.syncBtn}
            disabled={busy}
            onClick={sync}
            aria-label="시트에서 다시 읽어오기"
          >
            {busy ? "…" : "↻ 동기화"}
          </button>
        </div>
        <span className={`${styles.chip} ${editing && !closed ? styles.chipEditing : ""}`}>
          {closed ? "확정된 달 · 읽기 전용" : editing ? "저장된 기록 수정 중" : "새로 기록"}
        </span>
      </header>

      <div className={styles.field}>
        <span className={styles.label}>날짜 · 한국 시간 기준</span>
        <span className={styles.inputShell}>
          <input
            className={styles.dateInput}
            type="date"
            value={date}
            aria-label="출석 날짜"
            onChange={(event) => {
              if (event.target.value) setDate(event.target.value);
            }}
          />
          <span className={styles.dow}>({dayOfWeek(date)})</span>
        </span>
      </div>

      <div className={styles.toggles}>
        <button
          type="button"
          className={`${styles.toggle} ${kind === "정기" ? styles.toggleOn : ""}`}
          aria-pressed={kind === "정기"}
          disabled={closed}
          onClick={() => setKind(kind === "정기" ? "일반" : "정기")}
        >
          정기러닝
        </button>
        <button
          type="button"
          className={`${styles.toggle} ${showAll ? styles.toggleOn : ""}`}
          aria-pressed={showAll}
          onClick={() => {
            setShowAll(!showAll);
            setQuery("");
          }}
        >
          전체 명단
        </button>
      </div>

      <input
        className={styles.search}
        type="search"
        value={query}
        autoComplete="off"
        placeholder="이름 검색 · 초성도 됩니다"
        aria-label="이름 검색"
        onChange={(event) => setQuery(event.target.value)}
      />

      {closed && (
        <p className={styles.notice}>
          <b>확정된 달입니다.</b> 이 달 점수는 고정돼 있어서, 수정하려면 시트의 확정 목록에서
          이 달을 지운 뒤에 다시 시도해주세요.
        </p>
      )}

      {monthTabMissing && !closed && (
        <>
          <p className={`${styles.notice} ${styles.noticeInfo}`}>
            <b>{monthOf(date)} 시트 탭이 없습니다.</b> 새 달이 시작되면 탭을 한 번 추가해야
            출석을 기록할 수 있습니다. 직전 탭을 복제해서 날짜와 수식을 맞춰 만듭니다.
          </p>
          <button type="button" className={styles.cta} disabled={busy} onClick={createMonthTab}>
            {busy ? "만들고 있습니다…" : `${monthOf(date)} 탭 추가하기`}
          </button>
        </>
      )}

      {message && (
        <p
          className={`${styles.notice} ${
            message.tone === "ok"
              ? styles.noticeOk
              : message.tone === "info"
                ? styles.noticeInfo
                : ""
          }`}
        >
          {message.text}
        </p>
      )}

      <p className={styles.meta}>
        {query.trim()
          ? `검색 결과 ${visible.length}명`
          : showAll
            ? `활동 회원 ${pool.length}명`
            : `체크한 사람 ${visible.length}명`}
      </p>

      {visible.length === 0 && (
        <p className={styles.blank}>
          {query.trim()
            ? `“${query.trim()}” 에 맞는 이름이 없습니다`
            : "이름을 검색해서 찍어주세요."}
        </p>
      )}

      {unknownName && (
        <button type="button" className={styles.addNew} disabled={busy} onClick={addMember}>
          ＋ “{query.trim()}” 새 멤버로 추가
        </button>
      )}

      <ul className={styles.list}>
        {visible.map((member) => {
          const state = marks[member.id];
          return (
            <li key={member.id} className={styles.row}>
              <span className={styles.who}>
                <span
                  className={`${styles.avatar} ${
                    state === "참여"
                      ? styles.avatarAttend
                      : state === "노쇼"
                        ? styles.avatarNoShow
                        : ""
                  }`}
                  aria-hidden="true"
                >
                  {member.name.slice(0, 1)}
                </span>
                <span className={styles.name}>{member.name}</span>
              </span>

              <span className={styles.actions}>
                <button
                  type="button"
                  className={`${styles.stateBtn} ${state === "참여" ? styles.attendOn : ""}`}
                  aria-pressed={state === "참여"}
                  disabled={closed}
                  onClick={() => setState(member.id, "참여")}
                >
                  참여
                </button>
                <button
                  type="button"
                  className={`${styles.stateBtn} ${state === "노쇼" ? styles.noShowOn : ""}`}
                  aria-pressed={state === "노쇼"}
                  disabled={closed}
                  onClick={() => setState(member.id, "노쇼")}
                >
                  노쇼
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      <div className={styles.counts}>
        <div className={`${styles.count} ${styles.countAttend}`}>
          <b>{counts.attend}</b>
          <span>참여</span>
        </div>
        <div className={`${styles.count} ${styles.countNoShow}`}>
          <b>{counts.noShow}</b>
          <span>노쇼</span>
        </div>
      </div>

      <button
        type="button"
        className={styles.cta}
        disabled={closed || monthTabMissing || marked === 0 || busy}
        onClick={save}
      >
        {closed
          ? "확정 해제 후 수정 가능"
          : monthTabMissing
            ? "탭을 먼저 추가해주세요"
            : busy
            ? "처리 중…"
            : marked === 0
              ? "저장"
              : `${editing ? "수정 저장" : "저장"} · ${marked}명`}
      </button>

      <p className={styles.footLink}>
        <Link href="/summary">월별 집계 보기 →</Link>
      </p>
    </main>
  );
}
