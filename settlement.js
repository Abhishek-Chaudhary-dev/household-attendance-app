import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, query, where, orderBy, setDoc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
const firebaseConfig={apiKey:"AIzaSyBh7-h4GxX_cYZphqIvIYVVzMjQVFLKQyE",authDomain:"chatgpt-household-attendance.firebaseapp.com",projectId:"chatgpt-household-attendance",storageBucket:"chatgpt-household-attendance.firebasestorage.app",messagingSenderId:"640078047318",appId:"1:640078047318:web:fa508fb29be6621378f3f7"};
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app),$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const money=n=>`₹${Number(n||0).toLocaleString("en-IN")}`;
const parseDate=s=>{const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)};
const iso=d=>{const x=new Date(d);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`};
const monthStart=k=>`${k}-01`;const monthEnd=k=>{const[y,m]=k.split("-").map(Number);return iso(new Date(y,m,0))};
const monthLabel=k=>parseDate(`${k}-01`).toLocaleDateString(undefined,{month:"long",year:"numeric"});
const months=()=>{const out=[],d=new Date();for(let i=0;i<18;i++){out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);d.setMonth(d.getMonth()-1)}return out};
let user=null,householdId=null,workers=[],attendance=[],advances=[],payments=[],selectedMonth=`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}`;
const normEmail=e=>String(e||"").trim().toLowerCase();
async function resolveHouseholdId(){if(!user)return null;const own=await getDoc(doc(db,"households",user.uid));if(own.exists())return own.id;const email=normEmail(user.email);if(!email)return null;const q=await getDocs(query(collection(db,"households"),where("memberEmails","array-contains",email)));return q.empty?null:q.docs[0].id}
function toast(msg){const t=$("#toast");if(!t)return;t.textContent=msg;t.classList.remove("hidden");setTimeout(()=>t.classList.add("hidden"),2400)}
const advancesPath=id=>id?doc(db,"households",householdId,"advances",id):collection(db,"households",householdId,"advances");
const paymentsPath=id=>doc(db,"households",householdId,"payments",id);

// UNCHANGED — identical formula to app.js's workerStats() and the previous
// production version. Pay is a presentation layer on top of this; per the
// explicit decision on file, Absent stays pay-neutral for monthly workers
// (only Leave beyond the paid allowance deducts) — this is today's actual
// behavior, not something this pass silently changed.
function calculate(w,start,end){const rows=attendance.filter(a=>a.workerId===w.id&&a.date>=start&&a.date<=end),single=(w.shiftType??"double")==="single";const presentShifts=rows.reduce((n,a)=>n+(a.morning==="present")+(single?0:a.evening==="present"),0),leaveShifts=rows.reduce((n,a)=>n+(a.morning==="leave")+(single?0:a.evening==="leave"),0),absentShifts=rows.reduce((n,a)=>n+(a.morning==="absent")+(single?0:a.evening==="absent"),0),divisor=single?1:2,presentDays=presentShifts/divisor,leaveDays=leaveShifts/divisor,absentDays=absentShifts/divisor,paidLeaveDays=Math.min(leaveDays,Number(w.monthlyPaidLeaves??2)),unpaidLeaveDays=Math.max(0,leaveDays-paidLeaveDays),days=Math.max(1,Math.floor((parseDate(end)-parseDate(start))/86400000)+1),dailyRate=Number(w.dailyRate||0),monthlySalary=Number(w.monthlySalary||0),paymentMethod=w.payType==="monthly"?"monthly":"daily";let basePayment,deduction,finalPayment;if(paymentMethod==="monthly"){basePayment=monthlySalary;deduction=w.paymentPolicy==="full"?0:unpaidLeaveDays*(monthlySalary/days);finalPayment=Math.max(0,basePayment-deduction)}else{basePayment=(presentDays+paidLeaveDays)*dailyRate;deduction=0;finalPayment=Math.max(0,basePayment)}return{workerId:w.id,name:w.name,shiftType:single?"single":"double",paymentMethod,presentShifts,leaveShifts,absentShifts,presentDays,leaveDays,absentDays,paidLeaveDays,unpaidLeaveDays,days,dailyRate,monthlySalary,basePayment,deduction,finalPayment}}

// Own independent Firestore load (pre-existing pattern for this file) —
// now also pulling the two new collections.
async function loadData(){if(!user)return;try{householdId=householdId||await resolveHouseholdId();if(!householdId)throw new Error("No household access found for this Google account.");const [w,a,adv,pay]=await Promise.all([getDocs(query(collection(db,"households",householdId,"workers"),orderBy("name"))),getDocs(query(collection(db,"households",householdId,"attendance"),orderBy("date","desc"))),getDocs(query(collection(db,"households",householdId,"advances"),orderBy("advanceDate","desc"))),getDocs(collection(db,"households",householdId,"payments"))]);workers=w.docs.map(d=>({id:d.id,...d.data(),shiftType:d.data().shiftType??"double",monthlyPaidLeaves:Number(d.data().monthlyPaidLeaves??2),dailyRate:Number(d.data().dailyRate??0),monthlySalary:Number(d.data().monthlySalary??0)}));attendance=a.docs.map(d=>({id:d.id,...d.data()}));advances=adv.docs.map(d=>({id:d.id,...d.data(),recoveredAmount:Number(d.data().recoveredAmount||0)}));payments=pay.docs.map(d=>({id:d.id,...d.data()}));render()}catch(e){toast(`Couldn't load Pay data: ${e.message||"permission or connection error"}`)}}

