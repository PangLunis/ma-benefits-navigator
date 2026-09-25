/* =========================================================================
   Benefighter — the free benefits check (full engine).
   PORTED VERBATIM from classic/index.html (the original MA Senior Benefits
   Audit tool) on 2026-09-25. The question set (Q), helpers, thresholds and
   the entire programs() eligibility engine are byte-identical to the
   original — a parity test (same answers through both files, compare the
   programs() output) is how that was verified. The ONLY changes are UI:
     - "Start over" button removed (Ryan's dad saw it mid-results and
       panicked — didn't know what it meant)
     - "Export data" (a JSON download) removed — same reason, not a thing a
       senior or their family knows what to do with
     - every question now says plainly what to do ("tap an answer" / "type
       it, then tap Next"), and the last question's button says
       "See my results"
     - results open with a numbered "What to do next" box, and end with the
       optional paid Full Benefits Check as the next step
     - terms/privacy links fixed for the new location (../ -> same folder)
   ========================================================================= */
/* ---------- Paid-offer config (KEEP OFF until LLC + attorney review + live Stripe link) ---------- */
const SHOW_OFFER = false;     // flip to true ONLY after ClariDeed goes live (LLC + legal review)
const CHECKOUT_URL = "https://clarideed.com/senior-benefits/";  // funnels into ClariDeed service #6
const OFFER_PRICE = "$179";

/* ---------- Adaptive question set (branching via showIf) ---------- */
const Q = [
  {id:"name", type:"text", q:"Whose benefits are we checking?", hint:"Just a first name, so the results read clearly.", placeholder:"e.g. Dad / Robert", optional:true, noSkip:true},
  {id:"age", type:"number", q:n=>`How old is ${who(n)}?`, hint:"Age as of December 31 this year.", suffix:"years", noSkip:true},
  {id:"marital", type:"single", q:n=>`${whoC(n)} marital status?`, noSkip:true,
    opts:[{v:"single",l:"Single"},{v:"married",l:"Married"},{v:"widowed",l:"Widowed"}]},
  {id:"filing", type:"single", q:n=>`How does ${who(n)} file taxes?`, hint:"This sets the income limit for the Circuit Breaker credit.",
    help:"Look at the top of last year's tax return (MA Form 1 or the federal 1040) — it shows Single, Head of household, or Married. If they don't file at all, pick \"Doesn't file a return.\" Not sure? Tap \"I'm not sure\" and we'll flag it.",
    opts:[{v:"single",l:"Single"},{v:"hof",l:"Head of household"},{v:"joint",l:"Married — filing jointly"},{v:"mfs",l:"Married — filing separately"},{v:"none",l:"Doesn't file a return"}]},
  {id:"dependent", type:"single", q:n=>`Is ${who(n)} claimed as a dependent by someone else?`, hint:"Usually \"No\" for an independent senior.",
    help:"Say \"Yes\" only if an adult child or someone else lists this person as a dependent on THEIR taxes. For most seniors living on their own income, it's \"No.\"",
    opts:[{v:"no",l:"No"},{v:"yes",l:"Yes, claimed as a dependent"}]},
  {id:"citizen", type:"single", q:n=>`${whoC(n)} citizenship status?`, hint:"Needed for SNAP, SSI, and Medicare Savings.",
    help:"\"U.S. citizen\" covers anyone born in the U.S. or naturalized. \"Green card\" means a lawful permanent resident.",
    opts:[{v:"citizen",l:"U.S. citizen"},{v:"qualified",l:"Green card / lawful permanent resident"}]},
  {id:"housing", type:"single", q:n=>`Does ${who(n)} own or rent?`, noSkip:true,
    opts:[{v:"own",l:"Owns the home"},{v:"rent",l:"Rents"},{v:"family",l:"Lives with family (no rent)"}]},
  {id:"town", type:"text", q:"Which city or town in Massachusetts?", hint:"Property-tax breaks are set town-by-town, so we need this.", placeholder:"e.g. Framingham", noSkip:true},
  {id:"ownYears", type:"number", q:"About how many years owned?", hint:"Some senior exemptions require owning ~5 years.", suffix:"years",
    showIf:a=>a.housing==="own"},
  {id:"titling", type:"single", q:"How is the home titled?", hint:"Trusts and life estates can change exemption eligibility.",
    help:"Check the deed or the top of the tax bill. \"In a trust\" = a family/living trust owns the home. \"Life estate\" is a legal arrangement (often for Medicaid planning). Don't know? Tap \"I'm not sure.\"",
    opts:[{v:"own_name",l:"In their own name"},{v:"trust",l:"In a trust"},{v:"life_estate",l:"Life estate"},{v:"multi",l:"Shared with others on the deed"}],
    showIf:a=>a.housing==="own"},
  {id:"incomeSS", type:"currency", q:n=>`${whoC(n)} yearly Social Security income?`, hint:"Just Social Security. Enter 0 if none.",
    help:"The yearly Social Security total — on the annual letter from Social Security, or just the monthly check × 12. A rough number is fine."},
  {id:"incomeOther", type:"currency", q:"Other yearly income?", hint:"Everything except Social Security.",
    help:"Add up pensions, any wages, IRA/401(k) withdrawals, interest & dividends, and rental income — everything EXCEPT Social Security. A close estimate is fine."},
  {id:"assets", type:"currency", q:"Roughly, total savings & investments?", hint:"Do NOT count the home or one car.",
    help:"Add up checking, savings, CDs, and investment/IRA accounts. Do NOT count the home they live in or one car. A ballpark is fine."},
  {id:"medExpenses", type:"currency", q:"Yearly out-of-pocket medical costs?", hint:"A rough estimate is fine. Enter 0 if unsure.", optional:true,
    help:"Out-of-pocket health costs over a year: premiums, copays, prescriptions, dental, glasses. Seniors get extra SNAP credit for these, so even a rough number helps."},
  {id:"propTax", type:"currency", q:"Yearly property tax bill?", hint:"Your best estimate is fine.", showIf:a=>a.housing==="own",
    help:"On the city/town property tax bill. It often comes quarterly — add the four quarters. You can also look it up free on the town's online assessor database by address."},
  {id:"assessed", type:"currency", q:"Assessed value of the home?", hint:"There's a value ceiling for the Circuit Breaker, so this matters.", showIf:a=>a.housing==="own",
    help:"Also on the property tax bill, labeled \"assessed value\" or \"total value\" — what the TOWN values the home at (often lower than market). Same assessor website has it. Truly can't find it? Tap \"I'm not sure.\""},
  {id:"rent", type:"currency", q:"Monthly rent?", hint:"Your share of the rent each month.", showIf:a=>a.housing==="rent",
    help:"The monthly rent payment. If utilities are bundled in, just estimate the rent portion."},
  {id:"subsidized", type:"single", q:"Is the rental public, subsidized, or tax-exempt housing?", hint:"Affects the Circuit Breaker.",
    help:"\"Yes\" = public housing, a Section 8 voucher building, or housing run by a church/nonprofit at reduced rent. A normal private landlord at market rent = \"No.\"",
    opts:[{v:"no",l:"No — private market rental"},{v:"yes",l:"Yes, subsidized/public"}], showIf:a=>a.housing==="rent"},
  {id:"veteran", type:"single", q:n=>`Military service?`, hint:"Veterans qualify for extra programs.",
    opts:[{v:"vet",l:"Is a veteran"},{v:"spouse",l:"Surviving spouse of a veteran"},{v:"no",l:"No military service"}]},
  {id:"vaDis", type:"single", q:"Service-connected disability rating?", hint:"From the VA, if any.",
    help:"On the VA award/decision letter — a percentage like 30%, 70%, or 100%. Don't have it handy? Tap \"I'm not sure.\"",
    opts:[{v:"none",l:"None"},{v:"partial",l:"10% – 90%"},{v:"full",l:"100% or unable to work"}],
    showIf:a=>a.veteran==="vet"||a.veteran==="spouse"},
  {id:"wartime", type:"single", q:"Did the service include a wartime period?", hint:"Required for the VA Aid & Attendance pension.",
    help:"At least 90 days of active duty with one day during a wartime window — e.g., WWII, Korea, Vietnam (8/5/1964–5/7/1975, or 2/28/1961 if served in Vietnam), or the Gulf War (8/2/1990–present). Peacetime-only service doesn't qualify for this particular pension. Not sure of the dates? Tap \"I'm not sure.\"",
    opts:[{v:"yes",l:"Yes — served during a wartime period"},{v:"no",l:"No — peacetime only"}],
    showIf:a=>a.veteran==="vet"||a.veteran==="spouse"},
  {id:"disability", type:"single", q:n=>`Does ${who(n)} have a disability or get SSDI/SSI?`, hint:"Separate from veterans' disability — opens programs regardless of age.",
    opts:[{v:"yes",l:"Yes"},{v:"no",l:"No"}]},
  {id:"blind", type:"single", q:n=>`Is ${who(n)} legally blind?`,
    opts:[{v:"yes",l:"Yes"},{v:"no",l:"No"}]},
  {id:"medicare", type:"single", q:n=>`Is ${who(n)} on Medicare?`,
    opts:[{v:"yes",l:"Yes"},{v:"no",l:"No / not yet"}]},
  {id:"adl", type:"single", q:"Need help with daily activities?", hint:"Bathing, dressing, cooking, managing meds, getting around.",
    opts:[{v:"yes",l:"Yes, needs some help"},{v:"no",l:"No, fully independent"}]},
  {id:"already", type:"multi", q:n=>`Is ${who(n)} ALREADY getting any of these?`, hint:"It's totally normal not to know. If you can't tell, pick \"I'm not sure\" at the bottom — we'll help you check.", noSkip:true, exclusive:["none","unsure"],
    help:"Where to look for each: 1) Circuit Breaker — last year's MA state tax return, a line called \"Schedule CB\" / Circuit Breaker credit. 2) Property-tax exemption — the town property tax bill, a line lowering the amount (often labeled \"exemption\" or \"senior\"). 3) Fuel Assistance — did they apply for winter heating help at a local agency? 4) SNAP — do they have an EBT card? 5) Medicare Part B help — is the ~$185/mo premium NOT coming out of their Social Security check? 6) MassHealth — do they carry a MassHealth card? If you can't check any of these right now, just pick \"I'm not sure.\"",
    opts:[
      {v:"cb",l:"Senior Circuit Breaker tax credit",d:"A refund on the MA state tax return (look for \"Schedule CB\") — often $1,000–$2,800/yr."},
      {v:"exemption",l:"A property-tax exemption",d:"A discount line on the town property tax bill that lowers what's owed."},
      {v:"liheap",l:"Fuel Assistance (heating-bill help)",d:"Winter heating help, also called LIHEAP."},
      {v:"snap",l:"SNAP / food assistance",d:"Food benefits on an EBT card (used to be \"food stamps\")."},
      {v:"msp",l:"Help paying the Medicare Part B premium",d:"Something other than their Social Security check covers the ~$185/mo Part B premium."},
      {v:"masshealth",l:"MassHealth",d:"MassHealth — Massachusetts Medicaid (they'd have a MassHealth card)."},
      {v:"none",l:"None of these"},
      {v:"unsure",l:"🤔 I'm not sure — help me check"}
    ]},
  {id:"working", type:"single", q:"Still earning wages from a job?", hint:"Affects Social Security timing.",
    opts:[{v:"yes",l:"Yes, still working"},{v:"no",l:"No / retired"}], showIf:a=>num(a.age)<70}
];

