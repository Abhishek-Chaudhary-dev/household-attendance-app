import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, query, where, orderBy, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
const firebaseConfig={apiKey:"AIzaSyBh7-h4GxX_cYZphqIvIYVVzMjQVFLKQyE",authDomain:"chatgpt-household-attendance.firebaseapp.com",projectId:"chatgpt-household-attendance",storageBucket:"chatgpt-household-attendance.firebasestorage.app",messagingSenderId:"640078047318",appId:"1:640078047318:web:fa508fb29be6621378f3f7"};
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app),$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));const money=n=>`₹${Number(n||0).toLocaleString("en-IN")}`;const parseDate=s=>{const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)};const iso=d=>{const x=new Date(d);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`};const monthStart=k=>`${k}-01`;const monthEnd=k=>{const[y,m]=k.split("-").map(Number);return iso(new Date(y,m,0))};const monthLabel=k=>parseDate(`${k}-01`).toLocaleDateString(undefined,{month:"long",year:"numeric"});const months=()=>{const out=[],d=new Date();for(let i=0;i<18;i++){out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);d.setMonth(d.getMonth()-1)}return out};
let user=null,householdId=null,workers=[],attendance=[],settlements=[],selectedMonth=`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}`;const normEmail=e=>String(e||"").trim().toLowerCase();
async function resolveHouseholdId(){if(!user)return null;const own=await getDoc(doc(db,"households",user.uid));if(own.exists())return own.id;const email=normEmail(user.email);if(!email)return null;const q=await getDocs(query(collection(db,"households"),where("memberEmails","array-contains",email)));return q.empty?null:q.docs[0].id}
const settlementPath=id=>doc(db,"households",householdId,"settlements",id);function toast(msg){const t=$("#toast");if(!t)return;t.textContent=msg;t.classList.remove("hidden");setTimeout(()=>t.classList.add("hidden"),2400)}

// UNCHANGED — identical formula to the previous production version and to
// app.js's workerStats(). Pay is a presentation layer on top of this; this
// function must not be extended or reimplemented differently.
function calculate(w,start,end){const rows=attendance.filter(a=>a.workerId===w.id&&a.date>=start&&a.date<=end),single=(w.shiftType??"double")==="single";const presentShifts=rows.reduce((n,a)=>n+(a.morning==="present")+(single?0:a.evening==="present"),0),leaveShifts=rows.reduce((n,a)=>n+(a.morning==="leave")+(single?0:a.evening==="leave"),0),absentShifts=rows.reduce((n,a)=>n+(a.morning==="absent")+(single?0:a.evening==="absent"),0),divisor=single?1:2,presentDays=presentShifts/divisor,leaveDays=leaveShifts/divisor,absentDays=absentShifts/divisor,paidLeaveDays=Math.min(leaveDays,Number(w.monthlyPaidLeaves??2)),unpaidLeaveDays=Math.max(0,leaveDays-paidLeaveDays),days=Math.max(1,Math.floor((parseDate(end)-parseDate(start))/86400000)+1),dailyRate=Number(w.dailyRate||0),monthlySalary=Number(w.monthlySalary||0),paymentMethod=w.payType==="monthly"?"monthly":"daily";let basePayment,deduction,finalPayment;if(paymentMethod==="monthly"){basePayment=monthlySalary;deduction=w.paymentPolicy==="full"?0:unpaidLeaveDays*(monthlySalary/days);finalPayment=Math.max(0,basePayment-deduction)}else{basePayment=(presentDays+paidLeaveDays)*dailyRate;deduction=0;finalPayment=Math.max(0,basePayment)}return{workerId:w.id,name:w.name,shiftType:single?"single":"double",paymentMethod,presentShifts,leaveShifts,absentShifts,presentDays,leaveDays,absentDays,paidLeaveDays,unpaidLeaveDays,days,dailyRate,monthlySalary,basePayment,deduction,finalPayment}}

// UNCHANGED — own independent Firestore load, same as the previous version
// (this file has always loaded its own copy of workers/attendance rather
// than sharing app.js's; that pre-existing redundant-reads pattern is not
// something this visual/interaction redesign attempts to fix).
async function loadData(){if(!user)return;try{householdId=householdId||await resolveHouseholdId();if(!householdId)throw new Error("No household access found for this Google account.");const [w,a,s]=await Promise.all([getDocs(query(collection(db,"households",householdId,"workers"),orderBy("name"))),getDocs(query(collection(db,"households",householdId,"attendance"),orderBy("date","desc"))),getDocs(query(collection(db,"households",householdId,"settlements"),orderBy("periodStart","desc")))]);workers=w.docs.map(d=>({id:d.id,...d.data(),shiftType:d.data().shiftType??"double",monthlyPaidLeaves:Number(d.data().monthlyPaidLeaves??2),dailyRate:Number(d.data().dailyRate??0),monthlySalary:Number(d.data().monthlySalary??0)}));attendance=a.docs.map(d=>({id:d.id,...d.data()}));settlements=s.docs.map(d=>({id:d.id,...d.data()}));render()}catch(e){toast(`Couldn't load settlements: ${e.message||"permission or connection error"}`)}}
function settlementForMonth(){return settlements.find(s=>s.periodStart===monthStart(selectedMonth))}

