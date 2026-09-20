import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, addDoc, updateDoc, query, where, orderBy, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseConfig={apiKey:"AIzaSyBh7-h4GxX_cYZphqIvIYVVzMjQVFLKQyE",authDomain:"chatgpt-household-attendance.firebaseapp.com",projectId:"chatgpt-household-attendance",storageBucket:"chatgpt-household-attendance.firebasestorage.app",messagingSenderId:"640078047318",appId:"1:640078047318:web:fa508fb29be6621378f3f7"};
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app),provider=new GoogleAuthProvider();
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const state={user:null,household:null,workers:[],attendance:[],reports:[]};
const iso=d=>{const x=new Date(d);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`};
const parseDate=s=>{const [y,m,d]=String(s).split("-").map(Number);return new Date(y,m-1,d)};
const esc=s=>String(s??"").replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const normEmail=e=>String(e||"").trim().toLowerCase();
const path=(name,id)=>id?doc(db,"households",state.household.id,name,id):collection(db,"households",state.household.id,name);
const owner=()=>state.household?.ownerUid===state.user?.uid;
const shiftType=w=>w?.shiftType||"double"; // Existing workers without the field remain double-shift; new workers default to single.
function error(t,m){$("#modalContent").innerHTML=`<h2 class="error-title">${esc(t)}</h2><p>${esc(m)}</p><button class="primary-btn" id="ok">OK</button>`;$("#modal").classList.remove("hidden");$("#ok").onclick=()=>$("#modal").classList.add("hidden")}
function toast(m){const t=$("#toast");t.textContent=m;t.classList.remove("hidden");setTimeout(()=>t.classList.add("hidden"),2400)}

/* =========================================================================
   HOUSEHOLD / AUTH — unchanged from the previous production version
   ========================================================================= */
async function ensureHousehold(){
  const ownRef=doc(db,"households",state.user.uid),ownSnap=await getDoc(ownRef),email=normEmail(state.user.email);
  if(ownSnap.exists()){
    const household=normalizeHousehold(ownSnap);
    if(!household.memberEmails.includes(email)){household.memberEmails=Array.from(new Set([...(household.memberEmails||[]),email].filter(Boolean)));await setDoc(ownRef,{memberEmails:household.memberEmails,updatedAt:serverTimestamp()},{merge:true})}
    return household;
  }
  if(email){const invited=await getDocs(query(collection(db,"households"),where("memberEmails","array-contains",email)));if(!invited.empty)return normalizeHousehold(invited.docs[0])}
  await setDoc(ownRef,{ownerUid:state.user.uid,ownerEmail:email,name:"My Household",members:[state.user.uid],memberEmails:[email],createdAt:serverTimestamp()});
  return {id:state.user.uid,ownerUid:state.user.uid,ownerEmail:email,members:[state.user.uid],memberEmails:[email],name:"My Household"};
}
function normalizeHousehold(s){const d=s.data();return{id:s.id,...d,members:Array.isArray(d.members)?d.members:[],memberEmails:Array.isArray(d.memberEmails)?d.memberEmails.map(normEmail).filter(Boolean):[normEmail(d.ownerEmail)].filter(Boolean)}}

/* =========================================================================
   LOAD — unchanged. Still fetches + auto-generates reports in the background
   for data continuity, even though there is no dedicated Reports screen in
   this design; nothing about the calculation/report engine changes here.
   ========================================================================= */
async function load(){
  $("#loadingView").classList.remove("hidden");$("#mainView").classList.add("hidden");
  try{
    state.household=await ensureHousehold();
    const [w,a,r]=await Promise.all([getDocs(query(path("workers"),orderBy("name"))),getDocs(query(path("attendance"),orderBy("date","desc"))),getDocs(query(path("reports"),orderBy("periodStart","desc"))) ]);
    state.workers=w.docs.map(d=>({id:d.id,...d.data(),shiftType:d.data().shiftType??"double",monthlyPaidLeaves:Number(d.data().monthlyPaidLeaves??2),dailyRate:Number(d.data().dailyRate??0),monthlySalary:Number(d.data().monthlySalary??0)}));
    state.attendance=a.docs.map(d=>({id:d.id,...d.data()}));state.reports=r.docs.map(d=>({id:d.id,...d.data()}));
    await createDueReports();
    if(state.reports.length!==r.size){const rr=await getDocs(query(path("reports"),orderBy("periodStart","desc")));state.reports=rr.docs.map(d=>({id:d.id,...d.data()}))}
    render();$("#loadingView").classList.add("hidden");$("#mainView").classList.remove("hidden");
  }catch(e){$("#loadingView").classList.add("hidden");error("Couldn't load data",e.message||"Please check your connection.")}
}

/* =========================================================================
   ATTENDANCE DATA — att()/shiftValue()/saveAttendance() unchanged.
   ========================================================================= */
const att=(wid,date)=>state.attendance.find(x=>x.workerId===wid&&x.date===date);
function shiftValue(wid,date,shift){return att(wid,date)?.[shift]||"unmarked"}
async function saveAttendance(wid,date,shift,value){
  const a=att(wid,date);try{if(a)await updateDoc(path("attendance",a.id),{[shift]:value,updatedAt:serverTimestamp()});else await addDoc(path("attendance"),{workerId:wid,date,morning:shift==="morning"?value:"unmarked",evening:shift==="evening"?value:"unmarked",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});await load();toast("Attendance saved")}catch(e){error("Attendance wasn't saved",e.message)}}

// The ONLY place a combined day status is computed — always derived, never stored/tapped.
// halfday = one shift present + one shift absent/leave, in any combination.
function derivedStatus(w,date){
  if(shiftType(w)==="single") return shiftValue(w.id,date,"morning");
  const m=shiftValue(w.id,date,"morning"), e=shiftValue(w.id,date,"evening");
  if(m==="unmarked"&&e==="unmarked") return "unmarked";
  if(m==="unmarked"||e==="unmarked") return "partial";
  if(m==="present"&&e==="present") return "present";
  if(m==="leave"&&e==="leave") return "leave";
  if(m==="absent"&&e==="absent") return "absent";
  return "halfday";
}

/* =========================================================================
   CALCULATION ENGINE — workerStats()/workerRows()/monthRows()/calc()/period()/
   writeReport()/createDueReports() are byte-for-byte the same formulas as
   the previous production version. Do not extend this — Pay is a
   presentation layer on top of it, per the explicit product requirement.
   ========================================================================= */
function workerRows(w,start,end){return state.attendance.filter(a=>a.workerId===w.id&&a.date>=start&&a.date<=end)}
function workerStats(w,start,end){
  const rows=workerRows(w,start,end),single=shiftType(w)==="single";
  const present=rows.reduce((n,a)=>n+(a.morning==="present")+(single?0:a.evening==="present"),0),leave=rows.reduce((n,a)=>n+(a.morning==="leave")+(single?0:a.evening==="leave"),0),absent=rows.reduce((n,a)=>n+(a.morning==="absent")+(single?0:a.evening==="absent"),0);
  const divisor=single?1:2,presentDays=present/divisor,leaveDays=leave/divisor,absentDays=absent/divisor,paidLeaveDays=Math.min(leaveDays,Number(w.monthlyPaidLeaves||0)),unpaidLeaveDays=Math.max(0,leaveDays-paidLeaveDays),days=Math.floor((parseDate(end)-parseDate(start))/86400000)+1;
  const dailyRate=Number(w.dailyRate||0),monthlySalary=Number(w.monthlySalary||0),paymentMethod=w.payType==="monthly"?"monthly":"daily";let basePayment,deduction,finalPayment;
  if(paymentMethod==="monthly"){basePayment=monthlySalary;deduction=w.paymentPolicy==="full"?0:unpaidLeaveDays*(monthlySalary/Math.max(1,days));finalPayment=Math.max(0,basePayment-deduction)}else{basePayment=(presentDays+paidLeaveDays)*dailyRate;deduction=0;finalPayment=Math.max(0,basePayment)}
  return{workerId:w.id,name:w.name,shiftType:shiftType(w),presentShifts:present,leaveShifts:leave,absentShifts:absent,presentDays,leaveDays,absentDays,paidLeaveDays,unpaidLeaveDays,days,dailyRate,monthlySalary,paymentMethod,basePayment,deduction,finalPayment};
}
function monthRows(w,y,m){const days=new Date(y,m+1,0).getDate(),single=shiftType(w)==="single";return Array.from({length:days},(_,i)=>{const date=iso(new Date(y,m,i+1)),a=att(w.id,date),morning=a?.morning||"unmarked",evening=single?"unmarked":(a?.evening||"unmarked");return{date,morning,evening}})}
function period(kind,anchor=new Date()){const d=new Date(anchor);if(kind==="week"){const s=new Date(d);s.setDate(d.getDate()-d.getDay());const e=new Date(s);e.setDate(s.getDate()+6);return{start:iso(s),end:iso(e),label:`Week ${iso(s)} → ${iso(e)}`}}const s=new Date(d.getFullYear(),d.getMonth(),1),e=new Date(d.getFullYear(),d.getMonth()+1,0);return{start:iso(s),end:iso(e),label:s.toLocaleDateString(undefined,{month:"long",year:"numeric"})}}
function calc(start,end,workers=state.workers){return workers.filter(w=>w.active!==false).map(w=>workerStats(w,start,end))}
async function writeReport(kind,p){await setDoc(path("reports",`${kind}_${p.start}`),{kind,periodStart:p.start,periodEnd:p.end,label:p.label,summary:calc(p.start,p.end),generatedAt:serverTimestamp(),autoGenerated:true},{merge:true})}
async function createDueReports(){const now=new Date(),previousDay=new Date(now);previousDay.setDate(now.getDate()-1);const completedWeek=previousDay.getDay()===6?period("week",previousDay):null,previousMonth=new Date(now.getFullYear(),now.getMonth()-1,1),monthEnd=new Date(now.getFullYear(),now.getMonth(),0),monthClosed=iso(monthEnd)<iso(now),existing=new Set(state.reports.map(r=>`${r.kind}_${r.periodStart}`));if(completedWeek&&!existing.has(`week_${completedWeek.start}`))await writeReport("week",completedWeek);if(monthClosed){const p=period("month",previousMonth);if(!existing.has(`month_${p.start}`))await writeReport("month",p)}}

/* =========================================================================
   HOUSEHOLD MEMBERS — unchanged logic, now rendered into the account-menu
   overlay instead of a bottom tab.
   ========================================================================= */
function renderHousehold(){const emails=state.household.memberEmails||[],isOwner=owner();$("#householdPanel").innerHTML=`<div class="section-head"><div><h2>Household</h2><div class="subtle">Share this household with Google accounts by email.</div></div></div><div class="form-card"><h3 style="font-family:'Quicksand',sans-serif;font-size:16px;margin:0 0 4px">${esc(state.household.name||"My Household")}</h3><p class="subtle" style="margin:0 0 10px">Owner: ${esc(state.household.ownerEmail||"")}</p>${isOwner?`<form id="memberForm" class="member-form"><input name="email" type="email" required placeholder="name@example.com"><button class="primary-btn">Add member</button></form>`:`<p class="subtle">Only the owner can add or remove household members.</p>`}</div>${emails.map(email=>`<div class="member-card"><div><strong>${esc(email)}</strong><div class="subtle">${email===normEmail(state.household.ownerEmail)?"Owner":"Member"}</div></div>${isOwner&&email!==normEmail(state.household.ownerEmail)?`<button class="mini-action danger-action" data-member-remove="${esc(email)}">Remove</button>`:""}</div>`).join("")}`;const form=$("#memberForm");if(form)form.onsubmit=addMember}
async function addMember(e){e.preventDefault();if(!owner())return error("Only the owner can add members","Ask the household owner to update users.");const email=normEmail(new FormData(e.target).get("email"));if(!email)return;const memberEmails=Array.from(new Set([...(state.household.memberEmails||[]).map(normEmail),email].filter(Boolean)));try{await updateDoc(doc(db,"households",state.household.id),{memberEmails,updatedAt:serverTimestamp()});state.household.memberEmails=memberEmails;renderHousehold();toast("Member added")}catch(err){error("Member wasn't added",err.message)}}
async function removeMember(email){if(!owner())return;const target=normEmail(email),ownerEmail=normEmail(state.household.ownerEmail),memberEmails=(state.household.memberEmails||[]).map(normEmail).filter(e=>e&&(e!==target||e===ownerEmail));try{await updateDoc(doc(db,"households",state.household.id),{memberEmails,updatedAt:serverTimestamp()});state.household.memberEmails=memberEmails;renderHousehold();toast("Member removed")}catch(err){error("Member wasn't removed",err.message)}}

/* =========================================================================
   ILLUSTRATED AVATAR FAMILY — hand-built SVG, no photos/emoji. Real workers
   have no stored gender/seed, so both are derived deterministically from
   the worker's id purely for coherent, stable illustration variety — this
   is cosmetic only and never stored or treated as real demographic data.
   ========================================================================= */
function hashOf(str){let h=0;for(let i=0;i<str.length;i++){h=(h*31+str.charCodeAt(i))|0}return Math.abs(h)}
let _avId=0;
function avatarSVG(w){
  const h=hashOf(w.id), gender=h%2===0?"f":"m";
  const palettes=[
    {skin:'#EFC4A0',hair:'#2E211A',shirt:'#3E6FBF',bgTop:'#EAF1FB',bgBot:'#D7E4F6'},
    {skin:'#D89A6C',hair:'#1C1712',shirt:'#C97A3B',bgTop:'#FBEEE0',bgBot:'#F3DEC4'},
    {skin:'#F3D0A8',hair:'#4A2F1C',shirt:'#2E9165',bgTop:'#E7F5EE',bgBot:'#D3ECE0'},
    {skin:'#C48355',hair:'#170F0A',shirt:'#C2544B',bgTop:'#FBEAE7',bgBot:'#F3D5D0'},
    {skin:'#F0CBA3',hair:'#3A2A1B',shirt:'#7A5EC4',bgTop:'#EFEAFA',bgBot:'#DFD5F3'}
  ];
  const p=palettes[h%palettes.length];
  const id="av"+(_avId++);
  const hairBack=gender==="f"
    ?`<path d="M11 34 C9 16 20 6 32 6 C44 6 55 16 53 34 C53 42 50 50 48 55 L46 40 C46 34 44 30 44 30 L20 30 C20 30 18 34 18 40 L16 55 C14 50 11 42 11 34 Z" fill="${p.hair}"/>`
    :`<path d="M13 30 C13 14 21 7 32 7 C43 7 51 14 51 30 L51 24 C51 24 46 26 46 22 L18 22 C18 26 13 24 13 24 Z" fill="${p.hair}"/>`;
  const hairFront=gender==="f"
    ?`<path d="M14 22 C14 12 22 8 32 8 C42 8 50 12 50 22 C46 16 39 13 32 13 C25 13 18 16 14 22 Z" fill="${p.hair}"/>`
    :`<path d="M15 21 C17 12 24 9 32 9 C40 9 47 12 49 21 C44 15 39 18 32 17 C25 18 20 15 15 21 Z" fill="${p.hair}"/>`;
  const beard=gender==="m"?`<path d="M19 30 C18 40 22 48 32 49 C42 48 46 40 45 30 L43 38 C41 43 36 46 32 46 C28 46 23 43 21 38 Z" fill="${p.hair}" opacity="0.92"/>`:"";
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <defs><clipPath id="clip-${id}"><circle cx="32" cy="32" r="32"/></clipPath>
      <linearGradient id="bg-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.bgTop}"/><stop offset="1" stop-color="${p.bgBot}"/></linearGradient>
    </defs>
    <g clip-path="url(#clip-${id})">
      <rect width="64" height="64" fill="url(#bg-${id})"/>
      <path d="M8 66 C8 48 18 40 32 40 C46 40 56 48 56 66 Z" fill="${p.shirt}"/>
      <rect x="27" y="34" width="10" height="12" rx="4" fill="${p.skin}"/>
      ${hairBack}<ellipse cx="32" cy="27" rx="13" ry="14.5" fill="${p.skin}"/>${beard}${hairFront}
      <path d="M22 21.5 q3.5 -2.4 7 -0.2" stroke="${p.hair}" stroke-width="1.3" fill="none" stroke-linecap="round"/>
      <path d="M35 21.3 q3.5 -2.2 7 -0.2" stroke="${p.hair}" stroke-width="1.3" fill="none" stroke-linecap="round"/>
      <ellipse cx="26" cy="26.5" rx="2.6" ry="1.9" fill="#fff"/><ellipse cx="38" cy="26.5" rx="2.6" ry="1.9" fill="#fff"/>
      <circle cx="26.4" cy="26.6" r="1.15" fill="#2B2318"/><circle cx="38.4" cy="26.6" r="1.15" fill="#2B2318"/>
      <circle cx="26.8" cy="26.2" r="0.35" fill="#fff"/><circle cx="38.8" cy="26.2" r="0.35" fill="#fff"/>
      <ellipse cx="20.5" cy="29" rx="2.2" ry="1.6" fill="#E8967A" opacity="0.35"/><ellipse cx="43.5" cy="29" rx="2.2" ry="1.6" fill="#E8967A" opacity="0.35"/>
      <path d="M31 28 q1 2.6 0 4" stroke="#C98E68" stroke-width="1.1" fill="none" stroke-linecap="round" opacity="0.6"/>
      ${gender==="m"?`<path d="M28.5 34.5 q3.5 2 7 0" stroke="#3a2418" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
                   :`<path d="M27.5 34 q4.5 3.4 9 0" stroke="#B5583F" stroke-width="1.7" fill="none" stroke-linecap="round"/>`}
    </g></svg>`;
}
function makeAvatar(w,size){ return `<div class="avatar" style="width:${size}px;height:${size}px">${avatarSVG(w)}<span class="role-badge">${roleIconSVG(w.role)}</span></div>`; }
window.makeAvatar=makeAvatar; // exposed so settlement.js's Pay rows can reuse the same illustration system

// Small custom vector role icons in the same illustration family — NOT emoji.
// Roles are free text (e.g. "Housemaid, car cleaner"), so this matches by
// keyword rather than assuming a fixed set of role names.
function roleIconSVG(role){
  const stroke="#5A4A38", r=(role||"").toLowerCase();
  const icons={
    maid:`<path d="M6 21 L14 8 M12 8 h4 M9 13 h6" stroke="${stroke}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
    clean:`<rect x="9" y="6" width="5" height="8" rx="1.5" stroke="${stroke}" stroke-width="1.4" fill="none"/><path d="M11.5 14 v7 M8 21 h7" stroke="${stroke}" stroke-width="1.4" stroke-linecap="round"/>`,
    cook:`<path d="M5 12 a7 5 0 0 1 14 0 Z" stroke="${stroke}" stroke-width="1.5" fill="none"/><path d="M4 12 h16" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round"/><path d="M9 4 v3 M12 3 v4 M15 4 v3" stroke="${stroke}" stroke-width="1.3" stroke-linecap="round"/>`,
    drive:`<circle cx="12" cy="12" r="7" stroke="${stroke}" stroke-width="1.5" fill="none"/><circle cx="12" cy="12" r="1.6" fill="${stroke}"/><path d="M12 5 v3 M12 16 v3 M5 12 h3 M16 12 h3" stroke="${stroke}" stroke-width="1.3" stroke-linecap="round"/>`,
    car:`<circle cx="12" cy="12" r="7" stroke="${stroke}" stroke-width="1.5" fill="none"/><circle cx="12" cy="12" r="1.6" fill="${stroke}"/><path d="M12 5 v3 M12 16 v3 M5 12 h3 M16 12 h3" stroke="${stroke}" stroke-width="1.3" stroke-linecap="round"/>`,
    garden:`<path d="M12 21 V9" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round"/><path d="M12 9 C8 9 6 6 6 3 C10 3 12 6 12 9 Z" fill="${stroke}" opacity="0.85"/><path d="M12 13 C16 13 18 10 18 7 C14 7 12 10 12 13 Z" fill="${stroke}" opacity="0.6"/>`,
    default:`<circle cx="12" cy="9" r="3.4" stroke="${stroke}" stroke-width="1.5" fill="none"/><path d="M5 20 C5 15 8 13 12 13 C16 13 19 15 19 20" stroke="${stroke}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`
  };
  const key=Object.keys(icons).find(k=>k!=="default"&&r.includes(k));
  return `<svg viewBox="0 0 24 24">${icons[key||"default"]}</svg>`;
}

