"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  watchExams, watchMemberExams, saveExam, saveExamEntry, setExamResult, setExamAttendance, deleteExamEntry,
  EXAM_RESULTS, EXAM_COURSES, courseLabel, examSessions,
  type Exam, type ExamEntry, type ExamStore, type ExamResult,
} from "@/lib/exam-data";
import { type Member } from "@/lib/dojo-data";
import { rankLabel, type MemberRank } from "@/lib/member-rank";
import RankFields, { RankBadge } from "./rank-fields";
import "./exams.css";

const message = (error: unknown) => error instanceof Error ? error.message : "저장에 실패했어요. 다시 시도해 주세요.";
const dateLabel = (date: string) => date ? date.replace(/-/g, ". ") : "—";
const resultLabel = (result: ExamResult) => result === "passed" ? "통과" : result === "pending" ? "결과 미등록" : EXAM_RESULTS.find(([value]) => value === result)?.[1] ?? result;
const blankExam = (date: string): Omit<Exam, "id"> => ({ title: `${date.slice(0, 4)}년 ${Number(date.slice(5, 7))}월 심사`, date, time: "", dates: [{ date, time: "" }] });
const sessionLabel = (date: string, time: string) => `${dateLabel(date)} (${["일","월","화","수","목","금","토"][new Date(`${date}T12:00:00Z`).getUTCDay()]})${time ? ` ${time}` : ""}`;

