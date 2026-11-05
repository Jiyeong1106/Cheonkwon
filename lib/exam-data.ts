import { collection, doc, getDocs, onSnapshot, query, where, runTransaction, serverTimestamp, type Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { LOCATION_ID, type Member } from "@/lib/dojo-data";
import { validRank, type MemberRank, type RankSource } from "@/lib/member-rank";

export type ExamResult = "pending" | "passed" | "failed" | "deferred" | "absent";
export type ExamSession = { date: string; time: string };
export type Exam = {
  id: string; title: string; date: string; time: string; dates?: ExamSession[];
};
export type ExamEntry = {
  id: string; examId: string; memberId: string; memberName: string; memberPhone: string;
  examTitle: string; examDate: string; examTime?: string; examRank: MemberRank; targetRank: MemberRank | null;
  stage: number; course: string; result: ExamResult; attended: boolean; memo: string;
  rankBefore?: MemberRank | null; rankSourceBefore?: RankSource | null;
};
export type ExamStore = { exams: Exam[]; entries: ExamEntry[] };
export const EXAM_RESULTS: [ExamResult, string][] = [["pending", "결과 대기"], ["passed", "합격"], ["failed", "불합격"], ["deferred", "보류"], ["absent", "불참"]];
export const EXAM_COURSES = [
  ["white-1", "하얀띠 1차", "기본동작"], ["white-2", "하얀띠 2차", "태극 1장"],
  ["yellow-1", "노란띠 1차", "태극 2장"], ["yellow-2", "노란띠 2차", "태극 3장"],
  ["blue-1", "파란띠 1차", "태극 4장"], ["blue-2", "파란띠 2차", "태극 5장"],
  ["red-1", "빨간띠 1차", "태극 6장"], ["red-2", "빨간띠 2차", "태극 7장"],
  ["red-3", "빨간띠 3차", "1단 기본동작 · 태극 8장"],
  ["black-1", "검은띠 1차", "2·3단 기본동작 / 고려 / 태극 1~8장 중 1"],
  ["black-2", "검은띠 2차", "2·3단 기본동작 / 금강 / 태극 1장~고려 중 1"],
  ["black-3", "검은띠 3차", "4·5단 기본동작 / 태백 / 태극 1장~금강 중 1"],
  ["black-4", "검은띠 4차", "4·5단 기본동작 / 평원 / 태극 1장~태백 중 1"],
  ["dan-beginner", "유단자 · 하얀띠 1/2차 통합", "품새 미숙지자 과정"],
  ["dan-skilled", "유단자 · 유급자 과정 1/2차 통합", "품새 숙지자 과정 · 범위는 메모에 기록"],
  ["yellow-integrated", "노란띠 1/2차 통합", "태극 2·3장"],
  ["blue-integrated", "파란띠 1/2차 통합", "태극 4·5장"],
  ["red-integrated", "빨간띠 1/2차 통합", "태극 6·7장 · 3차 별도"],
] as const;
export const courseLabel = (course: string) => EXAM_COURSES.find(([id]) => id === course)?.[1] ?? course;
const examCollection = (name: string) => collection(db, "locations", LOCATION_ID, name);
const reference = (name: string, id: string) => doc(db, "locations", LOCATION_ID, name, id);
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
export const examSessions = (exam: Exam): ExamSession[] => (exam.dates?.length ? exam.dates : [{ date: exam.date, time: exam.time ?? "" }]).slice().sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));

export async function getExamBackup(): Promise<ExamStore> {
  const [exams, entries] = await Promise.all([getDocs(examCollection("exams")), getDocs(examCollection("examEntries"))]);
  return {
    exams: exams.docs.map(item => ({ ...item.data(), id: item.id }) as Exam),
    entries: entries.docs.map(item => ({ ...item.data(), id: item.id }) as ExamEntry),
  };
}