/* helpers for names */
function who(a){const n=(a&&a.name||"").trim(); return n?n:"this person";}
function whoC(a){const n=(a&&a.name||"").trim(); if(!n) return "What's the"; return n+"'s";}
function num(x){const v=parseFloat(String(x).replace(/[^0-9.]/g,"")); return isNaN(v)?0:v;}
function money(x){return "$"+Math.round(x).toLocaleString();}
function isUnknown(id){ return A[id]==="unknown"; }
/* text-size toggle (a11y) — pinch-zoom is also enabled via the viewport meta */
let tIdx=0; const tClasses=["","lg","xl"];
function applyTextSize(){ document.body.className=tClasses[tIdx]; }
window.addEventListener("DOMContentLoaded",()=>{
  const up=document.getElementById("tup"), dn=document.getElementById("tdown");
  if(up) up.onclick=()=>{ tIdx=Math.min(2,tIdx+1); applyTextSize(); };
  if(dn) dn.onclick=()=>{ tIdx=Math.max(0,tIdx-1); applyTextSize(); };
});
function qLabel(id){ const m={filing:"tax filing status",dependent:"dependent status",incomeSS:"Social Security income",incomeOther:"other income",propTax:"property tax amount",assessed:"home assessed value",rent:"monthly rent",subsidized:"subsidized-housing status",assets:"savings/assets",titling:"how the home is titled",vaDis:"VA disability rating",wartime:"wartime-service status",citizen:"citizenship status"}; return m[id]||id; }

/* ---------- State ---------- */
let A = {};           // answers
let order = [];       // visible question ids in order visited
let i = 0;            // index into a freshly computed visible list

function visible(){ return Q.filter(q=>!q.showIf || q.showIf(A)); }