/* =========================================================================
   SALARY + ADVANCE + PAYMENT — the calculated salary, advance recovery,
   final amount, and actual payment are kept as visibly separate numbers,
   never collapsed into one figure, per the explicit product requirement.
   ========================================================================= */
function outstandingAdvancesFor(workerId, monthKey){
  return advances.filter(a=>a.workerId===workerId && a.recoveryMonth===monthKey && (a.amount-a.recoveredAmount)>0.001);
}
function calcWorkerFull(w, monthKey){
  const base=calculate(w, monthStart(monthKey), monthEnd(monthKey));
  const outstanding=outstandingAdvancesFor(w.id, monthKey);
  const advanceRecovery=Math.min(base.finalPayment, outstanding.reduce((s,a)=>s+(a.amount-a.recoveredAmount),0));
  const finalAmount=Math.max(0, base.finalPayment - advanceRecovery);
  const paymentRec=payments.find(p=>p.workerId===w.id && p.month===monthKey);
  const actualPaid = paymentRec ? Number(paymentRec.actualPaid||0) : null;
  let status="unpaid"; if(actualPaid!=null){ status = actualPaid<=0 ? "unpaid" : actualPaid>=finalAmount ? "paid" : "partial"; }
  return {...base, outstanding, advanceRecovery, finalAmount, actualPaid, status, paymentRec};
}

// Advance recovery is only ever committed to Firestore at the moment a
// payment is actually recorded for that worker+month — not just from
// viewing the calculated preview. Oldest advance is recovered first.
async function recordPayment(workerId){
  const w=workers.find(x=>x.id===workerId); if(!w) return;
  const input=$(`#actual_${workerId}`); const actualPaid=Number(input.value||0);
  const c=calcWorkerFull(w, selectedMonth);
  try{
    const batch=writeBatch(db);
    let toRecover=c.advanceRecovery;
    const ordered=[...c.outstanding].sort((a,b)=>a.advanceDate.localeCompare(b.advanceDate));
    ordered.forEach(a=>{
      if(toRecover<=0) return;
      const remaining=a.amount-a.recoveredAmount, take=Math.min(remaining, toRecover);
      toRecover-=take;
      const newRecovered=a.recoveredAmount+take;
      batch.update(advancesPath(a.id), { recoveredAmount:newRecovered, remainingAmount:Math.max(0,a.amount-newRecovered), status: newRecovered>=a.amount-0.001 ? "recovered" : "partial", updatedAt:serverTimestamp() });
    });
    batch.set(paymentsPath(`${workerId}_${selectedMonth}`), { workerId, month:selectedMonth, actualPaid, paymentDate:iso(new Date()), note:"", updatedAt:serverTimestamp() }, {merge:true});
    await batch.commit();
    await loadData();
    toast("Payment recorded");
  }catch(e){ error(`Payment wasn't saved: ${e.message}`); }
}
function error(msg){ toast(msg); }