export function watchExams(onChange: (store: ExamStore) => void, onError: (error: Error) => void): Unsubscribe {
  let exams: Exam[] = [];
  let entries: ExamEntry[] = [];
  const ready = new Set<string>();
  const publish = () => { if (ready.size === 2) onChange({ exams, entries }); };
  const unsubscribeExams = onSnapshot(examCollection("exams"), snapshot => {
    exams = snapshot.docs.map(item => ({ ...item.data(), id: item.id }) as Exam).sort((a, b) => b.date.localeCompare(a.date));
    ready.add("exams"); publish();
  }, onError);
  const unsubscribeEntries = onSnapshot(examCollection("examEntries"), snapshot => {
    entries = snapshot.docs.map(item => ({ ...item.data(), id: item.id }) as ExamEntry);
    ready.add("entries"); publish();
  }, onError);
  return () => { unsubscribeExams(); unsubscribeEntries(); };
}

export function watchMemberExams(memberId: string, onChange: (entries: ExamEntry[]) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(examCollection("examEntries"), where("memberId", "==", memberId)), snapshot => {
    onChange(snapshot.docs.map(item => ({ ...item.data(), id: item.id }) as ExamEntry).sort((a, b) => b.examDate.localeCompare(a.examDate)));
  }, onError);
}

export async function saveExam(exam: Omit<Exam, "id">, examId?: string): Promise<string> {
  const dates = examSessions({ ...exam, id: examId ?? "" });
  if (!exam.title.trim() || dates.some(session => !validDate(session.date))) throw new Error("심사명과 올바른 심사일을 입력해 주세요.");
  if (dates.some(session => session.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(session.time))) throw new Error("심사 시간을 확인해 주세요.");
  if (new Set(dates.map(session => `${session.date}-${session.time}`)).size !== dates.length) throw new Error("같은 날짜와 시간이 중복되어 있어요.");
  if (new Set(dates.map(session => session.date.slice(0,7))).size > 1) throw new Error("같은 월의 날짜를 등록해 주세요. 다른 월의 심사는 별도 일정으로 등록하세요.");
  const examRef = reference("exams", examId ?? dates[0].date.slice(0, 7));
  await runTransaction(db, async transaction => {
    const current = await transaction.get(examRef);
    if (examId && !current.exists()) throw new Error("심사 일정을 찾지 못했어요.");
    if (!examId && current.exists()) throw new Error("이미 등록된 월이에요. 기존 심사 일정을 수정해 주세요.");
    if (examId && current.data()?.date.slice(0, 7) !== dates[0].date.slice(0, 7)) throw new Error("기존 심사의 월은 변경할 수 없어요.");
    transaction.set(examRef, { title: exam.title.trim(), dates, date: dates[0].date, time: dates[0].time, updatedAt: serverTimestamp() });
  });
  return examRef.id;
}