/* ---------- Render question ---------- */
function render(){
  const vis = visible();
  if(i>=vis.length){ return results(); }
  const q = vis[i];
  document.getElementById("bar").style.width = Math.round((i/(vis.length))*100)+"%";
  const qt = typeof q.q==="function"?q.q(A):q.q;
  const app = document.getElementById("app");
  let inner = i===0 ? `<div class="reassure">Answer what you can. Not sure about something? Tap <b>"I'm not sure"</b> — we'll list it at the end so you can look it up.</div>` : "";
  const isLast = (i===vis.length-1);
  const doWhat = q.type==="single" ? "Tap the answer that fits — it moves on by itself."
               : q.type==="multi" ? "Tap every one that applies, then tap Next."
               : "Type your answer, then tap Next.";
  inner += `<div class="card"><div class="qstep">Question ${i+1} &middot; <span>${doWhat}</span></div><div class="q">${qt}</div>`;
  if(q.hint) inner += `<p class="hint">${q.hint}</p>`;
  if(q.help) inner += `<details class="help"><summary>ⓘ What's this? Where do I find it?</summary><div class="hbox">${q.help}</div></details>`;

  const isInput = (q.type==="number"||q.type==="currency"||q.type==="text");
  if(q.type==="single"||q.type==="multi"){
    inner += `<div class="opts ${q.type==='multi'?'ms':''}" role="${q.type==='multi'?'group':'radiogroup'}">`;
    const role = q.type==="multi"?"checkbox":"radio";
    q.opts.forEach(o=>{
      const cur = q.type==="multi" ? (A[q.id]||[]).includes(o.v) : A[q.id]===o.v;
      inner += `<button class="opt ${cur?'sel':''}" data-v="${o.v}" role="${role}" aria-checked="${cur}"><span class="chk"></span><span class="ol">${o.l}${o.d?`<span class="od">${o.d}</span>`:""}</span></button>`;
    });
    if(q.type==="single" && !q.noSkip){
      inner += `<button class="opt unsure ${A[q.id]==="unknown"?'sel':''}" data-v="unknown" role="radio" aria-checked="${A[q.id]==="unknown"}"><span class="chk"></span><span>🤔 I'm not sure — flag it for later</span></button>`;
    }
    inner += `</div>`;
  } else {
    const isCur = q.type==="currency";
    const val = (A[q.id]!=null && A[q.id]!=="unknown")?A[q.id]:"";
    inner += `<div class="ipwrap ${isCur?'cur':''}">${isCur?'<span class="pre">$</span>':''}
      <input id="ip" type="${q.type==='text'?'text':'number'}" inputmode="${q.type==='text'?'text':'decimal'}"
      value="${val}" placeholder="${q.placeholder||''}"></div>`;
    if(q.suffix) inner += `<p class="hint" style="margin:8px 0 0">in ${q.suffix}</p>`;
  }

  inner += `<div class="nav">
      <button class="btn ghost" id="back" ${i===0?'disabled':''}>Back</button>
      <button class="btn prim" id="next">${isLast?"See my results &rarr;":"Next &rarr;"}</button>
    </div>`;
  if(isInput && !q.noSkip){ inner += `<button class="skip" id="skip">🤔 I'm not sure — skip &amp; flag it for later</button>`; }
  inner += `</div>`;
  app.innerHTML = inner;

  // wire choices
  if(q.type==="single"){
    app.querySelectorAll(".opt").forEach(b=>b.onclick=()=>{A[q.id]=b.dataset.v;i++;render();});
  } else if(q.type==="multi"){
    const excl=q.exclusive||[];
    app.querySelectorAll(".opt").forEach(b=>b.onclick=()=>{
      const v=b.dataset.v; let set=new Set(A[q.id]||[]);
      if(excl.includes(v)){ set = set.has(v)?new Set():new Set([v]); }     // exclusive choice
      else { excl.forEach(e=>set.delete(e)); set.has(v)?set.delete(v):set.add(v); }
      A[q.id]=[...set]; render();
    });
  } else {
    const ip=document.getElementById("ip"); ip.focus();
    ip.onkeydown=e=>{if(e.key==="Enter")document.getElementById("next").click();};
  }
  const back=document.getElementById("back"); if(back) back.onclick=()=>{i=Math.max(0,i-1);render();};
  const skip=document.getElementById("skip"); if(skip) skip.onclick=()=>{A[q.id]="unknown"; i++; render();};
  document.getElementById("next").onclick=()=>{
    if(isInput){
      const v=document.getElementById("ip").value.trim();
      if(!v && !q.optional){ document.getElementById("ip").focus(); document.getElementById("ip").style.borderColor="#d23"; return;}
      A[q.id]=v;
    }
    i++; render();
  };
}

/* ---------- Eligibility engine ---------- */
// thresholds (FY2025-26, approximate / public)
const CB_INC = {single:75000, hof:94000, joint:112000, none:75000}; // circuit breaker caps by FILING status (TIR 25-7)
const CB_MAX = 2820;                            // circuit breaker max credit
const CB_ASSESS = 1298000;                      // assessed value ceiling
const LIHEAP = {1:49196, 2:64333};              // ~60% state median income (rough)
const SNAP200 = {1:30120, 2:40880};             // 200% FPL gross (MA BBCE), annual
const MSP_INC = {1:24860, 2:33620};             // ~165% FPL (QI), annual; MA has NO asset test
const FPL = {1:15060, 2:20440};
const FPL135 = {1:20331, 2:27594};             // 135% FPL — Lifeline phone/broadband income gate

function hhSize(){ return A.marital==="married"?2:1; }
// citizenship gate for federal means-tested programs (SNAP/MSP/SSI)
function citizenOK(){ return A.citizen!=="other"; } // citizen or qualified immigrant
function citizenNote(){ return A.citizen==="qualified"?" (qualified-immigrant rules can add a waiting period — verify.)":""; }

