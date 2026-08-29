import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, query, orderBy, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseConfig={apiKey:"AIzaSyBh7-h4GxX_cYZphqIvIYVVzMjQVFLKQyE",authDomain:"chatgpt-household-attendance.firebaseapp.com",projectId:"chatgpt-household-attendance",storageBucket:"chatgpt-household-attendance.firebasestorage.app",messagingSenderId:"640078047318",appId:"1:640078047318:web:fa508fb29be6621378f3f7"};
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const money=n=>`₹${Number(n||0).toLocaleString("en-IN")}`;
const parseDate=s=>{const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)};
const iso=d=>{const x=new Date(d);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`};
const monthStart=key=>`${key}-01`;
const monthEnd=key=>{const [y,m]=key.split("-").map(Number);return iso(new Date(y,m,0))};
const monthLabel=key=>parseDate(`${key}-01`).toLocaleDateString(undefined,{month:"long",year:"numeric"});
const months=()=>{const out=[];const d=new Date();for(let i=0;i<18;i++){out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);d.setMonth(d.getMonth()-1)}return out};
const dayDiff=(a,b)=>Math.floor((parseDate(b)-parseDate(a))/86400000)+1;
let user=null,workers=[],attendance=[],settlements=[],selectedMonth=`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}`;
const workerPath=(id)=>doc(db,"households",user.uid,"workers",id);
const settlementPath=(id)=>doc(db,"households",user.uid,"settlements",id);
function toast(msg){const t=$("#toast");if(!t)return;t.textContent=msg;t.classList.remove("hidden");setTimeout(()=>t.classList.add("hidden"),2400)}
function error(msg){toast(msg)}
function calculate(w,start,end){
  const rows=attendance.filter(a=>a.workerId===w.id&&a.date>=start&&a.date<=end);
  const presentShifts=rows.reduce((n,a)=>n+(a.morning==="present")+(a.evening==="present"),0);
  const leaveShifts=rows.reduce((n,a)=>n+(a.morning==="leave")+(a.evening==="leave"),0);
  const absentShifts=rows.reduce((n,a)=>n+(a.morning==="absent")+(a.evening==="absent"),0);
  const presentDays=presentShifts/2,leaveDays=leaveShifts/2,absentDays=absentShifts/2;
  const paidLeaveDays=Math.min(leaveDays,Number(w.monthlyPaidLeaves??2));
  const unpaidLeaveDays=Math.max(0,leaveDays-paidLeaveDays);
  const days=dayDiff(start,end),dailyRate=Number(w.dailyRate||0),monthlySalary=Number(w.monthlySalary||0);
  const paymentMethod=w.payType==="monthly"?"monthly":"daily";
  let basePayment,deduction,finalPayment;
  if(paymentMethod==="monthly"){
    basePayment=monthlySalary;
    deduction=w.paymentPolicy==="full"?0:unpaidLeaveDays*(monthlySalary/days);
    finalPayment=Math.max(0,basePayment-deduction);
  }else{
    basePayment=(presentDays+paidLeaveDays)*dailyRate;
    deduction=0;
    finalPayment=Math.max(0,basePayment);
  }
  return {workerId:w.id,name:w.name,paymentMethod,presentShifts,leaveShifts,absentShifts,presentDays,leaveDays,absentDays,paidLeaveDays,unpaidLeaveDays,days,dailyRate,monthlySalary,basePayment,deduction,finalPayment};
}
async function loadData(){
  if(!user)return;
  try{
    const [w,a,s]=await Promise.all([
      getDocs(query(collection(db,"households",user.uid,"workers"),orderBy("name"))),
      getDocs(query(collection(db,"households",user.uid,"attendance"),orderBy("date","desc"))),
      getDocs(query(collection(db,"households",user.uid,"settlements"),orderBy("periodStart","desc")))
    ]);
    workers=w.docs.map(d=>({id:d.id,...d.data(),monthlyPaidLeaves:Number(d.data().monthlyPaidLeaves??2),dailyRate:Number(d.data().dailyRate??0),monthlySalary:Number(d.data().monthlySalary??0)}));
    attendance=a.docs.map(d=>({id:d.id,...d.data()}));
    settlements=s.docs.map(d=>({id:d.id,...d.data()}));
    render();
  }catch(e){error(`Couldn't load settlements: ${e.message||"permission or connection error"}`)}
}
function settlementForMonth(){return settlements.find(s=>s.periodStart===monthStart(selectedMonth))}
function render(){
  const panel=$("#settlementPanel");if(!panel)return;
  const start=monthStart(selectedMonth),end=monthEnd(selectedMonth),existing=settlementForMonth();
  const active=workers.filter(w=>w.active!==false),rows=active.map(w=>calculate(w,start,end));
  const total=rows.reduce((n,r)=>n+r.finalPayment,0),totalDed=rows.reduce((n,r)=>n+r.deduction,0),paid=existing?.status==="paid";
  panel.innerHTML=`<div class="section-head"><div><h2>Monthly settlement</h2><div class="subtle">Calculate what each worker should be paid.</div></div></div>
    <div class="settlement-toolbar"><label><span class="subtle">Settlement month</span><select id="settlementMonth">${months().map(m=>`<option value="${m}" ${m===selectedMonth?"selected":""}>${monthLabel(m)}</option>`).join("")}</select></label><div class="settlement-status ${paid?"paid":"unpaid"}">${paid?"Paid":"Not paid"}</div></div>
    <div class="settlement-summary"><div><span>Total workers</span><strong>${rows.length}</strong></div><div><span>Total deductions</span><strong>${money(totalDed)}</strong></div><div><span>Total payable</span><strong>${money(total)}</strong></div></div>
    ${rows.length?rows.map(r=>`<article class="settlement-card"><div class="settlement-card-head"><div><h3>${esc(r.name)}</h3><div class="subtle">${r.paymentMethod==="monthly"?`Monthly salary ${money(r.monthlySalary)}`:`Daily rate ${money(r.dailyRate)}`}</div></div><strong class="settlement-amount">${money(r.finalPayment)}</strong></div><div class="settlement-breakdown"><span>${r.presentDays} present days</span><span>${r.paidLeaveDays} paid leave days</span><span>${r.unpaidLeaveDays} unpaid leave days</span><span>${r.absentDays} absent days</span></div><div class="settlement-line"><span>Base</span><strong>${money(r.basePayment)}</strong></div>${r.deduction?`<div class="settlement-line deduction"><span>Excess leave deduction</span><strong>− ${money(r.deduction)}</strong></div>`:""}</article>`).join(""):"<div class='summary-card'><h3>No active workers</h3><p class='subtle'>Add workers first, then return here to calculate settlement.</p></div>"}
    <div class="settlement-actions"><button class="mini-action" id="saveSettlement">${paid?"Update paid record":"Save settlement"}</button>${paid?`<span class="subtle">Marked paid on ${existing.paidAt?.toDate?existing.paidAt.toDate().toLocaleDateString():"recorded date"}</span>`:"<span class='subtle'>Saving does not mark it paid until you confirm below.</span>"}</div>`;
  $("#settlementMonth").onchange=e=>{selectedMonth=e.target.value;render()};
  $("#saveSettlement").onclick=()=>saveSettlement(rows,total,totalDed,paid);
}
async function saveSettlement(rows,total,deduction,alreadyPaid){
  if(!user)return;
  const existing=settlementForMonth();
  try{
    const id=`month_${selectedMonth}`;
    const payload={kind:"month",periodStart:monthStart(selectedMonth),periodEnd:monthEnd(selectedMonth),label:monthLabel(selectedMonth),summary:rows,totalDeduction:deduction,totalPayable:total,status:existing?.status||"unpaid",updatedAt:serverTimestamp()};
    if(existing?.status==="paid")payload.paidAt=existing.paidAt||serverTimestamp();
    await setDoc(settlementPath(id),payload,{merge:true});
    const wantsPaid=confirm(`Settlement saved for ${monthLabel(selectedMonth)}. Mark it as PAID now?`);
    if(wantsPaid){await setDoc(settlementPath(id),{status:"paid",paidAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true})}
    await loadData();toast(wantsPaid?"Settlement saved and marked paid":"Settlement saved");
  }catch(e){error(`Settlement wasn't saved: ${e.message}`)}
}
document.addEventListener("click",e=>{const t=e.target.closest('.tab');if(t?.dataset.view==="settlement"){setTimeout(()=>{$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.view==="settlement"));$$('.panel').forEach(p=>p.classList.toggle('hidden',p.id!=="settlementPanel"))},0)}});
const $$=s=>[...document.querySelectorAll(s)];
onAuthStateChanged(auth,u=>{user=u;if(u)loadData()});
