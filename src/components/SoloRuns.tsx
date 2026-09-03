"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { dayOfWeek, monthOf, weekStartOf } from "@/lib/date";
import { matchesName } from "@/lib/hangul";
import type { IsoDate, Member, SoloRun } from "@/lib/types";
import styles from "./SoloRuns.module.css";

interface Props {
  today: IsoDate;
  members: Member[];
  initialRuns: SoloRun[];
  minMinutes: number;
  points: number;
  weeklyCap: number;
}

export default function SoloRuns({
  today,
  members,
  initialRuns,
  minMinutes,
  points,
  weeklyCap,
}: Props) {
  const [runs, setRuns] = useState<SoloRun[]>(initialRuns);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Member | null>(null);
  const [date, setDate] = useState<IsoDate>(today);
  const [minutes, setMinutes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const candidates = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return members.filter((m) => matchesName(m.name, q)).slice(0, 8);
  }, [members, query]);

  /**
   * 이번 달 사람별 인정 점수.
   *
   * 주간 상한이 있어서 개수 × 5점이 아닙니다. 40분 미달은 개수에서 빠집니다.
   * 화면에서 바로 확인할 수 있어야 "왜 점수가 이만큼인지" 설명이 됩니다.
   */
  const monthly = useMemo(() => {
    const month = monthOf(date);
    const byMember = new Map<string, { counted: number; ignored: number; points: number }>();

    for (const member of members) {
      const mine = runs.filter((r) => r.memberId === member.id && monthOf(r.date) === month);
      if (mine.length === 0) continue;

      const valid = mine.filter((r) => r.minutes >= minMinutes);
      const byWeek = new Map<IsoDate, number>();
      for (const run of valid) {
        const key = weekStartOf(run.date);
        byWeek.set(key, (byWeek.get(key) ?? 0) + 1);
      }
      let total = 0;
      for (const count of byWeek.values()) total += Math.min(count * points, weeklyCap);

      byMember.set(member.id, {
        counted: valid.length,
        ignored: mine.length - valid.length,
        points: total,
      });
    }
    return [...byMember.entries()].sort((a, b) => b[1].points - a[1].points);
  }, [runs, members, date, minMinutes, points, weeklyCap]);

  const visibleRuns = useMemo(
    () =>
      [...runs]
        .filter((r) => monthOf(r.date) === monthOf(date))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [runs, date],
  );

  async function add() {
    if (!picked) {
      setMessage({ tone: "warn", text: "이름을 먼저 선택해주세요." });
      return;
    }
    const mins = Number(minutes);
    if (!Number.isFinite(mins) || mins <= 0) {
      setMessage({ tone: "warn", text: "시간(분)을 숫자로 입력해주세요." });
      return;
    }

    setBusy(true);
    setMessage(null);
    const run: SoloRun = { memberId: picked.id, date, minutes: Math.round(mins) };
    try {
      const response = await fetch("/api/solo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(run),
      });
      const data = (await response.json()) as { counted?: boolean; error?: string };
      if (!response.ok) {
        setMessage({ tone: "warn", text: data.error ?? "추가하지 못했습니다." });
        return;
      }
      setRuns((prev) => [...prev, run]);
      setMinutes("");
      setMessage({
        tone: "ok",
        text: data.counted
          ? `${picked.name} · ${run.minutes}분 추가했습니다.`
          : `${picked.name} · ${run.minutes}분 추가했지만 ${minMinutes}분 미달로 점수는 붙지 않습니다.`,
      });
    } catch {
      setMessage({ tone: "warn", text: "서버에 연결하지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  async function remove(run: SoloRun) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/solo", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(run),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage({ tone: "warn", text: data.error ?? "지우지 못했습니다." });
        return;
      }
      setRuns((prev) => {
        const index = prev.findIndex(
          (r) => r.memberId === run.memberId && r.date === run.date && r.minutes === run.minutes,
        );
        if (index === -1) return prev;
        return prev.filter((_, i) => i !== index);
      });
      setMessage({ tone: "ok", text: "지웠습니다." });
    } catch {
      setMessage({ tone: "warn", text: "서버에 연결하지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? id;

  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <h1 className={styles.title}>혼뛰 후기</h1>
        <span className={styles.chip}>
          {minMinutes}분 이상 1개당 {points}점 · 주간 {weeklyCap}점 상한
        </span>
      </header>

      <div className={styles.card}>
        <div className={styles.field}>
          <span className={styles.label}>이름</span>
          {picked ? (
            <div className={styles.picked}>
              <span className={styles.pickedName}>{picked.name}</span>
              <button
                type="button"
                className={styles.change}
                onClick={() => {
                  setPicked(null);
                  setQuery("");
                }}
              >
                변경
              </button>
            </div>
          ) : (
            <>
              <input
                className={styles.input}
                type="search"
                value={query}
                autoComplete="off"
                placeholder="이름 검색 · 초성도 됩니다"
                aria-label="이름 검색"
                onChange={(event) => setQuery(event.target.value)}
              />
              {candidates.length > 0 && (
                <ul className={styles.candidates}>
                  {candidates.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        className={styles.candidate}
                        onClick={() => {
                          setPicked(m);
                          setQuery("");
                        }}
                      >
                        {m.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {query.trim() && candidates.length === 0 && (
                <p className={styles.hint}>맞는 이름이 없습니다.</p>
              )}
            </>
          )}
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <span className={styles.label}>날짜</span>
            <span className={styles.inputShell}>
              <input
                className={styles.dateInput}
                type="date"
                value={date}
                aria-label="혼뛰 날짜"
                onChange={(event) => {
                  if (event.target.value) setDate(event.target.value);
                }}
              />
              <span className={styles.dow}>({dayOfWeek(date)})</span>
            </span>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>시간 (분)</span>
            <input
              className={styles.input}
              type="number"
              inputMode="numeric"
              min={1}
              value={minutes}
              placeholder={`${minMinutes} 이상`}
              aria-label="달린 시간 (분)"
              onChange={(event) => setMinutes(event.target.value)}
            />
          </div>
        </div>

        {message && (
          <p className={`${styles.notice} ${message.tone === "ok" ? styles.noticeOk : ""}`}>
            {message.text}
          </p>
        )}

        <button type="button" className={styles.cta} disabled={busy} onClick={add}>
          {busy ? "처리 중…" : "추가"}
        </button>
      </div>

      <section className={styles.section}>
        <h2 className={styles.h2}>{monthOf(date)} 인정 점수</h2>
        {monthly.length === 0 ? (
          <p className={styles.hint}>이 달 기록이 없습니다.</p>
        ) : (
          <ul className={styles.scores}>
            {monthly.map(([id, stat]) => (
              <li key={id}>
                <span className={styles.scoreName}>{nameOf(id)}</span>
                <span className={styles.scoreMeta}>
                  {stat.counted}개
                  {stat.ignored > 0 && ` (미달 ${stat.ignored})`}
                </span>
                <span className={styles.scorePoints}>{stat.points}점</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>{monthOf(date)} 기록 {visibleRuns.length}건</h2>
        {visibleRuns.length === 0 ? (
          <p className={styles.hint}>이 달 기록이 없습니다.</p>
        ) : (
          <ul className={styles.list}>
            {visibleRuns.map((run, index) => (
              <li key={`${run.memberId}-${run.date}-${run.minutes}-${index}`}>
                <span className={styles.runName}>{nameOf(run.memberId)}</span>
                <span className={styles.runMeta}>
                  {run.date.slice(5)} · {run.minutes}분
                  {run.minutes < minMinutes && (
                    <span className={styles.ignored}>점수 미인정</span>
                  )}
                </span>
                <button
                  type="button"
                  className={styles.remove}
                  disabled={busy}
                  onClick={() => remove(run)}
                  aria-label={`${nameOf(run.memberId)} ${run.date} 기록 지우기`}
                >
                  지우기
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className={styles.footLink}>
        <Link href="/">← 출석 체크로</Link> · <Link href="/summary">월별 집계</Link>
      </p>
    </main>
  );
}