function programs(){
  const age=num(A.age), incSS=num(A.incomeSS), incOther=num(A.incomeOther), inc=incSS+incOther;
  const assets=num(A.assets), med=num(A.medExpenses), hh=hhSize();
  const out=[];
  const owner = A.housing==="own", renter = A.housing==="rent";
  const disabled = A.disability==="yes";

  // 1. Senior Circuit Breaker
  (()=>{
    if(age<65){ out.push(cb("no","Requires age 65+ by December 31.")); return; }
    if(A.dependent==="yes"){ out.push(cb("no","Can't be claimed as a dependent on someone else's return — that disqualifies the Circuit Breaker.")); return; }
    if(A.dependent==="unsure"){ out.push(cb("maybe","Eligible only if NOT claimed as a dependent by anyone — confirm this first.")); return; }
    if(A.filing==="mfs"){ out.push(cb("no","Married filing separately can't claim it — a married couple must file jointly.")); return; }
    const cap = CB_INC[A.filing] || CB_INC.single;
    if(inc>cap){ out.push(cb("no",`Total income ~${money(inc)} is over the $${cap.toLocaleString()} limit for this filing status.`)); return; }
    let status="maybe", why="";
    if(owner){
      const tax=num(A.propTax);
      const burden = tax > 0.10*inc;
      if(A.assessed && num(A.assessed)>CB_ASSESS){ out.push(cb("no",`Home assessed over the $${CB_ASSESS.toLocaleString()} value ceiling.`)); return; }
      const assessedKnown = A.assessed && num(A.assessed)>0;
      if(burden && assessedKnown){ status="likely"; why=`Property tax (${money(tax)}) tops 10% of income and the home is under the value ceiling — strong match. (50% of water/sewer also counts toward the test.)`; }
      else if(burden && !assessedKnown){ status="maybe"; why=`Property tax tops 10% of income — likely, but you MUST confirm the home is assessed under $${CB_ASSESS.toLocaleString()} (hard cutoff).`; }
      else { status="maybe"; why=`Income qualifies; confirm property tax + 50% of water/sewer exceeds 10% of income (${money(0.10*inc)}).`; }
    } else if(renter){
      if(A.subsidized==="yes"){ out.push(cb("no","Renters in public/subsidized/tax-exempt housing can't claim it — no property tax is paid on the unit.")); return; }
      const rentYr=num(A.rent)*12; const burden = (0.25*rentYr) > 0.10*inc;
      status = burden?(A.subsidized==="unsure"?"maybe":"likely"):"maybe";
      why = burden?`25% of rent (${money(0.25*rentYr)}) tops 10% of income — qualifies as a renter${A.subsidized==="unsure"?" (confirm the unit isn't subsidized/tax-exempt).":"."}`:`Income qualifies; 25% of rent must top 10% of income (${money(0.10*inc)}).`;
    } else { out.push(cb("maybe","Income qualifies, but the Circuit Breaker needs you to own or rent your principal MA home.")); return; }
    out.push(cb(status, why));
    function cb(s,w){return {id:"cb",name:"Senior Circuit Breaker Credit",status:s,val:s==="no"?0:CB_MAX,valTxt:s==="no"?"—":`up to ${money(CB_MAX)}/yr`,why:w,
      form:"Schedule CB (filed with the MA income tax return).",
      forml:"https://www.mass.gov/info-details/massachusetts-senior-circuit-breaker-tax-credit",
      docs:["Property tax bills + water/sewer bills (homeowners), or rent receipts/landlord statement","Last year's tax return / all income statements","Proof of age 65+ and MA principal residence"],
      where:`File Schedule CB with the MA Form 1. NOTE: "total income" on Schedule CB has its own definition (it adds back tax-exempt interest and counts Social Security) — verify the exact figure on the form. ${A.filing==="none"?"Even if "+who(A)+" doesn't normally file, they can file a return just to claim this refundable credit. ":""}Missed prior years? You can usually AMEND the last 3 years and claim it retroactively.`};}
  })();

  // 2. Property tax exemption Clause 41C/41C½ (owner)
  if(owner){
    let s="no",w="";
    const married=A.marital==="married";
    const titleNote = (A.titling==="trust"||A.titling==="life_estate"||A.titling==="multi")?" Note: the home is held in a trust/life-estate/shared deed — that can affect exemption eligibility; confirm with the assessor.":"";
    // Real limits (FY2025-26): unmodified statutory FLOOR = $13k single / $15k married income, $28k/$30k assets (whole estate excl. domicile).
    // Towns can raise the 41C limits by local option, and towns that adopt Clause 41C½ use an income limit that TRACKS the Senior Circuit Breaker cap.
    // So the real range is ~$13k (floor) up to the Circuit Breaker cap (41C½) — it depends entirely on the town's adopted clause.
    const floorInc = married?15000:13000, floorAsset = married?30000:28000;
    const halfInc = CB_INC[A.filing] || (married?CB_INC.joint:CB_INC.single); // 41C½ income ceiling
    if(age>=65 && inc<=floorInc && assets<=floorAsset){
      s="maybe"; w=`At/under the unmodified state floor ($${floorInc.toLocaleString()} income / $${floorAsset.toLocaleString()} assets, home not counted) — qualifies for Clause 41C in essentially any MA town. Just verify the exact dollar amount.`+titleNote;
    } else if(age>=65 && inc<=halfInc){
      s="maybe"; w=`Depends entirely on which clause ${A.town||"the town"} adopted: limits run from ~$${floorInc.toLocaleString()} (classic 41C floor) up to ~$${halfInc.toLocaleString()} for towns that adopted 41C½ (its income limit tracks the Circuit Breaker). You MUST check ${A.town||"your town"}'s adopted clause + asset limit before counting on this.`+titleNote;
    } else if(age>=65){
      s="no"; w=`Income (~${money(inc)}) likely exceeds even the most generous 41C½ limit (~$${halfInc.toLocaleString()}). The Clause 41A deferral below is the usual fallback for higher-income owners.`+titleNote;
    } else { w="Senior clauses require age 65 (Clause 17D allows 70)."; }
    out.push({id:"ex41c",name:"Property Tax Exemption (Clause 41C / 41C½)",status:s,val:s==="no"?0:1200,valTxt:s==="no"?"—":"~$500–$2,000/yr",why:w,
      form:"State Tax Form 96 (filed with your town assessor).",
      forml:"https://www.mass.gov/info-details/property-tax-exemptions-for-seniors",
      docs:["Prior-year income (tax return / SS statement)","Bank & investment balances","Deed / proof of ownership & residency","Birth date proof"],
      where:`Contact the ${A.town||"town"} Assessor's office — they confirm the town's adopted clause, limits, and amount. Statewide adopted values: https://dls-gw.dor.state.ma.us/reports/rdpage.aspx?rdreport=localoptions.propertytax . Deadline is usually April 1.`});
  }

  // 3. Clause 17D (owner, 70+ or widowed — asset test, no income test)
  if(owner && (age>=70 || A.marital==="widowed")){
    out.push({id:"ex17d",name:"Property Tax Exemption (Clause 17D)",status:"maybe",val:300,valTxt:"~$175–$350/yr",
      why:"70+ or surviving spouse, owner — a no-income-test alternative if income is too high for Clause 41C.",
      form:"State Tax Form 96-1 (town assessor).",forml:"https://www.mass.gov/info-details/property-tax-exemptions-for-seniors",
      docs:["Proof of ownership/residency","Whole-estate (asset) statement"],
      where:`${A.town||"Town"} Assessor. Choose whichever clause (17D vs 41C) gives the bigger break — you can't take both.`});
  }

  // 4. Veterans exemption Clause 22 (owner)
  if((A.veteran==="vet"||A.veteran==="spouse")){
    let s = owner ? "maybe":"no", w;
    if(!owner){ w="Veterans property-tax exemption applies to homeowners; renter — skip."; }
    else if(A.vaDis==="full"){ s="likely"; w="Owner + 100%/unemployable rating — can be a large exemption (Clause 22E or full)."; }
    else if(A.vaDis==="partial"){ s="likely"; w="Owner + service-connected disability — qualifies for the veterans' exemption."; }
    else { s="maybe"; w="Veteran/surviving spouse, owner — many qualify even at the base level; verify with the assessor."; }
    out.push({id:"vet22",name:"Veterans' Property Tax Exemption (Cl. 22)",status:s,val:s==="no"?0:800,valTxt:s==="no"?"—":"$400 – full abatement",why:w,
      form:"State Tax Form 96-3 (town assessor).",forml:"https://www.mass.gov/info-details/learn-about-property-tax-deferral-and-exemptions-for-veterans",
      docs:["DD-214 (discharge papers)","VA disability award letter","Proof of MA residency & ownership"],
      where:`${A.town||"Town"} Assessor. Also ask the local Veterans' Service Officer about state veterans' benefits (Chapter 115).`});
  }

  // 5. Blind exemption 37A
  if(A.blind==="yes" && owner){
    out.push({id:"blind37a",name:"Blind Person's Exemption (Cl. 37A)",status:"likely",val:500,valTxt:"~$500/yr",
      why:"Legally blind homeowner — straightforward exemption.",
      form:"State Tax Form 96-4 + Mass. Commission for the Blind certificate.",forml:"https://www.mass.gov/info-details/property-tax-exemptions-for-seniors",
      docs:["Certificate of blindness from the Mass. Commission for the Blind","Proof of ownership"],
      where:`${A.town||"Town"} Assessor (annual).`});
  }

  // 6. Fuel Assistance / LIHEAP
  (()=>{
    if(A.housing==="family"){ out.push(fa("maybe","May still qualify if responsible for any heat/utility costs.")); return;}
    const lim = LIHEAP[hh]||LIHEAP[2];
    const s = inc<=lim?"likely":(inc<=lim*1.15?"maybe":"no");
    out.push(fa(s, s==="no"?`Income above the ~${money(lim)} guideline for a household of ${hh}.`:`Income near/under the ~${money(lim)} guideline — heat & utility help. Renters qualify even if heat is included in rent.`));
    function fa(s,w){return {id:"liheap",name:"Fuel Assistance (LIHEAP)",status:s,val:s==="no"?0:800,valTxt:s==="no"?"—":"~$500–$1,200/winter",why:w,
      form:"Application through your local Community Action agency.",forml:"https://www.mass.gov/how-to/apply-for-the-low-income-home-energy-assistance-program-liheap",
      docs:["Last 4 weeks of income (all sources)","Most recent heating + electric bill","Lease or mortgage statement"],
      where:"Find your local fuel-assistance (CAP) agency by ZIP and apply Nov–Apr. Also unlocks utility discount rates."};}
  })();

  // 7. SNAP (food)
  (()=>{
    const lim=SNAP200[hh]||SNAP200[2];
    let s = inc<=lim?"likely":(inc<=lim*1.1?"maybe":"no");
    let w = s==="no"?`Income above ~${money(lim)} for a household of ${hh}.`:`Age 60+ gets extra deductions for medical costs and high rent — many qualify even near the income line.${med>0?` Their ~${money(med)}/yr medical costs help via the 60+ deduction.`:""}`;
    if(!citizenOK()){ s="no"; w="SNAP needs U.S. citizen or qualified-immigrant status — verify before applying."; }
    out.push({id:"snap",name:"SNAP (Food Assistance)",status:s,val:s==="no"?0:1200,valTxt:s==="no"?"—":"~$100/mo (varies)",why:w+" Benefit varies with income — often around $50–$150/mo for seniors (statutory max $292).",
      form:"Online via DTAConnect or paper application.",forml:"https://www.mass.gov/snap-benefits-formerly-food-stamps",
      docs:["Proof of income","Housing + utility costs","Out-of-pocket medical expenses (60+ deduction)"],
      where:"Apply at DTAConnect.com or call DTA. Seniors can deduct medical expenses over $35/mo — push hard on this."});
  })();

  // 8. Medicare Savings Program (MA Buy-In) — no asset test in MA
  if(A.medicare==="yes"){
    const lim=MSP_INC[hh]||MSP_INC[2];
    let s = inc<=lim?"likely":(inc<=lim*1.15?"maybe":"no");
    let mw = s==="no"?`Income above ~${money(lim)}; still worth a SHINE check.`:`Massachusetts has NO asset test for this — it pays the Part B premium (~$185/mo) and often more. High-value, often missed.${citizenNote()}`;
    if(!citizenOK()){ s="no"; mw="Needs U.S. citizen or qualified-immigrant status — verify."; }
    out.push({id:"msp",name:"Medicare Savings Program (pays Part B)",status:s,val:s==="no"?0:2220,valTxt:s==="no"?"—":"~$2,100+/yr",
      why:mw,
      form:"MassHealth Buy-In application (MSP).",forml:"https://www.mass.gov/info-details/masshealth-coverage-types-for-individuals-and-families-including-people-with-disabilities#medicare-savings-programs-",
      docs:["Medicare card","Proof of income","Social Security award letter"],
      where:"Apply through MassHealth or get free help from a SHINE counselor (1-800-AGE-INFO). Approval also triggers federal Extra Help for drug costs."});
    // Extra Help flag
    if(s!=="no"){
      out.push({id:"lis",name:"Extra Help — Part D Drug Costs",status:"likely",val:600,valTxt:"~$600+/yr",
        why:"Qualifying for the Medicare Savings Program automatically grants Extra Help (lower drug copays).",
        form:"Automatic with MSP, or apply via SSA.",forml:"https://www.ssa.gov/medicare/part-d-extra-help",
        docs:["Same as MSP"],where:"Confirm enrollment when MSP is approved; otherwise apply at ssa.gov."});
    }
  }

  // 9. VA Aid & Attendance (requires WARTIME service)
  if((A.veteran==="vet"||A.veteran==="spouse") && A.adl==="yes" && A.wartime!=="no"){
    const wt = A.wartime==="yes";
    out.push({id:"aanda",name:"VA Aid & Attendance Pension",status: wt?"likely":"maybe",val:A.veteran==="vet"?27000:16000,
      valTxt:A.veteran==="vet"?"up to ~$2,300/mo":"up to ~$1,480/mo",
      why: wt?"Wartime veteran (or surviving spouse) who needs help with daily activities — a large, underused benefit.":"Big benefit IF the service included a wartime period (90 days active, 1 day wartime) — confirm the dates. Also needs net worth under ~$155k.",
      form:"VA Form 21-2680 + pension application.",forml:"https://www.va.gov/pension/aid-attendance-housebound/",
      docs:["DD-214 (shows service dates — confirms the wartime requirement)","Doctor's statement on care needs","Income & net-worth statement (limit ~$155k)","Care/medical expense records"],
      where:"File with the VA; a free accredited VSO (Veterans Service Officer) or the town Veterans' Agent can do this with you — never pay someone to file it."});
  }

  // 10. Social Security review (informational)
  {
    const tips=[];
    if(num(A.age)<70 && A.working==="no") tips.push("delaying claiming raises the monthly check ~8%/yr until 70");
    if(A.marital==="married") tips.push("a spousal benefit can be worth up to 50% of the higher earner's");
    if(A.marital==="widowed") tips.push("survivor benefits may pay more than the current check — worth checking");
    if(A.working==="yes" && num(A.age)<67) tips.push("the earnings test may be reducing the check while still working");
    out.push({id:"ss",name:"Social Security Review",status:"maybe",val:0,valTxt:"strategy",
      why: tips.length?("Worth a one-time look: "+tips.join("; ")+"."):"A one-time claiming/strategy review is usually worthwhile.",
      form:"Free review with a fee-only advisor or SSA.",forml:"https://www.ssa.gov/myaccount/",
      docs:["my Social Security account statement","Spouse's earnings record (if married/widowed)"],
      where:"Open a my Social Security account to see the actual numbers. NOTE: this is information, not financial advice — confirm with a licensed advisor before changing anything."});
  }

  // 11. MassHealth — REFER, never advise
  if(age>=65 && (A.adl==="yes" || assets<100000)){
    out.push({id:"masshealth",name:"MassHealth / Long-Term Care",status:"refer",val:0,valTxt:"see an attorney",
      why:"Potentially major help with care costs — BUT eligibility & asset planning is legal work (5-year lookback, estate recovery). Don't DIY.",
      form:"Handled by an elder-law attorney.",forml:"https://www.mass.gov/masshealth",
      docs:["Bring a full asset/income picture to the consult"],
      where:"Refer to a licensed MA elder-law attorney — many offer a free first consult. This is the ONE area we do not advise on directly, by design."});
  }

  // 12. SSI (very low income + STRICT asset limit; aged 65+ or disabled)
  const ssiAssetCap = A.marital==="married"?3000:2000;
  if((age>=65 || disabled) && assets<=ssiAssetCap+1000 && inc<13000){
    const s = citizenOK()?"maybe":"no";
    out.push({id:"ssi",name:"Supplemental Security Income (SSI)",status:s,
      val: s==="no"?0:6000, valTxt: s==="no"?"—":"up to ~$960/mo",
      why: citizenOK()?`Income and assets look low enough to be worth a hard look. SSI has a STRICT countable-asset limit (~$${ssiAssetCap.toLocaleString()}) and pays up to ~$960/mo federal + a small MA supplement. Confirm exact countable assets & income — these limits are unforgiving, so this is a "verify," not a sure thing.`:"SSI needs U.S. citizen or qualified-immigrant status.",
      form:"Apply with the Social Security Administration.",forml:"https://www.ssa.gov/ssi/",
      docs:["Bank statements (asset limit is strict — ~$2,000 single / $3,000 couple)","Proof of income","ID & citizenship/immigration docs"],
      where:"Apply at ssa.gov or 1-800-772-1213. SSI in MA usually opens MassHealth automatically."});
  }

  // 13. Chapter 115 MA veterans' benefits (need-based; separate from the Cl.22 exemption)
  if((A.veteran==="vet"||A.veteran==="spouse") && inc<45000){
    out.push({id:"ch115",name:"MA Veterans' Benefits (Chapter 115)",status:"maybe",val:6000,valTxt:"need-based, can be substantial",
      why:"Need-based MA cash + medical benefit for low-income veterans and surviving spouses — completely separate from the property-tax exemption, and often missed.",
      form:"Through your city/town Veterans' Service Officer (VSO).",forml:"https://www.mass.gov/chapter-115-benefits",
      docs:["DD-214","Income & asset statement","Proof of MA residency"],
      where:"Contact your municipal Veterans' Service Officer — every MA city/town has one; the service is free."});
  }

  // 14. Property tax deferral Clause 41A (owner 65+) — the income-too-high fallback
  if(owner && age>=65){
    out.push({id:"defer41a",name:"Property Tax Deferral (Clause 41A)",status:"maybe",val:0,valTxt:"defers up to 100% of the bill",
      why:"Lets a 65+ owner defer property tax at low interest, repaid when the home is sold or transferred. The fallback when income is too high for the 41C exemption — keeps a house-rich/cash-tight senior in their home.",
      form:"State Tax Form 97 (town assessor) + a tax-deferral agreement.",forml:"https://www.mass.gov/info-details/learn-about-property-tax-deferral-and-exemptions-for-residential-properties",
      docs:["Proof of ownership & residency","Income statement","Note: it's a lien repaid later, not a giveaway"],
      where:`${A.town||"Town"} Assessor. Income limit is a local option (often ~$60k+). Discuss with family since it reduces home equity over time.`});
  }

  // 15. Senior property-tax Work-Off (owner 60+)
  if(owner && age>=60){
    out.push({id:"workoff",name:"Senior Property Tax Work-Off",status:"maybe",val:1500,valTxt:"up to ~$2,000/yr off the bill",
      why:"Many MA towns let seniors volunteer for the town in exchange for up to ~$2,000 off the property tax bill. Town-specific program.",
      form:"Sign up through the town (Council on Aging or Assessor).",forml:"https://www.mass.gov/info-details/property-tax-exemptions-for-seniors",
      docs:["Proof of age & residency"],
      where:`Ask the ${A.town||"town"} Council on Aging or Assessor if they run a Senior Work-Off program and whether slots are open.`});
  }

  // 16. Prescription Advantage (MA pharmacy assistance; 65+ or disabled)
  if(age>=65 || disabled){
    out.push({id:"rxadv",name:"Prescription Advantage (MA)",status:"maybe",val:600,valTxt:"lowers drug costs",
      why:"MA state pharmacy program that wraps around Medicare Part D — fills coverage gaps and caps out-of-pocket drug spending. Income-based benefit levels.",
      form:"Apply to Prescription Advantage (works with Part D).",forml:"https://www.mass.gov/prescription-advantage",
      docs:["Medicare card","Income info","Current drug list"],
      where:"Apply via mass.gov or a SHINE counselor; stacks on top of Part D / Extra Help."});
  }

  // 17. Utility low-income discount rate + arrearage forgiveness (income-eligible)
  if(A.housing!=="family"){
    const utilLim = LIHEAP[hh]||LIHEAP[2];
    if(inc<=utilLim*1.3){
      out.push({id:"utildisc",name:"Utility Discount Rate",status: inc<=utilLim?"likely":"maybe",val:450,valTxt:"~$300–$600/yr",
        why:"Income-eligible households get a discounted electric & gas rate (often 25–42% off), plus arrearage-forgiveness programs. Separate from — and stackable with — Fuel Assistance.",
        form:"Enroll with the electric/gas utility (often automatic with LIHEAP/SNAP/MassHealth).",forml:"https://www.mass.gov/info-details/low-income-discount-rates-for-utilities",
        docs:["Proof of income or a benefit-program enrollment letter","A recent utility bill"],
        where:"Call the utility's low-income/discount line, or it auto-applies once Fuel Assistance/SNAP/MassHealth is approved."});
    }
  }

  // 18. Weatherization (WAP) — income-eligible
  if(A.housing!=="family"){
    const utilLim = LIHEAP[hh]||LIHEAP[2];
    if(inc<=utilLim){
      out.push({id:"wap",name:"Weatherization Assistance (WAP)",status:"maybe",val:0,valTxt:"free home energy upgrades",
        why:"Free insulation, air-sealing, and heating-system help for income-eligible homes (owners AND renters) — cuts heating bills long-term.",
        form:"Through the local Community Action / fuel-assistance agency.",forml:"https://www.mass.gov/how-to/apply-for-weatherization-assistance-program-wap",
        docs:["Proof of income","A recent energy bill"],
        where:"Apply at the same local CAP agency as Fuel Assistance — they often screen for both together."});
    }
  }

  // 19. Lifeline + ACP-style phone/broadband discount (income- or program-based)
  (()=>{
    const lim135 = FPL135[hh]||FPL135[2];
    const snapLim = SNAP200[hh]||SNAP200[2];
    let s = inc<=lim135 ? "likely" : (inc<=snapLim ? "maybe" : "no");
    if(s==="no") return; // don't clutter for clearly-ineligible
    out.push({id:"lifeline",name:"Lifeline Phone/Internet Discount",status:s,val:120,valTxt:"~$10–$20/mo off",
      why:(s==="likely"?"Income looks within Lifeline's ~135% FPL limit":"You likely qualify *through* a benefit program (SNAP/MassHealth/SSI auto-qualify)")+" — a monthly federal (and MA) discount on a phone or home-internet bill. Commonly missed.",
      form:"Apply via the Lifeline National Verifier, or through a participating phone/internet carrier.",forml:"https://www.lifelinesupport.org/",
      docs:["Proof of income OR proof of SNAP/MassHealth/SSI enrollment","ID"],
      where:"Easiest path: once SNAP/MassHealth is approved, the carrier can enroll you automatically. One discount per household."});
  })();

  // 20. Community MassHealth / Frail Elder (the FREE, no-lawyer, no-lookback path — distinct from LTC planning)
  if(A.adl==="yes" && (age>=65 || disabled)){
    out.push({id:"mhcommunity",name:"In-Home Care via MassHealth (Frail Elder Waiver)",status:"maybe",val:0,valTxt:"in-home care + dental",
      why:"Needs help with daily activities — there's a FREE path most people miss: community MassHealth + the Frail Elder Waiver / Personal Care Attendant / adult day health pay for care AT HOME, plus adult dental. Income/asset limits apply, but the 5-year lookback does NOT (that only applies to nursing-home MassHealth) — so no lawyer needed to apply.",
      form:"Free eligibility screen through your local ASAP (Aging Services Access Point).",forml:"https://www.mass.gov/info-details/masshealth-coverage-types-for-individuals-and-families-including-people-with-disabilities",
      docs:["Income & asset info","Medicare/insurance cards","A note on the help needed at home"],
      where:"Call your local ASAP or 800-AGE-INFO (SHINE) for a free assessment — no attorney required. (Nursing-home/asset-protection MassHealth is the separate 'see a pro' card below.)"});
  }

  // 21. Reduced-fare senior transit (NOT income-based — universal for 65+/disabled)
  if(age>=65 || disabled){
    out.push({id:"transit",name:"Reduced-Fare Senior Transit",status:"likely",val:0,valTxt:"half-fare or free rides",
      why:"Not income-based — anyone 65+ (or with a disability) gets reduced or free local transit: MBTA Senior CharlieCard, regional (RTA) half-fare, and The RIDE paratransit.",
      form:"Apply to the local transit authority for a senior/disabled fare card.",forml:"https://www.mass.gov/how-to/apply-for-a-senior-charliecard",
      docs:["Proof of age (ID) or disability","A photo for the card"],
      where:"MBTA Senior CharlieCard office, or your regional transit authority (RTA). The RIDE needs a separate application."});
  }

  // ---- Unknown-answer handling: a created card that depends on a skipped ("not sure") field becomes "verify — needs info" ----
  const DEP={
    cb:["filing","dependent","incomeSS","incomeOther","propTax","assessed","rent","subsidized"],
    ex41c:["incomeSS","incomeOther","assets","titling"],
    vet22:["vaDis"],
    aanda:["wartime"],
    liheap:["incomeSS","incomeOther"],
    snap:["incomeSS","incomeOther","citizen"],
    msp:["incomeSS","incomeOther","citizen"],
    ssi:["incomeSS","incomeOther","assets","citizen"],
    ch115:["incomeSS","incomeOther"],
    utildisc:["incomeSS","incomeOther"],
    wap:["incomeSS","incomeOther"],
    lifeline:["incomeSS","incomeOther"]
  };
  out.forEach(p=>{
    if(p.status==="have"||p.status==="refer"||p.status==="no") return;
    const miss=(DEP[p.id]||[]).filter(isUnknown);
    if(miss.length){ p.status="maybe"; p.why="⚠️ Can't confirm yet — still need: "+miss.map(qLabel).join(", ")+" (see the checklist up top). "+p.why; }
  });

  // ---- "Already receiving" override: don't tell people to apply for what they have ----
  const haveMap={cb:"cb",ex41c:"exemption",ex17d:"exemption",vet22:"exemption",blind37a:"exemption",liheap:"liheap",snap:"snap",msp:"msp",lis:"msp",masshealth:"masshealth"};
  const has=(A.already||[]);
  out.forEach(p=>{
    const k=haveMap[p.id];
    if(k && has.includes(k) && p.status!=="no"){
      p.status="have"; p.val=0;
      p.why="✓ Already receiving this — no action needed. Just re-confirm it stays active (most must be re-filed/redetermined every year).";
    }
  });

  return out;
}

