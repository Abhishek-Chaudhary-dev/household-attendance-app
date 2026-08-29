import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, collection, query, where, orderBy, updateDoc, addDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseConfig={apiKey:"AIzaSyBh7-h4GxX_cYZphqIvIYVVzMjQVFLKQyE",authDomain:"chatgpt-household-attendance.firebaseapp.com",projectId:"chatgpt-household-attendance",storageBucket:"chatgpt-household-attendance.firebasestorage.app",messagingSenderId:"640078047318",appId:"1:640078047318:web:fa508fb29be6621378f3f7"};
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const norm=e=>String(e||"").trim().toLowerCase();
const iso=d=>{const x=new Date(d);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`};
const parse=s=>{const [y,m,d]=String(s).split("-").map(Number);return new Date(y,m-1,d)};
const money=n=>`₹${Number(n||0).toLocaleString("en-IN")}`;
let user=null,householdId=null,workers=[],attendance=[];
let observerTimer=null;

async function resolveHousehold(){
  if(!user)return null;
  const own=await getDoc(doc(db,"households",user.uid));
  if(own.exists())return own.id;
  const email=norm(user.email);if(!email)return null;
  const q=await getDocs(query(collection(db,"households"),where("memberEmails","array-contains",email)));
  return q.empty?null:q.docs[0].id;
}
async function loadData(){
  if(!user)return;
  householdId=await resolveHousehold();
  if(!householdId)return;
  const [w,a]=await Promise.all([
    getDocs(query(collection(db,"households",householdId,"workers"),orderBy("name"))),
    getDocs(query(collection(db,"households",householdId,"attendance"),orderBy("date","desc")))
  ]);
  workers=w.docs.map(d=>({id:d.id,...d.data(),shiftType:d.data().shiftType||"double",monthlyPaidLeaves:Number(d.data().monthlyPaidLeaves??2),dailyRate:Number(d.data().dailyRate??0),monthlySalary:Number(d.data().monthlySalary??0)}));
  attendance=a.docs.map(d=>({id:d.id,...d.data()}));
  schedulePatch();
}
function workerForCard(card){const id=card.querySelector('[data-action="edit"]')?.dataset.id||card.querySelector('[data-shift]')?.dataset.worker;return workers.find(w=>w.id===id)}
function workerStats(w,start,end){
  const rows=attendance.filter(a=>a.workerId===w.id&&a.date>=start&&a.date<=end);
  const single=w.shiftType==="single";
  const present=rows.reduce((n,a)=>n+(a.morning==="present")+(single?0:a.evening==="present"),0);
  const leave=rows.reduce((n,a)=>n+(a.morning==="leave")+(single?0:a.evening==="leave"),0);
  const absent=rows.reduce((n,a)=>n+(a.morning==="absent")+(single?0:a.evening==="absent"),0);
  const divisor=single?1:2;
  const presentDays=present/divisor,leaveDays=leave/divisor,absentDays=absent/divisor;
  const paidLeaveDays=Math.min(leaveDays,Number(w.monthlyPaidLeaves||0));
  const unpaidLeaveDays=Math.max(0,leaveDays-paidLeaveDays);
  const days=Math.floor((parse(end)-parse(start))/86400000)+1;
  const dailyRate=Number(w.dailyRate||0),monthlySalary=Number(w.monthlySalary||0);
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
  return {workerId:w.id,name:w.name,shiftType:w.shiftType,presentShifts:present,leaveShifts:leave,absentShifts:absent,presentDays,leaveDays,absentDays,paidLeaveDays,unpaidLeaveDays,days,dailyRate,monthlySalary,paymentMethod,basePayment,deduction,finalPayment};
}
function periodMonth(value){const [y,m]=value.split("-").map(Number);return{start:`${value}-01`,end:iso(new Date(y,m,0)),label:new Date(y,m-1,1).toLocaleDateString(undefined,{month:"long",year:"numeric"})}}
function patchToday(){
  $$(".worker-card").forEach(card=>{
    const w=workerForCard(card);if(!w)return;
    const row=card.querySelector(".shift-row");if(!row)return;
    const evening=row.querySelector('[data-shift="evening"]');
    if(w.shiftType==="single"){
      if(evening)evening.remove();
      row.classList.add("single-shift");
    }else row.classList.remove("single-shift");
  });
}
function patchMonth(){
  const panel=$("#monthPanel");if(!panel||panel.classList.contains("hidden"))return;
  $$(".summary-card",panel).forEach(card=>{
    const name=card.querySelector("h3")?.textContent?.trim();
    const w=workers.find(x=>x.name===name);if(!w)return;
    const y=new Date().getFullYear(),m=new Date().getMonth(),start=iso(new Date(y,m,1)),end=iso(new Date(y,m+1,0)),s=workerStats(w,start,end);
    const vals=card.querySelectorAll(".stat strong");if(vals[0])vals[0].textContent=s.presentDays;
    if(vals[1])vals[1].textContent=s.leaveDays;
    if(vals[2])vals[2].textContent=s.absentDays;
    const labels=card.querySelectorAll(".stat span");if(labels[0])labels[0].textContent="Attended days";if(labels[1])labels[1].textContent="Leave days";if(labels[2])labels[2].textContent="Absent days";
  });
}
function patchReports(){
  const panel=$("#reportsPanel");if(!panel||panel.classList.contains("hidden"))return;
  $$(".report-metric",panel).forEach(metric=>{
    const name=metric.querySelector("strong")?.textContent?.trim();const w=workers.find(x=>x.name===name);if(!w)return;
    const text=metric.querySelector("span");if(!text)return;
    const row=metric.closest("article")?.querySelector("h3")?.textContent||"";
    const match=row.match(/(\d{4}-\d{2}-\d{2})[^\d]*(\d{4}-\d{2}-\d{2})/);
    if(!match)return;
    const s=workerStats(w,match[1],match[2]);text.textContent=`${s.presentDays} attended days · ${s.leaveDays} leave days · ${s.unpaidLeaveDays} unpaid leave days · ${money(s.finalPayment)}`;
  });
}
function patchSettlement(){
  const panel=$("#settlementPanel");if(!panel||panel.classList.contains("hidden"))return;
  const select=$("#settlementMonth");if(!select)return;
  const p=periodMonth(select.value);
  const rows=workers.filter(w=>w.active!==false).map(w=>workerStats(w,p.start,p.end));
  const cards=$$(".settlement-card",panel);
  cards.forEach(card=>{
    const name=card.querySelector("h3")?.textContent?.trim();const r=rows.find(x=>x.name===name);if(!r)return;
    const amount=card.querySelector(".settlement-amount");if(amount)amount.textContent=money(r.finalPayment);
    const breakdown=card.querySelector(".settlement-breakdown");if(breakdown)breakdown.innerHTML=`<span>${r.presentDays} attended days</span><span>${r.paidLeaveDays} paid leave days</span><span>${r.unpaidLeaveDays} unpaid leave days</span><span>${r.absentDays} absent days</span>`;
    const base=card.querySelector(".settlement-line strong");if(base)base.textContent=money(r.basePayment);
  });
  const total=rows.reduce((n,r)=>n+r.finalPayment,0),ded=rows.reduce((n,r)=>n+r.deduction,0),summary=panel.querySelector(".settlement-summary");
  if(summary){const strong=summary.querySelectorAll("strong");if(strong[1])strong[1].textContent=money(ded);if(strong[2])strong[2].textContent=money(total)}
  const save=$("#saveSettlement");if(save&&!save.dataset.shiftRulesBound){save.dataset.shiftRulesBound="1";save.onclick=()=>saveCorrectSettlement(p,rows,total,ded)}
}
async function saveCorrectSettlement(p,rows,total,deduction){
  try{
    const id=`month_${p.start.slice(0,7)}`;
    const ref=doc(db,"households",householdId,"settlements",id);
    const old=await getDoc(ref);
    const payload={kind:"month",periodStart:p.start,periodEnd:p.end,label:p.label,summary:rows,totalDeduction:deduction,totalPayable:total,status:old.exists()?old.data().status||"unpaid":"unpaid",updatedAt:serverTimestamp()};
    await setDoc(ref,payload,{merge:true});
    const wantsPaid=confirm(`Settlement saved for ${p.label}. Mark it as PAID now?`);
    if(wantsPaid)await setDoc(ref,{status:"paid",paidAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
    await loadData();$("#refreshBtn")?.click();
  }catch(e){console.error(e);alert(`Settlement wasn't saved: ${e.message}`)}
}
function patchWorkerForm(){
  const form=$("#wf");if(!form||form.dataset.shiftRulesBound)return;
  form.dataset.shiftRulesBound="1";
  const editId=form.querySelector('input[name="name"]')?.value;
  const existing=workers.find(w=>w.name===editId);
  const wrap=document.createElement("label");wrap.innerHTML=`Attendance shifts<select name="shiftType"><option value="single">One shift — morning only</option><option value="double">Two shifts — morning + evening</option></select>`;
  const select=wrap.querySelector("select");select.value=existing?.shiftType||"single";
  const actions=form.querySelector(".form-actions");form.insertBefore(wrap,actions);
  form.onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(form),name=String(f.get("name")||"").trim();
    const data={name,role:String(f.get("role")||"").trim(),monthlyPaidLeaves:Number(f.get("leave")||0),dailyRate:Number(f.get("rate")||0),payType:f.get("payType"),monthlySalary:Number(f.get("salary")||0),paymentPolicy:f.get("policy"),active:f.get("active")==="true",shiftType:String(f.get("shiftType")||"single"),updatedAt:serverTimestamp()};
    try{
      const id=workers.find(w=>w.name===editId)?.id;
      if(id)await updateDoc(doc(db,"households",householdId,"workers",id),data);else await addDoc(collection(db,"households",householdId,"workers"),{...data,createdAt:serverTimestamp()});
      $("#modal")?.classList.add("hidden");await loadData();$("#refreshBtn")?.click();
    }catch(err){console.error(err);alert(`Worker wasn't saved: ${err.message}`)}
  };
}
function interceptReportGeneration(){
  document.addEventListener("click",async e=>{
    const b=e.target.closest('[data-action="report"]');if(!b)return;
    e.stopImmediatePropagation();e.preventDefault();
    const kind=b.dataset.kind||"month",d=new Date();
    let start,end,label;
    if(kind==="month"){start=iso(new Date(d.getFullYear(),d.getMonth(),1));end=iso(new Date(d.getFullYear(),d.getMonth()+1,0));label=d.toLocaleDateString(undefined,{month:"long",year:"numeric"})}
    else {const s=new Date(d);s.setDate(d.getDate()-d.getDay());const en=new Date(s);en.setDate(s.getDate()+6);start=iso(s);end=iso(en);label=`Week ${start} → ${end}`}
    const summary=workers.filter(w=>w.active!==false).map(w=>workerStats(w,start,end));
    try{await setDoc(doc(db,"households",householdId,"reports",`${kind}_${start}`),{kind,periodStart:start,periodEnd:end,label,summary,generatedAt:serverTimestamp(),autoGenerated:false},{merge:true});$("#refreshBtn")?.click()}catch(err){alert(`Report failed: ${err.message}`)}
  },true);
}
function schedulePatch(){
  clearTimeout(observerTimer);observerTimer=setTimeout(()=>{patchToday();patchMonth();patchReports();patchSettlement();patchWorkerForm()},40);
}
const observer=new MutationObserver(schedulePatch);
observer.observe(document.body,{subtree:true,childList:true});
interceptReportGeneration();
onAuthStateChanged(auth,async u=>{user=u;if(u){try{await loadData()}catch(e){console.error(e)}}});
