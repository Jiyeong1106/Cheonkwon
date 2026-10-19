"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
  createMember,
  createPass,
  createSchedules,
  DEFAULT_SCHEDULES,
  deleteAttendanceForDate,
  hasLegacyData,
  importLegacyStore,
  initializeDojo,
  isDojoInitialized,
  newScheduleId,
  readLegacyStore,
  removeSchedule as removeScheduleDocument,
  startFreshDojo,
  toggleAttendance as toggleAttendanceRecord,
  updateMember,
  updatePass,
  watchDojoStore,
  type Attendance,
  type Member,
  type Pass,
  type Schedule,
  type Store,
} from "@/lib/dojo-data";

type Dialog = "member" | "edit" | "pass" | "passEdit" | "schedule" | "help" | "notifications" | null;

const STORE_KEY = "cheonkwon-mvp-v1";
// Temporary public demo mode. Set to false to require admin Google sign-in again.
const DEMO_MODE = false;
const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const isAdminEmail = (email: string | null) =>
  Boolean(email && ADMIN_EMAILS.includes(email.toLowerCase()));
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const defaultStore: Store = { members: [], attendance: [], schedules: DEFAULT_SCHEDULES };
const weekdayNames = ["일", "월", "화", "수", "목", "금", "토"];
const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
const hourOptions = Array.from({ length: 24 }, (_, hour) => { const value = String(hour).padStart(2, "0"); return [value, value]; });
const minuteOptions = ["00", "10", "20", "30", "40", "50"].map((value) => [value, value]);
const moneylessDate = (date: string) => date ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(`${date}T12:00:00+09:00`)) : "-";
const addPassDays = (date: string, months: number) => { const [year,month,day]=date.split("-").map(Number); const target=new Date(Date.UTC(year,month-1,day+months*30)); return `${target.getUTCFullYear()}-${String(target.getUTCMonth()+1).padStart(2,"0")}-${String(target.getUTCDate()).padStart(2,"0")}`; };
const passEndDate = (pass: Pass) => pass.end || addPassDays(pass.start, pass.months);
const passAllowance = (pass: Pass) => pass.weekly === "unlimited" ? null : pass.weekly * 4 * pass.months;
const weeklyLabel = (pass: Pass) => pass.weekly === "unlimited" ? "무제한" : `주 ${pass.weekly}회`;
const attendanceSummary = (pass: Pass, used: number) => {
  const allowance = passAllowance(pass);
  return allowance === null ? `${used}회 · 무제한` : `${used} / ${allowance}회`;
};
const usagePercent = (pass: Pass, used: number) => { const allowance = passAllowance(pass); return allowance === null ? 0 : Math.min(100, used / allowance * 100); };
const weeklyValue = (value: string): Pass["weekly"] => value === "unlimited" ? "unlimited" : Number(value);
const id = () => Math.random().toString(36).slice(2, 10);
const activePass = (m: Member, date: string) => m.passes.filter(p => p.start <= date && passEndDate(p) >= date).sort((a,b) => b.start.localeCompare(a.start))[0];
const passAttendance = (store: Store, pass: Pass) => store.attendance.filter(a => a.passId === pass.id).length;
const statusFor = (m: Member, date: string) => { const p=activePass(m,date); if(p) return "이용 중"; return m.passes.length ? "만료" : "미등록"; };
const fmtPhone = (a:string,b:string,c:string) => [a,b,c].filter(Boolean).join("-");
const getDay = (date:string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const firestoreErrorMessage = (error: unknown, action: string) => {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return code === "permission-denied"
    ? "Firestore 접근이 거부됐어요. Firebase Console에 firestore.rules를 게시했는지 확인해 주세요."
    : `${action} 실패했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.`;
};

function Icon({ name }: { name: string }) {
  const paths: Record<string,string> = { grid:"M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z", users:"M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 8v6 M23 11h-6", check:"M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11", calendar:"M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2z", search:"M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z M21 21l-4.35-4.35", bell:"M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4", arrow:"M5 12h14 M12 5l7 7-7 7", plus:"M12 5v14 M5 12h14", close:"M18 6 6 18 M6 6l12 12", logout:"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9", download:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3", clock:"M12 8v4l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0", edit:"M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z", chevron:"m9 18 6-6-6-6", help:"M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3 M12 17h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0", shield:"M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.grid}/></svg>;
}

export default function Home() {
  const [user,setUser]=useState<User|null>(null);
  const [authPending,setAuthPending]=useState(false);
  const [authError,setAuthError]=useState("");
  const [store,setStore]=useState<Store>(defaultStore);
  const [loaded,setLoaded]=useState(false);
  const [view,setView]=useState<"dashboard"|"members"|"attendance"|"detail">("dashboard");
  const [selected,setSelected]=useState<string|null>(null);
  const [editingPassId,setEditingPassId]=useState<string|null>(null);
  const [dialog,setDialog]=useState<Dialog>(null);
  const [search,setSearch]=useState("");
  const [filter,setFilter]=useState("전체 회원");
  const [currentDate,setCurrentDate]=useState("2026-10-18");
  const [attendanceDate,setAttendanceDate]=useState("2026-10-18");
  const [timeFilter,setTimeFilter]=useState("전체");
  const [nameFilter,setNameFilter]=useState("");
  const [mobileMenu,setMobileMenu]=useState(false);
  const [form,setForm]=useState({name:"",phone1:"",phone2:"",phone3:"",memo:"",birthDate:"",start:"2026-10-18",end:"2027-01-18",weekly:"3",months:"3"});
  const [scheduleDays,setScheduleDays]=useState<number[]>([1]);
  const [scheduleTime,setScheduleTime]=useState("19:00");
  const [toast,setToast]=useState("");
  const [backupBusy,setBackupBusy]=useState(false);
  const [loadError,setLoadError]=useState("");
  const [legacyStore,setLegacyStore]=useState<Store|null>(null);
  const [migrationBusy,setMigrationBusy]=useState(false);
  const [migrationOpen,setMigrationOpen]=useState(false);
  const migrationChecked=useRef(false);
  const [profileMenuOpen,setProfileMenuOpen]=useState(false);
  const profileMenuRef=useRef<HTMLDivElement|null>(null);

  useEffect(()=>{
    if(DEMO_MODE)return;
    return onAuthStateChanged(auth,(currentUser)=>{if(currentUser&&!isAdminEmail(currentUser.email)){setUser(null);setAuthError("관리자로 등록된 Google 계정만 이용할 수 있어요.");void signOut(auth).catch(()=>{})}else{setUser(currentUser);if(currentUser)setAuthError("")}});
  },[]);
  useEffect(()=>{ const date=today(); setCurrentDate(date); setAttendanceDate(date); setForm(f=>({...f,start:date,end:addPassDays(date,Number(f.months))})); },[]);
  useEffect(()=>{
    if(!user){setLoaded(false);return}
    let active=true;
    migrationChecked.current=false;
    setLoaded(false);setLoadError("");setMigrationOpen(false);setLegacyStore(null);
    const unsubscribe=watchDojoStore(nextStore=>{
      if(!active)return;
      setStore(nextStore);setLoaded(true);
      if(migrationChecked.current)return;
      migrationChecked.current=true;
      const isEmpty=nextStore.members.length===0&&nextStore.attendance.length===0&&nextStore.schedules.length===0;
      if(!isEmpty)return;
      void isDojoInitialized().then(initialized=>{
        if(!active||initialized)return;
        return readLegacyStore(localStorage.getItem(STORE_KEY)).then(legacy=>{
          if(!active)return;
          if(legacy&&hasLegacyData(legacy)){setLegacyStore(legacy);setMigrationOpen(true)}
          else void initializeDojo().catch(error=>{if(active)setLoadError(firestoreErrorMessage(error,"기본 수업 시간 설정"))});
        });
      }).catch(error=>{if(active)setLoadError(firestoreErrorMessage(error,"도장 설정 확인"))});
    },error=>{
      if(!active)return;
      setLoadError(firestoreErrorMessage(error,"Firestore 데이터 불러오기"));setLoaded(true);
    });
    return()=>{active=false;unsubscribe()};
  },[user]);
  useEffect(()=>{ if(!toast)return; const timer=setTimeout(()=>setToast(""),2800); return ()=>clearTimeout(timer); },[toast]);
  useEffect(()=>{ const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape"){setDialog(null);setProfileMenuOpen(false)}}; window.addEventListener("keydown",onKey); return ()=>window.removeEventListener("keydown",onKey); },[]);
  useEffect(()=>{
    if(!profileMenuOpen)return;
    const onPointerDown=(event:PointerEvent)=>{if(profileMenuRef.current&&!profileMenuRef.current.contains(event.target as Node))setProfileMenuOpen(false)};
    document.addEventListener("pointerdown",onPointerDown);
    return()=>document.removeEventListener("pointerdown",onPointerDown);
  },[profileMenuOpen]);

  const selectedMember=store.members.find(m=>m.id===selected) || null;
  const sorted=useMemo(()=>store.members.slice().sort((a,b)=>a.name.localeCompare(b.name,"ko")),[store.members]);
  const dateDay=getDay(attendanceDate);
  const schedules=useMemo(()=>store.schedules.filter(s=>s.day===dateDay).sort((a,b)=>a.time.localeCompare(b.time)),[store.schedules,dateDay]);
  const filteredMembers=sorted.filter(m=>{
    const matches=`${m.name} ${m.phone}`.includes(search.trim());
    const state=statusFor(m,currentDate);
    return matches && (filter==="전체 회원" || (filter==="이용 중"&&state==="이용 중") || (filter==="만료"&&state==="만료"));
  });
  const attendancePool=sorted.filter(m=>activePass(m,attendanceDate));
  const selectedSessions=(m:Member)=>store.attendance.find(a=>a.memberId===m.id&&a.date===attendanceDate)?.sessions||[];
  const attendanceMembers=attendancePool.filter(m=>!nameFilter||m.name.includes(nameFilter));
  const attended=attendanceMembers.filter(m=>timeFilter==="전체"?selectedSessions(m).length>0:selectedSessions(m).includes(timeFilter));
  const absent=attendanceMembers.filter(m=>timeFilter==="전체"?selectedSessions(m).length===0:!selectedSessions(m).includes(timeFilter));
  const todayRecords=store.attendance.filter(a=>a.date===currentDate);
  const expiring=store.members.filter(m=>{const p=activePass(m,currentDate); if(!p)return false;const remain=(new Date(`${passEndDate(p)}T12:00:00+09:00`).getTime()-new Date(`${currentDate}T12:00:00+09:00`).getTime())/86400000; return remain>=0&&remain<=7;});
  const monthCount=store.attendance.filter(a=>a.date.slice(0,7)===currentDate.slice(0,7)).length;
  const activeCount=store.members.filter(m=>!!activePass(m,currentDate)).length;
  const go=(v:typeof view)=>{setView(v);setMobileMenu(false);setSelected(null)};
  const showMember=(m:Member)=>{setSelected(m.id);setView("detail")};
  const resetForm=()=>setForm({name:"",phone1:"",phone2:"",phone3:"",memo:"",birthDate:"",start:currentDate,end:addPassDays(currentDate,3),weekly:"3",months:"3"});
  const openNew=()=>{resetForm();setDialog("member")};
  const saveNew=()=>{if(!form.name.trim()){setToast("회원 이름을 입력해 주세요.");return}if(form.end<form.start){setToast("종료일은 시작일 이후로 지정해 주세요.");return}const member:Member={id:id(),name:form.name.trim(),phone:fmtPhone(form.phone1,form.phone2,form.phone3),birthDate:form.birthDate,memo:form.memo.trim(),created:currentDate,passes:[{id:id(),start:form.start,end:form.end,months:Number(form.months),weekly:weeklyValue(form.weekly)}]};void createMember(member).then(()=>{setDialog(null);setToast("새 회원을 등록했어요.")}).catch(error=>setToast(firestoreErrorMessage(error,"회원 등록")))};
  const openEdit=(m:Member)=>{const parts=m.phone.split("-");setForm({...form,name:m.name,phone1:parts[0]||"",phone2:parts[1]||"",phone3:parts[2]||"",birthDate:m.birthDate||"",memo:m.memo});setDialog("edit")};
  const saveEdit=()=>{if(!selectedMember)return;if(!form.name.trim()){setToast("회원 이름을 입력해 주세요.");return}void updateMember({id:selectedMember.id,name:form.name.trim(),phone:fmtPhone(form.phone1,form.phone2,form.phone3),birthDate:form.birthDate,memo:form.memo.trim()}).then(()=>{setDialog(null);setToast("회원 정보를 수정했어요.")}).catch(error=>setToast(firestoreErrorMessage(error,"회원 정보 수정")))};
  const addPass=()=>{if(!selectedMember)return;if(form.end<form.start){setToast("종료일은 시작일 이후로 지정해 주세요.");return}const p:Pass={id:id(),start:form.start,end:form.end,months:Number(form.months),weekly:weeklyValue(form.weekly)};void createPass(selectedMember.id,p).then(()=>{setDialog(null);setToast("새 이용권을 등록했어요.")}).catch(error=>setToast(firestoreErrorMessage(error,"이용권 등록")))};
  const openPassEdit=(pass:Pass)=>{setEditingPassId(pass.id);setForm(f=>({...f,start:pass.start,end:passEndDate(pass),weekly:String(pass.weekly),months:String(pass.months)}));setDialog("passEdit")};
  const savePassEdit=()=>{if(!selectedMember||!editingPassId)return;if(form.end<form.start){setToast("종료일은 시작일 이후로 지정해 주세요.");return}void updatePass({id:editingPassId,start:form.start,end:form.end,weekly:weeklyValue(form.weekly),months:Number(form.months)}).then(()=>{setDialog(null);setToast("이용권 정보를 수정했어요.")}).catch(error=>setToast(firestoreErrorMessage(error,"이용권 수정")))};
  const attendanceToggle=(m:Member,time:string)=>{const pass=activePass(m,attendanceDate);if(!pass)return;const used=passAttendance(store,pass);const allowance=passAllowance(pass);const existing=store.attendance.find(a=>a.memberId===m.id&&a.date===attendanceDate);if(allowance!==null&&!existing&&used>=allowance){setToast(`${m.name} 회원은 이용권의 전체 출석 횟수를 모두 사용했어요.`);return}void toggleAttendanceRecord({memberId:m.id,date:attendanceDate,passId:pass.id},time).catch(error=>setToast(firestoreErrorMessage(error,"출석 저장")))};
  const cancelDay=()=>{const count=store.attendance.filter(a=>a.date===attendanceDate).length;if(!count)return;if(!window.confirm(`${attendanceDate}의 출석 ${count}건을 모두 취소할까요?`))return;void deleteAttendanceForDate(attendanceDate).then(()=>setToast("선택한 날짜의 출석을 모두 취소했어요.")).catch(error=>setToast(firestoreErrorMessage(error,"출석 취소")))};
  const toggleScheduleDay=(day:number)=>setScheduleDays(days=>days.includes(day)?days.filter(value=>value!==day):[...days,day].sort((a,b)=>a-b));
  const addSchedule=()=>{if(scheduleDays.length===0){setToast("수업 요일을 하나 이상 선택해 주세요.");return}const existing=new Set(store.schedules.map(s=>`${s.day}-${s.time}`));const newSchedules=scheduleDays.filter(day=>!existing.has(`${day}-${scheduleTime}`)).map(day=>({id:newScheduleId(day,scheduleTime),day,time:scheduleTime}));if(newSchedules.length===0){setToast("선택한 요일에 같은 시간 수업이 이미 등록돼 있어요.");return}void createSchedules(newSchedules).then(()=>setToast(newSchedules.length===scheduleDays.length?"선택한 요일에 수업 시간을 추가했어요.":"이미 등록된 요일을 제외하고 추가했어요.")).catch(error=>setToast(firestoreErrorMessage(error,"수업 시간 추가")))};
  const removeSchedule=(sid:string)=>void removeScheduleDocument(sid).catch(error=>setToast(firestoreErrorMessage(error,"수업 시간 삭제")));
  const importExistingData=async()=>{if(!legacyStore)return;setMigrationBusy(true);try{await importLegacyStore(legacyStore);setMigrationOpen(false);setLegacyStore(null);setToast("기존 브라우저 데이터를 Firestore로 가져왔어요.")}catch(error){setLoadError(error instanceof Error?error.message:firestoreErrorMessage(error,"기존 데이터 가져오기"))}finally{setMigrationBusy(false)}};
  const startWithFirestore=async()=>{setMigrationBusy(true);try{await startFreshDojo();setMigrationOpen(false);setLegacyStore(null);setToast("Firestore에서 새로 시작합니다.")}catch(error){setLoadError(firestoreErrorMessage(error,"Firestore 초기화"))}finally{setMigrationBusy(false)}};
  const handleGoogleSignIn=async()=>{setAuthPending(true);setAuthError("");try{const result=await signInWithPopup(auth,new GoogleAuthProvider());if(!isAdminEmail(result.user.email)){await signOut(auth);setAuthError("관리자로 등록된 Google 계정만 이용할 수 있어요.")}}catch(error){const code=error&&typeof error==="object"&&"code" in error?String(error.code):"";if(code==="auth/popup-closed-by-user"){return}setAuthError(code==="auth/unauthorized-domain"?"Firebase Authentication의 승인된 도메인에 이 사이트를 추가해 주세요.":code==="auth/popup-blocked"?"브라우저에서 팝업을 허용한 뒤 다시 시도해 주세요.":"Google 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.")}finally{setAuthPending(false)}};
  const handleSignOut=async()=>{setProfileMenuOpen(false);try{await signOut(auth)}catch{setToast("로그아웃에 실패했어요. 다시 시도해 주세요.")}};
  const exportStoreBackup=async()=>{
    if(backupBusy)return;
    setBackupBusy(true);
    try{
      const XLSX=await import("xlsx");
      const workbook=XLSX.utils.book_new();
      const addSheet=(name:string,headers:string[],rows:(string|number)[][],widths:number[])=>{
        const sheet=XLSX.utils.aoa_to_sheet([headers,...rows]);
        sheet["!cols"]=widths.map(wch=>({wch}));
        if(sheet["!ref"])sheet["!autofilter"]={ref:sheet["!ref"]};
        XLSX.utils.book_append_sheet(workbook,sheet,name);
      };
      const memberNames=new Map(store.members.map(member=>[member.id,member.name]));
      const members=store.members.map(member=>[
        member.id,member.name,member.phone,member.birthDate||"",member.memo,member.created,
      ]);
      const passes=store.members.flatMap(member=>member.passes.map(pass=>[
        pass.id,member.name,member.id,weeklyLabel(pass),pass.weekly==="unlimited"?"무제한":pass.weekly,
        pass.months,pass.start,passEndDate(pass),passAllowance(pass)??"무제한",passAttendance(store,pass),
      ]));
      const attendance=store.attendance.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(record=>[
        record.date,memberNames.get(record.memberId)||"(회원 정보 없음)",record.memberId,
        record.sessions.slice().sort().join(", "),record.passId,
      ]);
      const schedules=store.schedules.slice().sort((a,b)=>a.day-b.day||a.time.localeCompare(b.time)).map(schedule=>[
        `${weekdayNames[schedule.day]}요일`,schedule.time,
      ]);
      addSheet("회원",["회원 ID","이름","연락처","생년월일","메모","등록일"],members,[22,16,18,14,32,14]);
      addSheet("이용권",["이용권 ID","회원 이름","회원 ID","이용권 종류","주간 횟수","기간(개월)","시작일","종료일","총 허용 출석","누적 출석"],passes,[22,16,22,18,14,12,14,14,16,14]);
      addSheet("출석",["날짜","회원 이름","회원 ID","수업 시간","이용권 ID"],attendance,[14,16,22,24,22]);
      addSheet("수업시간",["요일","수업 시간"],schedules,[14,14]);
      XLSX.writeFileXLSX(workbook,`cheonkwon-backup-${today()}.xlsx`,{compression:true});
      setToast("회원·이용권·출석·수업시간 엑셀 백업을 저장했어요.");
    }catch{
      setToast("엑셀 백업 파일을 만들지 못했어요. 다시 시도해 주세요.");
    }finally{
      setBackupBusy(false);
    }
  };

  if(!DEMO_MODE&&!user)return <main className="auth-screen"><section className="auth-card"><div className="auth-mark">천</div><p className="auth-eyebrow">CHEONKWON TAEKWONDO</p><h1>천권태권도장 관리자</h1><p className="auth-description">회원과 출석 정보를 관리하려면<br/>관리자 Google 계정으로 로그인해 주세요.</p><button className="auth-google-button" onClick={handleGoogleSignIn} disabled={authPending||ADMIN_EMAILS.length===0}><svg className="auth-google-icon" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.46 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.9c-.58 2.96-2.26 5.48-4.76 7.18l7.73 6C44.38 37.93 46.98 31.84 46.98 24.55Z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.88.93 7.55 2.56 10.78l7.97-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.73-6c-2.14 1.44-4.89 2.3-8.17 2.3-6.26 0-11.55-4.22-13.45-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg>{authPending?"Google 계정 연결 중…":"Google 계정으로 로그인"}</button>{ADMIN_EMAILS.length===0&&<p className="auth-error" role="alert">관리자 이메일 설정이 필요합니다.</p>}{authError&&<p className="auth-error" role="alert">{authError}</p>}<p className="auth-footnote"><Icon name="shield"/> 등록된 관리자 계정만 접근할 수 있습니다.</p></section></main>;

  const pageTitle=view==="dashboard"?"대시보드":view==="members"?"회원 관리":view==="attendance"?"출석 체크":"회원 상세";
  const breadcrumb=<div className="breadcrumb"><button onClick={()=>go("dashboard")}>천권태권도</button>{view!=="dashboard"&&<><span>/</span>{view==="detail"?<><button onClick={()=>go("members")}>회원목록</button><span>/</span><span>회원상세</span></>:<span>{view==="attendance"?"출석 체크":"회원목록"}</span>}</>}</div>;
  const memberRow=(m:Member,compact=false)=><tr key={m.id} className="click-row" onClick={()=>showMember(m)} tabIndex={0} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();showMember(m)}}}><td><div className="person-cell"><div className="avatar">{m.name.slice(0,1)}</div><div><strong>{m.name}</strong><small>{m.phone||"전화번호 미등록"}</small></div></div></td><td>{activePass(m,currentDate)?weeklyLabel(activePass(m,currentDate)!):m.passes.length?"이용권 없음":"미등록"}</td><td>{activePass(m,currentDate)?`${moneylessDate(activePass(m,currentDate)!.start)} – ${moneylessDate(passEndDate(activePass(m,currentDate)!))}`:"-"}</td><td>{(()=>{const p=activePass(m,currentDate);return p?attendanceSummary(p,passAttendance(store,p)):"-"})()}</td><td><span className={`badge ${statusFor(m,currentDate)==="이용 중"?"blue":"muted"}`}>{statusFor(m,currentDate)}</span></td>{!compact&&<td><button className="icon-button small" aria-label={`${m.name} 상세`} onClick={e=>{e.stopPropagation();showMember(m)}}><Icon name="chevron"/></button></td>}</tr>;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileMenu?"open":""}`}>
      <button className="brand" onClick={()=>go("dashboard")} aria-label="천권태권도장 대시보드로 이동"><Image className="brand-logo" src="/cheonkwon-logo.png" width={1500} height={870} alt="Cheon Kwon Adult Taekwondo"/></button>
      <div className="dojo-card"><div className="dojo-avatar">천</div><div><strong>천권태권도</strong><small>운영 도장</small></div><span className="online-dot"/></div>
      <div className="nav-label">메뉴</div>
      <nav className="side-nav"><button className={view==="dashboard"?"active":""} onClick={()=>go("dashboard")}><Icon name="grid"/>대시보드</button><button className={view==="members"||view==="detail"?"active":""} onClick={()=>go("members")}><Icon name="users"/>회원 관리</button><button className={view==="attendance"?"active":""} onClick={()=>go("attendance")}><Icon name="check"/>출석 체크</button></nav>
      <div className="sidebar-bottom"><div className="help-card"><div className="help-bubble"><Icon name="help"/></div><strong>도장 운영을 더 쉽게</strong><p>간단한 사용 안내를 확인해 보세요.</p><button onClick={()=>setDialog("help")}>사용 안내 <Icon name="arrow"/></button></div><button className="sidebar-export" onClick={exportStoreBackup} disabled={!loaded||backupBusy} title="회원 연락처와 생년월일이 포함된 Excel 백업을 내려받습니다."><Icon name="download"/>{backupBusy?"엑셀 파일 생성 중…":"Excel로 백업"}</button></div>
    </aside>
    {mobileMenu&&<button className="scrim nav-scrim" onClick={()=>setMobileMenu(false)} aria-label="메뉴 닫기"/>}
    <main className="main-area">
      {loadError&&<div className="firestore-error" role="alert">{loadError}</div>}
      <header className="topbar"><button className="menu-toggle icon-button" onClick={()=>setMobileMenu(true)} aria-label="메뉴 열기">☰</button>{breadcrumb}<div className="top-actions"><span className="today-label"><strong>Today  </strong><span>{new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",year:"numeric",month:"long",day:"numeric",weekday:"long"}).format(new Date(`${currentDate}T12:00:00+09:00`))}</span></span><button className="icon-button notification-button" aria-label="알림" onClick={()=>setDialog("notifications")}><Icon name="bell"/></button><div className="profile-menu-wrap" ref={profileMenuRef}><button type="button" className="profile-button" title={DEMO_MODE?"공개 시연 모드":user?.displayName||user?.email||"Google 계정"} aria-label="계정 메뉴" aria-haspopup="menu" aria-expanded={profileMenuOpen} onClick={()=>setProfileMenuOpen(open=>!open)}>{DEMO_MODE?"체":user?.displayName?.trim().slice(0,1)||user?.email?.slice(0,1)||"관"}</button>{profileMenuOpen&&<div className="profile-menu" role="menu"><div className="profile-menu-account"><span>로그인 계정</span><strong>{DEMO_MODE?"공개 시연 모드":user?.displayName||"Google 사용자"}</strong>{!DEMO_MODE&&<small>{user?.email||"Google 계정"}</small>}</div>{!DEMO_MODE&&<button type="button" className="profile-menu-logout" style={{display:"flex",alignItems:"center",gap:8,fontSize:11,lineHeight:1.4,fontWeight:600}} role="menuitem" onClick={handleSignOut}><Icon name="logout"/>로그아웃</button>}</div>}</div></div></header>
      <div className="page-content"><div className="page-heading"><div><div className="eyebrow">CHEONKWON TAEKWONDO</div><h1>{pageTitle}</h1>{view==="dashboard"?<p>오늘도 활기찬 하루, 도장 운영 현황을 확인해 보세요.</p>:view==="members"?<p>회원 정보와 이용권 현황을 한눈에 관리할 수 있어요.</p>:view==="attendance"?<p>오늘의 수업 출석을 빠르고 간편하게 체크해 보세요.</p>:null}</div><div className="heading-actions">{view==="dashboard"&&<button className="button primary" onClick={openNew}><Icon name="plus"/>새 회원 등록</button>}{view==="members"&&<button className="button primary" onClick={openNew}><Icon name="plus"/>새 회원 등록</button>}</div></div>
      {view==="dashboard"&&<>
        <section className="stats-grid"><Stat icon="users" label="전체 회원" value={`${store.members.length}`} suffix="명" detail="등록된 전체 회원"/><Stat icon="shield" label="이용 중 회원" value={`${activeCount}`} suffix="명" detail="현재 이용권이 유효해요" tone="blue"/><Stat icon="check" label="오늘 출석" value={`${todayRecords.length}`} suffix="명" detail={`${todayRecords.reduce((n,a)=>n+a.sessions.length,0)}개 수업 참여`}/><Stat icon="calendar" label="만료 예정" value={`${expiring.length}`} suffix="명" detail="7일 이내 이용권 만료" tone="amber"/></section>
        <div className="dashboard-grid"><section className="panel attendance-panel"><div className="panel-heading"><div><h2>오늘의 출석</h2><p>{moneylessDate(currentDate)} · {weekdayNames[getDay(currentDate)]}요일</p></div><button className="text-link" onClick={()=>go("attendance")}>전체 보기 <Icon name="arrow"/></button></div>{todayRecords.length?<div className="mini-list">{todayRecords.slice(0,5).map(a=>{const m=store.members.find(x=>x.id===a.memberId);const p=m?.passes.find(x=>x.id===a.passId);return m?<div className="mini-row" key={a.id}><div className="avatar">{m.name[0]}</div><div className="mini-main"><strong>{m.name}</strong><small>{a.sessions.join(" · ")}</small></div><div className="usage"><strong>{p?attendanceSummary(p,passAttendance(store,p)):"-"}</strong><small>이용권 누적</small></div></div>:null})}</div>:<Empty compact title="오늘 출석한 회원이 없어요" action="출석 체크하기" onClick={()=>go("attendance")}/>}</section>
          <section className="panel expiring-panel"><div className="panel-heading"><div><h2>이용권 만료 예정</h2><p>앞으로 7일 이내 만료되는 회원</p></div><span className="soft-count">{expiring.length}명</span></div>{expiring.length?<div className="mini-list">{expiring.slice(0,5).map(m=>{const p=activePass(m,currentDate)!;const remain=Math.max(0,Math.ceil((new Date(`${passEndDate(p)}T12:00:00+09:00`).getTime()-new Date(`${currentDate}T12:00:00+09:00`).getTime())/86400000));return <div className="mini-row" key={m.id}><div className="avatar pale">{m.name[0]}</div><div className="mini-main"><strong>{m.name}</strong><small>{weeklyLabel(p)} · {p.months}개월</small></div><span className="remaining">{remain===0?"오늘 만료":`${remain}일 남음`}</span></div>})}</div>:<Empty compact title="만료 예정 이용권이 없어요"/>}</section></div>
        <section className="panel recent-panel"><div className="panel-heading"><div><h2>최근 회원</h2><p>회원별 이용권과 출석 현황을 확인해 보세요.</p></div><button className="text-link" onClick={()=>go("members")}>회원 전체 보기 <Icon name="arrow"/></button></div><Table>{sorted.length?sorted.slice(0,6).map(m=>memberRow(m,true)):<tr><td colSpan={5}><Empty title="등록된 회원이 아직 없어요" action="첫 회원 등록하기" onClick={openNew}/></td></tr>}</Table></section>
        <section className="panel month-strip"><div className="month-icon"><Icon name="calendar"/></div><div><strong>이번 달 출석 횟수</strong><small>{currentDate.slice(0,4)}년 {Number(currentDate.slice(5,7))}월 누적 출석</small></div><b>{monthCount}<span>회</span></b></section>
      </>}
      {view==="members"&&<section className="panel members-panel"><div className="toolbar"><div className="search-box"><Icon name="search"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="이름 또는 전화번호 검색"/></div><div className="toolbar-right"><label className="select-wrap"><select value={filter} onChange={e=>setFilter(e.target.value)}><option>전체 회원</option><option>이용 중</option><option>만료</option></select></label><span className="result-count">총 <b>{filteredMembers.length}</b>명</span></div></div><Table>{filteredMembers.length?filteredMembers.map(m=>memberRow(m)):<tr><td colSpan={6}><Empty title={sorted.length?"검색 결과가 없어요":"등록된 회원이 아직 없어요"} action={sorted.length?undefined:"첫 회원 등록하기"} onClick={sorted.length?undefined:openNew}/></td></tr>}</Table><div className="table-foot">회원 이름을 가나다순으로 보여드려요.</div></section>}
      {view==="detail"&&selectedMember&&<MemberDetail member={selectedMember} store={store} currentDate={currentDate} onBack={()=>go("members")} onEdit={()=>openEdit(selectedMember)} onAddPass={()=>{setForm(f=>({...f,start:currentDate,end:addPassDays(currentDate,Number(f.months))}));setDialog("pass")}} onEditPass={openPassEdit} onAttendance={()=>go("attendance")}/>}
      {view==="attendance"&&<><section className="panel attendance-tools"><div className="attendance-date"><div><span className="field-label">출석 날짜</span><label className="date-input"><Icon name="calendar"/><input type="date" value={attendanceDate} onClick={e=>{try{e.currentTarget.showPicker()}catch{e.currentTarget.focus()}}} onChange={e=>setAttendanceDate(e.target.value)}/></label><button className="text-link today-button" onClick={()=>setAttendanceDate(today())}>오늘</button><span className="date-weekday">{weekdayNames[dateDay]}요일 수업</span></div><div className="attendance-buttons"><button className="button secondary" onClick={()=>setDialog("schedule")}><Icon name="clock"/>수업 시간 관리</button><button className="button danger-light" onClick={cancelDay}>전체 취소</button></div></div><div className="time-filters"><button className={timeFilter==="전체"?"selected":""} onClick={()=>setTimeFilter("전체")}>전체</button>{schedules.map(s=><button key={s.id} className={timeFilter===s.time?"selected":""} onClick={()=>setTimeFilter(s.time)}>{s.time}</button>)}{schedules.length===0&&<span className="no-classes">등록된 수업 시간이 없어요. 수업 시간 관리에서 추가해 주세요.</span>}</div></section><div className="attendance-summary"><div><h2>{timeFilter==="전체"?"오늘의 회원 출석":`${timeFilter} 수업 출석`}</h2><p>출석 날짜 기준 유효한 이용권이 있는 회원이에요.</p></div><div className="attendance-search"><Icon name="search"/><input value={nameFilter} onChange={e=>setNameFilter(e.target.value)} placeholder="회원 이름 검색"/></div></div><div className="attendance-columns"><AttendanceColumn title="출석" count={attended.length} status="present">{attended.length?attended.map(m=><AttendanceCard key={m.id} member={m} sessions={selectedSessions(m)} schedules={schedules} onToggle={t=>attendanceToggle(m,t)} pass={activePass(m,attendanceDate)!} used={passAttendance(store,activePass(m,attendanceDate)!)}/>):<Empty compact title="아직 출석한 회원이 없어요"/>}</AttendanceColumn><AttendanceColumn title="미출석" count={absent.length} status="absent">{absent.length?absent.map(m=><AttendanceCard key={m.id} member={m} sessions={selectedSessions(m)} schedules={schedules} onToggle={t=>attendanceToggle(m,t)} pass={activePass(m,attendanceDate)!} used={passAttendance(store,activePass(m,attendanceDate)!)}/>):<Empty compact title="미출석 회원이 없어요"/>}</AttendanceColumn></div></>}
      <footer className="footer"><span>© 2026 Cheonkwon</span><span>천권태권도장 회원 · 이용권 · 출석 관리</span></footer>
      </div>
    </main>
    {dialog&&<div className="scrim modal-scrim" onMouseDown={e=>{if(e.target===e.currentTarget)setDialog(null)}}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="modal-heading"><div><span className="eyebrow">CHEONKWON</span><h2 id="dialog-title">{dialog==="member"?"새 회원 등록":dialog==="edit"?"회원 정보 수정":dialog==="pass"?"이용권 추가":dialog==="passEdit"?"이용권 수정":dialog==="schedule"?"수업 시간 관리":dialog==="help"?"사용 안내":"알림"}</h2></div><button className="icon-button" aria-label="닫기" onClick={()=>setDialog(null)}><Icon name="close"/></button></div>
      {(dialog==="member"||dialog==="edit"||dialog==="pass"||dialog==="passEdit")&&<div className="modal-body">{dialog!=="pass"&&dialog!=="passEdit"&&<><label className="form-field"><span>이름 <i>*</i></span><input autoFocus value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="회원 이름"/></label><div className="form-field"><span>전화번호</span><div className="phone-fields"><input inputMode="numeric" maxLength={3} value={form.phone1} onChange={e=>setForm(f=>({...f,phone1:e.target.value.replace(/\D/g,"").slice(0,3)}))} placeholder="010"/><b>-</b><input inputMode="numeric" maxLength={4} value={form.phone2} onChange={e=>setForm(f=>({...f,phone2:e.target.value.replace(/\D/g,"").slice(0,4)}))} placeholder="1111"/><b>-</b><input inputMode="numeric" maxLength={4} value={form.phone3} onChange={e=>setForm(f=>({...f,phone3:e.target.value.replace(/\D/g,"").slice(0,4)}))} placeholder="2222"/></div></div><label className="form-field"><span>생년월일</span><input type="date" value={form.birthDate} onClick={e=>{try{e.currentTarget.showPicker()}catch{e.currentTarget.focus()}}} onChange={e=>setForm(f=>({...f,birthDate:e.target.value}))}/></label><label className="form-field"><span>메모</span><textarea value={form.memo} onChange={e=>setForm(f=>({...f,memo:e.target.value}))} placeholder="도장 운영에 필요한 메모를 입력하세요." rows={3}/></label></>}{dialog!=="edit"&&<><div className="form-divider">{dialog==="member"?"첫 이용권":dialog==="passEdit"?"이용권 정보 수정":"이용권 정보"}</div><label className="form-field"><span>시작일</span><input type="date" value={form.start} onClick={e=>{try{e.currentTarget.showPicker()}catch{e.currentTarget.focus()}}} onChange={e=>setForm(f=>({...f,start:e.target.value,end:addPassDays(e.target.value,Number(f.months))}))}/></label><div className="form-row"><label className="form-field"><span>이용권 종류</span><Select value={form.weekly} onChange={v=>setForm(f=>({...f,weekly:v}))} options={[...(dialog==="passEdit"&&!new Set(["2","3","unlimited"]).has(form.weekly)?[[form.weekly,`기존 이용권 · 주 ${form.weekly}회`]]:[]),["2","주 2회 (월 8회)"],["3","주 3회 (월 12회)"],["unlimited","무제한"]]}/></label><label className="form-field"><span>이용 기간</span><Select value={form.months} onChange={v=>setForm(f=>({...f,months:v,end:addPassDays(f.start,Number(v))}))} options={[...(dialog==="passEdit"&&!new Set(["1","2","3"]).has(form.months)?[[form.months,`기존 기간 · ${form.months}개월`]]:[]),["1","1개월"],["2","2개월"],["3","3개월"]]}/></label></div>{dialog==="passEdit"&&<label className="form-field"><span>종료일</span><input type="date" min={form.start} value={form.end} onClick={e=>{try{e.currentTarget.showPicker()}catch{e.currentTarget.focus()}}} onChange={e=>setForm(f=>({...f,end:e.target.value}))}/></label>}<p className="form-note">{dialog==="passEdit"?"종료일을 필요에 따라 변경할 수 있어요. ":"종료일은 시작일과 이용 기간에 따라 자동 계산됩니다. "}{form.weekly==="unlimited"?"무제한 이용권은 종료일까지 출석 횟수 제한 없이 이용할 수 있어요.":"총 이용 횟수는 주간 횟수 × 4주 × 이용 개월 수로 계산됩니다."}</p></>}</div>}
      {dialog==="schedule"&&<div className="modal-body"><div className="schedule-form"><div className="form-field schedule-days-field"><span>요일 <small>여러 개 선택 가능</small></span><div className="weekday-chips" role="group" aria-label="수업 요일">{weekdayOrder.map(index=><button type="button" key={weekdayNames[index]} className={`weekday-chip ${scheduleDays.includes(index)?"selected":""}`} aria-pressed={scheduleDays.includes(index)} onClick={()=>toggleScheduleDay(index)}>{weekdayNames[index]}</button>)}</div></div><div className="schedule-bottom-row"><div className="form-field"><span>수업 시간</span><div className="time-selects"><Select value={scheduleTime.slice(0,2)} onChange={hour=>setScheduleTime(current=>`${hour}:${current.slice(3)}`)} options={hourOptions}/><span>:</span><Select value={scheduleTime.slice(3,5)} onChange={minute=>setScheduleTime(current=>`${current.slice(0,2)}:${minute}`)} options={minuteOptions}/></div></div><button className="button primary add-schedule" onClick={addSchedule}><Icon name="plus"/>수업 추가</button></div></div><div className="schedule-list">{[0,1,2,3,4,5,6].map(day=>{const entries=store.schedules.filter(s=>s.day===day).sort((a,b)=>a.time.localeCompare(b.time));return entries.length?<div className="schedule-day" key={day}><strong>{weekdayNames[day]}요일</strong><div>{entries.map(s=><span className="schedule-chip" key={s.id}>{s.time}<button onClick={()=>removeSchedule(s.id)} aria-label={`${s.time} 삭제`}>×</button></span>)}</div></div>:null})}{!store.schedules.length&&<Empty compact title="등록된 수업 시간이 없어요"/>}</div></div>}
      {dialog==="help"&&<div className="modal-body help-content"><div><b>01</b><section><strong>회원과 이용권 등록</strong><p>새 회원 등록에서 이름, 연락처와 첫 이용권을 함께 등록할 수 있어요. 재등록은 회원 상세에서 이용권 추가를 선택해 주세요.</p></section></div><div><b>02</b><section><strong>출석 체크</strong><p>날짜와 수업 시간대를 선택한 뒤 회원 카드의 수업 시간을 눌러 체크하세요. 같은 날 여러 수업을 들어도 이용 횟수는 하루 한 번만 차감됩니다.</p></section></div><div><b>03</b><section><strong>수업 시간 관리</strong><p>출석 체크 화면에서 요일과 시간을 추가하거나 삭제할 수 있어요.</p></section></div></div>}
      {dialog==="notifications"&&<div className="modal-body"><div className="empty-state"><div className="empty-icon"><Icon name="bell"/></div><strong>새로운 알림이 없어요</strong><p>새 소식이 생기면 이곳에 알려드릴게요.</p></div></div>}
      <div className="modal-footer">{dialog!=="schedule"&&dialog!=="help"&&dialog!=="notifications"&&<><button className="button secondary" onClick={()=>setDialog(null)}>취소</button><button className="button primary" onClick={dialog==="member"?saveNew:dialog==="edit"?saveEdit:dialog==="passEdit"?savePassEdit:addPass}>{dialog==="member"?"등록하기":dialog==="edit"?"수정하기":dialog==="passEdit"?"수정하기":"이용권 등록"}</button></>}{(dialog==="help"||dialog==="notifications")&&<button className="button secondary full" onClick={()=>setDialog(null)}>닫기</button>}{dialog==="schedule"&&<button className="button secondary full" onClick={()=>setDialog(null)}>완료</button>}</div>
    </div></div>}
    {migrationOpen&&legacyStore&&<div className="scrim modal-scrim"><section className="modal migration-modal" role="dialog" aria-modal="true" aria-labelledby="migration-title"><div className="modal-heading"><div><span className="eyebrow">CHEONKWON</span><h2 id="migration-title">기존 데이터를 가져올까요?</h2></div></div><div className="modal-body"><p className="migration-copy">이 브라우저에서 회원 {legacyStore.members.length}명, 출석 {legacyStore.attendance.length}건, 수업 시간 {legacyStore.schedules.length}개를 찾았어요. 가져오면 Firebase Firestore에 저장되어 관리자 기기에서 공유됩니다. 현재 브라우저 데이터는 가져오기가 끝난 뒤에도 백업으로 남습니다.</p></div><div className="modal-footer migration-actions"><button className="button secondary" disabled={migrationBusy} onClick={()=>void startWithFirestore()}>Firestore에서 새로 시작</button><button className="button primary" disabled={migrationBusy} onClick={()=>void importExistingData()}>{migrationBusy?"처리 중…":"기존 데이터 가져오기"}</button></div></section></div>}
    {toast&&<div className="toast" role="status">{toast}</div>}
    {!loaded&&<div className="loading-overlay">도장 데이터를 불러오는 중이에요…</div>}
  </div>;
}

function Stat({icon,label,value,suffix,detail,tone=""}:{icon:string;label:string;value:string;suffix:string;detail:string;tone?:string}){return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon name={icon}/></div><div className="stat-label">{label}</div><div className="stat-value">{value}<span>{suffix}</span></div><div className="stat-detail">{detail}</div></div>}
function Table({children}:{children:React.ReactNode}){return <div className="table-scroll"><table><thead><tr><th>회원</th><th>이용권 조건</th><th>유효 기간</th><th>이용권 누적 출석</th><th>상태</th><th aria-label="상세"/></tr></thead><tbody>{children}</tbody></table></div>}
function Empty({title,action,onClick,compact=false}:{title:string;action?:string;onClick?:()=>void;compact?:boolean}){return <div className={`empty-state ${compact?"compact":""}`}><div className="empty-icon"><Icon name="users"/></div><strong>{title}</strong>{!compact&&<p>회원이 등록되면 이곳에서 현황을 확인할 수 있어요.</p>}{action&&<button className="button secondary" onClick={onClick}>{action}</button>}</div>}
function Select({value,onChange,options}:{value:string;onChange:(v:string)=>void;options:string[][]}){return <label className="select-wrap"><select value={value} onChange={e=>onChange(e.target.value)}>{options.map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>}
function AttendanceColumn({title,count,status,children}:{title:string;count:number;status:string;children:React.ReactNode}){return <section className={`panel attendance-column ${status}`}><div className="column-heading"><div><span className="status-dot"/><h3>{title}</h3><span className="column-count">{count}</span></div><button className="filter-mini"><Icon name="grid"/>필터</button></div><div className="attendance-list">{children}</div></section>}
function AttendanceCard({member,sessions,schedules,onToggle,pass,used}:{member:Member;sessions:string[];schedules:Schedule[];onToggle:(t:string)=>void;pass:Pass;used:number}){return <div className="attendance-card"><div className="attendee-top"><div className="person-cell"><div className="avatar">{member.name[0]}</div><div><strong>{member.name}</strong><small>{member.phone||"전화번호 미등록"}</small></div></div><button className="icon-button small" aria-label={`${member.name} 상세`}><Icon name="chevron"/></button></div><div className="session-chips">{schedules.map(s=>{const active=sessions.includes(s.time);return <button key={s.id} className={`session-chip ${active?"active":""}`} onClick={()=>onToggle(s.time)}>{s.time}{active&&<span>×</span>}</button>})}</div><div className="attendee-foot"><span>{weeklyLabel(pass)} 이용권</span><span>누적 <b>{attendanceSummary(pass,used)}</b></span></div></div>}
function MemberDetail({member,store,currentDate,onBack,onEdit,onAddPass,onEditPass,onAttendance}:{member:Member;store:Store;currentDate:string;onBack:()=>void;onEdit:()=>void;onAddPass:()=>void;onEditPass:(pass:Pass)=>void;onAttendance:()=>void}){const current=activePass(member,currentDate);const records=store.attendance.filter(a=>a.memberId===member.id).sort((a,b)=>b.date.localeCompare(a.date));const passStatus=(p:Pass)=>p.start>currentDate?"예정":passEndDate(p)<currentDate?"만료":(new Date(`${passEndDate(p)}T12:00:00+09:00`).getTime()-new Date(`${currentDate}T12:00:00+09:00`).getTime())/86400000<=7?"만료 임박":"이용 중";return <div className="detail-page"><button className="back-link" onClick={onBack}>← 회원 목록으로</button><section className="panel member-hero"><div className="hero-person"><div className="avatar large">{member.name[0]}</div><div><span className="badge blue">{statusFor(member,currentDate)}</span><h2>{member.name}</h2><p>{member.phone||"전화번호 미등록"}</p></div></div><div className="hero-actions"><button className="button secondary" onClick={onEdit}><Icon name="edit"/>회원 정보 수정</button><button className="button primary" onClick={onAddPass}><Icon name="plus"/>이용권 추가</button></div><div className="hero-meta"><div><span>전화번호</span><strong>{member.phone||"미등록"}</strong></div><div><span>생년월일</span><strong>{member.birthDate?moneylessDate(member.birthDate):"미등록"}</strong></div><div><span>이용권 수</span><strong>{member.passes.length}건</strong></div><div><span>누적 출석</span><strong>{records.length}회</strong></div><div><span>메모</span><strong>{member.memo||"메모 없음"}</strong></div></div></section><div className="detail-grid"><section className="panel current-pass"><div className="panel-heading"><div><h2>현재 이용권</h2><p>이용권 전체 기간의 출석 사용량</p></div><span className="pass-icon"><Icon name="shield"/></span></div>{current?<><div className="current-pass-main"><div><span className="pass-kicker">WEEKLY PASS</span><h3>{weeklyLabel(current)} <span>· {current.months}개월</span></h3></div><span className="badge blue">이용 중</span></div><div className="pass-dates"><div><span>시작일</span><strong>{moneylessDate(current.start)}</strong></div><div><span>종료일</span><strong>{moneylessDate(passEndDate(current))}</strong></div></div><div className="usage-bar"><div><span>이용권 누적 사용량</span><b>{attendanceSummary(current,passAttendance(store,current))}</b></div>{passAllowance(current)!==null&&<span className="bar"><i style={{width:`${usagePercent(current,passAttendance(store,current))}%`}}/></span>}</div></>:<Empty compact title="현재 유효한 이용권이 없어요" action="이용권 추가" onClick={onAddPass}/>}</section><section className="panel member-note"><div className="panel-heading"><div><h2>회원 메모</h2><p>도장 운영 참고 사항</p></div><button className="icon-button small" onClick={onEdit} aria-label="메모 수정"><Icon name="edit"/></button></div><p className="note-text">{member.memo||"등록된 메모가 없습니다."}</p><button className="text-link" onClick={onAttendance}>출석 체크 바로가기 <Icon name="arrow"/></button></section></div><section className="panel history-panel"><div className="panel-heading"><div><h2>이용권 등록 이력</h2><p>재등록한 이용권을 모두 확인할 수 있어요.</p></div><button className="button secondary" onClick={onAddPass}><Icon name="plus"/>이용권 추가</button></div><div className="table-scroll"><table><thead><tr><th>이용 기간</th><th>이용 조건</th><th>기간</th><th>출석 횟수</th><th>상태</th><th>수정</th></tr></thead><tbody>{member.passes.slice().sort((a,b)=>b.start.localeCompare(a.start)).map(p=><tr key={p.id}><td>{moneylessDate(p.start)} – {moneylessDate(passEndDate(p))}</td><td>{weeklyLabel(p)} / {passAllowance(p)===null?"기간 내 무제한":`총 ${passAllowance(p)}회`}</td><td>{p.months}개월</td><td>{store.attendance.filter(a=>a.passId===p.id).length}회</td><td><span className={`badge ${passStatus(p)==="이용 중"?"blue":"muted"}`}>{passStatus(p)}</span></td><td><button className="text-link" onClick={()=>onEditPass(p)}>수정</button></td></tr>)}</tbody></table></div></section><section className="panel history-panel"><div className="panel-heading"><div><h2>출석 이력</h2><p>날짜별 참여 수업과 사용한 이용권</p></div></div><div className="table-scroll"><table><thead><tr><th>날짜</th><th>참여 시간대</th><th>사용한 이용권</th><th>차감 횟수</th></tr></thead><tbody>{records.length?records.map(a=>{const p=member.passes.find(x=>x.id===a.passId);return <tr key={a.id}><td>{moneylessDate(a.date)}</td><td>{a.sessions.join(" · ")}</td><td>{p?`${weeklyLabel(p)} · ${p.months}개월`:"-"}</td><td>1회</td></tr>}):<tr><td colSpan={4} className="table-empty">출석 기록이 없습니다.</td></tr>}</tbody></table></div></section></div>}