/* ---------- Results screen ---------- */
function results(){
  document.getElementById("bar").style.width="100%";
  document.getElementById("privacy").style.display="none";
  const ps=programs();
  const rank={likely:0,maybe:1,have:2,refer:3,no:4};
  ps.sort((a,b)=> (rank[a.status]-rank[b.status]) || (b.val-a.val));
  const likely=ps.filter(p=>p.status==="likely");
  const total=likely.reduce((s,p)=>s+(p.val||0),0);
  const haveN=ps.filter(p=>p.status==="have").length;
  const nm=who(A);

  const maybeN=ps.filter(p=>p.status==="maybe").length;
  const unknownN=Q.filter(q=>A[q.id]==="unknown").length;
  let h=`<div class="headline">
      <div class="pill" style="color:#fff;background:rgba(255,255,255,.18)">${(A.town||"Massachusetts")}</div>
      <div class="big">${total>0?"≈ "+money(total)+"/yr":"Let's dig in"}</div>
      <div class="lbl">in benefits ${nm==="this person"?"they":nm} may be leaving on the table — estimated, if approved for the strong matches</div>
      <div class="sub">${likely.length} to apply for now &middot; ${maybeN} worth verifying${haveN?` &middot; ${haveN} already active`:""}. Tap any card for the exact form, documents, and where to file.</div>
    </div>
    <div class="estnote">These are <b>estimates, not guarantees</b> — each program must be applied for and confirmed, and amounts vary by income and town. This tool finds what to chase; it doesn't approve anything.</div>
    <div class="legend">
      <span><i style="background:var(--green)"></i>Apply now</span>
      <span><i style="background:var(--amber)"></i>Verify / need info</span>
      ${haveN?`<span><i style="background:#0a5"></i>Already have</span>`:""}
      <span><i style="background:var(--blue)"></i>See a pro</span>
    </div>
    <div class="nextsteps">
      <h3>What to do next</h3>
      <ol>
        <li><b>Start with the green "Apply for these" cards below.</b> Tap <b>How to claim it</b> on each one to see the exact form, what to gather, and where to file.</li>
        ${unknownN?`<li><b>Track down the ${unknownN} answer${unknownN>1?"s":""} you weren't sure about</b> — the yellow box explains where to find each one.</li>`:""}
        <li><b>Print or save this page</b> with the button at the bottom, so you have the list when you make calls.</li>
        <li><b>Want help doing it?</b> Our Full Benefits Check turns this into a written plan and walks through it with you on a call — see the bottom of this page.</li>
      </ol>
    </div>`;

  // "I'm not sure" checklist — resurface every skipped answer with how-to-find-it help
  const unknownQs = Q.filter(q=>A[q.id]==="unknown");
  if(unknownQs.length){
    const many=unknownQs.length>1;
    h+=`<div class="gaps"><h3>⚠️ ${unknownQs.length} answer${many?"s":""} to track down</h3>
      <p class="lead">You marked ${many?"these":"this"} "not sure." Find ${many?"them":"it"} and re-run — ${many?"they":"it"} can change what ${nm==="this person"?"they"  : nm} qualif${nm==="this person"?"y":"ies"} for.</p>`;
    unknownQs.forEach(q=>{ const qt=typeof q.q==="function"?q.q(A):q.q; h+=`<div class="gitem"><div class="gq">${qt}</div>${q.help?`<div class="gh">${q.help}</div>`:""}</div>`; });
    h+=`</div>`;
  }
  if((A.already||[]).includes("unsure")){
    h+=`<div class="gaps" style="background:#e6effb;border-color:#bcd0f5"><h3 style="color:#1551a8">ℹ️ First, check what's already in place</h3>
      <p class="lead" style="color:#33507e">You weren't sure which of these ${nm==="this person"?"they"  : nm} already gets. Here's how to check each, so you don't re-apply for something already active:</p>
      <div class="gitem" style="border-color:#cfe0fb"><div class="gq">Circuit Breaker credit</div><div class="gh">Last year's MA state tax return — a "Schedule CB" credit line.</div></div>
      <div class="gitem" style="border-color:#cfe0fb"><div class="gq">Property-tax exemption</div><div class="gh">The town property tax bill — an "exemption"/"senior" line lowering the amount owed.</div></div>
      <div class="gitem" style="border-color:#cfe0fb"><div class="gq">Fuel Assistance / SNAP</div><div class="gh">Did they apply for winter heating help at a local agency? Do they have an EBT card?</div></div>
      <div class="gitem" style="border-color:#cfe0fb"><div class="gq">Medicare Part B help / MassHealth</div><div class="gh">Is the ~$185/mo Part B premium NOT coming out of their Social Security check? Do they carry a MassHealth card?</div></div>
    </div>`;
  }

  const groups=[["likely","✅ Apply for these"],["maybe","🔎 Worth verifying"],["have","✓ Already receiving — no action needed"],["refer","⚖️ Get professional help"],["no","Not a match right now"]];
  groups.forEach(([st,label])=>{
    const g=ps.filter(p=>p.status===st);
    if(!g.length) return;
    const collapse = st==="no";   // tuck the non-matches behind a toggle to cut clutter
    if(collapse){ h+=`<details class="nomatch"><summary class="sech" style="cursor:pointer;list-style:none">▸ ${label} (${g.length}) — tap to view</summary>`; }
    else { h+=`<div class="sech">${label}</div>`; }
    g.forEach(p=>{
      const bc={likely:"b-likely",maybe:"b-maybe",have:"b-have",refer:"b-refer",no:"b-no"}[p.status];
      const bt={likely:"Likely eligible",maybe:"Need to verify",have:"Already have",refer:"See a pro",no:"Not a match"}[p.status];
      h+=`<div class="prog">
        <div class="top"><h3>${p.name}</h3><span class="val">${p.valTxt}</span></div>
        <span class="badge ${bc}">${bt}</span>
        <p class="why">${p.why}</p>`;
      if(p.status!=="no"){
        h+=`<details><summary>How to claim it →</summary><div class="body">
          <b>Form:</b> ${p.form}<br>
          <b>Bring / gather:</b><ul>${p.docs.map(d=>`<li>${d}</li>`).join("")}</ul>
          <b>Where:</b> ${p.where}<br>
          <a href="${p.forml}" target="_blank" rel="noopener">Official program page →</a>
        </div></details>`;
      }
      h+=`</div>`;
    });
    if(collapse){ h+=`</details>`; }
  });

  if(SHOW_OFFER){
    h+=`<div class="offer">
      <div class="offer-h">Want us to handle it for you?</div>
      <div class="offer-sub">Personal Benefits Audit — <b>${OFFER_PRICE}</b>, money-back guarantee</div>
      <ul>
        <li>A personalized written action plan for ${nm==="this person"?"you":nm}</li>
        <li>A 30-minute call to walk through every program, step by step</li>
        <li>We help complete the paperwork we're allowed to (exemptions, fuel assistance, SNAP) and connect you to the <b>free</b> experts for the rest</li>
        <li><b>Guarantee:</b> if we don't find at least $500/yr you aren't already getting, you pay nothing</li>
      </ul>
      <a class="offer-btn" href="${CHECKOUT_URL||'#'}"${CHECKOUT_URL?'':' onclick="return false"'}>Get my audit &rarr;</a>
      <div class="offer-fine">Optional paid help — everything here can also be done yourself for free. We are not a government agency and are not affiliated with one. We do <b>not</b> prepare VA claims or tax returns for a fee; those are referred to free, accredited experts. By continuing you agree to our <a href="terms.html" target="_blank">Terms</a> &amp; <a href="privacy.html" target="_blank">Privacy Policy</a>.</div>
    </div>`;
  }
  h+=`<div class="bf-next">
      <div class="bf-next-h">Want us to do this with you?</div>
      <p>The <b>Full Benefits Check</b> is $179 flat: a written plan for ${nm==="this person"?"your family":nm}, a 30-minute call to walk through every program, and help with the paperwork. Money-back if we don't find at least $500/yr you aren't already getting.</p>
      <p class="bf-next-fine">Totally optional — everything on this page can also be done yourself, for free.</p>
      <a class="btn prim bf-next-btn" href="index.html#start">Tell me about the Full Benefits Check &rarr;</a>
    </div>
    <div class="acts">
      <button class="btn prim" onclick="window.print()">Print or save this plan</button>
    </div>
    <div class="disc"><b>Important:</b> This tool gives general information based on public Massachusetts program rules (FY2025–26). It is <b>not</b> legal, tax, or financial advice. Dollar amounts and eligibility shown are estimates — income limits, exemption amounts, and town rules change and must be confirmed with each program or a licensed professional before you rely on them. MassHealth/long-term-care planning should go to a licensed elder-law attorney.</div>`;
  document.getElementById("app").innerHTML=h;
  const dl=document.getElementById("dl");
  if(dl) dl.onclick=()=>{
    const blob=new Blob([JSON.stringify({answers:A,generated:"client-side",programs:ps},null,2)],{type:"application/json"});
    const u=URL.createObjectURL(blob);const a=document.createElement("a");
    a.href=u;a.download=`benefits-audit-${(A.name||"profile").replace(/\W+/g,"_")}.json`;a.click();URL.revokeObjectURL(u);
  };
  window.scrollTo(0,0);
}

render();