/* =========================================================================
   TODAY — one chip per worker; the sheet handles morning/evening
   complexity progressively rather than exposing two permanent pills.
   ========================================================================= */
const statusMeta={
  unmarked:{label:"Tap to mark",cls:"unmarked"}, present:{label:"Present",cls:"present"},
  absent:{label:"Absent",cls:"absent"}, halfday:{label:"Half Day",cls:"halfday"}, leave:{label:"Leave",cls:"leave"}
};
function renderToday(){
  const active=state.workers.filter(w=>w.active!==false), today=iso(new Date());
  const dateLabel=new Date().toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long"});
  let html=`<div class="screen-motif" aria-hidden="true"><svg viewBox="0 0 120 90" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 55 L45 25 L80 55" stroke="#0F6E45" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M20 55 V80 H70 V55" stroke="#0F6E45" stroke-width="2" fill="none" stroke-linejoin="round"/>
      <path d="M92 40 C92 30 100 24 108 24 C108 34 100 40 92 40 Z" stroke="#0F6E45" stroke-width="1.6" fill="none"/>
      <path d="M92 40 V60" stroke="#0F6E45" stroke-width="1.6" stroke-linecap="round"/>
    </svg></div>
    <div class="greeting-row"><div class="greeting"><div class="hi">Good day</div><h1 class="disp">Today</h1></div>
    <div class="progress-pill"><span class="n" id="progressN">0/0</span><span class="lbl">shifts</span></div></div>
    <div class="date-line">${dateLabel}</div>
    <div id="completionBanner" class="completion-banner hidden"><div class="tick">●</div><div id="completionText"></div></div>`;
  if(!active.length){
    html+=`<div class="empty-state"><div class="avatar" style="background:var(--surface);margin:0 auto 14px">${avatarSVG({id:"empty"})}</div><h3>Let's add your first worker</h3><p>Once you add someone, you'll see them here every day for quick attendance.</p><button class="primary-btn" data-action="add">+ Add your first worker</button></div>`;
  } else {
    html+=`<p class="section-title">Today's household</p>`;
    html+=active.map(w=>{
      const morning=shiftValue(w.id,today,"morning"), evening=shiftType(w)==="single"?null:shiftValue(w.id,today,"evening");
      const derived=derivedStatus(w,today);
      let chipState="unmarked", note="";
      if(derived==="partial"){ chipState=morning!=="unmarked"?morning:evening; note=morning==="unmarked"?"Morning still pending":"Evening still pending"; }
      else if(derived!=="unmarked"){ chipState=derived; }
      const m=statusMeta[chipState];
      return `<div class="worker-card">${makeAvatar(w,54)}
        <div class="worker-info"><p class="worker-name">${esc(w.name)}</p><div class="worker-meta">${esc(w.role||"Worker")}</div></div>
        <div class="worker-actions">
          <button class="status-pill ${m.cls}" data-open-sheet="${w.id}" data-date="${today}">${chipState!=="unmarked"?'<span class="dot"></span>':''}${m.label}</button>
          ${note?`<div class="pending-note">${note}</div>`:""}
        </div></div>`;
    }).join("");
  }
  $("#todayPanel").innerHTML=html;
  const totalShifts=active.reduce((s,w)=>s+(shiftType(w)==="single"?1:2),0);
  const markedShifts=active.reduce((s,w)=>{const m=shiftValue(w.id,today,"morning")!=="unmarked",e=shiftType(w)==="single"?false:shiftValue(w.id,today,"evening")!=="unmarked";return s+(m?1:0)+(e?1:0)},0);
  $("#progressN").textContent=`${markedShifts}/${totalShifts}`;
  $("#completionText").textContent=`All ${totalShifts} shifts marked ✓`;
  $("#completionBanner").classList.toggle("hidden", totalShifts===0 || markedShifts<totalShifts);
}