function ExamModal({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const reference = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = reference.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={reference} className="exam-modal" aria-labelledby="exam-modal-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-heading"><div><span className="eyebrow">CHEONKWON</span><h2 id="exam-modal-title">{title}</h2></div><button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="닫기">×</button></div>
    {children}
  </dialog>;
}

export default function ExamManagement({ members, currentDate, onMember }: { members: Member[]; currentDate: string; onMember: (member: Member) => void }) {
  const [store, setStore] = useState<ExamStore>({ exams: [], entries: [] });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [month, setMonth] = useState(currentDate.slice(0, 7));
  const [resultFilter, setResultFilter] = useState("all");
  const [modal, setModal] = useState<"exam" | "entry" | "delete" | null>(null);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [examForm, setExamForm] = useState(blankExam(currentDate));
  const [editingEntry, setEditingEntry] = useState<ExamEntry | null>(null);
  const [memberId, setMemberId] = useState("");
  const [examRank, setExamRank] = useState<MemberRank>({ belt: "white", dan: 0 });
  const [targetRank, setTargetRank] = useState<MemberRank | null>(null);
  const [course, setCourse] = useState<string>(EXAM_COURSES[0][0]);
  const [entrySession, setEntrySession] = useState("");
  const [memo, setMemo] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => watchExams(next => { setStore(next); setLoaded(true); setError(""); }, issue => { setError(message(issue)); setLoaded(true); }), []);
  const exams = store.exams.filter(exam => exam.date.startsWith(month));
  const selected = exams.find(exam => exam.id === selectedId) ?? exams[0] ?? null;
  const entries = store.entries.filter(entry => entry.examId === selected?.id).sort((a,b) => a.memberName.localeCompare(b.memberName, "ko"));
  const shown = entries.filter(entry => resultFilter === "all" || (resultFilter === "unrecorded" ? entry.result !== "passed" : entry.result === resultFilter));
  const passCandidates = entries.filter(entry => entry.attended && entry.result !== "passed" && members.some(member => member.id === entry.memberId));
  const availableMembers = members.filter(member => (editingEntry?.memberId === member.id || !entries.some(entry => entry.memberId === member.id))).sort((a,b) => a.name.localeCompare(b.name,"ko"));
  const chosenCourse = EXAM_COURSES.find(([id]) => id === course);
  const formSessions = examForm.dates?.length ? examForm.dates : examSessions({ ...examForm, id: editingExam?.id ?? "" });
  const changeSession = (index: number, key: "date" | "time", value: string) => setExamForm(current => ({ ...current, dates: (current.dates ?? [{ date: current.date, time: current.time }]).map((session, position) => position === index ? { ...session, [key]: value } : session) }));
  const closeModal = () => { if (!busy) { setModal(null); setFormError(""); } };
  const openExam = (exam?: Exam) => {
    setEditingExam(exam ?? null); setExamForm(exam ? { ...exam } : blankExam(month === currentDate.slice(0, 7) ? currentDate : `${month}-01`)); setFormError(""); setModal("exam");
  };
  const chooseMember = (id: string) => {
    const member = members.find(item => item.id === id);
    setMemberId(id); setExamRank(member?.rank ?? { belt: "white", dan: 0 }); setTargetRank(null);
  };
  const openEntry = (entry?: ExamEntry) => {
    setEditingEntry(entry ?? null); setMemberId(entry?.memberId ?? "");
    setExamRank(entry?.examRank ?? { belt: "white", dan: 0 }); setTargetRank(entry?.targetRank ?? null);
    setCourse(entry?.course ?? EXAM_COURSES[0][0]); setMemo(entry?.memo ?? ""); setFormError(""); setModal("entry");
    setEntrySession(entry ? `${entry.examDate}|${entry.examTime ?? ""}` : selected ? `${examSessions(selected)[0].date}|${examSessions(selected)[0].time}` : "");
  };
  const submitExam = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setFormError("");
    try {
      if (formSessions.some(session => session.date.slice(0, 7) !== month)) throw new Error("선택한 심사 월 안에서 날짜를 추가해 주세요.");
      const id = await saveExam(examForm, editingExam?.id); setSelectedId(id); setMonth(formSessions[0].date.slice(0,7)); setModal(null); setNotice("심사 일정을 저장했어요.");
    } catch (issue) { setFormError(message(issue)); } finally { setBusy(false); }
  };
  const submitEntry = async (event: FormEvent) => {
    event.preventDefault(); if (busy || !selected) return; setBusy(true); setFormError("");
    try {
      const stageMatch = course.match(/-([1-4])$/);
      const [examDate, examTime = ""] = entrySession.split("|");
      await saveExamEntry({ examId: selected.id, memberId, examDate, examTime, examRank, targetRank, course, stage: stageMatch ? Number(stageMatch[1]) : 1, memo: memo.trim() }, Boolean(editingEntry));
      setModal(null); setNotice("심사 신청을 저장했어요.");
    } catch (issue) { setFormError(message(issue)); } finally { setBusy(false); }
  };
  const changeResult = async (entry: ExamEntry, result: ExamResult) => {
    if (busy) return; setBusy(true); setError(""); setNotice("");
    try {
      await setExamResult(entry.id, result);
    } catch (issue) { setError(message(issue)); } finally { setBusy(false); }
  };
  const passAllAttendees = async () => {
    if (busy || !passCandidates.length) return;
    setBusy(true); setError(""); setNotice("");
    let completed = 0;
    const failures: string[] = [];
    try {
      for (const entry of passCandidates) {
        try { await setExamResult(entry.id, "passed", true); completed++; }
        catch (issue) { failures.push(`${entry.memberName}: ${message(issue)}`); }
      }
      if (completed) setNotice(`참석자 ${completed}명을 통과 처리했어요.`);
      if (failures.length) setError(`${failures.length}명은 처리하지 못했어요. ${failures.join(" / ")}`);
    } finally { setBusy(false); }
  };
  const changeAttendance = async (entry: ExamEntry, attended: boolean) => {
    if (busy) return; setBusy(true); setError("");
    try { await setExamAttendance(entry.id, attended); } catch (issue) { setError(message(issue)); } finally { setBusy(false); }
  };
  const removeEntry = async () => {
    if (!editingEntry || busy) return; setBusy(true); setFormError("");
    try { await deleteExamEntry(editingEntry.id); setModal(null); setNotice("심사 신청을 삭제했어요."); }
    catch (issue) { setFormError(message(issue)); } finally { setBusy(false); }
  };

  return <div className="exam-management">
    <div className="exam-page-tools"><label>심사 월<input type="month" required value={month} disabled={busy} onChange={event => { if (event.target.value) { setMonth(event.target.value); setSelectedId(""); setResultFilter("all"); } }}/></label><button className="button primary" disabled={!loaded || busy || Boolean(error && !store.exams.length)} onClick={()=>openExam(selected ?? undefined)}>{selected ? "심사 일정 수정" : "+ 심사 일정 등록"}</button></div>
    {error && <p className="exam-error" role="alert">{error}</p>}{notice && <p className="exam-notice" role="status">{notice}</p>}
    <div className="exam-layout">
      <div className="exam-main">{!loaded ? <section className="panel exam-empty">심사 일정을 불러오는 중이에요…</section> : selected ? <>
        <section className="panel exam-overview" aria-label="심사 날짜와 시간"><span className="exam-overview-label">심사 일정</span>
          <div className="exam-date-chips">{examSessions(selected).map(session=><span key={`${session.date}-${session.time}`}>{sessionLabel(session.date,session.time)}</span>)}</div>
        </section>
        <section className="panel exam-roster"><div className="panel-heading"><div><h2>심사 신청 명단 <span className="exam-roster-count">{entries.length}</span></h2><p>참석 여부를 확인하고 통과를 체크하세요.</p></div><div className="exam-roster-tools"><div className="select-wrap"><select aria-label="심사 결과 필터" value={resultFilter} onChange={event=>setResultFilter(event.target.value)}><option value="all">전체 결과</option><option value="passed">통과</option><option value="unrecorded">미통과</option></select></div><button className="button primary" disabled={busy || !members.length} onClick={()=>openEntry()}>+ 회원 추가</button></div></div>

          <div className="table-scroll"><table className="exam-roster-table"><thead><tr><th>회원</th><th>응시 과정</th><th>통과 후 등급</th><th className="exam-attendance-cell">참석</th><th>결과</th><th className="exam-actions-cell">관리</th></tr></thead><tbody>{shown.length ? shown.map(entry => {
            const member = members.find(item=>item.id===entry.memberId);
            return <tr key={entry.id}><td><button className="exam-member-link" disabled={!member} onClick={()=>member&&onMember(member)}>{member?.name ?? entry.memberName}</button><small>{member?.phone ?? entry.memberPhone}{!member && " · 삭제된 회원"}</small></td><td><strong>{courseLabel(entry.course)}</strong><small>{dateLabel(entry.examDate)} {entry.examTime}</small><small>{rankLabel(entry.examRank)}</small>{entry.memo && <small className="exam-entry-memo">{entry.memo}</small>}</td><td>{entry.targetRank ? <RankBadge rank={entry.targetRank}/> : <span className="exam-muted">기록만 저장</span>}</td><td className="exam-attendance-cell"><input aria-label={`${entry.memberName} 심사 참석`} type="checkbox" checked={entry.attended} disabled={busy || entry.result==="passed"} onChange={event=>void changeAttendance(entry,event.target.checked)}/></td><td><label className={`exam-pass-check ${entry.result === "passed" ? "passed" : ""}`}><input type="checkbox" aria-label={`${entry.memberName} 심사 통과`} checked={entry.result === "passed"} disabled={busy || (!member && entry.result !== "passed")} onChange={event=>void changeResult(entry,event.target.checked ? "passed" : "pending")}/><span>{entry.result === "passed" ? "통과" : resultLabel(entry.result)}</span></label></td><td><div className="exam-row-actions"><button className="exam-action-icon" aria-label={`${entry.memberName} 신청 수정`} disabled={busy || entry.result==="passed"} title={entry.result==="passed"?"통과 체크를 해제한 뒤 수정할 수 있어요.":"신청 정보 수정"} onClick={()=>openEntry(entry)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5M4 20l4-1L21 6l-4-4L4 15l-1 6Z"/></svg></button><button className="exam-action-icon exam-delete" aria-label={`${entry.memberName} 신청 삭제`} title={entry.result==="passed"?"통과 체크를 해제한 뒤 삭제할 수 있어요.":"신청 삭제"} disabled={busy || entry.result==="passed"} onClick={()=>{setEditingEntry(entry);setFormError("");setModal("delete");}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button></div></td></tr>;
          }) : <tr><td colSpan={6}><div className="exam-empty">{entries.length ? "선택한 결과에 해당하는 회원이 없어요." : "밴드에 신청한 회원을 추가해 주세요."}</div></td></tr>}</tbody></table></div>
          <div className="exam-roster-footer"><div><strong>{shown.length}명 표시 <span>/ 전체 {entries.length}명</span></strong><p>전체 통과는 필터와 관계없이 현재 심사의 참석자에게 적용돼요.</p></div><button className="button secondary exam-bulk-button" disabled={busy || !passCandidates.length} onClick={()=>void passAllAttendees()}>참석자 전체 통과 <span>{passCandidates.length}명</span></button></div>
        </section>
      </> : <section className="panel exam-welcome"><h2>심사 준비부터 결과 기록까지</h2><p>심사 일정을 등록하고 신청 회원, 응시 과정, 참석 여부와 결과를 한곳에서 관리하세요.</p><p>통합 심사는 지정된 과정으로 기록하며, 보유 단수와 도장 내 띠를 구분해 관리합니다.</p></section>}</div>
    </div>
    {modal==="exam" && <ExamModal title={editingExam?"심사 일정 수정":"심사 일정 등록"} busy={busy} onClose={closeModal}>
      <form onSubmit={event=>void submitExam(event)}><div className="modal-body">
        <div className="exam-dates-heading"><strong>심사일 · 시간</strong><button className="text-link" type="button" disabled={busy} onClick={()=>setExamForm({...examForm,dates:[...formSessions,{date:formSessions[formSessions.length-1]?.date??currentDate,time:""}]})}>+ 날짜 추가</button></div>
        <div className="exam-date-inputs">{formSessions.map((session,index)=><div className="exam-date-row" key={index}>
          <label className="form-field"><span>심사일 {index+1} *</span><input required type="date" min={`${month}-01`} max={`${month}-${new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()}`} value={session.date} onChange={event=>changeSession(index,"date",event.target.value)}/></label>
          <label className="form-field"><span>시간 (선택)</span><input type="time" value={session.time} onChange={event=>changeSession(index,"time",event.target.value)}/></label>
          <button type="button" className="icon-button danger-icon" disabled={busy||formSessions.length===1} aria-label={`심사일 ${index+1} 삭제`} onClick={()=>setExamForm({...examForm,dates:formSessions.filter((_,position)=>position!==index)})}>×</button>
        </div>)}</div>
        <p className="form-note">같은 달의 심사일을 여러 개 등록할 수 있어요. 신청 회원마다 응시 날짜와 시간을 지정합니다.</p>
        {editingExam&&<p className="form-note">일정을 바꿔도 이미 저장된 신청 회원의 응시일은 유지돼요. 필요한 회원은 신청 정보를 수정해 주세요.</p>}
        {formError&&<p className="exam-error" role="alert">{formError}</p>}
      </div><div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={closeModal}>취소</button><button className="button primary" disabled={busy}>{busy?"저장 중…":"일정 저장"}</button></div></form>
    </ExamModal>}
    {modal==="entry" && selected && <ExamModal title={editingEntry?"심사 신청 수정":"신청 회원 추가"} busy={busy} onClose={closeModal}><form onSubmit={event=>void submitEntry(event)}><div className="modal-body">
      <label className="form-field"><span>회원 *</span><div className="select-wrap"><select required value={memberId} disabled={Boolean(editingEntry)} onChange={event=>chooseMember(event.target.value)}><option value="">회원을 선택하세요</option>{availableMembers.map(member=><option value={member.id} key={member.id}>{member.name} · {member.phone || "연락처 없음"}</option>)}</select></div></label>
      {memberId && <p className="exam-current-rank">현재 회원 등급 <RankBadge rank={members.find(member=>member.id===memberId)?.rank}/></p>}
      <label className="form-field"><span>응시일 *</span><div className="select-wrap"><select required value={entrySession} onChange={event=>setEntrySession(event.target.value)}><option value="">심사일을 선택하세요</option>{examSessions(selected).map(session=><option key={`${session.date}-${session.time}`} value={`${session.date}|${session.time}`}>{sessionLabel(session.date,session.time)}</option>)}</select></div></label>
      <label className="form-field"><span>이번 심사 응시 과정 *</span><div className="select-wrap"><select value={course} onChange={event=>setCourse(event.target.value)}>{EXAM_COURSES.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></div></label><p className="form-note">{chosenCourse?.[2]}</p>
      <p className="form-note">현재 등급은 회원정보에서 자동으로 가져와요. 기본으로 심사 이력만 저장합니다.</p>
      <details className="exam-entry-options" open={editingEntry && (editingEntry.targetRank !== null || Boolean(editingEntry.memo)) ? true : undefined}>
      <summary>추가 설정 · 등급 변경 / 메모</summary>
      <div className="form-divider">응시 당시 띠 · 보유 단수 수정</div><RankFields value={examRank} onChange={rank=>rank&&setExamRank(rank)}/>
      <label className="exam-rank-toggle"><input type="checkbox" checked={targetRank!==null} onChange={event=>setTargetRank(event.target.checked?{...examRank}:null)}/><span>합격 시 회원 등급 변경</span></label>
      {targetRank && <><RankFields value={targetRank} onChange={setTargetRank}/><p className="form-note">합격 후 도장 내 띠와 보유 단수를 지정해 주세요. 통합 심사도 이 등급으로 갱신됩니다.</p></>}
      <label className="form-field"><span>메모</span><textarea maxLength={2000} value={memo} onChange={event=>setMemo(event.target.value)} placeholder="밴드 댓글 내용, 통합 범위, 다음 차수 등을 기록하세요."/></label><p className="form-note">보유 단수가 있어도 도장 내 띠는 하얀띠로 기록할 수 있어요. 등급 변경을 선택하지 않으면 심사 이력만 저장합니다.</p>
      </details>{formError && <p className="exam-error" role="alert">{formError}</p>}
    </div><div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={closeModal}>취소</button><button className="button primary" disabled={busy || !memberId}>{busy?"저장 중…":"신청 저장"}</button></div></form></ExamModal>}
    {modal==="delete" && editingEntry && <ExamModal title="심사 신청 삭제" busy={busy} onClose={closeModal}><div className="modal-body"><p>{editingEntry.memberName} 회원의 심사 신청을 삭제할까요?</p>{formError && <p className="exam-error" role="alert">{formError}</p>}</div><div className="modal-footer"><button className="button secondary" disabled={busy} onClick={closeModal}>취소</button><button className="button danger-light" disabled={busy} onClick={()=>void removeEntry()}>{busy?"삭제 중…":"삭제"}</button></div></ExamModal>}
  </div>;
}

export function MemberExamHistory({ memberId }: { memberId: string }) {
  const [history,setHistory] = useState<{ memberId: string; entries: ExamEntry[]; error: string } | null>(null);
  useEffect(()=>watchMemberExams(memberId,next=>setHistory({memberId,entries:next,error:""}),issue=>setHistory({memberId,entries:[],error:message(issue)})),[memberId]);
  const current = history?.memberId===memberId ? history : null;
  const entries = current?.entries ?? [];
  const loaded = current!==null;
  const error = current?.error ?? "";
  return <section className="panel history-panel"><div className="panel-heading"><div><h2>심사 이력</h2><p>응시 과정과 결과, 합격 후 등급을 확인할 수 있어요.</p></div></div>{error?<p className="exam-error" role="alert">{error}</p>:<div className="table-scroll"><table><thead><tr><th>심사일</th><th>응시 과정</th><th>결과</th><th>합격 후 등급</th></tr></thead><tbody>{entries.length?entries.map(entry=><tr key={entry.id}><td>{dateLabel(entry.examDate)}</td><td>{courseLabel(entry.course)}</td><td><span className={`exam-result-badge ${entry.result}`}>{resultLabel(entry.result)}</span></td><td>{entry.targetRank?rankLabel(entry.targetRank):"기록만 저장"}</td></tr>):<tr><td colSpan={4} className="table-empty">{loaded?"등록된 심사 이력이 없어요.":"심사 이력을 불러오는 중이에요…"}</td></tr>}</tbody></table></div>}</section>;
}