/* ---- Add Advance modal ---- */
function openAdvanceModal(preselectId){
  let modal=$("#advanceModal");
  if(!modal){
    modal=document.createElement("div"); modal.id="advanceModal"; modal.className="confirm-backdrop hidden";
    modal.innerHTML=`<div class="confirm-card" style="max-height:82vh;overflow-y:auto">
      <h3>Advances</h3>
      <div id="advHistoryList"></div>
      <h3 style="margin-top:16px">Add Advance</h3>
      <div class="form-field"><label>Worker</label><select id="advWorker"></select></div>
      <div class="form-field"><label>Amount (₹)</label><input id="advAmount" type="number" min="0" step="1" placeholder="1000"></div>
      <div class="form-field"><label>Date</label><input id="advDate" type="date"></div>
      <div class="form-field"><label>Recover in</label><select id="advRecoverMonth"></select></div>
      <div class="form-field"><label>Notes (optional)</label><input id="advNotes" placeholder="e.g. Personal emergency"></div>
      <div class="confirm-actions">
        <button class="btn-cancel" id="advCancel">Cancel</button>
        <button class="btn-confirm" id="advSave">Save Advance</button>
      </div></div>`;
    document.getElementById("app")?.appendChild(modal) || document.body.appendChild(modal);
    $("#advCancel").onclick=closeAdvanceModal;
    $("#advSave").onclick=saveAdvance;
    $("#advWorker").onchange=e=>renderAdvanceHistory(e.target.value);
  }
  const sel=$("#advWorker"); sel.innerHTML=workers.filter(w=>w.active!==false).map(w=>`<option value="${w.id}" ${w.id===preselectId?"selected":""}>${esc(w.name)}</option>`).join("");
  $("#advAmount").value=""; $("#advDate").value=iso(new Date());
  const rm=$("#advRecoverMonth"); rm.innerHTML=months().slice(0,6).map(k=>`<option value="${k}" ${k===selectedMonth?"selected":""}>${monthLabel(k)}</option>`).join("");
  $("#advNotes").value="";
  renderAdvanceHistory(preselectId||sel.value);
  modal.classList.remove("hidden");
}
function renderAdvanceHistory(workerId){
  const list=$("#advHistoryList"); if(!list) return;
  const mine=advances.filter(a=>a.workerId===workerId).sort((a,b)=>b.advanceDate.localeCompare(a.advanceDate));
  const label={pending:"Pending",partial:"Partially recovered",recovered:"Recovered"};
  list.innerHTML = mine.length ? mine.map(a=>`
    <div class="advance-history-row">
      <div><strong>${money(a.amount)}</strong> · ${parseDate(a.advanceDate).toLocaleDateString(undefined,{day:"numeric",month:"short"})} · recovers ${monthLabel(a.recoveryMonth).split(" ")[0]}${a.notes?` · ${esc(a.notes)}`:""}</div>
      <span class="advance-status ${a.status}">${label[a.status]||a.status}</span>
    </div>`).join("") : `<p class="subtle" style="margin:0 0 8px">No advances recorded yet for this worker.</p>`;
}
function closeAdvanceModal(){ $("#advanceModal")?.classList.add("hidden"); }
async function saveAdvance(){
  const workerId=$("#advWorker").value, amount=Number($("#advAmount").value||0);
  if(!amount||amount<=0) return;
  const rec={ workerId, amount, advanceDate:$("#advDate").value||iso(new Date()), recoveryMonth:$("#advRecoverMonth").value,
    recoveredAmount:0, remainingAmount:amount, status:"pending", notes:$("#advNotes").value||"", createdAt:serverTimestamp(), updatedAt:serverTimestamp() };
  try{ await setDoc(doc(advancesPath()), rec); closeAdvanceModal(); await loadData(); toast("Advance saved"); }
  catch(e){ toast(`Advance wasn't saved: ${e.message}`); }
}

