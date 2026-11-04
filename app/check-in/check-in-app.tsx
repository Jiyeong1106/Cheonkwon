"use client";

import { useEffect, useRef, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
  recordKioskAttendance,
  watchDojoStore,
  type Member,
  type Pass,
  type Store,
} from "@/lib/dojo-data";

const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const isAdminEmail = (email: string | null) => Boolean(email && ADMIN_EMAILS.includes(email.toLowerCase()));
const emptyStore: Store = { members: [], attendance: [], schedules: [] };

const koreaNow = () => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date()).reduce<Record<string, string>>((result, part) => ({ ...result, [part.type]: part.value }), {});
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  return { date, time, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
};

const addPassDays = (date: string, months: number) => { const [year, month, day] = date.split("-").map(Number); const next = new Date(Date.UTC(year, month - 1, day + months * 30)); return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`; };
const passEndDate = (pass: Pass) => pass.end || addPassDays(pass.start, pass.months);
const passPending = (pass: Pass) => pass.activatedAt === null;
const isPassOnHold = (pass: Pass, date: string) => (pass.holds ?? []).some((hold) => hold.start <= date && (!hold.end || hold.end > date));
const passAllowance = (pass: Pass) => pass.weekly === "unlimited" ? null : pass.weekly * 4 * pass.months;
const formatDate = (date: string) => date.replace(/-/g, ". ");
const attendancePass = (member: Member, date: string) => member.passes
  .filter((pass) => (passPending(pass) ? pass.start <= date : pass.start <= date && passEndDate(pass) >= date) && !isPassOnHold(pass, date))
  .sort((a, b) => b.start.localeCompare(a.start))[0];
const firestoreMessage = (error: unknown) => {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return code === "permission-denied" ? "이 태블릿의 관리자 로그인을 확인해 주세요." : "출석 처리에 실패했어요. 다시 시도해 주세요.";
};

const SUCCESS_POPUP_DURATION_MS = 4000;
type Feedback =
  | { type: "success"; title: string; detail: string; expiresAt: string; remaining: number | null }
  | { type: "error"; title: string; detail: string }
  | null;

export default function CheckInApp() {
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [authReady, setAuthReady] = useState(() => auth.currentUser !== null);
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState("");
  const [store, setStore] = useState<Store>(emptyStore);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const successDialogRef = useRef<HTMLDialogElement>(null);
  const firstDigitRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, (currentUser) => {
      if (currentUser && !isAdminEmail(currentUser.email)) {
        setUser(null);
        setAuthError("관리자로 등록된 Google 계정으로 로그인해 주세요.");
        void signOut(auth).catch(() => {});
      } else {
        setUser(currentUser);
      }
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    if (!user) { setLoaded(false); return; }
    setLoaded(false);
    setLoadError("");
    return watchDojoStore((nextStore) => { setStore(nextStore); setLoaded(true); }, (error) => { setLoadError(firestoreMessage(error)); setLoaded(true); });
  }, [user]);

  useEffect(() => {
    if (feedback?.type !== "success") return;
    const dialog = successDialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    const timer = window.setTimeout(() => setFeedback(null), SUCCESS_POPUP_DURATION_MS);
    return () => {
      window.clearTimeout(timer);
      dialog.close();
      firstDigitRef.current?.focus({ preventScroll: true });
    };
  }, [feedback]);

  // Temporary kiosk testing: always record the 19:00 class.
  const session = { time: "19:00" };

  const addDigit = (digit: string) => {
    if (submitting || feedback?.type === "success") return;
    setFeedback(null);
    setPin((current) => current.length < 4 ? `${current}${digit}` : current);
  };
  const eraseDigit = () => { if (!submitting) { setFeedback(null); setPin((current) => current.slice(0, -1)); } };
  const resetPin = () => { if (!submitting) { setFeedback(null); setPin(""); } };
  const signIn = async () => {
    setAuthPending(true);
    setAuthError("");
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      if (!isAdminEmail(result.user.email)) {
        await signOut(auth);
        setAuthError("관리자로 등록된 Google 계정으로 로그인해 주세요.");
      }
    } catch {
      setAuthError("Google 로그인에 실패했어요. 다시 시도해 주세요.");
    } finally {
      setAuthPending(false);
    }
  };
  const submit = async () => {
    if (pin.length !== 4 || submitting || !loaded || loadError || feedback?.type === "success") return;
    setFeedback(null);
    const checkInDate = koreaNow().date;
    const matches = store.members.filter((member) => member.phone.replace(/\D/g, "").endsWith(pin));
    if (!matches.length) {
      setFeedback({ type: "error", title: "등록된 회원을 찾지 못했어요", detail: "휴대폰 번호 뒤 4자리를 다시 확인해 주세요." });
      return;
    }
    if (matches.length > 1) {
      setFeedback({ type: "error", title: "같은 번호 끝자리가 여러 명 있어요", detail: "관리자에게 휴대폰 번호를 확인해 달라고 말씀해 주세요." });
      return;
    }
    const member = matches[0];
    const todayRecord = store.attendance.find((record) => record.memberId === member.id && record.date === checkInDate);
    const pass = (todayRecord && member.passes.find((item) => item.id === todayRecord.passId))
      || attendancePass(member, checkInDate);
    if (!pass || isPassOnHold(pass, checkInDate) || pass.start > checkInDate || (!passPending(pass) && passEndDate(pass) < checkInDate)) {
      setFeedback({ type: "error", title: "사용 가능한 이용권이 없어요", detail: "관리자에게 이용권 상태를 확인해 달라고 말씀해 주세요." });
      return;
    }
    const allowance = passAllowance(pass);
    const used = store.attendance.filter((record) => record.passId === pass.id).length;
    const alreadyCheckedInToday = Boolean(todayRecord);
    if (allowance !== null && !alreadyCheckedInToday && used >= allowance) {
      setFeedback({ type: "error", title: "이용 가능 횟수를 모두 사용했어요", detail: "관리자에게 이용권 상태를 확인해 달라고 말씀해 주세요." });
      return;
    }
    setSubmitting(true);
    try {
      const result = await recordKioskAttendance({ memberId: member.id, date: checkInDate, passId: pass.id, activatePass: passPending(pass) }, session.time);
      const savedAllowance = passAllowance(result.pass);
      // Count today's attendance exactly once, including repeat check-ins and additional classes.
      const usedAfterCheckIn = store.attendance.filter((record) => record.passId === result.pass.id && record.date !== checkInDate).length + 1;
      setFeedback({
        type: "success",
        title: result.status === "already-recorded" ? `${member.name}님은 이미 출석 완료했어요` : `${member.name}님, 출석 완료!`,
        detail: `${session.time} 수업 출석이 확인되었습니다.`,
        expiresAt: passEndDate(result.pass),
        remaining: savedAllowance === null ? null : Math.max(0, savedAllowance - usedAfterCheckIn),
      });
      setPin("");
    } catch (error) {
      setFeedback({ type: "error", title: "출석 처리에 실패했어요", detail: firestoreMessage(error) });
    } finally {
      setSubmitting(false);
    }
  };

  if (!authReady) return <main className="check-in-loading">기기 인증을 확인하는 중이에요…</main>;
  if (!user) return <main className="check-in-auth"><section className="check-in-auth-card"><img src="/cheonkwon-logo.png" alt="천권태권도"/><p>태블릿 출석 체크를 시작하려면<br/>관리자 Google 계정으로 로그인해 주세요.</p><button className="check-in-confirm" onClick={()=>void signIn()} disabled={authPending}>{authPending ? "로그인 중…" : "Google 계정으로 로그인"}</button>{authError && <small>{authError}</small>}</section></main>;

  return <main className="check-in-screen">
    <section className="check-in-card">
      <span className="check-in-eyebrow">CHEONKWON CHECK-IN</span>
      <h1>휴대폰 번호 뒤 4자리를<br/>입력해 주세요</h1>
      <p>입력 후 확인을 누르면 출석이 완료됩니다.</p>
      <div className="pin-display" aria-label={`입력한 번호 ${pin.length}자리`}>{[0, 1, 2, 3].map((index) => <span className={pin[index] ? "filled" : ""} key={index}>{pin[index] ?? "•"}</span>)}</div>
      <div className="keypad" aria-label="휴대폰 번호 뒤 4자리 입력"><button ref={firstDigitRef} onClick={()=>addDigit("1")}>1</button><button onClick={()=>addDigit("2")}>2</button><button onClick={()=>addDigit("3")}>3</button><button onClick={()=>addDigit("4")}>4</button><button onClick={()=>addDigit("5")}>5</button><button onClick={()=>addDigit("6")}>6</button><button onClick={()=>addDigit("7")}>7</button><button onClick={()=>addDigit("8")}>8</button><button onClick={()=>addDigit("9")}>9</button><button className="keypad-reset" onClick={resetPin}>초기화</button><button onClick={()=>addDigit("0")}>0</button><button className="keypad-back" onClick={eraseDigit} aria-label="한 글자 지우기">←</button></div>
      <button className="check-in-confirm" onClick={()=>void submit()} disabled={pin.length !== 4 || submitting || !loaded}>{submitting ? "출석 처리 중…" : "확인"}</button>
      {feedback?.type === "error" && <div className="check-in-feedback error" role="alert"><strong>{feedback.title}</strong><span>{feedback.detail}</span><button onClick={resetPin}>다시 입력</button></div>}
      {loadError && <p className="check-in-error">{loadError}</p>}
    </section>
    {feedback?.type === "success" && <dialog ref={successDialogRef} className="check-in-success-popup" aria-labelledby="check-in-success-title" aria-describedby="check-in-success-detail" onCancel={()=>setFeedback(null)}>
      <span className="check-in-success-label">출석 확인</span>
      <h2 id="check-in-success-title">{feedback.title}</h2>
      <p id="check-in-success-detail">{feedback.detail}</p>
      <dl className="check-in-pass-summary">
        <div><dt>이용권 만료일</dt><dd>{formatDate(feedback.expiresAt)}</dd></div>
        <div><dt>남은 횟수</dt><dd>{feedback.remaining === null ? "무제한" : <>{feedback.remaining}<small>회</small></>}</dd></div>
      </dl>
      <p className="check-in-popup-hint">잠시 후 자동으로 닫힙니다.</p>
      <button type="button" className="check-in-popup-close" onClick={()=>setFeedback(null)}>닫기</button>
    </dialog>}
  </main>;
}