// UNCHANGED save path — same Firestore writes, same confirm-to-mark-paid flow.
async function saveSettlement(rows,total,deduction){if(!user)return;const existing=settlementForMonth();try{const id=`month_${selectedMonth}`,payload={kind:"month",periodStart:monthStart(selectedMonth),periodEnd:monthEnd(selectedMonth),label:monthLabel(selectedMonth),summary:rows,totalDeduction:deduction,totalPayable:total,status:existing?.status||"unpaid",updatedAt:serverTimestamp()};if(existing?.status==="paid")payload.paidAt=existing.paidAt||serverTimestamp();await setDoc(settlementPath(id),payload,{merge:true});const wantsPaid=confirm(`Settlement saved for ${monthLabel(selectedMonth)}. Mark it as PAID now?`);if(wantsPaid)await setDoc(settlementPath(id),{status:"paid",paidAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});await loadData();toast(wantsPaid?"Settlement saved and marked paid":"Settlement saved")}catch(e){toast(`Settlement wasn't saved: ${e.message}`)}}

/* ---- Pay UI — new markup, same data/logic above ---- */
function render(){
  const panel=$("#payPanel"); if(!panel) return;
  const start=monthStart(selectedMonth), end=monthEnd(selectedMonth), existing=settlementForMonth(), active=workers.filter(w=>w.active!==false);
  const rows=active.map(w=>calculate(w,start,end)), total=rows.reduce((n,r)=>n+r.finalPayment,0), totalDed=rows.reduce((n,r)=>n+r.deduction,0), paid=existing?.status==="paid";
  const avatar=(w,size)=>window.makeAvatar ? window.makeAvatar(w,size) : `<div class="avatar" style="width:${size}px;height:${size}px;background:var(--green-tint)"></div>`;
  panel.innerHTML=`
    <h1 class="disp" style="font-size:19px;margin-bottom:14px">Pay</h1>
    <div class="settlement-toolbar">
      <select id="settlementMonth">${months().map(m=>`<option value="${m}" ${m===selectedMonth?"selected":""}>${monthLabel(m)}</option>`).join("")}</select>
      <div class="settlement-status ${paid?"paid":"unpaid"}">${paid?"Paid":"Not paid"}</div>
    </div>
    <div class="pay-hero ${paid?"settled":""}">
      <div class="lbl">${paid?"PAID":"TO PAY THIS MONTH"}</div>
      <div class="amt">${money(total)}</div>
      <div class="sub">${rows.length} ${rows.length===1?"person":"people"} · ${monthLabel(selectedMonth)}</div>
    </div>
    ${rows.length ? `<div class="pay-surface">${rows.map(r=>{
      const w=active.find(x=>x.id===r.workerId);
      const basis = r.paymentMethod==="monthly" ? `${w?.role?esc(w.role)+" · ":""}₹${r.monthlySalary.toLocaleString("en-IN")}/month` : `${r.presentDays+r.paidLeaveDays} days marked · ₹${r.dailyRate}/day`;
      return `<div class="pay-row">${w?avatar(w,40):""}
        <div><div class="name">${esc(r.name)}</div><div class="basis">${basis}${r.deduction?`<span class="ded">− ${money(r.deduction)} leave deduction</span>`:""}</div></div>
        <div class="amt">${money(r.finalPayment)}</div>
      </div>`;
    }).join("")}</div>` : `<div class="empty-state"><p>Add workers first, then come back here to calculate pay.</p></div>`}
    ${rows.length ? `<button class="pay-cta" id="saveSettlement">${paid?"Update paid record":"Mark month as paid"}</button>
      <p class="settled-note">${paid?`Marked paid on ${existing.paidAt?.toDate?existing.paidAt.toDate().toLocaleDateString():"recorded date"}`:"Saving doesn't mark it paid until you confirm."}</p>` : ""}
  `;
  const monthSelect=$("#settlementMonth"); if(monthSelect) monthSelect.onchange=e=>{selectedMonth=e.target.value;render()};
  const saveBtn=$("#saveSettlement"); if(saveBtn) saveBtn.onclick=()=>saveSettlement(rows,total,totalDed);
}
window.renderPay=render; // exposed so app.js can trigger a re-render after actions like adding a worker

onAuthStateChanged(auth,u=>{user=u;if(u)loadData()});