/* ---- Render ---- */
function render(){
  const panel=$("#payPanel"); if(!panel) return;
  const active=workers.filter(w=>w.active!==false);
  const avatar=(w,size)=>window.makeAvatar ? window.makeAvatar(w,size) : `<div class="avatar" style="width:${size}px;height:${size}px;background:var(--green-tint)"></div>`;
  const rows=active.map(w=>calcWorkerFull(w, selectedMonth));
  const total=rows.reduce((s,r)=>s+r.finalAmount,0);
  panel.innerHTML=`
    <div class="month-select">${months().slice(0,6).map(k=>`<button class="${k===selectedMonth?"active":""}" data-pay-month="${k}">${monthLabel(k).split(" ")[0]}</button>`).join("")}</div>
    <div class="pay-hero">
      <div class="lbl">TOTAL TO PAY THIS MONTH</div>
      <div class="amt">${money(total)}</div>
      <div class="sub">${active.length} ${active.length===1?"person":"people"} · ${monthLabel(selectedMonth)}</div>
    </div>
    ${!rows.length ? `<div class="empty-state"><p>Add workers first, then come back here to calculate pay.</p></div>` : rows.map(c=>{
      const w=active.find(x=>x.id===c.workerId);
      const statusLabel={unpaid:"Not paid",partial:"Partially paid",paid:"Paid"}[c.status];
      let paymentResult="";
      if(c.actualPaid!=null){
        const diff=c.actualPaid-c.finalAmount;
        if(diff<-0.01) paymentResult=`<div class="payment-result remaining">${money(Math.abs(diff))} remaining</div>`;
        else if(diff>0.01) paymentResult=`<div class="payment-result extra">${money(diff)} extra paid</div>`;
        else paymentResult=`<div class="payment-result exact">Paid in full</div>`;
      }
      return `<div class="worker-pay-card">
        <div class="worker-pay-head">${avatar(w,40)}<div><div class="name">${esc(c.name)}</div><div class="role">${esc(w?.role||"Worker")}</div></div><div class="pay-status ${c.status}">${statusLabel}</div></div>
        <div class="attendance-summary">
          <div class="chip"><div class="n">${c.presentDays}</div><div class="l">Present</div></div>
          <div class="chip"><div class="n">${c.leaveDays}</div><div class="l">Leave</div></div>
          <div class="chip"><div class="n">${c.absentDays}</div><div class="l">Absent</div></div>
        </div>
        ${c.paymentMethod==="monthly" ? `
          <div class="calc-line"><span>Monthly salary</span><span>${money(c.monthlySalary)}</span></div>
          <div class="calc-line"><span>Daily allocation</span><span>${money(c.monthlySalary/c.days)}</span></div>
          ${c.unpaidLeaveDays>0?`<div class="calc-line"><span>Unpaid leave deduction (${c.unpaidLeaveDays} day${c.unpaidLeaveDays===1?"":"s"})</span><span class="neg">− ${money(c.deduction)}</span></div>`:""}
        ` : `
          <div class="calc-line"><span>Daily rate</span><span>${money(c.dailyRate)}</span></div>
          <div class="calc-line"><span>Payable days (present + paid leave)</span><span>${c.presentDays+c.paidLeaveDays}</span></div>
        `}
        <div class="calc-line total"><span>Calculated payable</span><span>${money(c.basePayment-c.deduction)}</span></div>
        ${c.advanceRecovery>0?`<div class="calc-line advance-line"><span>Advance recovery</span><span>− ${money(c.advanceRecovery)}</span></div>`:""}
        ${outstandingAdvancesFor(w.id, selectedMonth).length
          ? `<div class="advance-banner"><span><strong>${money(outstandingAdvancesFor(w.id,selectedMonth).reduce((s,a)=>s+(a.amount-a.recoveredAmount),0))}</strong> advance to recover</span><span style="display:flex;gap:8px"><button class="add-advance-link" data-advance-view="${w.id}">View (${advances.filter(a=>a.workerId===w.id).length})</button><button class="add-advance-link" data-advance-worker="${w.id}">+ Add Advance</button></span></div>`
          : `<div style="margin-top:8px"><button class="add-advance-link" data-advance-worker="${w.id}">+ Add Advance</button></div>`}
        <div class="final-amount-box"><div class="lbl">FINAL AMOUNT TO PAY</div><div class="amt">${money(c.finalAmount)}</div></div>
        <div class="payment-row">
          <input type="number" min="0" step="1" placeholder="Actual amount paid" id="actual_${w.id}" value="${c.actualPaid??""}">
          <button data-record-payment="${w.id}">Save</button>
        </div>
        ${paymentResult}
      </div>`;
    }).join("")}
  `;
  $$("[data-pay-month]").forEach(b=>b.onclick=()=>{selectedMonth=b.dataset.payMonth;render()});
  $$("[data-advance-worker]").forEach(b=>b.onclick=()=>openAdvanceModal(b.dataset.advanceWorker));
  $$("[data-advance-view]").forEach(b=>b.onclick=()=>openAdvanceModal(b.dataset.advanceView));
  $$("[data-record-payment]").forEach(b=>b.onclick=()=>recordPayment(b.dataset.recordPayment));
}
window.renderPay=render; // exposed so app.js can trigger a re-render after actions like adding a worker

onAuthStateChanged(auth,u=>{user=u;if(u)loadData()});