/* =========================================================================
   ATTENDANCE SHEET — shared by Today and Calendar. Opens on whichever
   shift still needs marking; the Morning/Evening toggle only appears when
   editing an already-complete day. Writes go through the existing,
   unchanged saveAttendance()/load() pipeline — see the note on sheetCtx
   for the one honest trade-off this involves.
   ========================================================================= */
let sheetCtx={workerId:null,date:null,shift:null};
function findWorker(id){ return state.workers.find(x=>x.id===id) }
function openAttendance(workerId,date,forceShift){
  const w=findWorker(workerId); if(!w) return;
  let shift=forceShift;
  if(!shift){
    if(shiftType(w)==="single") shift="morning";
    else { const m=shiftValue(workerId,date,"morning"); shift = m==="unmarked" ? "morning" : (shiftValue(workerId,date,"evening")==="unmarked" ? "evening" : "morning"); }
  }
  sheetCtx={workerId,date,shift};
  $("#sheetAvatar").outerHTML=makeAvatar(w,44).replace('class="avatar"','id="sheetAvatar" class="avatar"');
  $("#sheetName").textContent=w.name;
  const dateLabel = date===iso(new Date()) ? "Today" : parseDate(date).toLocaleDateString(undefined,{weekday:"short",day:"numeric",month:"short"});
  $("#sheetSub").textContent = dateLabel + (shiftType(w)==="double" ? (shift==="morning"?" · Morning":" · Evening") : "");
  const toggle=$("#shiftToggle");
  toggle.classList.toggle("hidden", shiftType(w)!=="double");
  $$(".shift-toggle button").forEach(b=>b.classList.toggle("active", b.dataset.shift===shift));
  highlightState(shiftValue(workerId,date,shift));
  $("#attendanceSheet").classList.add("open"); $("#sheetBackdrop").classList.add("open");
}
function highlightState(v){ $$(".state-btn").forEach(b=>b.classList.toggle("selected", b.dataset.state===v)) }
function closeSheet(){ $("#attendanceSheet").classList.remove("open"); $("#sheetBackdrop").classList.remove("open") }
async function selectState(state_){
  const {workerId,date,shift}=sheetCtx, w=findWorker(workerId);
  if(!w) return;
  // The existing saveAttendance() reloads all household data after every write
  // (unchanged, protected behavior) — so unlike a client-only mock, advancing
  // to the second shift means a brief reload between taps, not an instant
  // transition. We re-derive whether to advance from the freshly loaded data.
  const wasDouble=shiftType(w)==="double";
  const otherShift = shift==="morning" ? "evening" : "morning";
  const otherWasUnmarked = wasDouble && shiftValue(workerId,date,otherShift)==="unmarked";
  closeSheet();
  await saveAttendance(workerId,date,shift,state_);
  if(otherWasUnmarked && findWorker(workerId)) openAttendance(workerId,date,otherShift);
}

