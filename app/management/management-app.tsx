"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
  createMember,
  createMembers,
  createPass,
  DEFAULT_SCHEDULES,
  deleteMemberData,
  deleteAttendanceForDate,
  hasLegacyData,
  importLegacyStore,
  initializeDojo,
  isDojoInitialized,
  newScheduleId,
  readLegacyStore,
  saveSchedulesForDate,
  schedulesForDate,
  startFreshDojo,
  toggleAttendance as toggleAttendanceRecord,
  updateMember,
  updatePass,
  updatePassHolds,
  watchDojoStore,
  type Attendance,
  type HoldPeriod,
  type Member,
  type Pass,
  type Schedule,
  type Store,
} from "@/lib/dojo-data";

type Dialog = "member" | "edit" | "pass" | "passEdit" | "schedule" | "memberImport" | "deleteMember" | "deleteHold" | "help" | "notifications" | null;
type MemberImportRow = { rowNumber: number; member: Member; errors: string[] };
type MemberImportPreview = { fileName: string; rows: MemberImportRow[] };

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
const endOfMonth = (yearMonth: string) => {
  const [year, month] = yearMonth.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 0));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
};
const defaultStore: Store = { members: [], attendance: [], schedules: DEFAULT_SCHEDULES };
const weekdayNames = ["일", "월", "화", "수", "목", "금", "토"];
const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
const hourOptions = Array.from({ length: 24 }, (_, hour) => { const value = String(hour).padStart(2, "0"); return [value, value]; });
const minuteOptions = ["00", "10", "20", "30", "40", "50"].map((value) => [value, value]);
const moneylessDate = (date: string) => date ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(`${date}T12:00:00+09:00`)) : "-";
const addPassDays = (date: string, months: number) => { const [year,month,day]=date.split("-").map(Number); const target=new Date(Date.UTC(year,month-1,day+months*30)); return `${target.getUTCFullYear()}-${String(target.getUTCMonth()+1).padStart(2,"0")}-${String(target.getUTCDate()).padStart(2,"0")}`; };
const passEndDate = (pass: Pass) => pass.end || addPassDays(pass.start, pass.months);
const passPending = (pass:Pass) => pass.activatedAt===null;
const addDateDays = (date:string,days:number) => { const [year,month,day]=date.split("-").map(Number); const target=new Date(Date.UTC(year,month-1,day+days)); return `${target.getUTCFullYear()}-${String(target.getUTCMonth()+1).padStart(2,"0")}-${String(target.getUTCDate()).padStart(2,"0")}`; };
const daysBetween = (start:string,end:string) => { const [startYear,startMonth,startDay]=start.split("-").map(Number); const [endYear,endMonth,endDay]=end.split("-").map(Number); return Math.round((Date.UTC(endYear,endMonth-1,endDay)-Date.UTC(startYear,startMonth-1,startDay))/86400000); };
const isPassOnHold = (pass:Pass,date:string) => (pass.holds??[]).some(hold=>hold.start<=date&&(!hold.end||hold.end>date));
const holdEndBounds = (holds:HoldPeriod[],hold:HoldPeriod) => { const ordered=holds.slice().sort((a,b)=>a.start.localeCompare(b.start)); const index=ordered.findIndex(item=>item.id===hold.id); return {min:ordered[index-1]?.end??hold.start,max:ordered[index+1]?.start??today()}; };
const holdStartBounds = (pass:Pass,holds:HoldPeriod[],hold:HoldPeriod) => { const ordered=holds.slice().sort((a,b)=>a.start.localeCompare(b.start)); const index=ordered.findIndex(item=>item.id===hold.id); const nextStart=ordered[index+1]?.start; const latest=hold.end??today(); return {min:ordered[index-1]?.end??pass.start,max:nextStart&&nextStart<latest?nextStart:latest}; };
const passAllowance = (pass: Pass) => pass.weekly === "unlimited" ? null : pass.weekly * 4 * pass.months;
const weeklyLabel = (pass: Pass) => pass.weekly === "unlimited" ? "무제한" : `주 ${pass.weekly}회`;
const attendanceSummary = (pass: Pass, used: number) => {
  const allowance = passAllowance(pass);
  return allowance === null ? `${used}회 · 무제한` : `${used} / ${allowance}회`;
};
const usagePercent = (pass: Pass, used: number) => { const allowance = passAllowance(pass); return allowance === null ? 0 : Math.min(100, used / allowance * 100); };
const weeklyValue = (value: string): Pass["weekly"] => value === "unlimited" ? "unlimited" : Number(value);
const id = () => Math.random().toString(36).slice(2, 10);
const phoneDigits = (phone: string) => phone.replace(/\D/g, "");
const normalizeImportedPhone = (value: unknown) => {
  const source = String(value ?? "").trim();
  let digits = phoneDigits(source);
  if (digits.length === 10 && !digits.startsWith("0")) digits = `0${digits}`;
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10 && digits.startsWith("02")) return `02-${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return source;
};
const activePass = (m: Member, date: string) => m.passes.filter(p => !passPending(p) && p.start <= date && passEndDate(p) >= date && !isPassOnHold(p,date)).sort((a,b) => b.start.localeCompare(a.start))[0];
const attendancePass = (m:Member,date:string) => m.passes.filter(p => (passPending(p)?p.start<=date:p.start<=date&&passEndDate(p)>=date) && !isPassOnHold(p,date)).sort((a,b) => b.start.localeCompare(a.start))[0];
const pausedPass = (m: Member, date: string) => m.passes.filter(p => p.start <= date && isPassOnHold(p,date)).sort((a,b) => b.start.localeCompare(a.start))[0];
const firstAttendancePendingPass = (m:Member,date:string) => m.passes.filter(p=>passPending(p)&&p.start<=date).sort((a,b)=>b.start.localeCompare(a.start))[0];
const displayPass = (m: Member, date: string) => activePass(m,date) ?? pausedPass(m,date) ?? firstAttendancePendingPass(m,date);
const passAttendance = (store: Store, pass: Pass) => store.attendance.filter(a => a.passId === pass.id).length;
const statusFor = (m: Member, date: string) => { const p=activePass(m,date); if(p) return "이용 중"; if(m.passes.some(item=>item.start<=date&&isPassOnHold(item,date)))return "휴회"; if(firstAttendancePendingPass(m,date))return "첫 출석 전"; return m.passes.length ? "만료" : "미등록"; };
const fmtPhone = (a:string,b:string,c:string) => [a,b,c].filter(Boolean).join("-");
const getDay = (date:string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const firestoreErrorMessage = (error: unknown, action: string) => {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return code === "permission-denied"
    ? "Firestore 접근이 거부됐어요. Firebase Console에 firestore.rules를 게시했는지 확인해 주세요."
    : `${action} 실패했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.`;
};

function Icon({ name }: { name: string }) {
  const paths: Record<string,string> = { grid:"M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z", users:"M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 8v6 M23 11h-6", check:"M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11", calendar:"M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2z", search:"M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z M21 21l-4.35-4.35", bell:"M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4", arrow:"M5 12h14 M12 5l7 7-7 7", plus:"M12 5v14 M5 12h14", close:"M18 6 6 18 M6 6l12 12", logout:"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9", download:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3", upload:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12", clock:"M12 8v4l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0", edit:"M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z", trash:"M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6 M10 11v5 M14 11v5", chevron:"m9 18 6-6-6-6", help:"M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3 M12 17h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0", shield:"M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.grid}/></svg>;
}

export default function ManagementApp() {
  const router=useRouter();
  const pathname=usePathname();
  const segments=useMemo(()=>pathname.split("/").slice(2).filter(Boolean).map(segment=>{
    try{return decodeURIComponent(segment)}catch{return segment}
  }),[pathname]);
  const section=segments[0];
  const view: "dashboard"|"members"|"attendance"|"detail" = !section?"dashboard":section==="members"?(segments[1]?"detail":"members"):section==="attendance"?"attendance":"dashboard";
  const selected=view==="detail"?segments[1]??null:null;
  const [user,setUser]=useState<User|null>(()=>DEMO_MODE?null:auth.currentUser);
  const [authReady,setAuthReady]=useState(()=>DEMO_MODE||auth.currentUser!==null);
  const [authPending,setAuthPending]=useState(false);
  const [authError,setAuthError]=useState("");
  const [store,setStore]=useState<Store>(defaultStore);
  const [loaded,setLoaded]=useState(false);
  const [editingPassId,setEditingPassId]=useState<string|null>(null);
  const [dialog,setDialog]=useState<Dialog>(null);
  const [search,setSearch]=useState("");
  const [filter,setFilter]=useState("전체 회원");
  const [currentDate,setCurrentDate]=useState("2026-10-18");
  const [expiryMonth,setExpiryMonth]=useState(()=>today().slice(0,7));
  const [attendanceDate,setAttendanceDate]=useState("2026-10-18");
  const [timeFilter,setTimeFilter]=useState("전체");
  const [nameFilter,setNameFilter]=useState("");
  const [mobileMenu,setMobileMenu]=useState(false);
  const [form,setForm]=useState({name:"",phone1:"",phone2:"",phone3:"",memo:"",birthDate:"",start:"2026-10-18",end:"2027-01-18",weekly:"3",months:"3"});
  const [scheduleDays,setScheduleDays]=useState<number[]>([1]);
  const [scheduleTime,setScheduleTime]=useState("19:00");
  const [scheduleEffectiveDate,setScheduleEffectiveDate]=useState("");
  const [scheduleDraft,setScheduleDraft]=useState<Schedule[]>([]);
  const [scheduleDraftTouched,setScheduleDraftTouched]=useState(false);
  const [scheduleSaving,setScheduleSaving]=useState(false);
  const [toast,setToast]=useState("");
  const [backupBusy,setBackupBusy]=useState(false);
  const [loadError,setLoadError]=useState("");
  const [legacyStore,setLegacyStore]=useState<Store|null>(null);
  const [migrationBusy,setMigrationBusy]=useState(false);
  const [migrationOpen,setMigrationOpen]=useState(false);
  const migrationChecked=useRef(false);
  const [profileMenuOpen,setProfileMenuOpen]=useState(false);
  const profileMenuRef=useRef<HTMLDivElement|null>(null);
  const memberImportInputRef=useRef<HTMLInputElement|null>(null);
  const [memberImportPreview,setMemberImportPreview]=useState<MemberImportPreview|null>(null);
  const [memberImportBusy,setMemberImportBusy]=useState(false);
  const [deletingMemberId,setDeletingMemberId]=useState<string|null>(null);
  const [memberToDelete,setMemberToDelete]=useState<Member|null>(null);
  const [deleteConfirmation,setDeleteConfirmation]=useState("");
  const [holdBusyPassId,setHoldBusyPassId]=useState<string|null>(null);
  const [holdToDelete,setHoldToDelete]=useState<{pass:Pass;hold:HoldPeriod}|null>(null);

  useEffect(()=>{
    if(DEMO_MODE){setAuthReady(true);return}
    return onAuthStateChanged(auth,(currentUser)=>{if(currentUser&&!isAdminEmail(currentUser.email)){setUser(null);setAuthError("관리자로 등록된 Google 계정만 이용할 수 있어요.");void signOut(auth).catch(()=>{})}else{setUser(currentUser);if(currentUser)setAuthError("")}setAuthReady(true)});
  },[]);
  useEffect(()=>{ const date=today(); setCurrentDate(date); setAttendanceDate(date); setScheduleEffectiveDate(date); setForm(f=>({...f,start:date,end:addPassDays(date,Number(f.months))})); },[]);
  useEffect(()=>{if((section!==undefined&&section!=="members"&&section!=="attendance")||(section==="members"&&segments.length>2)||(section==="attendance"&&segments.length>1))router.replace("/management")},[router,section,segments]);
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
  useEffect(()=>{ const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape"){if((dialog==="schedule"&&scheduleSaving)||(dialog==="memberImport"&&memberImportBusy))return;if(dialog==="memberImport")cancelMemberImport();else setDialog(null);setProfileMenuOpen(false)}}; window.addEventListener("keydown",onKey); return ()=>window.removeEventListener("keydown",onKey); },[dialog,scheduleSaving,memberImportBusy]);
  useEffect(()=>{
    if(!profileMenuOpen)return;
    const onPointerDown=(event:PointerEvent)=>{if(profileMenuRef.current&&!profileMenuRef.current.contains(event.target as Node))setProfileMenuOpen(false)};
    document.addEventListener("pointerdown",onPointerDown);
    return()=>document.removeEventListener("pointerdown",onPointerDown);
  },[profileMenuOpen]);

  const selectedMember=store.members.find(m=>m.id===selected) || null;
  const editingPendingPass=selectedMember?.passes.find(pass=>pass.id===editingPassId)?.activatedAt===null;
  const canDeleteMember=deleteConfirmation==="delete"&&!deletingMemberId;
  const sorted=useMemo(()=>store.members.slice().sort((a,b)=>a.name.localeCompare(b.name,"ko")),[store.members]);
  const dateDay=getDay(attendanceDate);
  const schedules=useMemo(()=>schedulesForDate(store.schedules,attendanceDate).filter(s=>s.day===dateDay),[store.schedules,attendanceDate,dateDay]);
  const filteredMembers=sorted.filter(m=>{
    const matches=`${m.name} ${m.phone}`.includes(search.trim());
    const state=statusFor(m,currentDate);
    return matches && (filter==="전체 회원" || (filter==="이용 중"&&state==="이용 중") || (filter==="첫 출석 전"&&state==="첫 출석 전") || (filter==="만료"&&state==="만료") || (filter==="휴회"&&state==="휴회"));
  });
  const attendancePool=sorted.filter(member=>statusFor(member,attendanceDate)!=="휴회"&&Boolean(attendancePass(member,attendanceDate)));
  const selectedSessions=(m:Member)=>store.attendance.find(a=>a.memberId===m.id&&a.date===attendanceDate)?.sessions||[];
  const attendanceMembers=attendancePool.filter(m=>!nameFilter||m.name.includes(nameFilter));
  const attended=attendanceMembers.filter(m=>timeFilter==="전체"?selectedSessions(m).length>0:selectedSessions(m).includes(timeFilter));
  const absent=attendanceMembers.filter(m=>timeFilter==="전체"?selectedSessions(m).length===0:!selectedSessions(m).includes(timeFilter));
  const todayRecords=store.attendance.filter(a=>a.date===currentDate);
  const expiryStart=expiryMonth===currentDate.slice(0,7)?currentDate:`${expiryMonth}-01`;
  const expiryMonthEnd=endOfMonth(expiryMonth);
  const expiring=store.members.flatMap(member=>{
    const pass=member.passes.filter(item=>!passPending(item)&&passEndDate(item)>=expiryStart&&passEndDate(item)<=expiryMonthEnd&&!isPassOnHold(item,currentDate)).sort((a,b)=>passEndDate(a).localeCompare(passEndDate(b)))[0];
    return pass?[{member,pass}]:[];
  }).sort((a,b)=>passEndDate(a.pass).localeCompare(passEndDate(b.pass))||a.member.name.localeCompare(b.member.name,"ko"));
  const expiringToday=store.members.flatMap(member=>{
    const pass=member.passes.filter(item=>!passPending(item)&&passEndDate(item)===currentDate&&!isPassOnHold(item,currentDate)).sort((a,b)=>passEndDate(a).localeCompare(passEndDate(b)))[0];
    return pass?[{member,pass}]:[];
  });
  const monthCount=store.attendance.filter(a=>a.date.slice(0,7)===currentDate.slice(0,7)).length;
  const activeCount=store.members.filter(m=>!!activePass(m,currentDate)).length;
  const go=(v:typeof view)=>{router.push(v==="dashboard"?"/management":v==="members"?"/management/members":v==="attendance"?"/management/attendance":selected?`/management/members/${encodeURIComponent(selected)}`:"/management/members");setMobileMenu(false)};
  const showMember=(m:Member)=>{router.push(`/management/members/${encodeURIComponent(m.id)}`);setMobileMenu(false)};
  const resetForm=()=>setForm({name:"",phone1:"",phone2:"",phone3:"",memo:"",birthDate:"",start:currentDate,end:addPassDays(currentDate,3),weekly:"3",months:"3"});
  const openNew=()=>{resetForm();setDialog("member")};
  const saveNew=()=>{if(!form.name.trim()){setToast("회원 이름을 입력해 주세요.");return}if(form.end<form.start){setToast("종료일은 시작일 이후로 지정해 주세요.");return}const member:Member={id:id(),name:form.name.trim(),phone:fmtPhone(form.phone1,form.phone2,form.phone3),birthDate:form.birthDate,memo:form.memo.trim(),created:currentDate,passes:[{id:id(),start:form.start,end:form.end,months:Number(form.months),weekly:weeklyValue(form.weekly),activatedAt:null}]};void createMember(member).then(()=>{setDialog(null);setToast("새 회원을 등록했어요.")}).catch(error=>setToast(firestoreErrorMessage(error,"회원 등록")))};
  const downloadMemberTemplate=async()=>{try{const XLSX=await import("xlsx");const workbook=XLSX.utils.book_new();const headers=["이름","연락처","생년월일","메모","이용권 종류","이용 기간(개월)","출석 가능 시작일","첫 출석일","휴회 시작일","휴회 종료일"];const sheet=XLSX.utils.aoa_to_sheet([headers]);sheet["!cols"]=[{wch:16},{wch:18},{wch:14},{wch:30},{wch:20},{wch:16},{wch:18},{wch:14},{wch:14},{wch:14}];for(let row=2;row<=101;row++){sheet[`B${row}`]={t:"s",v:"",z:"@"};["C","G","H","I","J"].forEach(column=>{sheet[`${column}${row}`]={t:"s",v:"",z:"yyyy-mm-dd"}})}sheet["!ref"]="A1:J101";XLSX.utils.book_append_sheet(workbook,sheet,"회원정보");const instructions=XLSX.utils.aoa_to_sheet([["항목","입력 방법"],["이름","필수 입력"],["연락처","선택 입력. 앞자리 0이 유지되도록 텍스트 형식으로 설정했습니다."],["생년월일","선택 입력. YYYY-MM-DD 형식"],["메모","선택 입력"],["이용권 종류","선택 입력. 주 2회, 주 3회, 무제한 중 하나"],["이용 기간(개월)","이용권을 넣을 때 필수 입력. 1, 2, 3 중 하나"],["출석 가능 시작일","이용권을 넣을 때 필수 입력. 첫 출석 전 회원은 이 날짜부터 출석 목록에 표시됩니다."],["첫 출석일","비워 두면 첫 출석 전 상태로 등록됩니다. 입력하면 그 날부터 이용권이 시작됩니다."],["휴회 시작일 / 종료일","선택 입력. 첫 출석일이 있는 이용권에만 입력할 수 있으며, 종료일을 비우면 휴회 중으로 등록됩니다."]]);instructions["!cols"]=[{wch:20},{wch:86}];XLSX.utils.book_append_sheet(workbook,instructions,"작성 안내");XLSX.writeFileXLSX(workbook,"천권태권도-회원·이용권등록-양식.xlsx");}catch{setToast("회원 등록 양식을 만들지 못했어요. 다시 시도해 주세요.")}};
  const handleMemberWorkbook=async(event:React.ChangeEvent<HTMLInputElement>)=>{const file=event.target.files?.[0];event.target.value="";if(!file)return;try{const XLSX=await import("xlsx");const workbook=XLSX.read(await file.arrayBuffer(),{type:"array"});const firstSheet=workbook.Sheets[workbook.SheetNames[0]];if(!firstSheet){setToast("엑셀 파일에 회원정보 시트가 없어요.");return}const table=XLSX.utils.sheet_to_json<unknown[]>(firstSheet,{header:1,raw:true,defval:"",blankrows:false});if(table.length<2){setToast("엑셀 파일에 등록할 회원 행이 없어요.");return}const headers=table[0].map(value=>String(value??"").replace(/^\uFEFF/,"").trim().replace(/\s/g,""));const column=(...names:string[])=>names.map(name=>headers.indexOf(name)).find(index=>index>=0)??-1;const nameColumn=column("이름","이름(필수)");if(nameColumn<0){setToast("첫 번째 시트에 ‘이름’ 열이 있는지 확인해 주세요.");return}const phoneColumn=column("연락처","전화번호");const birthDateColumn=column("생년월일");const memoColumn=column("메모");const passTypeColumn=column("이용권종류","이용권");const passMonthsColumn=column("이용기간(개월)","이용개월");const passStartColumn=column("출석가능시작일","이용권시작일");const activatedColumn=column("첫출석일");const holdStartColumn=column("휴회시작일");const holdEndColumn=column("휴회종료일","재개일");const valueAt=(row:unknown[],index:number)=>index<0?"":row[index];const textAt=(row:unknown[],index:number)=>String(valueAt(row,index)??"").trim();const parseDate=(value:unknown):string|null=>{if(value===""||value===null||value===undefined)return "";let year:number,month:number,day:number;if(typeof value==="number"){const parsed=XLSX.SSF.parse_date_code(value);if(!parsed)return null;year=parsed.y;month=parsed.m;day=parsed.d}else{const match=String(value).trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);if(!match)return null;year=Number(match[1]);month=Number(match[2]);day=Number(match[3])}const date=new Date(Date.UTC(year,month-1,day));if(date.getUTCFullYear()!==year||date.getUTCMonth()+1!==month||date.getUTCDate()!==day)return null;return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`};const parseWeekly=(value:string):Pass["weekly"]|null=>{const normalized=value.replace(/\s/g,"");if(["2","주2회","주2회(월8회)"].includes(normalized))return 2;if(["3","주3회","주3회(월12회)"].includes(normalized))return 3;if(normalized==="무제한")return "unlimited";return null};const existingPhones=new Set(store.members.map(member=>phoneDigits(member.phone)).filter(Boolean));const seenPhones=new Set<string>();const rows:MemberImportRow[]=[];table.slice(1).forEach((row,index)=>{const name=textAt(row,nameColumn);const rawPhone=valueAt(row,phoneColumn);const phone=normalizeImportedPhone(rawPhone);const rawBirthDate=valueAt(row,birthDateColumn);const birthDate=parseDate(rawBirthDate);const memo=textAt(row,memoColumn);const passType=textAt(row,passTypeColumn);const passMonths=textAt(row,passMonthsColumn);const rawPassStart=valueAt(row,passStartColumn);const rawActivated=valueAt(row,activatedColumn);const rawHoldStart=valueAt(row,holdStartColumn);const rawHoldEnd=valueAt(row,holdEndColumn);const hasPass=[passType,passMonths,rawPassStart,rawActivated,rawHoldStart,rawHoldEnd].some(value=>String(value??"").trim()!=="");if(!name&&!phone&&!rawBirthDate&&!memo&&!hasPass)return;const errors:string[]=[];if(!name)errors.push("이름을 입력해 주세요.");if(rawBirthDate!==""&&birthDate===null)errors.push("생년월일을 YYYY-MM-DD 날짜로 입력해 주세요.");const digits=phoneDigits(phone);if(digits&&existingPhones.has(digits))errors.push("이미 등록된 연락처입니다.");if(digits&&seenPhones.has(digits))errors.push("파일 안에서 연락처가 중복됩니다.");if(digits)seenPhones.add(digits);const passes:Pass[]=[];if(hasPass){const weekly=parseWeekly(passType);const months=Number(passMonths);const availableStart=parseDate(rawPassStart);const activatedAt=parseDate(rawActivated);const holdStart=parseDate(rawHoldStart);const holdEnd=parseDate(rawHoldEnd);if(!weekly)errors.push("이용권 종류는 주 2회, 주 3회, 무제한 중 하나로 입력해 주세요.");if(![1,2,3].includes(months))errors.push("이용 기간은 1, 2, 3개월 중 하나로 입력해 주세요.");if(!availableStart)errors.push("출석 가능 시작일을 YYYY-MM-DD로 입력해 주세요.");if(rawActivated!==""&&activatedAt===null)errors.push("첫 출석일을 YYYY-MM-DD로 입력해 주세요.");if(rawHoldStart!==""&&holdStart===null)errors.push("휴회 시작일을 YYYY-MM-DD로 입력해 주세요.");if(rawHoldEnd!==""&&holdEnd===null)errors.push("휴회 종료일을 YYYY-MM-DD로 입력해 주세요.");if(availableStart&&activatedAt&&activatedAt<availableStart)errors.push("첫 출석일은 출석 가능 시작일 이후여야 합니다.");if(holdStart&&!activatedAt)errors.push("휴회는 첫 출석일이 있는 이용권에만 등록할 수 있어요.");if(holdEnd&&!holdStart)errors.push("휴회 종료일을 입력하려면 휴회 시작일도 필요해요.");if(holdStart&&activatedAt&&holdStart<activatedAt)errors.push("휴회 시작일은 첫 출석일 이후여야 합니다.");if(holdStart&&holdEnd&&holdEnd<=holdStart)errors.push("휴회 종료일은 휴회 시작일 이후여야 합니다.");if(!errors.length&&weekly&&availableStart){const start=activatedAt||availableStart;const holds=holdStart?[{id:id(),start:holdStart,...(holdEnd?{end:holdEnd}:{})}]:undefined;const baseEnd=addPassDays(start,months);const end=holdStart&&holdEnd?addDateDays(baseEnd,daysBetween(holdStart,holdEnd)):baseEnd;passes.push({id:id(),start,end,months,weekly,activatedAt:activatedAt||null,...(holds?{holds}:{})})}}rows.push({rowNumber:index+2,member:{id:id(),name,phone,birthDate:birthDate||"",memo,created:currentDate,passes},errors})});if(rows.length===0){setToast("엑셀 파일에 등록할 회원 행이 없어요.");return}setMemberImportPreview({fileName:file.name,rows});setDialog("memberImport")}catch{setToast("엑셀 파일을 읽지 못했어요. 회원 등록 양식을 사용해 주세요.")}};
  const cancelMemberImport=()=>{if(memberImportBusy)return;setDialog(null);setMemberImportPreview(null)};
  const saveMemberImport=async()=>{if(!memberImportPreview||memberImportBusy)return;if(memberImportPreview.rows.some(row=>row.errors.length)||memberImportPreview.rows.length===0){setToast("엑셀의 오류를 수정한 뒤 다시 불러와 주세요.");return}setMemberImportBusy(true);try{await createMembers(memberImportPreview.rows.map(row=>row.member));setDialog(null);setToast(`${memberImportPreview.rows.length}명의 회원을 등록했어요.`);setMemberImportPreview(null)}catch(error){setToast(firestoreErrorMessage(error,"엑셀 회원 등록"))}finally{setMemberImportBusy(false)}};
  const openMemberDelete=(member:Member|null|undefined=selectedMember)=>{if(!member)return;setMemberToDelete(member);setDeleteConfirmation("");setDialog("deleteMember")};
  const deleteMemberFromAdmin=async()=>{if(!memberToDelete||deletingMemberId||deleteConfirmation!=="delete")return;const member=memberToDelete;setDeletingMemberId(member.id);try{const deleted=await deleteMemberData(member.id);setDialog(null);setMemberToDelete(null);if(selected===member.id)router.replace("/management/members");setToast(`${member.name} 회원을 삭제했어요. 이용권 ${deleted.passes}건, 출석 ${deleted.attendance}건이 삭제됐습니다.`)}catch(error){setToast(firestoreErrorMessage(error,"회원 삭제"))}finally{setDeletingMemberId(null)}};
  const togglePassHold=async(pass:Pass)=>{if(holdBusyPassId)return;if(passPending(pass)){setToast("첫 출석 후에 휴회를 설정할 수 있어요.");return}const now=today();const holds=pass.holds??[];const openHold=holds.find(hold=>!hold.end);let nextHolds:HoldPeriod[];let nextEnd=passEndDate(pass);if(openHold){if(now<openHold.start){setToast("휴회 시작일이 오늘 이후라 종료할 수 없어요.");return}const pausedDays=daysBetween(openHold.start,now);nextEnd=addDateDays(nextEnd,pausedDays);nextHolds=holds.map(hold=>hold.id===openHold.id?{...hold,end:now}:hold)}else{if(pass.start>now||passEndDate(pass)<now){setToast("현재 이용 중인 이용권만 휴회할 수 있어요.");return}nextHolds=[...holds,{id:id(),start:now}]}setHoldBusyPassId(pass.id);try{await updatePassHolds(pass.id,nextEnd,nextHolds);setToast(openHold?`휴회가 종료됐어요. 종료일을 ${moneylessDate(nextEnd)}까지 연장했어요.`:"휴회를 시작했어요.")}catch(error){setToast(firestoreErrorMessage(error,"이용권 휴회 변경"))}finally{setHoldBusyPassId(null)}};
  const updateHoldEnd=async(pass:Pass,hold:HoldPeriod,newEnd:string)=>{if(holdBusyPassId)return;const holds=pass.holds??[];const bounds=holdEndBounds(holds,hold);if(!newEnd||newEnd<bounds.min||newEnd>bounds.max){setToast("휴회 재개일은 이전·다음 휴회와 겹치지 않도록 선택해 주세요.");return}if(!hold.end||hold.end===newEnd)return;const oldDays=daysBetween(hold.start,hold.end);const newDays=daysBetween(hold.start,newEnd);const nextEnd=addDateDays(passEndDate(pass),newDays-oldDays);if(nextEnd<pass.start){setToast("휴회 기간을 줄이면 종료일이 이용권 시작일보다 앞서게 돼요.");return}const nextHolds=holds.map(item=>item.id===hold.id?{...item,end:newEnd}:item);setHoldBusyPassId(pass.id);try{await updatePassHolds(pass.id,nextEnd,nextHolds);setToast(`휴회 기간을 수정했어요. 이용권 종료일은 ${moneylessDate(nextEnd)}입니다.`)}catch(error){setToast(firestoreErrorMessage(error,"휴회 기간 수정"))}finally{setHoldBusyPassId(null)}};
  const updateHoldStart=async(pass:Pass,hold:HoldPeriod,newStart:string)=>{if(holdBusyPassId)return;const holds=pass.holds??[];const bounds=holdStartBounds(pass,holds,hold);if(!newStart||newStart<bounds.min||newStart>bounds.max){setToast("휴회 시작일은 이용권 기간 안에서 다른 휴회와 겹치지 않게 선택해 주세요.");return}if(newStart===hold.start)return;let nextEnd=passEndDate(pass);if(hold.end){const oldDays=daysBetween(hold.start,hold.end);const newDays=daysBetween(newStart,hold.end);nextEnd=addDateDays(nextEnd,newDays-oldDays);if(nextEnd<pass.start){setToast("휴회 기간을 줄이면 종료일이 이용권 시작일보다 앞서게 돼요.");return}}const nextHolds=holds.map(item=>item.id===hold.id?{...item,start:newStart}:item);setHoldBusyPassId(pass.id);try{await updatePassHolds(pass.id,nextEnd,nextHolds);setToast(hold.end?`휴회 시작일을 수정했어요. 이용권 종료일은 ${moneylessDate(nextEnd)}입니다.`:"휴회 시작일을 수정했어요.")}catch(error){setToast(firestoreErrorMessage(error,"휴회 시작일 수정"))}finally{setHoldBusyPassId(null)}};
  const openHoldDelete=(pass:Pass,hold:HoldPeriod)=>{setHoldToDelete({pass,hold});setDialog("deleteHold")};
  const deleteHold=async()=>{if(!holdToDelete||holdBusyPassId)return;const {pass,hold}=holdToDelete;const holdDays=hold.end?daysBetween(hold.start,hold.end):0;const nextEnd=addDateDays(passEndDate(pass),-holdDays);if(nextEnd<pass.start){setToast("휴회 이력을 삭제하면 종료일이 이용권 시작일보다 앞서게 돼요.");return}setHoldBusyPassId(pass.id);try{await updatePassHolds(pass.id,nextEnd,(pass.holds??[]).filter(item=>item.id!==hold.id));setDialog(null);setHoldToDelete(null);setToast(holdDays?`휴회 이력을 삭제했어요. 종료일은 ${moneylessDate(nextEnd)}입니다.`:"휴회 이력을 삭제했어요.")}catch(error){setToast(firestoreErrorMessage(error,"휴회 이력 삭제"))}finally{setHoldBusyPassId(null)}};
  const openEdit=(m:Member)=>{const parts=m.phone.split("-");setForm({...form,name:m.name,phone1:parts[0]||"",phone2:parts[1]||"",phone3:parts[2]||"",birthDate:m.birthDate||"",memo:m.memo});setDialog("edit")};
  const saveEdit=()=>{if(!selectedMember)return;if(!form.name.trim()){setToast("회원 이름을 입력해 주세요.");return}void updateMember({id:selectedMember.id,name:form.name.trim(),phone:fmtPhone(form.phone1,form.phone2,form.phone3),birthDate:form.birthDate,memo:form.memo.trim()}).then(()=>{setDialog(null);setToast("회원 정보를 수정했어요.")}).catch(error=>setToast(firestoreErrorMessage(error,"회원 정보 수정")))};
  const addPass=()=>{if(!selectedMember)return;if(form.end<form.start){setToast("종료일은 시작일 이후로 지정해 주세요.");return}const p:Pass={id:id(),start:form.start,end:form.end,months:Number(form.months),weekly:weeklyValue(form.weekly),activatedAt:null};void createPass(selectedMember.id,p).then(()=>{setDialog(null);setToast("새 이용권을 등록했어요.")}).catch(error=>setToast(firestoreErrorMessage(error,"이용권 등록")))};
  const openPassEdit=(pass:Pass)=>{setEditingPassId(pass.id);setForm(f=>({...f,start:pass.start,end:passEndDate(pass),weekly:String(pass.weekly),months:String(pass.months)}));setDialog("passEdit")};
  const savePassEdit=()=>{if(!selectedMember||!editingPassId)return;if(form.end<form.start){setToast("종료일은 시작일 이후로 지정해 주세요.");return}void updatePass({id:editingPassId,start:form.start,end:form.end,weekly:weeklyValue(form.weekly),months:Number(form.months)}).then(()=>{setDialog(null);setToast("이용권 정보를 수정했어요.")}).catch(error=>setToast(firestoreErrorMessage(error,"이용권 수정")))};
  const attendanceToggle=(m:Member,time:string)=>{const pass=attendancePass(m,attendanceDate);if(!pass)return;const used=passAttendance(store,pass);const allowance=passAllowance(pass);const existing=store.attendance.find(a=>a.memberId===m.id&&a.date===attendanceDate);if(allowance!==null&&!existing&&used>=allowance){setToast(`${m.name} 회원은 이용권의 전체 출석 횟수를 모두 사용했어요.`);return}const firstCheckIn=passPending(pass);void toggleAttendanceRecord({memberId:m.id,date:attendanceDate,passId:pass.id,activatePass:firstCheckIn},time).then(()=>{if(firstCheckIn)setToast(`${moneylessDate(attendanceDate)}을(를) 이용권 첫 출석일로 기록했어요.`)}).catch(error=>setToast(firestoreErrorMessage(error,"출석 저장")))};
  const cancelDay=()=>{const count=store.attendance.filter(a=>a.date===attendanceDate).length;if(!count)return;if(!window.confirm(`${attendanceDate}의 출석 ${count}건을 모두 취소할까요?`))return;void deleteAttendanceForDate(attendanceDate).then(()=>setToast("선택한 날짜의 출석을 모두 취소했어요.")).catch(error=>setToast(firestoreErrorMessage(error,"출석 취소")))};
  const toggleScheduleDay=(day:number)=>setScheduleDays(days=>days.includes(day)?days.filter(value=>value!==day):[...days,day].sort((a,b)=>a-b));
  const openSchedule=()=>{const effectiveDate=today();setScheduleEffectiveDate(effectiveDate);setScheduleDraft(schedulesForDate(store.schedules,effectiveDate));setScheduleDraftTouched(false);setDialog("schedule")};
  const changeScheduleEffectiveDate=(effectiveDate:string)=>{setScheduleEffectiveDate(effectiveDate);setScheduleDraft(schedulesForDate(store.schedules,effectiveDate))};
  const addSchedule=()=>{if(scheduleSaving)return;if(!scheduleEffectiveDate){setToast("시간표 변경 적용일을 선택해 주세요.");return}if(scheduleDays.length===0){setToast("수업 요일을 하나 이상 선택해 주세요.");return}const existing=new Set(scheduleDraft.map(schedule=>`${schedule.day}-${schedule.time}`));const newSchedules=scheduleDays.filter(day=>!existing.has(`${day}-${scheduleTime}`)).map(day=>({id:`draft-${newScheduleId(day,scheduleTime)}`,day,time:scheduleTime,effectiveFrom:scheduleEffectiveDate}));if(newSchedules.length===0){setToast("선택한 요일에 같은 시간 수업이 이미 등록돼 있어요.");return}setScheduleDraft(current=>[...current,...newSchedules]);setScheduleDraftTouched(true)};
  const removeSchedule=(schedule:Schedule)=>{if(scheduleSaving)return;setScheduleDraft(current=>current.filter(item=>item.id!==schedule.id));setScheduleDraftTouched(true)};
  const saveScheduleDraft=async()=>{if(scheduleSaving)return;if(!scheduleEffectiveDate){setToast("시간표 변경 적용일을 선택해 주세요.");return}setScheduleSaving(true);try{const currentSchedules=schedulesForDate(store.schedules,scheduleEffectiveDate);await saveSchedulesForDate(currentSchedules,scheduleDraft,scheduleEffectiveDate);setDialog(null);setToast(scheduleDraftTouched?"수업 시간 변경을 저장했어요.":"변경 사항이 없어요.")}catch(error){setToast(firestoreErrorMessage(error,"수업 시간 저장"))}finally{setScheduleSaving(false)}};
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
        pass.months,pass.start,passPending(pass)?"첫 출석 후 계산":passEndDate(pass),passAllowance(pass)??"무제한",passAttendance(store,pass),passPending(pass)?"첫 출석 전":pass.activatedAt??"기존 이용권",
        (pass.holds??[]).map(hold=>`${hold.start}~${hold.end||"재개 전"}`).join(" / "),
      ]));
      const attendance=store.attendance.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(record=>[
        record.date,memberNames.get(record.memberId)||"(회원 정보 없음)",record.memberId,
        record.sessions.slice().sort().join(", "),record.passId,
      ]);
      const schedules=store.schedules.slice().sort((a,b)=>a.day-b.day||a.time.localeCompare(b.time)||(a.effectiveFrom??"").localeCompare(b.effectiveFrom??"")).map(schedule=>[
        `${weekdayNames[schedule.day]}요일`,schedule.time,schedule.effectiveFrom||"기존 시간표부터",schedule.effectiveTo||"현재 적용 중",
      ]);
      addSheet("회원",["회원 ID","이름","연락처","생년월일","메모","등록일"],members,[22,16,18,14,32,14]);
      addSheet("이용권",["이용권 ID","회원 이름","회원 ID","이용권 종류","주간 횟수","기간(개월)","시작일","종료일","총 허용 출석","누적 출석","첫 출석일","휴회 이력"],passes,[22,16,22,18,14,12,14,14,16,14,14,34]);
      addSheet("출석",["날짜","회원 이름","회원 ID","수업 시간","이용권 ID"],attendance,[14,16,22,24,22]);
      addSheet("수업시간",["요일","수업 시간","적용 시작일","적용 종료일"],schedules,[14,14,20,20]);
      XLSX.writeFileXLSX(workbook,`cheonkwon-backup-${today()}.xlsx`,{compression:true});
      setToast("회원·이용권·출석·수업시간 엑셀 백업을 저장했어요.");
    }catch{
      setToast("엑셀 백업 파일을 만들지 못했어요. 다시 시도해 주세요.");
    }finally{
      setBackupBusy(false);
    }
  };

  if(!DEMO_MODE&&!authReady)return <div className="loading-overlay">로그인 상태를 확인하는 중이에요…</div>;
  if(!DEMO_MODE&&!user)return <main className="auth-screen"><section className="auth-card"><div className="auth-mark">천</div><p className="auth-eyebrow">CHEONKWON TAEKWONDO</p><h1>천권태권도장 관리자</h1><p className="auth-description">회원과 출석 정보를 관리하려면<br/>관리자 Google 계정으로 로그인해 주세요.</p><button className="auth-google-button" onClick={handleGoogleSignIn} disabled={authPending||ADMIN_EMAILS.length===0}><svg className="auth-google-icon" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.46 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.9c-.58 2.96-2.26 5.48-4.76 7.18l7.73 6C44.38 37.93 46.98 31.84 46.98 24.55Z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.88.93 7.55 2.56 10.78l7.97-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.73-6c-2.14 1.44-4.89 2.3-8.17 2.3-6.26 0-11.55-4.22-13.45-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg>{authPending?"Google 계정 연결 중…":"Google 계정으로 로그인"}</button>{ADMIN_EMAILS.length===0&&<p className="auth-error" role="alert">관리자 이메일 설정이 필요합니다.</p>}{authError&&<p className="auth-error" role="alert">{authError}</p>}<p className="auth-footnote"><Icon name="shield"/> 등록된 관리자 계정만 접근할 수 있습니다.</p></section></main>;

  const pageTitle=view==="dashboard"?"대시보드":view==="members"?"회원 관리":view==="attendance"?"출석 체크":"회원 상세";
  const breadcrumb=<div className="breadcrumb"><button onClick={()=>go("dashboard")}>천권태권도</button>{view!=="dashboard"&&<><span>/</span>{view==="detail"?<><button onClick={()=>go("members")}>회원목록</button><span>/</span><span>회원상세</span></>:<span>{view==="attendance"?"출석 체크":"회원목록"}</span>}</>}</div>;
  const memberRow=(m:Member,compact=false)=>{
    const pass=displayPass(m,currentDate);
    const status=statusFor(m,currentDate);
    return <tr key={m.id} className="click-row" onClick={()=>showMember(m)} tabIndex={0} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();showMember(m)}}}>
      <td><div className="person-cell"><div className="avatar">{m.name.slice(0,1)}</div><div><strong>{m.name}</strong><small>{m.phone||"전화번호 미등록"}</small></div></div></td>
      <td>{pass?weeklyLabel(pass):m.passes.length?"이용권 없음":"미등록"}</td>
      <td>{pass?(passPending(pass)?"첫 출석 후 기간 시작":`${moneylessDate(pass.start)} – ${moneylessDate(passEndDate(pass))}`):"-"}</td>
      <td>{pass?attendanceSummary(pass,passAttendance(store,pass)):"-"}</td>
      <td><span className={`badge ${status==="이용 중"?"blue":"muted"}`}>{status}</span></td>
      {!compact&&<td><div className="member-row-actions"><button className="icon-button small danger-icon" aria-label={`${m.name} 회원 삭제`} title="회원 삭제" disabled={deletingMemberId===m.id} onKeyDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();openMemberDelete(m)}}><Icon name="trash"/></button><button className="icon-button small" aria-label={`${m.name} 상세`} onKeyDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();showMember(m)}}><Icon name="chevron"/></button></div></td>}
    </tr>;
  };

  return <div className="app-shell">
    <aside className={`sidebar ${mobileMenu?"open":""}`}>
      <button className="brand" onClick={()=>go("dashboard")} aria-label="천권태권도장 대시보드로 이동"><Image className="brand-logo" src="/cheonkwon-logo.png" width={1500} height={870} alt="Cheon Kwon Adult Taekwondo"/></button>
      <div className="nav-label">메뉴</div>
      <nav className="side-nav"><button className={view==="dashboard"?"active":""} onClick={()=>go("dashboard")}><Icon name="grid"/>대시보드</button><button className={view==="members"||view==="detail"?"active":""} onClick={()=>go("members")}><Icon name="users"/>회원 관리</button><button className={view==="attendance"?"active":""} onClick={()=>go("attendance")}><Icon name="check"/>출석 체크</button></nav>
      <div className="sidebar-bottom"><div className="help-card"><div className="help-bubble"><Icon name="help"/></div><strong>도장 운영을 더 쉽게</strong><p>간단한 사용 안내를 확인해 보세요.</p><button onClick={()=>setDialog("help")}>사용 안내 <Icon name="arrow"/></button></div><button className="sidebar-export" onClick={exportStoreBackup} disabled={!loaded||backupBusy} title="회원 연락처와 생년월일이 포함된 Excel 백업을 내려받습니다."><Icon name="download"/>{backupBusy?"엑셀 파일 생성 중…":"Excel로 백업"}</button></div>
    </aside>
    {mobileMenu&&<button className="scrim nav-scrim" onClick={()=>setMobileMenu(false)} aria-label="메뉴 닫기"/>}
    <main className="main-area">
      {loadError&&<div className="firestore-error" role="alert">{loadError}</div>}
      <header className="topbar"><button className="menu-toggle icon-button" onClick={()=>setMobileMenu(true)} aria-label="메뉴 열기">☰</button>{breadcrumb}<div className="top-actions"><span className="today-label"><strong>Today  </strong><span>{new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",year:"numeric",month:"long",day:"numeric",weekday:"long"}).format(new Date(`${currentDate}T12:00:00+09:00`))}</span></span><button className="icon-button notification-button" aria-label={expiringToday.length?`오늘 만료 예정 알림 ${expiringToday.length}건`:"알림"} onClick={()=>setDialog("notifications")}><Icon name="bell"/>{expiringToday.length>0&&<span className="notification-badge" aria-hidden="true">{expiringToday.length>9?"9+":expiringToday.length}</span>}</button><div className="profile-menu-wrap" ref={profileMenuRef}><button type="button" className="profile-button" title={DEMO_MODE?"공개 시연 모드":user?.displayName||user?.email||"Google 계정"} aria-label="계정 메뉴" aria-haspopup="menu" aria-expanded={profileMenuOpen} onClick={()=>setProfileMenuOpen(open=>!open)}>{DEMO_MODE?"체":user?.displayName?.trim().slice(0,1)||user?.email?.slice(0,1)||"관"}</button>{profileMenuOpen&&<div className="profile-menu" role="menu"><div className="profile-menu-account"><span>로그인 계정</span><strong>{DEMO_MODE?"공개 시연 모드":user?.displayName||"Google 사용자"}</strong>{!DEMO_MODE&&<small>{user?.email||"Google 계정"}</small>}</div>{!DEMO_MODE&&<button type="button" className="profile-menu-logout" style={{display:"flex",alignItems:"center",gap:8,fontSize:11,lineHeight:1.4,fontWeight:600}} role="menuitem" onClick={handleSignOut}><Icon name="logout"/>로그아웃</button>}</div>}</div></div></header>
      <div className="page-content"><div className="page-heading"><div><div className="eyebrow">CHEONKWON TAEKWONDO</div><h1>{pageTitle}</h1>{view==="dashboard"?<p>오늘도 활기찬 하루, 도장 운영 현황을 확인해 보세요.</p>:view==="members"?<p>회원 정보와 이용권 현황을 한눈에 관리할 수 있어요.</p>:view==="attendance"?<p>오늘의 수업 출석을 빠르고 간편하게 체크해 보세요.</p>:null}</div><div className="heading-actions">{view==="dashboard"&&<button className="button primary" onClick={openNew}><Icon name="plus"/>새 회원 등록</button>}{view==="members"&&<button className="button primary" onClick={openNew}><Icon name="plus"/>새 회원 등록</button>}</div></div>
      {view==="dashboard"&&<>
        <section className="stats-grid"><Stat icon="users" label="전체 회원" value={`${store.members.length}`} suffix="명" detail="등록된 전체 회원"/><Stat icon="shield" label="이용 중 회원" value={`${activeCount}`} suffix="명" detail="현재 이용권이 유효해요" tone="blue"/><Stat icon="check" label="오늘 출석" value={`${todayRecords.length}`} suffix="명" detail={`${todayRecords.reduce((n,a)=>n+a.sessions.length,0)}개 수업 참여`}/><Stat icon="calendar" label="월별 만료 예정" value={`${expiring.length}`} suffix="명" detail={`${expiryMonth.slice(0,4)}년 ${Number(expiryMonth.slice(5,7))}월 이용권 만료`} tone="amber"/></section>
        <div className="dashboard-grid"><section className="panel attendance-panel"><div className="panel-heading"><div><h2>오늘의 출석</h2><p>{moneylessDate(currentDate)} · {weekdayNames[getDay(currentDate)]}요일</p></div><button className="text-link" onClick={()=>go("attendance")}>전체 보기 <Icon name="arrow"/></button></div>{todayRecords.length?<div className="mini-list">{todayRecords.slice(0,5).map(a=>{const m=store.members.find(x=>x.id===a.memberId);const p=m?.passes.find(x=>x.id===a.passId);return m?<div className="mini-row" key={a.id}><div className="avatar">{m.name[0]}</div><div className="mini-main"><strong>{m.name}</strong><small>{a.sessions.join(" · ")}</small></div><div className="usage"><strong>{p?attendanceSummary(p,passAttendance(store,p)):"-"}</strong><small>이용권 누적</small></div></div>:null})}</div>:<Empty compact title="오늘 출석한 회원이 없어요" action="출석 체크하기" onClick={()=>go("attendance")}/>}</section>
          <section className="panel expiring-panel"><div className="panel-heading"><div><h2>이용권 만료 예정</h2><p>선택한 달에 이용권이 만료되는 회원</p></div><div className="expiring-tools"><input className="month-picker" type="month" min={currentDate.slice(0,7)} value={expiryMonth} onChange={event=>{if(/^\d{4}-\d{2}$/.test(event.target.value))setExpiryMonth(event.target.value)}} aria-label="만료 예정 월 선택"/><span className="soft-count">{expiring.length}명</span></div></div>{expiring.length?<div className="mini-list">{expiring.slice(0,5).map(({member,pass})=><div className="mini-row" key={member.id}><div className="avatar pale">{member.name[0]}</div><div className="mini-main"><strong>{member.name}</strong><small>{weeklyLabel(pass)} · {pass.months}개월</small></div><span className="remaining">{moneylessDate(passEndDate(pass))} 만료</span></div>)}</div>:<Empty compact title="선택한 달에 만료 예정인 이용권이 없어요"/>}{expiring.length>5&&<p className="expiring-more">만료 예정 회원 {expiring.length}명 중 5명을 표시합니다.</p>}</section></div>
        <section className="panel recent-panel"><div className="panel-heading"><div><h2>최근 회원</h2><p>회원별 이용권과 출석 현황을 확인해 보세요.</p></div><button className="text-link" onClick={()=>go("members")}>회원 전체 보기 <Icon name="arrow"/></button></div><Table>{sorted.length?sorted.slice(0,6).map(m=>memberRow(m,true)):<tr><td colSpan={5}><Empty title="등록된 회원이 아직 없어요" action="첫 회원 등록하기" onClick={openNew}/></td></tr>}</Table></section>
        <section className="panel month-strip"><div className="month-icon"><Icon name="calendar"/></div><div><strong>이번 달 출석 횟수</strong><small>{currentDate.slice(0,4)}년 {Number(currentDate.slice(5,7))}월 누적 출석</small></div><b>{monthCount}<span>회</span></b></section>
      </>}
      {view==="members"&&<section className="panel members-panel"><div className="toolbar"><div className="search-box"><Icon name="search"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="이름 또는 전화번호 검색"/></div><div className="toolbar-right"><label className="select-wrap"><select value={filter} onChange={e=>setFilter(e.target.value)}><option>전체 회원</option><option>이용 중</option><option>첫 출석 전</option><option>만료</option><option>휴회</option></select></label><span className="result-count">총 <b>{filteredMembers.length}</b>명</span></div></div><div className="member-import-tools"><input ref={memberImportInputRef} type="file" accept=".xlsx,.xls" aria-label="회원 엑셀 파일 선택" onChange={event=>void handleMemberWorkbook(event)}/><button className="button secondary" onClick={()=>void downloadMemberTemplate()}><Icon name="download"/>양식 다운로드</button><button className="button secondary" disabled={!loaded} onClick={()=>memberImportInputRef.current?.click()}><Icon name="upload"/>엑셀에서 회원 등록</button></div><Table>{filteredMembers.length?filteredMembers.map(m=>memberRow(m)):<tr><td colSpan={6}><Empty title={sorted.length?"검색 결과가 없어요":"등록된 회원이 아직 없어요"} action={sorted.length?undefined:"첫 회원 등록하기"} onClick={sorted.length?undefined:openNew}/></td></tr>}</Table><div className="table-foot">회원 이름을 가나다순으로 보여드려요.</div></section>}
      {view==="detail"&&selectedMember&&<MemberDetail member={selectedMember} store={store} currentDate={currentDate} onBack={()=>go("members")} onEdit={()=>openEdit(selectedMember)} onAddPass={()=>{setForm(f=>({...f,start:currentDate,end:addPassDays(currentDate,Number(f.months))}));setDialog("pass")}} onEditPass={openPassEdit} onAttendance={()=>go("attendance")} onDelete={openMemberDelete} deleteBusy={deletingMemberId===selectedMember.id||holdBusyPassId!==null} onToggleHold={togglePassHold} onUpdateHoldEnd={updateHoldEnd} onUpdateHoldStart={updateHoldStart} onDeleteHold={openHoldDelete} holdBusyPassId={holdBusyPassId}/>}
      {view==="detail"&&!selectedMember&&loaded&&<section className="panel"><Empty title="회원 정보를 찾을 수 없어요" action="회원 목록으로 이동" onClick={()=>go("members")}/></section>}
      {view==="attendance"&&<><section className="panel attendance-tools"><div className="attendance-date"><div><span className="field-label">출석 날짜</span><label className="date-input"><Icon name="calendar"/><input type="date" value={attendanceDate} onClick={e=>{try{e.currentTarget.showPicker()}catch{e.currentTarget.focus()}}} onChange={e=>{setAttendanceDate(e.target.value);setTimeFilter("전체")}}/></label><button className="text-link today-button" onClick={()=>{setAttendanceDate(today());setTimeFilter("전체")}}>오늘</button><span className="date-weekday">{weekdayNames[dateDay]}요일 수업</span></div><div className="attendance-buttons"><button className="button secondary" onClick={openSchedule}><Icon name="clock"/>수업 시간 관리</button></div></div><div className="time-filters"><button className={timeFilter==="전체"?"selected":""} onClick={()=>setTimeFilter("전체")}>전체</button>{schedules.map(s=><button key={s.id} className={timeFilter===s.time?"selected":""} onClick={()=>setTimeFilter(s.time)}>{s.time}</button>)}{schedules.length===0&&<span className="no-classes">등록된 수업 시간이 없어요. 수업 시간 관리에서 추가해 주세요.</span>}</div></section><div className="attendance-summary"><div><h2>{timeFilter==="전체"?"오늘의 회원 출석":`${timeFilter} 수업 출석`}</h2><p>첫 출석일에 이용권 기간이 시작되는 회원도 표시됩니다.</p></div><div className="attendance-summary-actions"><div className="attendance-search"><Icon name="search"/><input value={nameFilter} onChange={e=>setNameFilter(e.target.value)} placeholder="회원 이름 검색"/></div><button className="button danger-light attendance-cancel-button" onClick={cancelDay}>전체 취소</button></div></div><div className="attendance-columns"><AttendanceColumn title="출석" count={attended.length} status="present">{attended.length?attended.map(m=><AttendanceCard key={m.id} member={m} sessions={selectedSessions(m)} schedules={schedules} onToggle={t=>attendanceToggle(m,t)} pass={attendancePass(m,attendanceDate)!} used={passAttendance(store,attendancePass(m,attendanceDate)!)}/>):<Empty compact title="아직 출석한 회원이 없어요"/>}</AttendanceColumn><AttendanceColumn title="미출석" count={absent.length} status="absent">{absent.length?absent.map(m=><AttendanceCard key={m.id} member={m} sessions={selectedSessions(m)} schedules={schedules} onToggle={t=>attendanceToggle(m,t)} pass={attendancePass(m,attendanceDate)!} used={passAttendance(store,attendancePass(m,attendanceDate)!)}/>):<Empty compact title="미출석 회원이 없어요"/>}</AttendanceColumn></div></>}
      <footer className="footer"><span>© 2026 Cheonkwon</span><span>천권태권도장 회원 · 이용권 · 출석 관리</span></footer>
      </div>
    </main>
      {dialog&&<div className="scrim modal-scrim" onMouseDown={e=>{if(e.target===e.currentTarget&&!(dialog==="schedule"&&scheduleSaving)&&!(dialog==="memberImport"&&memberImportBusy)&&!(dialog==="deleteMember"&&deletingMemberId)&&!(dialog==="deleteHold"&&holdBusyPassId)){if(dialog==="memberImport")cancelMemberImport();else setDialog(null)}}}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="modal-heading"><div><span className="eyebrow">CHEONKWON</span><h2 id="dialog-title">{dialog==="member"?"새 회원 등록":dialog==="edit"?"회원 정보 수정":dialog==="pass"?"이용권 추가":dialog==="passEdit"?"이용권 수정":dialog==="schedule"?"수업 시간 관리":dialog==="memberImport"?"엑셀 회원 등록":dialog==="deleteMember"?"회원 삭제":dialog==="deleteHold"?"휴회 이력 삭제":dialog==="help"?"사용 안내":"알림"}</h2></div><button className="icon-button" aria-label="닫기" disabled={(dialog==="schedule"&&scheduleSaving)||(dialog==="memberImport"&&memberImportBusy)||(dialog==="deleteMember"&&Boolean(deletingMemberId))||(dialog==="deleteHold"&&Boolean(holdBusyPassId))} onClick={()=>dialog==="memberImport"?cancelMemberImport():setDialog(null)}><Icon name="close"/></button></div>
      {(dialog==="member"||dialog==="edit"||dialog==="pass"||dialog==="passEdit")&&<div className="modal-body">{dialog!=="pass"&&dialog!=="passEdit"&&<><label className="form-field"><span>이름 <i>*</i></span><input autoFocus value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="회원 이름"/></label><div className="form-field"><span>전화번호</span><div className="phone-fields"><input inputMode="numeric" maxLength={3} value={form.phone1} onChange={e=>setForm(f=>({...f,phone1:e.target.value.replace(/\D/g,"").slice(0,3)}))} placeholder="010"/><b>-</b><input inputMode="numeric" maxLength={4} value={form.phone2} onChange={e=>setForm(f=>({...f,phone2:e.target.value.replace(/\D/g,"").slice(0,4)}))} placeholder="1111"/><b>-</b><input inputMode="numeric" maxLength={4} value={form.phone3} onChange={e=>setForm(f=>({...f,phone3:e.target.value.replace(/\D/g,"").slice(0,4)}))} placeholder="2222"/></div></div><label className="form-field"><span>생년월일</span><input type="date" value={form.birthDate} onClick={e=>{try{e.currentTarget.showPicker()}catch{e.currentTarget.focus()}}} onChange={e=>setForm(f=>({...f,birthDate:e.target.value}))}/></label><label className="form-field"><span>메모</span><textarea value={form.memo} onChange={e=>setForm(f=>({...f,memo:e.target.value}))} placeholder="도장 운영에 필요한 메모를 입력하세요." rows={3}/></label></>}{dialog!=="edit"&&<><div className="form-divider">{dialog==="member"?"첫 이용권":dialog==="passEdit"?"이용권 정보 수정":"이용권 정보"}</div><label className="form-field"><span>{(dialog==="member"||dialog==="pass"||editingPendingPass)?"출석 가능 시작일":"시작일"}</span><input type="date" value={form.start} onClick={e=>{try{e.currentTarget.showPicker()}catch{e.currentTarget.focus()}}} onChange={e=>setForm(f=>({...f,start:e.target.value,end:addPassDays(e.target.value,Number(f.months))}))}/></label><div className="form-row"><label className="form-field"><span>이용권 종류</span><Select value={form.weekly} onChange={v=>setForm(f=>({...f,weekly:v}))} options={[...(dialog==="passEdit"&&!new Set(["2","3","unlimited"]).has(form.weekly)?[[form.weekly,`기존 이용권 · 주 ${form.weekly}회`]]:[]),["2","주 2회 (월 8회)"],["3","주 3회 (월 12회)"],["unlimited","무제한"]]}/></label><label className="form-field"><span>이용 기간</span><Select value={form.months} onChange={v=>setForm(f=>({...f,months:v,end:addPassDays(f.start,Number(v))}))} options={[...(dialog==="passEdit"&&!new Set(["1","2","3"]).has(form.months)?[[form.months,`기존 기간 · ${form.months}개월`]]:[]),["1","1개월"],["2","2개월"],["3","3개월"]]}/></label></div>{dialog==="passEdit"&&!editingPendingPass&&<label className="form-field"><span>종료일</span><input type="date" min={form.start} value={form.end} onClick={e=>{try{e.currentTarget.showPicker()}catch{e.currentTarget.focus()}}} onChange={e=>setForm(f=>({...f,end:e.target.value}))}/></label>}<p className="form-note">{(dialog==="member"||dialog==="pass"||editingPendingPass)?"첫 출석일에 이용권이 시작되며 종료일은 이용 기간에 따라 계산됩니다. ":dialog==="passEdit"?"종료일을 필요에 따라 변경할 수 있어요. ":"종료일은 시작일과 이용 기간에 따라 자동 계산됩니다. "}{form.weekly==="unlimited"?"무제한 이용권은 종료일까지 출석 횟수 제한 없이 이용할 수 있어요.":"총 이용 횟수는 주간 횟수 × 4주 × 이용 개월 수로 계산됩니다."}</p></>}</div>}
      {dialog==="schedule"&&<div className="modal-body"><label className="form-field"><span>변경 적용일</span><input type="date" min={today()} value={scheduleEffectiveDate} disabled={scheduleDraftTouched||scheduleSaving} onClick={e=>{try{e.currentTarget.showPicker()}catch{e.currentTarget.focus()}}} onChange={e=>changeScheduleEffectiveDate(e.target.value)}/></label><p className="form-note">적용일을 먼저 고른 뒤 시간표를 수정하세요. 이전 날짜의 출석 화면에는 당시 시간표가 유지됩니다. 저장 전 변경은 완료를 눌러야 반영돼요.</p><div className="schedule-form"><div className="form-field schedule-days-field"><span>요일 <small>여러 개 선택 가능</small></span><div className="weekday-chips" role="group" aria-label="수업 요일">{weekdayOrder.map(index=><button type="button" key={weekdayNames[index]} className={`weekday-chip ${scheduleDays.includes(index)?"selected":""}`} aria-pressed={scheduleDays.includes(index)} onClick={()=>toggleScheduleDay(index)}>{weekdayNames[index]}</button>)}</div></div><div className="schedule-bottom-row"><div className="form-field"><span>수업 시간</span><div className="time-selects"><Select value={scheduleTime.slice(0,2)} onChange={hour=>setScheduleTime(current=>`${hour}:${current.slice(3)}`)} options={hourOptions}/><span>:</span><Select value={scheduleTime.slice(3,5)} onChange={minute=>setScheduleTime(current=>`${current.slice(0,2)}:${minute}`)} options={minuteOptions}/></div></div><button className="button primary add-schedule" disabled={scheduleSaving} onClick={addSchedule}><Icon name="plus"/>수업 추가</button></div></div><div className="schedule-list">{[0,1,2,3,4,5,6].map(day=>{const entries=scheduleDraft.filter(s=>s.day===day).sort((a,b)=>a.time.localeCompare(b.time));return entries.length?<div className="schedule-day" key={day}><strong>{weekdayNames[day]}요일</strong><div>{entries.map(s=><span className="schedule-chip" key={s.id}>{s.time}<button disabled={scheduleSaving} onClick={()=>removeSchedule(s)} aria-label={`${weekdayNames[day]}요일 ${s.time} 수업을 ${scheduleEffectiveDate}부터 종료`}>×</button></span>)}</div></div>:null})}{scheduleDraft.length===0&&<Empty compact title="선택한 날짜에 등록된 수업 시간이 없어요"/>}</div></div>}
      {dialog==="memberImport"&&memberImportPreview&&<div className="modal-body member-import-preview"><p className="member-import-file">파일 <strong>{memberImportPreview.fileName}</strong></p><div className="member-import-summary"><span>전체 <b>{memberImportPreview.rows.length}명</b></span><span>등록 가능 <b>{memberImportPreview.rows.filter(row=>!row.errors.length).length}명</b></span><span className={memberImportPreview.rows.some(row=>row.errors.length)?"has-errors":""}>확인 필요 <b>{memberImportPreview.rows.filter(row=>row.errors.length).length}명</b></span></div><p className="form-note">이용권 열을 비우면 회원 정보만 등록합니다. 이용권을 입력한 행은 함께 등록됩니다.</p>{memberImportPreview.rows.some(row=>row.errors.length)&&<div className="member-import-errors" role="alert"><strong>아래 행을 수정한 뒤 파일을 다시 선택해 주세요.</strong>{memberImportPreview.rows.filter(row=>row.errors.length).map(row=><p key={row.rowNumber}>{row.rowNumber}행 · {row.errors.join(" ")}</p>)}</div>}<div className="member-import-table-wrap"><table className="member-import-table"><thead><tr><th>엑셀 행</th><th>이름</th><th>연락처</th><th>생년월일</th><th>이용권</th></tr></thead><tbody>{memberImportPreview.rows.map(row=><tr key={row.rowNumber} className={row.errors.length?"invalid":""}><td>{row.rowNumber}</td><td>{row.member.name||"—"}</td><td>{row.member.phone||"—"}</td><td>{row.member.birthDate||"—"}</td><td>{row.member.passes.length?`${weeklyLabel(row.member.passes[0])} · ${row.member.passes[0].months}개월`:"없음"}</td></tr>)}</tbody></table></div></div>}
      {dialog==="deleteMember"&&memberToDelete&&<div className="modal-body delete-member-content"><p><strong>{memberToDelete.name}</strong> 회원을 삭제합니다.</p><p className="delete-member-warning">회원 정보와 이용권 {memberToDelete.passes.length}건, 출석 기록이 실제 데이터에서 영구 삭제됩니다. 이 작업은 되돌릴 수 없습니다.</p><label className="form-field"><span>계속하려면 아래에 <b>delete</b>를 입력해 주세요.</span><input className={deleteConfirmation&&!canDeleteMember?"delete-confirm-input invalid":"delete-confirm-input"} autoFocus value={deleteConfirmation} onChange={event=>setDeleteConfirmation(event.target.value)} placeholder="delete" autoComplete="off" spellCheck={false}/></label></div>}
      {dialog==="deleteHold"&&holdToDelete&&<div className="modal-body delete-hold-content"><p><strong>휴회 {moneylessDate(holdToDelete.hold.start)}{holdToDelete.hold.end?` – ${moneylessDate(holdToDelete.hold.end)}`:""}</strong> 이력을 삭제할까요?</p><p className="delete-member-warning">완료된 휴회 이력을 삭제하면 해당 휴회 기간만큼 이용권 종료일도 함께 앞당겨집니다.</p></div>}
      {dialog==="help"&&<div className="modal-body help-content"><div><b>01</b><section><strong>회원과 이용권 등록</strong><p>새 회원 등록에서 이름, 연락처와 첫 이용권을 함께 등록할 수 있어요. 재등록은 회원 상세에서 이용권 추가를 선택해 주세요.</p></section></div><div><b>02</b><section><strong>출석 체크</strong><p>날짜와 수업 시간대를 선택한 뒤 회원 카드의 수업 시간을 눌러 체크하세요. 같은 날 여러 수업을 들어도 이용 횟수는 하루 한 번만 차감됩니다.</p></section></div><div><b>03</b><section><strong>수업 시간 관리</strong><p>출석 체크 화면에서 요일과 시간을 추가하거나 삭제할 수 있어요.</p></section></div></div>}
      {dialog==="notifications"&&<div className="modal-body notification-content">{expiringToday.length?<><p className="notification-intro">오늘 이용권이 종료되는 회원이에요.</p><div className="notification-list">{expiringToday.map(({member,pass})=><button className="notification-item" key={member.id} onClick={()=>{setDialog(null);showMember(member)}}><div className="avatar">{member.name[0]}</div><div><strong>{member.name}</strong><small>{weeklyLabel(pass)} · {pass.months}개월 · 오늘 종료</small></div><Icon name="chevron"/></button>)}</div></>:<div className="empty-state"><div className="empty-icon"><Icon name="bell"/></div><strong>오늘 만료 예정인 회원이 없어요</strong><p>이용권 종료일이 오늘인 회원이 생기면 알려드릴게요.</p></div>}</div>}
      <div className="modal-footer">{dialog!=="schedule"&&dialog!=="help"&&dialog!=="notifications"&&dialog!=="memberImport"&&dialog!=="deleteMember"&&dialog!=="deleteHold"&&<><button className="button secondary" onClick={()=>setDialog(null)}>취소</button><button className="button primary" onClick={dialog==="member"?saveNew:dialog==="edit"?saveEdit:dialog==="passEdit"?savePassEdit:addPass}>{dialog==="member"?"등록하기":dialog==="edit"?"수정하기":dialog==="passEdit"?"수정하기":"이용권 등록"}</button></>}{dialog==="memberImport"&&<><button className="button secondary" disabled={memberImportBusy} onClick={cancelMemberImport}>취소</button><button className="button primary" disabled={memberImportBusy||!memberImportPreview||memberImportPreview.rows.some(row=>row.errors.length)} onClick={()=>void saveMemberImport()}>{memberImportBusy?"등록 중…":`${memberImportPreview?.rows.length??0}명 회원 등록`}</button></>}{dialog==="deleteMember"&&<><button className="button secondary" disabled={Boolean(deletingMemberId)} onClick={()=>{setDialog(null);setMemberToDelete(null);setDeleteConfirmation("")}}>취소</button><button className="button danger-light delete-confirm-button" disabled={!canDeleteMember} onClick={()=>void deleteMemberFromAdmin()}><Icon name="trash"/>{deletingMemberId?"삭제 중…":"회원 삭제"}</button></>}{dialog==="deleteHold"&&<><button className="button secondary" disabled={Boolean(holdBusyPassId)} onClick={()=>{setDialog(null);setHoldToDelete(null)}}>취소</button><button className="button danger-light" disabled={Boolean(holdBusyPassId)} onClick={()=>void deleteHold()}><Icon name="trash"/>{holdBusyPassId?"삭제 중…":"삭제"}</button></>}{(dialog==="help"||dialog==="notifications")&&<button className="button secondary full" onClick={()=>setDialog(null)}>닫기</button>}{dialog==="schedule"&&<button className="button secondary full" disabled={scheduleSaving} onClick={saveScheduleDraft}>{scheduleSaving?"저장 중…":"완료"}</button>}</div>
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
function AttendanceCard({member,sessions,schedules,onToggle,pass,used}:{member:Member;sessions:string[];schedules:Schedule[];onToggle:(t:string)=>void;pass:Pass;used:number}){return <div className="attendance-card"><div className="attendee-top"><div className="person-cell"><div className="avatar">{member.name[0]}</div><div><strong>{member.name}</strong><small>{member.phone||"전화번호 미등록"}</small></div></div><div className="attendance-card-actions"><div className="session-chips compact-session-chips">{schedules.map(s=>{const active=sessions.includes(s.time);return <button key={s.id} className={`session-chip ${active?"active":""}`} onClick={()=>onToggle(s.time)}>{s.time}{active&&<span>×</span>}</button>})}</div><button className="icon-button small" aria-label={`${member.name} 상세`}><Icon name="chevron"/></button></div></div><div className="attendee-foot"><span>{weeklyLabel(pass)} 이용권</span><span>누적 <b>{attendanceSummary(pass,used)}</b></span></div></div>}
function MemberDetail({member,store,currentDate,onBack,onEdit,onAddPass,onEditPass,onAttendance,onDelete,deleteBusy,onToggleHold,onUpdateHoldEnd,onUpdateHoldStart,onDeleteHold,holdBusyPassId}:{member:Member;store:Store;currentDate:string;onBack:()=>void;onEdit:()=>void;onAddPass:()=>void;onEditPass:(pass:Pass)=>void;onAttendance:()=>void;onDelete:()=>void;deleteBusy:boolean;onToggleHold:(pass:Pass)=>void;onUpdateHoldEnd:(pass:Pass,hold:HoldPeriod,end:string)=>void;onUpdateHoldStart:(pass:Pass,hold:HoldPeriod,start:string)=>void;onDeleteHold:(pass:Pass,hold:HoldPeriod)=>void;holdBusyPassId:string|null}){
  const current=displayPass(member,currentDate);
  const currentStatus=statusFor(member,currentDate);
  const records=store.attendance.filter(a=>a.memberId===member.id).sort((a,b)=>b.date.localeCompare(a.date));
  const passes=member.passes.slice().sort((a,b)=>b.start.localeCompare(a.start));
  const passStatus=(pass:Pass)=>passPending(pass)?"첫 출석 전":isPassOnHold(pass,currentDate)?"휴회":pass.start>currentDate?"예정":passEndDate(pass)<currentDate?"만료":(new Date(`${passEndDate(pass)}T12:00:00+09:00`).getTime()-new Date(`${currentDate}T12:00:00+09:00`).getTime())/86400000<=7?"만료 임박":"이용 중";
  return <div className="detail-page">
    <button className="back-link" onClick={onBack}>← 회원 목록으로</button>
    <section className="panel member-hero">
      <div className="hero-person"><div className="avatar large">{member.name[0]}</div><div><span className={`badge ${currentStatus==="이용 중"?"blue":"muted"}`}>{currentStatus}</span><h2>{member.name}</h2><p>{member.phone||"전화번호 미등록"}</p></div></div>
      <div className="hero-actions"><button className="icon-button small" onClick={onEdit} aria-label="회원 정보 수정" title="회원 정보 수정"><Icon name="edit"/></button><button className="icon-button small danger-icon" onClick={onDelete} disabled={deleteBusy} aria-label="회원 삭제" title="회원 삭제"><Icon name="trash"/></button></div>
      <div className="hero-meta member-meta-simple"><div><span>전화번호</span><strong>{member.phone||"미등록"}</strong></div><div><span>생년월일</span><strong>{member.birthDate?moneylessDate(member.birthDate):"미등록"}</strong></div><div><span>이용권 수</span><strong>{member.passes.length}건</strong></div><div><span>누적 출석</span><strong>{records.length}회</strong></div></div>
    </section>
    <div className="detail-grid">
      <section className="panel current-pass"><div className="panel-heading"><div><h2>현재 이용권</h2><p>이용권 전체 기간의 출석 사용량</p></div><span className="pass-icon"><Icon name="shield"/></span></div>{current?<><div className="current-pass-main"><div><span className="pass-kicker">WEEKLY PASS</span><h3>{weeklyLabel(current)} <span>· {current.months}개월</span></h3></div><span className={`badge ${currentStatus==="이용 중"?"blue":"muted"}`}>{currentStatus}</span></div><div className="pass-dates"><div><span>{passPending(current)?"이용권 시작":"시작일"}</span><strong>{passPending(current)?"첫 출석일":moneylessDate(current.start)}</strong></div><div><span>종료일</span><strong>{passPending(current)?"첫 출석 후 계산":moneylessDate(passEndDate(current))}</strong></div></div><div className="usage-bar"><div><span>이용권 누적 사용량</span><b>{attendanceSummary(current,passAttendance(store,current))}</b></div>{passAllowance(current)!==null&&<span className="bar"><i style={{width:`${usagePercent(current,passAttendance(store,current))}%`}}/></span>}</div></>:<Empty compact title="현재 유효한 이용권이 없어요" action="이용권 추가" onClick={onAddPass}/>}</section>
      <section className="panel member-note"><div className="panel-heading"><div><h2>회원 메모</h2><p>도장 운영 참고 사항</p></div><button className="icon-button small" onClick={onEdit} aria-label="메모 수정"><Icon name="edit"/></button></div><p className="note-text">{member.memo||"등록된 메모가 없습니다."}</p><button className="text-link" onClick={onAttendance}>출석 체크 바로가기 <Icon name="arrow"/></button></section>
    </div>
    <section className="panel history-panel"><div className="panel-heading"><div><h2>이용권 등록 이력</h2><p>휴회 중에는 출석을 체크할 수 없어요. 재개일부터 다시 이용하며, 휴회 시작일부터 재개일 전날까지의 일수만큼 이용권 종료일을 연장합니다.</p></div><button className="button secondary" onClick={onAddPass}><Icon name="plus"/>이용권 추가</button></div><div className="table-scroll"><table className="pass-history-table"><thead><tr><th>이용 기간</th><th>이용 조건</th><th>기간</th><th>출석 횟수</th><th>상태</th><th>수정</th><th>휴회</th></tr></thead><tbody>{passes.map(pass=>{
      const openHold=(pass.holds??[]).find(hold=>!hold.end);
      const canPause=!passPending(pass)&&(Boolean(openHold)||(pass.start<=currentDate&&passEndDate(pass)>=currentDate));
      return <Fragment key={pass.id}>
        <tr><td>{passPending(pass)?"첫 출석 후 기간 시작":`${moneylessDate(pass.start)} – ${moneylessDate(passEndDate(pass))}`}</td><td>{weeklyLabel(pass)} / {passAllowance(pass)===null?"기간 내 무제한":`총 ${passAllowance(pass)}회`}</td><td>{pass.months}개월</td><td>{store.attendance.filter(a=>a.passId===pass.id).length}회</td><td><span className={`badge ${passStatus(pass)==="이용 중"?"blue":"muted"}`}>{passStatus(pass)}</span></td><td><button className="text-link" onClick={()=>onEditPass(pass)}>수정</button></td><td><button className={`button ${openHold?"primary":"secondary"} hold-toggle`} disabled={!canPause||holdBusyPassId===pass.id||deleteBusy} onClick={()=>onToggleHold(pass)}>{holdBusyPassId===pass.id?"저장 중…":openHold?"휴회 종료":"휴회"}</button></td></tr>
        {(pass.holds??[]).map((hold,index)=><tr className="hold-history-row" key={`${pass.id}-${hold.id}`}><td colSpan={7}><div className="hold-history-content"><strong>휴회 {index+1}</strong><label>시작일<input className="hold-end-input" type="date" min={holdStartBounds(pass,pass.holds??[],hold).min} max={holdStartBounds(pass,pass.holds??[],hold).max} value={hold.start} disabled={holdBusyPassId===pass.id||deleteBusy} onClick={event=>{try{event.currentTarget.showPicker()}catch{event.currentTarget.focus()}}} onChange={event=>void onUpdateHoldStart(pass,hold,event.target.value)}/></label>{hold.end?<label>종료일(재개일)<input className="hold-end-input" type="date" min={holdEndBounds(pass.holds??[],hold).min} max={holdEndBounds(pass.holds??[],hold).max} value={hold.end} disabled={holdBusyPassId===pass.id||deleteBusy} onClick={event=>{try{event.currentTarget.showPicker()}catch{event.currentTarget.focus()}}} onChange={event=>void onUpdateHoldEnd(pass,hold,event.target.value)}/></label>:<span className="hold-open-label">휴회 중 · 재개하면 종료일이 기록됩니다</span>}<button className="text-link hold-delete-button" disabled={holdBusyPassId===pass.id||deleteBusy} onClick={()=>onDeleteHold(pass,hold)}>삭제</button></div></td></tr>)}
      </Fragment>;
    })}</tbody></table></div></section>
    <section className="panel history-panel"><div className="panel-heading"><div><h2>출석 이력</h2><p>날짜별 참여 수업과 사용한 이용권</p></div></div><div className="table-scroll"><table><thead><tr><th>날짜</th><th>참여 시간대</th><th>사용한 이용권</th><th>차감 횟수</th></tr></thead><tbody>{records.length?records.map(record=>{const pass=member.passes.find(item=>item.id===record.passId);return <tr key={record.id}><td>{moneylessDate(record.date)}</td><td>{record.sessions.join(" · ")}</td><td>{pass?`${weeklyLabel(pass)} · ${pass.months}개월`:"-"}</td><td>1회</td></tr>}):<tr><td colSpan={4} className="table-empty">출석 기록이 없습니다.</td></tr>}</tbody></table></div></section>
  </div>;
}
