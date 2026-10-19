import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type Pass = { id: string; start: string; end?: string; months: number; weekly: number | "unlimited" };
export type Member = { id: string; name: string; phone: string; birthDate?: string; memo: string; created: string; passes: Pass[] };
export type Attendance = { id: string; memberId: string; date: string; passId: string; sessions: string[] };
export type Schedule = { id: string; day: number; time: string; effectiveFrom?: string; effectiveTo?: string };
export type Store = { members: Member[]; attendance: Attendance[]; schedules: Schedule[] };

export const LOCATION_ID = "main";
export const DEFAULT_SCHEDULES: Schedule[] = [1, 2, 3, 4, 5]
  .flatMap((day) => ["19:00", "20:00", "21:00"].map((time) => ({ id: `default-${day}-${time}`, day, time })))
  .concat([{ id: "default-6-11:00", day: 6, time: "11:00" }]);

const locationCollection = (name: string) => collection(db, "locations", LOCATION_ID, name);
const locationDocument = (name: string, id: string) => doc(db, "locations", LOCATION_ID, name, id);
const scheduleDocumentId = (day: number, time: string) => `schedule-${day}-${time.replace(":", "")}`;
const attendanceDocumentId = (memberId: string, date: string) => `${memberId}_${date}`;
const previousDate = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}-${String(previous.getUTCDate()).padStart(2, "0")}`;
};

export function schedulesForDate(schedules: Schedule[], date: string): Schedule[] {
  return schedules
    .filter((schedule) => (!schedule.effectiveFrom || schedule.effectiveFrom <= date)
      && (!schedule.effectiveTo || schedule.effectiveTo >= date))
    .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));
}

export function watchDojoStore(onChange: (store: Store) => void, onError: (error: Error) => void): Unsubscribe {
  let members: Member[] = [];
  let passes: Array<Pass & { memberId: string }> = [];
  let attendance: Attendance[] = [];
  let schedules: Schedule[] = [];
  const ready = new Set<string>();

  const publish = () => {
    if (ready.size !== 4) return;
    onChange({
      members: members.map((member) => ({
        ...member,
        passes: passes
          .filter((pass) => pass.memberId === member.id)
          .map(({ memberId: _memberId, ...pass }) => pass)
          .sort((a, b) => b.start.localeCompare(a.start)),
      })),
      attendance,
      schedules: schedules.sort((a, b) => a.day - b.day || a.time.localeCompare(b.time)
        || (a.effectiveFrom ?? "").localeCompare(b.effectiveFrom ?? "")),
    });
  };

  const fail = (error: Error) => onError(error);
  const unsubs = [
    onSnapshot(locationCollection("members"), (snapshot) => {
      members = snapshot.docs.map((item) => ({
        ...(item.data() as Omit<Member, "id" | "passes">),
        id: item.id,
        passes: [],
      }));
      ready.add("members");
      publish();
    }, fail),
    onSnapshot(locationCollection("passes"), (snapshot) => {
      passes = snapshot.docs.map((item) => ({ ...item.data(), id: item.id }) as Pass & { memberId: string });
      ready.add("passes");
      publish();
    }, fail),
    onSnapshot(locationCollection("attendance"), (snapshot) => {
      attendance = snapshot.docs.map((item) => ({ ...item.data(), id: item.id }) as Attendance);
      ready.add("attendance");
      publish();
    }, fail),
    onSnapshot(locationCollection("schedules"), (snapshot) => {
      schedules = snapshot.docs.map((item) => ({ ...item.data(), id: item.id }) as Schedule);
      ready.add("schedules");
      publish();
    }, fail),
  ];

  return () => unsubs.forEach((unsubscribe) => unsubscribe());
}

export async function initializeDojo(): Promise<void> {
  const stateRef = locationDocument("meta", "state");
  const schedulesRef = locationCollection("schedules");
  await runTransaction(db, async (transaction) => {
    const state = await transaction.get(stateRef);
    if (state.exists()) return;
    transaction.set(stateRef, { schemaVersion: 1, createdAt: serverTimestamp() });
    DEFAULT_SCHEDULES.forEach(({ id, day, time }) => transaction.set(doc(schedulesRef, id), { day, time }));
  });
}

export async function isDojoInitialized(): Promise<boolean> {
  return (await getDoc(locationDocument("meta", "state"))).exists();
}

export async function createMember(member: Member): Promise<void> {
  const batch = writeBatch(db);
  const { passes, ...profile } = member;
  batch.set(locationDocument("members", member.id), profile);
  passes.forEach((pass) => batch.set(locationDocument("passes", pass.id), { ...pass, memberId: member.id }));
  await batch.commit();
}

export async function createMembers(members: Member[]): Promise<void> {
  for (let start = 0; start < members.length; start += 450) {
    const batch = writeBatch(db);
    members.slice(start, start + 450).forEach(({ passes: _passes, ...member }) => {
      batch.set(locationDocument("members", member.id), member);
    });
    await batch.commit();
  }
}

export async function updateMember(member: Pick<Member, "id" | "name" | "phone" | "birthDate" | "memo">): Promise<void> {
  await updateDoc(locationDocument("members", member.id), {
    name: member.name,
    phone: member.phone,
    birthDate: member.birthDate ?? "",
    memo: member.memo,
  });
}

export async function createPass(memberId: string, pass: Pass): Promise<void> {
  await writeBatch(db)
    .set(locationDocument("passes", pass.id), { ...pass, memberId })
    .commit();
}

export async function updatePass(pass: Pass): Promise<void> {
  await updateDoc(locationDocument("passes", pass.id), {
    start: pass.start,
    end: pass.end ?? null,
    months: pass.months,
    weekly: pass.weekly,
  });
}

export async function toggleAttendance(
  record: Pick<Attendance, "memberId" | "date" | "passId">,
  time: string,
): Promise<void> {
  const attendanceRef = locationDocument("attendance", attendanceDocumentId(record.memberId, record.date));
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(attendanceRef);
    const current = snapshot.exists() ? snapshot.data() as Omit<Attendance, "id"> : null;
    const sessions = current?.sessions ?? [];
    const nextSessions = sessions.includes(time)
      ? sessions.filter((session) => session !== time)
      : [...sessions, time].sort();

    if (nextSessions.length === 0) {
      if (snapshot.exists()) transaction.delete(attendanceRef);
      return;
    }

    transaction.set(attendanceRef, {
      memberId: record.memberId,
      date: record.date,
      passId: current?.passId ?? record.passId,
      sessions: nextSessions,
    });
  });
}

export async function deleteAttendanceForDate(date: string): Promise<number> {
  const snapshot = await getDocs(query(locationCollection("attendance"), where("date", "==", date)));
  for (let start = 0; start < snapshot.docs.length; start += 450) {
    const batch = writeBatch(db);
    snapshot.docs.slice(start, start + 450).forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
  return snapshot.docs.length;
}

export async function saveSchedulesForDate(
  currentSchedules: Schedule[],
  nextSchedules: Schedule[],
  effectiveDate: string,
): Promise<void> {
  const batch = writeBatch(db);
  const currentByTime = new Map(currentSchedules.map((schedule) => [`${schedule.day}-${schedule.time}`, schedule]));
  const nextByTime = new Map(nextSchedules.map((schedule) => [`${schedule.day}-${schedule.time}`, schedule]));
  let changes = 0;

  currentByTime.forEach((schedule, key) => {
    if (nextByTime.has(key)) return;
    const scheduleRef = locationDocument("schedules", schedule.id);
    if (schedule.effectiveFrom && schedule.effectiveFrom >= effectiveDate) {
      batch.delete(scheduleRef);
    } else {
      batch.update(scheduleRef, { effectiveTo: previousDate(effectiveDate) });
    }
    changes += 1;
  });

  nextByTime.forEach((schedule, key) => {
    if (currentByTime.has(key)) return;
    batch.set(locationDocument("schedules", schedule.id), {
      day: schedule.day,
      time: schedule.time,
      effectiveFrom: effectiveDate,
    });
    changes += 1;
  });

  if (changes > 0) await batch.commit();
}

export async function readLegacyStore(raw: string | null): Promise<Store | null> {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Store>;
    if (!Array.isArray(value.members) || !Array.isArray(value.attendance) || !Array.isArray(value.schedules)) return null;
    return {
      members: value.members as Member[],
      attendance: value.attendance as Attendance[],
      schedules: value.schedules as Schedule[],
    };
  } catch {
    return null;
  }
}

export function hasLegacyData(store: Store): boolean {
  if (store.members.length > 0 || store.attendance.length > 0) return true;
  const sort = (schedules: Schedule[]) => schedules.map(({ day, time }) => `${day}-${time}`).sort();
  return JSON.stringify(sort(store.schedules)) !== JSON.stringify(sort(DEFAULT_SCHEDULES));
}

export async function importLegacyStore(store: Store): Promise<void> {
  const stateRef = locationDocument("meta", "state");
  const [state, members, passes, attendance, schedules] = await Promise.all([
    getDoc(stateRef),
    getDocs(locationCollection("members")),
    getDocs(locationCollection("passes")),
    getDocs(locationCollection("attendance")),
    getDocs(locationCollection("schedules")),
  ]);
  if (state.exists() || members.size || passes.size || attendance.size || schedules.size) {
    throw new Error("Firestore에 이미 도장 데이터가 있어 가져오기를 중단했어요.");
  }

  const operations: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = [];
  store.members.forEach(({ passes: memberPasses, ...member }) => {
    operations.push({ ref: locationDocument("members", member.id), data: member });
    memberPasses.forEach((pass) => operations.push({
      ref: locationDocument("passes", pass.id),
      data: { ...pass, memberId: member.id },
    }));
  });

  const mergedAttendance = new Map<string, Attendance>();
  store.attendance.forEach((record) => {
    const id = attendanceDocumentId(record.memberId, record.date);
    const previous = mergedAttendance.get(id);
    mergedAttendance.set(id, {
      id,
      memberId: record.memberId,
      date: record.date,
      passId: previous?.passId ?? record.passId,
      sessions: [...new Set([...(previous?.sessions ?? []), ...record.sessions])].sort(),
    });
  });
  mergedAttendance.forEach(({ id, ...record }) => operations.push({ ref: locationDocument("attendance", id), data: record }));
  store.schedules.forEach(({ id, day, time }) => operations.push({
    ref: locationDocument("schedules", id),
    data: { day, time },
  }));

  for (let start = 0; start < operations.length; start += 450) {
    const batch = writeBatch(db);
    operations.slice(start, start + 450).forEach(({ ref, data }) => batch.set(ref, data));
    await batch.commit();
  }
  await writeBatch(db).set(stateRef, { schemaVersion: 1, importedAt: serverTimestamp() }).commit();
}

export async function startFreshDojo(): Promise<void> {
  await initializeDojo();
}

export function newScheduleId(day: number, time: string): string {
  return scheduleDocumentId(day, time);
}