/* =========================================================================
   CALENDAR — worker- and date-aware, built on the existing monthRows().
   ========================================================================= */
let calWorkerId=null, calYear=new Date().getFullYear(), calMonthIdx=new Date().getMonth(), calSelectedDay=new Date().getDate();
function renderCalendar(){
  const active=state.workers.filter(w=>w.active!==false);
  if(!calWorkerId || !active.find(w=>w.id===calWorkerId)) calWorkerId=active[0]?.id||null;
  let html=`<h1 class="disp" style="font-size:19px;margin-bottom:14px">Calendar</h1>`;
  if(!active.length){ html+=`<div class="empty-state"><p>Add a worker first to see their calendar.</p></div>`; $("#calendarPanel").innerHTML=html; return; }
  html+=`<div class="worker-selector">${active.map(w=>`<button class="worker-chip ${w.id===calWorkerId?"active":""}" data-cal-worker="${w.id}">${makeAvatar(w,42)}<span>${esc(w.name)}</span></button>`).join("")}</div>`;
  const monthLabel=new Date(calYear,calMonthIdx,1).toLocaleDateString(undefined,{month:"long",year:"numeric"});
  html+=`<div class="month-nav"><button data-cal-nav="-1">‹</button><div class="lbl">${monthLabel}</div><button data-cal-nav="1">›</button></div>`;
  html+=`<div class="cal-dow"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>`;
  const w=findWorker(calWorkerId), rows=monthRows(w,calYear,calMonthIdx), firstDow=new Date(calYear,calMonthIdx,1).getDay(), today=iso(new Date());
  let grid=""; for(let i=0;i<firstDow;i++) grid+='<div class="cal-cell empty"></div>';
  rows.forEach((r,i)=>{
    const d=i+1, vals=[r.morning, shiftType(w)==="single"?null:r.evening].filter(Boolean);
    let cls="";
    if(!vals.includes("unmarked")&&vals.length){
      if(vals.every(v=>v==="present")) cls="present"; else if(vals.every(v=>v==="leave")) cls="leave"; else if(vals.every(v=>v==="absent")) cls="absent"; else cls="halfday";
    }
    const isToday = r.date===today ? "today-mark" : "";
    grid+=`<div class="cal-cell ${cls} ${isToday} ${d===calSelectedDay?"selected":""}" data-cal-day="${d}">${d}</div>`;
  });
  html+=`<div class="cal-grid">${grid}</div>`;
  $("#calendarPanel").innerHTML=html;
  renderDateDetail();
}
function renderDateDetail(){
  const w=findWorker(calWorkerId); if(!w) return;
  const date=iso(new Date(calYear,calMonthIdx,calSelectedDay)), today=iso(new Date());
  const dateLabel = date===today ? "Today" : parseDate(date).toLocaleDateString(undefined,{weekday:"short",day:"numeric",month:"short"});
  const rows = shiftType(w)==="double" ? [["Morning","morning"],["Evening","evening"]] : [["Today","morning"]];
  const html=`<div class="date-detail"><div class="top">${dateLabel} · ${esc(w.name)}</div>
    ${rows.map(([label,shift])=>{ const v=shiftValue(w.id,date,shift), m=statusMeta[v];
      return `<div class="shift-detail-row"><span class="lbl">${label}</span>
        <button data-open-sheet="${w.id}" data-date="${date}" data-shift="${shift}">
          <span class="status-pill ${m.cls}">${m.label}</span><span class="edit-chevron">›</span>
        </button></div>`;
    }).join("")}</div>`;
  const existing=$("#calendarPanel .date-detail"); if(existing) existing.outerHTML=html; else $("#calendarPanel").insertAdjacentHTML("beforeend",html);
}