export async function saveExamEntry(input: Pick<ExamEntry, "examId" | "memberId" | "examDate" | "examTime" | "examRank" | "targetRank" | "stage" | "course" | "memo">, editing = false): Promise<void> {
  if (!validRank(input.examRank) || (input.targetRank && !validRank(input.targetRank)) || !EXAM_COURSES.some(([id]) => id === input.course) || !Number.isInteger(input.stage) || input.stage < 1 || input.stage > 20) throw new Error("응시 과정과 등급을 확인해 주세요.");
  const entryRef = reference("examEntries", `${input.examId}_${input.memberId}`);
  await runTransaction(db, async transaction => {
    const [examDoc, memberDoc, existing] = await Promise.all([
      transaction.get(reference("exams", input.examId)), transaction.get(reference("members", input.memberId)), transaction.get(entryRef),
    ]);
    if (!examDoc.exists() || !memberDoc.exists()) throw new Error("심사 일정 또는 회원을 찾지 못했어요.");
    if (existing.exists() && !editing) throw new Error("이 심사에 이미 등록된 회원이에요.");
    if (editing && !existing.exists()) throw new Error("심사 신청을 찾지 못했어요.");
    if (existing.exists() && existing.data().result === "passed") throw new Error("합격 결과를 대기로 변경한 뒤 신청 정보를 수정해 주세요.");
    const member = memberDoc.data() as Member;
    const exam = examDoc.data() as Exam;
    if (!examSessions(exam).some(session => session.date === input.examDate && session.time === (input.examTime ?? ""))) throw new Error("이 일정에 등록된 심사일과 시간을 선택해 주세요.");
    transaction.set(entryRef, {
      ...input, memberName: member.name, memberPhone: member.phone,
      examTitle: exam.title,
      result: existing.exists() ? existing.data().result : "pending",
      attended: existing.exists() ? existing.data().attended : false,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function setExamAttendance(entryId: string, attended: boolean): Promise<void> {
  const entryRef = reference("examEntries", entryId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(entryRef);
    if (!snapshot.exists()) throw new Error("심사 신청을 찾지 못했어요.");
    if (snapshot.data().result === "passed" && !attended) throw new Error("합격한 회원은 참석 상태를 해제할 수 없어요.");
    transaction.update(entryRef, { attended, updatedAt: serverTimestamp() });
  });
}

export async function setExamResult(entryId: string, result: ExamResult, requireAttendance = false): Promise<void> {
  if (!EXAM_RESULTS.some(([value]) => value === result)) throw new Error("올바른 심사 결과를 선택해 주세요.");
  const entryRef = reference("examEntries", entryId);
  await runTransaction(db, async transaction => {
    const entryDoc = await transaction.get(entryRef);
    if (!entryDoc.exists()) throw new Error("심사 신청을 찾지 못했어요.");
    const entry = entryDoc.data() as ExamEntry;
    if (entry.result === result) return;
    if (requireAttendance && !entry.attended) throw new Error("참석 상태가 변경되어 통과 처리하지 않았어요.");
    const memberRef = reference("members", entry.memberId);
    const memberDoc = await transaction.get(memberRef);
    if (!memberDoc.exists() && result === "passed") throw new Error("삭제된 회원의 등급은 갱신할 수 없어요.");
    const member = memberDoc.exists() ? memberDoc.data() as Member : null;
    const patch: Record<string, unknown> = { result, updatedAt: serverTimestamp() };
    if (result === "passed") patch.attended = true;
    if (result === "passed" && member && entry.targetRank) {
      if (!validRank(entry.targetRank)) throw new Error("합격 후 등급을 확인해 주세요.");
      if (member.rankSource && member.rankSource.examDate > entry.examDate) throw new Error("더 최근 심사로 승급한 회원이에요. 최근 심사 결과부터 확인해 주세요.");
      patch.rankBefore = member.rank ?? null;
      patch.rankSourceBefore = member.rankSource ?? null;
      transaction.update(memberRef, { rank: entry.targetRank, rankSource: { entryId, examDate: entry.examDate } });
    } else if (entry.result === "passed" && entry.targetRank && member) {
      if (member.rankSource && member.rankSource.entryId !== entryId) throw new Error("이후 승급 기록이 있어요. 최근 심사 결과부터 변경해 주세요.");
      if (member.rankSource?.entryId === entryId) transaction.update(memberRef, { rank: entry.rankBefore ?? null, rankSource: entry.rankSourceBefore ?? null });
    }
    if (result === "absent") patch.attended = false;
    transaction.update(entryRef, patch);
  });
}

export async function deleteExamEntry(entryId: string): Promise<void> {
  const entryRef = reference("examEntries", entryId);
  await runTransaction(db, async transaction => {
    const entry = await transaction.get(entryRef);
    if (!entry.exists()) return;
    if (entry.data().result === "passed") throw new Error("합격 결과를 대기로 변경한 뒤 신청을 삭제해 주세요.");
    transaction.delete(entryRef);
  });
}