/* =========================================================================
   WORKERS ROSTER
   ========================================================================= */
function renderWorkers(){
  $("#workersPanel").innerHTML=`<div class="section-head"><div><h2>Your household</h2></div><button class="primary-btn" data-action="add">+ Add</button></div>
  ${state.workers.length ? `<div class="roster-surface">${state.workers.map(w=>`
    <button class="roster-row" data-open-details="${w.id}">${makeAvatar(w,44)}
      <div><div class="worker-name">${esc(w.name)} ${w.active===false?'<span class="inactive-tag">· Inactive</span>':''}</div>
      <div class="worker-meta">${esc(w.role||"Worker")} · ${payLine(w)}</div></div>
      <span class="chevron">›</span>
    </button>`).join("")}</div>` : `<div class="empty-state"><p>No workers yet.</p></div>`}`;
}
function payLine(w){ return w.payType==="monthly" ? `₹${Number(w.monthlySalary||0).toLocaleString("en-IN")}/month` : `₹${Number(w.dailyRate||0).toLocaleString("en-IN")}/day`; }

/* =========================================================================
   ADD WORKER — Name → Role → Pay only. Shift pattern defaults to single
   and is changed afterward in Worker Details, not during onboarding.
   ========================================================================= */
function addWorkerModal(){
  $("#modalContent").innerHTML=`<h2>Add worker</h2>
    <form id="wf" class="form-grid">
      <label>What's their name?<input name="name" required placeholder="e.g. Kamla"></label>
      <label>What do they do?<input name="role" placeholder="e.g. Housemaid, Cook, Driver"></label>
      <label>How many visits a day?
        <div class="toggle-row"><button type="button" class="active" data-shift="single">One</button><button type="button" data-shift="double">Two (morning &amp; evening)</button></div>
      </label>
      <label>How do you pay them?
        <div class="toggle-row"><button type="button" class="active" data-pay="daily">Daily</button><button type="button" data-pay="monthly">Monthly</button></div>
      </label>
      <label id="rateLabel">Daily rate (₹)<input name="rate" type="number" min="0" step="1" required></label>
      <div class="form-actions"><button type="button" class="secondary-btn" id="cancel">Cancel</button><button class="primary-btn">Save</button></div>
    </form>
    <p class="link-btn">Leave allowance and other details can be added from Worker Details later.</p>`;
  $("#modal").classList.remove("hidden");
  $("#cancel").onclick=()=>$("#modal").classList.add("hidden");
  let payType="daily", shiftType_="single";
  $$('#modalContent [data-shift]').forEach(b=>b.onclick=()=>{shiftType_=b.dataset.shift;$$('#modalContent [data-shift]').forEach(x=>x.classList.toggle("active",x===b))});
  $$('#modalContent [data-pay]').forEach(b=>b.onclick=()=>{payType=b.dataset.pay;$$('#modalContent [data-pay]').forEach(x=>x.classList.toggle("active",x===b));$("#rateLabel").innerHTML=(payType==="monthly"?"Monthly amount (₹)":"Daily rate (₹)")+`<input name="rate" type="number" min="0" step="1" required>`});
  $("#wf").onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(e.target), rate=Number(f.get("rate")||0);
    const data={name:String(f.get("name")).trim(),role:String(f.get("role")).trim(),shiftType:shiftType_,monthlyPaidLeaves:2,paymentPolicy:"deduct",active:true,
      payType, dailyRate: payType==="daily"?rate:0, monthlySalary: payType==="monthly"?rate:0, updatedAt:serverTimestamp()};
    if(!data.name) return;
    try{ await addDoc(path("workers"),{...data,createdAt:serverTimestamp()}); $("#modal").classList.add("hidden"); await load(); toast("Worker added") }
    catch(err){ error("Worker wasn't saved",err.message) }
  };
}

/* =========================================================================
   WORKER DETAILS — Details / History / Money tabs. Edit toggle genuinely
   persists to Firestore (shift pattern, leave allowance, rate, status).
   Contact fields are explicitly placeholder — this app has no phone/
   address/notes fields in the schema, and we don't fabricate the
   appearance of real data for them.
   ========================================================================= */
let detailWorkerId=null, detailTab="details", editing=false, moreInfoOpen=false;
function openDetails(id){ const w=findWorker(id); detailWorkerId=id; detailTab="details"; editing=false; moreInfoOpen=false; renderDetails(); window.selectView("workers"); $("#detailsPanel").classList.remove("hidden"); $("#workersPanel").classList.add("hidden"); const t=$("#screenTitle"); if(t&&w) t.textContent=w.name; }
function closeDetails(){ $("#detailsPanel").classList.add("hidden"); window.selectView("workers"); }
function setDetailTab(tab){ detailTab=tab; editing=false; renderDetails(); }
function toggleMoreInfo(){ moreInfoOpen=!moreInfoOpen; renderDetails(); }
function renderDetails(){
  const w=findWorker(detailWorkerId); if(!w){ closeDetails(); return; }
  let html=`<button class="secondary-btn" data-action="close-details" style="margin-bottom:12px">← Back</button>
    <div class="detail-header">${makeAvatar(w,58)}<div><div class="name">${esc(w.name)}</div><div class="role">${esc(w.role||"Worker")} · ${w.active===false?"Inactive":"Active"}</div></div></div>
    <div class="detail-tabs">
      <button class="${detailTab==="details"?"active":""}" data-detail-tab="details">Details</button>
      <button class="${detailTab==="history"?"active":""}" data-detail-tab="history">History</button>
      <button class="${detailTab==="money"?"active":""}" data-detail-tab="money">Money</button>
    </div>`;
  if(detailTab==="details"){
    const editBtn=`<button class="edit-toggle-btn ${editing?"saving":""}" data-action="toggle-edit">${editing?"Save":"Edit details"}</button>`;
    if(editing){
      html+=`<form id="detailsForm" class="detail-surface">
        <div class="detail-row"><span>Comes in</span>
          <div class="toggle-row" style="width:60%"><button type="button" class="${shiftType(w)==="single"?"active":""}" data-shift-choice="single">Once</button><button type="button" class="${shiftType(w)==="double"?"active":""}" data-shift-choice="double">Twice</button></div>
        </div>
        <div class="detail-row"><span>Paid leave/month</span><input name="leave" type="number" min="0" step="1" value="${w.monthlyPaidLeaves??2}"></div>
        <div class="detail-row"><span>Pay basis</span>
          <div class="toggle-row" style="width:60%"><button type="button" class="${w.payType!=="monthly"?"active":""}" data-pay-choice="daily">Daily</button><button type="button" class="${w.payType==="monthly"?"active":""}" data-pay-choice="monthly">Monthly</button></div>
        </div>
        <div class="detail-row"><span id="rateFieldLabel">${w.payType==="monthly"?"Monthly amount":"Daily rate"} (₹)</span><input name="rate" type="number" min="0" step="1" value="${w.payType==="monthly"?(w.monthlySalary??0):(w.dailyRate??0)}"></div>
        <div class="detail-row"><span>If leave exceeds allowance</span>
          <div class="toggle-row" style="width:60%"><button type="button" class="${w.paymentPolicy!=="full"?"active":""}" data-policy-choice="deduct">Deduct</button><button type="button" class="${w.paymentPolicy==="full"?"active":""}" data-policy-choice="full">Pay full</button></div>
        </div>
        <div class="detail-row"><span>Status</span>
          <div class="toggle-row" style="width:60%"><button type="button" class="${w.active!==false?"active":""}" data-status-choice="true">Active</button><button type="button" class="${w.active===false?"active":""}" data-status-choice="false">Inactive</button></div>
        </div>
      </form>${editBtn}`;
    } else {
      html+=`<div class="detail-surface">
        <div class="detail-row"><span>Comes in</span><span>${shiftType(w)==="double"?"Morning & evening":"One visit a day"}</span></div>
        <div class="detail-row"><span>Paid leave/month</span><span>${w.monthlyPaidLeaves??2} days</span></div>
        <div class="detail-row"><span>Pay</span><span>${payLine(w)}</span></div>
        <div class="detail-row"><span>If leave exceeds allowance</span><span>${w.paymentPolicy==="full"?"Still paid in full":"Deducted"}</span></div>
        <button class="more-info-toggle" data-action="toggle-more-info">${moreInfoOpen?"Hide contact info":"Contact info"} <span>${moreInfoOpen?"▲":"▼"}</span></button>
        ${moreInfoOpen?`<p class="placeholder-note">This app doesn't store contact details yet — nothing real is shown here.</p>
          <div class="detail-row"><span>Phone</span><span class="empty-field">Not added</span></div>
          <div class="detail-row"><span>Address</span><span class="empty-field">Not added</span></div>`:""}
      </div>${editBtn}`;
    }
  } else if(detailTab==="history"){
    const today=new Date(), rows=[];
    for(let i=6;i>=0;i--){ const d=new Date(today); d.setDate(today.getDate()-i); const ds=iso(d), stat=derivedStatus(w,ds); rows.push([ds,stat]); }
    html+=`<div class="detail-surface">${rows.map(([ds,stat])=>{ const m=statusMeta[stat]; const label=parseDate(ds).toLocaleDateString(undefined,{weekday:"short",day:"numeric",month:"short"});
      return `<div class="detail-row"><span>${label}</span><span class="status-pill ${m.cls}" style="padding:5px 10px;font-size:11.5px">${m.label}</span></div>`; }).join("")}</div>`;
  } else {
    const now=new Date(), start=iso(new Date(now.getFullYear(),now.getMonth(),1)), end=iso(now), stats=workerStats(w,start,end);
    html+=`<div class="detail-surface">
      <div class="detail-row"><span>This month so far</span><span>₹${stats.finalPayment.toLocaleString("en-IN")}</span></div>
      <div class="detail-row"><span>Attended days</span><span>${stats.presentDays}</span></div>
      <div class="detail-row"><span>Paid leave used</span><span>${stats.paidLeaveDays}</span></div>
      ${stats.deduction?`<div class="detail-row"><span>Deduction</span><span>− ₹${stats.deduction.toLocaleString("en-IN")}</span></div>`:""}
    </div>`;
  }
  $("#detailsPanel").innerHTML=html;
  if(editing){
    let pendingShift=shiftType(w), pendingPay=w.payType==="monthly"?"monthly":"daily", pendingPolicy=w.paymentPolicy==="full"?"full":"deduct", pendingActive=w.active!==false;
    const syncRateLabel=()=>{ $("#rateFieldLabel").textContent=(pendingPay==="monthly"?"Monthly amount":"Daily rate")+" (₹)"; };
    $$('[data-shift-choice]').forEach(b=>b.onclick=()=>{pendingShift=b.dataset.shiftChoice;$$('[data-shift-choice]').forEach(x=>x.classList.toggle("active",x===b))});
    $$('[data-pay-choice]').forEach(b=>b.onclick=()=>{pendingPay=b.dataset.payChoice;$$('[data-pay-choice]').forEach(x=>x.classList.toggle("active",x===b));syncRateLabel()});
    $$('[data-policy-choice]').forEach(b=>b.onclick=()=>{pendingPolicy=b.dataset.policyChoice;$$('[data-policy-choice]').forEach(x=>x.classList.toggle("active",x===b))});
    $$('[data-status-choice]').forEach(b=>b.onclick=()=>{pendingActive=b.dataset.statusChoice==="true";$$('[data-status-choice]').forEach(x=>x.classList.toggle("active",x===b))});
    $('[data-action="toggle-edit"]').onclick=async ()=>{
      const form=$("#detailsForm"), fd=new FormData(form), rate=Number(fd.get("rate")||0), leave=Number(fd.get("leave")||0);
      const data={shiftType:pendingShift, monthlyPaidLeaves:leave, payType:pendingPay, dailyRate:pendingPay==="daily"?rate:w.dailyRate, monthlySalary:pendingPay==="monthly"?rate:w.monthlySalary, paymentPolicy:pendingPolicy, active:pendingActive, updatedAt:serverTimestamp()};
      try{ await updateDoc(path("workers",w.id),data); await load(); openDetails(w.id); toast("Worker updated") }
      catch(err){ error("Worker wasn't saved",err.message) }
    };
  } else {
    const editBtn=$('[data-action="toggle-edit"]'); if(editBtn) editBtn.onclick=()=>{editing=true;renderDetails()};
  }
}

/* =========================================================================
   ACCOUNT MENU / HOUSEHOLD OVERLAY
   ========================================================================= */
function syncAccountUI(){const emailEl=$("#accountEmail");if(emailEl)emailEl.textContent=state.user?.email||"";const avatarEl=$("#avatarInitial");if(avatarEl)avatarEl.textContent=(state.user?.email||"?").trim()[0]?.toUpperCase()||"?"}
function closeAccountMenu(){const m=$("#accountMenu");if(m){m.classList.add("hidden");$("#accountBtn")?.setAttribute("aria-expanded","false")}}

/* Panel visibility for the 4 tabs is owned by navigation.js; render() must
   never toggle panel .hidden classes itself (this was Bug 2 previously). */
function render(){renderToday();renderCalendar();window.renderPay?.();renderWorkers();syncAccountUI();if(state.household)renderHousehold()}
window.__onViewChanged=(view)=>{
  if(view==="calendar") renderCalendar();
  if(view==="pay" && window.renderPay) window.renderPay();
  if(view==="workers"){ $("#detailsPanel").classList.add("hidden"); renderWorkers(); }
};

/* =========================================================================
   EVENT WIRING
   ========================================================================= */
$("#googleSignInBtn").onclick=async()=>{try{await signInWithPopup(auth,provider)}catch(e){error("Google sign-in failed",e.message)}};
$("#refreshBtn").onclick=()=>{closeAccountMenu();load()};
$("#closeModal").onclick=()=>$("#modal").classList.add("hidden");
$("#accountBtn").onclick=e=>{e.stopPropagation();const m=$("#accountMenu"),willOpen=m.classList.contains("hidden");m.classList.toggle("hidden");$("#accountBtn").setAttribute("aria-expanded",String(willOpen))};
document.addEventListener("click",()=>closeAccountMenu());
$("#householdBtn").onclick=()=>{closeAccountMenu();renderHousehold();$("#householdOverlay").classList.remove("hidden")};
$("#closeHousehold").onclick=()=>$("#householdOverlay").classList.add("hidden");

document.addEventListener("click",e=>{
  const sheetBtn=e.target.closest("[data-open-sheet]");
  if(sheetBtn){ openAttendance(sheetBtn.dataset.openSheet, sheetBtn.dataset.date, sheetBtn.dataset.shift); return; }
  const stateBtn=e.target.closest(".state-btn");
  if(stateBtn && $("#attendanceSheet").classList.contains("open")){ stateBtn.classList.add("stamping"); void stateBtn.offsetWidth; selectState(stateBtn.dataset.state); return; }
  const shiftToggleBtn=e.target.closest("#shiftToggle button");
  if(shiftToggleBtn){ openAttendance(sheetCtx.workerId, sheetCtx.date, shiftToggleBtn.dataset.shift); return; }
  const calWorkerBtn=e.target.closest("[data-cal-worker]");
  if(calWorkerBtn){ calWorkerId=calWorkerBtn.dataset.calWorker; renderCalendar(); return; }
  const calNavBtn=e.target.closest("[data-cal-nav]");
  if(calNavBtn){ calMonthIdx+=Number(calNavBtn.dataset.calNav); if(calMonthIdx<0){calMonthIdx=11;calYear--} if(calMonthIdx>11){calMonthIdx=0;calYear++} calSelectedDay=1; renderCalendar(); return; }
  const calDayBtn=e.target.closest("[data-cal-day]");
  if(calDayBtn){ calSelectedDay=Number(calDayBtn.dataset.calDay); renderCalendar(); return; }
  const detailsBtn=e.target.closest("[data-open-details]");
  if(detailsBtn){ openDetails(detailsBtn.dataset.openDetails); return; }
  const closeDetailsBtn=e.target.closest('[data-action="close-details"]');
  if(closeDetailsBtn){ closeDetails(); return; }
  const detailTabBtn=e.target.closest("[data-detail-tab]");
  if(detailTabBtn){ setDetailTab(detailTabBtn.dataset.detailTab); return; }
  const moreInfoBtn=e.target.closest('[data-action="toggle-more-info"]');
  if(moreInfoBtn){ toggleMoreInfo(); return; }
  const memberRemoveBtn=e.target.closest("[data-member-remove]");
  if(memberRemoveBtn){ removeMember(memberRemoveBtn.dataset.memberRemove); return; }
  const addBtn=e.target.closest('[data-action="add"]');
  if(addBtn){ addWorkerModal(); return; }
  if(e.target.closest("#sheetBackdrop")){ closeSheet(); return; }
});
document.addEventListener("click",e=>{if(e.target.id==="logoutBtn"){closeAccountMenu();signOut(auth).catch(err=>error("Sign out failed",err.message))}});
onAuthStateChanged(auth,async u=>{state.user=u;syncAccountUI();if(!u){$("#loginView").classList.remove("hidden");$("#loadingView").classList.add("hidden");$("#mainView").classList.add("hidden")}else{$("#loginView").classList.add("hidden");await load()}});
