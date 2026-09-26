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
   2026-09-25 (later): independent accuracy + coverage review (two agents,
   every claim cited; key numbers re-verified on primary sources) found
   wrong answers and 1–2-year-old figures. Fixed here; programs() now
   DIFFERS from classic/ on purpose. See PLAN.md 2026-09-25 for the list.
   YEARLY REFRESH: every constant below carries its program year + source.
   ========================================================================= */
/* ---------- Paid-offer config (KEEP OFF until LLC + attorney review + live Stripe link) ---------- */
const SHOW_OFFER = false;     // flip to true ONLY after ClariDeed goes live (LLC + legal review)
const CHECKOUT_URL = "https://clarideed.com/senior-benefits/";  // funnels into ClariDeed service #6
const OFFER_PRICE = "$179";

/* ---------- Adaptive question set (branching via showIf) ---------- */
const Q = [
  {id:"name", type:"text", q:"Whose benefits are we checking?", hint:"Just a first name, so the results read clearly.", optional:true, noSkip:true},
  {id:"age", type:"number", q:n=>`How old is ${who(n)}?`, hint:"Age as of December 31 this year.", suffix:"years", noSkip:true},
  {id:"marital", type:"single", q:n=>`${whoC(n)} marital status?`, noSkip:true,
    opts:[{v:"single",l:"Single"},{v:"married",l:"Married"},{v:"widowed",l:"Widowed"}]},
  {id:"spouseAge", type:"number", q:"How old is their spouse?", hint:"Some credits only need ONE spouse to be 65 or older.", suffix:"years",
    showIf:a=>a.marital==="married"},
  {id:"filing", type:"single", q:n=>`How does ${who(n)} file taxes?`, hint:"This sets the income limit for the Circuit Breaker credit.",
    help:"Look at the top of last year's tax return (MA Form 1 or the federal 1040) — it shows Single, Head of household, or Married. If they don't file at all, pick \"Doesn't file a return.\" Not sure? Tap \"I'm not sure\" and we'll flag it.",
    opts:[{v:"single",l:"Single"},{v:"hof",l:"Head of household"},{v:"joint",l:"Married — filing jointly"},{v:"mfs",l:"Married — filing separately"},{v:"none",l:"Doesn't file a return"}]},
  {id:"dependent", type:"single", q:n=>`Is ${who(n)} claimed as a dependent by someone else?`, hint:"Usually \"No\" for an independent senior.",
    help:"Say \"Yes\" only if an adult child or someone else lists this person as a dependent on THEIR taxes. For most seniors living on their own income, it's \"No.\"",
    opts:[{v:"no",l:"No"},{v:"yes",l:"Yes, claimed as a dependent"}]},
  {id:"citizen", type:"single", q:n=>`${whoC(n)} citizenship status?`, hint:"Needed for SNAP, SSI, and Medicare Savings.",
    help:"\"U.S. citizen\" covers anyone born in the U.S. or naturalized. \"Green card\" means a lawful permanent resident.",
    opts:[{v:"citizen",l:"U.S. citizen"},{v:"qualified",l:"Green card / lawful permanent resident"},{v:"other",l:"Other immigration status"}]},
  {id:"housing", type:"single", q:n=>`Does ${who(n)} own or rent?`, noSkip:true,
    opts:[{v:"own",l:"Owns the home"},{v:"rent",l:"Rents"},{v:"family",l:"Lives with family (no rent)"}]},
  {id:"town", type:"text", q:"Which city or town in Massachusetts?", hint:"Property-tax breaks are set town-by-town, so we need this.", noSkip:true},
  {id:"hhSize", type:"number", q:n=>`How many people live in the home, counting ${who(n)}?`, hint:"Include a spouse, adult children, grandchildren — everyone who lives there.", suffix:"people"},
  {id:"hhOtherInc", type:"currency", period:"yr", q:"Income of everyone ELSE in the home?", hint:"Not counting them or their spouse. Heating help and utility discounts look at the whole household. Enter 0 if none.", optional:true,
    help:"Add up wages, Social Security, pensions and other income of the other people who live there. A rough number is fine.",
    showIf:a=>num(a.hhSize) > (a.marital==="married"?2:1)},
  {id:"ownYears", type:"number", q:"About how many years owned?", hint:"Some senior exemptions require owning ~5 years.", suffix:"years",
    showIf:a=>a.housing==="own"},
  {id:"maYears", type:"single", q:"Have they lived in Massachusetts for at least the past 10 years?", hint:"Several property-tax breaks require 10 straight years of Massachusetts residence.",
    opts:[{v:"yes",l:"Yes, 10+ years"},{v:"no",l:"No, fewer than 10 years"}], showIf:a=>a.housing==="own"},
  {id:"titling", type:"single", q:"How is the home titled?", hint:"Trusts and life estates can change exemption eligibility.",
    help:"Check the deed or the top of the tax bill. \"In a trust\" = a family/living trust owns the home. \"Life estate\" is a legal arrangement (often for Medicaid planning). Don't know? Tap \"I'm not sure.\"",
    opts:[{v:"own_name",l:"In their own name"},{v:"trust",l:"In a trust"},{v:"life_estate",l:"Life estate"},{v:"multi",l:"Shared with others on the deed"}],
    showIf:a=>a.housing==="own"},
  {id:"incomeSS", type:"currency", period:"mo", q:n=>n.marital==="married"?`Social Security income for ${who(n)==="this person"?"them":who(n)} and their spouse, combined?`:`${whoC(n)} Social Security income?`, hint:"Just Social Security, before Medicare is taken out. If married, add both spouses together. Pick per month or per year. Enter 0 if none.",
    help:"The yearly Social Security total BEFORE the Medicare premium comes out — it's on the annual Social Security letter (Form SSA-1099). If you only know the monthly deposit, add about $203/month for Medicare Part B, then × 12. A rough number is fine."},
  {id:"incomeOther", type:"currency", period:"yr", q:n=>n.marital==="married"?"Other income — both spouses combined?":"Other income?", hint:"Everything except Social Security — pensions, wages, IRA withdrawals, interest. If married, include the spouse's income too, even if the spouse still works. Pick per month or per year.",
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
  {id:"vetService", type:"single", q:"Where did they serve?", hint:"For some places, certain health conditions are automatically treated as caused by service.",
    opts:[{v:"ao",l:"Vietnam, Thailand, Laos, Cambodia, Guam, or the Korean DMZ"},{v:"gw",l:"Gulf War, Iraq, Afghanistan, or another post-9/11 deployment"},{v:"other",l:"Somewhere else / stateside"}],
    showIf:a=>a.veteran==="vet"},
  {id:"vaDis", type:"single", q:"Service-connected disability rating?", hint:"From the VA, if any.",
    help:"On the VA award/decision letter — a percentage like 30%, 70%, or 100%. Don't have it handy? Tap \"I'm not sure.\"",
    opts:[{v:"none",l:"None"},{v:"partial",l:"10% – 90%"},{v:"full",l:"100% or unable to work"}],
    showIf:a=>a.veteran==="vet"||a.veteran==="spouse"},
  {id:"wartime", type:"single", q:"Did the service include a wartime period?", hint:"Required for the VA Aid & Attendance pension.",
    help:"At least 90 days of active duty with one day during a wartime window (anyone who entered after 9/7/1980 generally needs 24 months, or the full period called up) — e.g., WWII, Korea, Vietnam (8/5/1964–5/7/1975, or from 11/1/1955 if served in Vietnam itself), or the Gulf War (8/2/1990–present). Peacetime-only service doesn't qualify for this particular pension. Not sure of the dates? Tap \"I'm not sure.\"",
    opts:[{v:"yes",l:"Yes — served during a wartime period"},{v:"no",l:"No — peacetime only"}],
    showIf:a=>a.veteran==="vet"||a.veteran==="spouse"},
  {id:"disability", type:"single", q:n=>`Does ${who(n)} have a disability or get SSDI/SSI?`, hint:"Separate from veterans' disability — opens programs regardless of age.",
    opts:[{v:"yes",l:"Yes"},{v:"no",l:"No"}]},
  {id:"blind", type:"single", q:n=>`Is ${who(n)} legally blind?`,
    opts:[{v:"yes",l:"Yes"},{v:"no",l:"No"}]},
  {id:"medicare", type:"single", q:n=>`Is ${who(n)} on Medicare?`,
    opts:[{v:"yes",l:"Yes"},{v:"no",l:"No / not yet"}]},
  {id:"healthCov", type:"single", q:n=>`What health coverage does ${who(n)} have now?`,
    opts:[{v:"employer",l:"Through a job or retiree plan"},{v:"masshealth",l:"MassHealth"},{v:"connector",l:"A Health Connector plan"},{v:"none",l:"No coverage right now"}],
    showIf:a=>a.medicare==="no"},
  {id:"adl", type:"single", q:"Need help with daily activities?", hint:"Bathing, dressing, cooking, managing meds, getting around.",
    opts:[{v:"yes",l:"Yes, needs some help"},{v:"no",l:"No, fully independent"}]},
  {id:"already", type:"multi", q:n=>`Is ${who(n)} ALREADY getting any of these?`, hint:"It's totally normal not to know. If you can't tell, pick \"I'm not sure\" at the bottom — we'll help you check.", noSkip:true, exclusive:["none","unsure"],
    help:"Where to look for each: 1) Circuit Breaker — last year's MA state tax return, a line called \"Schedule CB\" / Circuit Breaker credit. 2) Property-tax exemption — the town property tax bill, a line lowering the amount (often labeled \"exemption\" or \"senior\"). 3) Fuel Assistance — did they apply for winter heating help at a local agency? 4) SNAP — do they have an EBT card? 5) Medicare Part B help — is the ~$203/mo premium NOT coming out of their Social Security check? 6) MassHealth — do they carry a MassHealth card? If you can't check any of these right now, just pick \"I'm not sure.\"",
    opts:[
      {v:"cb",l:"Senior Circuit Breaker tax credit",d:"A refund on the MA state tax return (look for \"Schedule CB\") — often $1,000–$2,800/yr."},
      {v:"exemption",l:"A property-tax exemption",d:"A discount line on the town property tax bill that lowers what's owed."},
      {v:"liheap",l:"Fuel Assistance (heating-bill help)",d:"Winter heating help, also called LIHEAP."},
      {v:"snap",l:"SNAP / food assistance",d:"Food benefits on an EBT card (used to be \"food stamps\")."},
      {v:"msp",l:"Help paying the Medicare Part B premium",d:"Something other than their Social Security check covers the ~$203/mo Part B premium."},
      {v:"masshealth",l:"MassHealth",d:"MassHealth — Massachusetts Medicaid (they'd have a MassHealth card)."},
      {v:"vacomp",l:"VA disability compensation",d:"A monthly VA payment for a service-connected condition."},
      {v:"homecare",l:"State Home Care services",d:"In-home help arranged by the local Aging Services Access Point (ASAP)."},
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
function qLabel(id){ const m={spouseAge:"spouse's age",hhSize:"household size",hhOtherInc:"other household income",maYears:"years living in Massachusetts",vetService:"where they served",healthCov:"current health coverage",filing:"tax filing status",dependent:"dependent status",incomeSS:"Social Security income",incomeOther:"other income",propTax:"property tax amount",assessed:"home assessed value",rent:"monthly rent",subsidized:"subsidized-housing status",assets:"savings/assets",titling:"how the home is titled",vaDis:"VA disability rating",wartime:"wartime-service status",citizen:"citizenship status"}; return m[id]||id; }

/* ---------- State ---------- */
let A = {};           // answers
let order = [];       // visible question ids in order visited
let i = 0;            // index into a freshly computed visible list

function visible(){ return Q.filter(q=>!q.showIf || q.showIf(A)); }

/* ---------- Question list / navigation (added 2026-09-25 after Dad's test:
   he typed the wrong income and couldn't find a way back, especially from the
   results page). Every question is listed with a dot — green when answered,
   amber "?" when marked not sure, empty when not answered yet — and any item
   can be tapped to jump straight to it. ---------- */
const NAV = {name:"Name",age:"Age",marital:"Marital status",spouseAge:"Spouse's age",filing:"Tax filing",dependent:"Claimed as a dependent?",citizen:"Citizenship",housing:"Own or rent",town:"City or town",hhSize:"People in the home",hhOtherInc:"Others' income",ownYears:"Years owned",maYears:"10+ years in MA",titling:"How the home is titled",incomeSS:"Social Security",incomeOther:"Other income",assets:"Savings",medExpenses:"Medical costs",propTax:"Property tax",assessed:"Assessed value",rent:"Monthly rent",subsidized:"Subsidized housing?",veteran:"Military service",vetService:"Where they served",vaDis:"VA rating",wartime:"Wartime service",disability:"Disability",blind:"Legally blind",medicare:"Medicare",healthCov:"Health coverage",adl:"Help with daily activities",already:"Already getting",working:"Still working"};
let editMode = false;   // true when the person jumped back from the results page
function ansState(q){
  const v=A[q.id];
  if(v==="unknown") return "unsure";
  if(v==null) return "empty";
  if(Array.isArray(v)) return v.length?"done":"empty";
  return String(v).trim()===""?"empty":"done";
}
function fmtAns(q){
  const v=A[q.id], st=ansState(q);
  if(st==="unsure") return "Not sure";
  if(st==="empty") return "—";
  if(q.type==="single"){ const o=(q.opts||[]).find(o=>o.v===v); return o?o.l:String(v); }
  if(q.type==="multi"){ return v.map(x=>{const o=q.opts.find(o=>o.v===x); return o?o.l.replace(/^🤔\s*/,""):x;}).join(", "); }
  if(q.type==="currency"){ const per=A[q.id+"_per"]; return per==="mo" ? money(num(v)/12)+"/month" : money(num(v))+(["incomeSS","incomeOther","hhOtherInc","medExpenses","propTax"].includes(q.id)?"/year":""); }
  if(q.type==="number") return String(v)+(q.suffix?" "+q.suffix:"");
  return String(v);
}
function navHTML(vis){
  const done=vis.filter(q=>ansState(q)!=="empty").length;
  const allDone = done===vis.length;
  let h=`<details class="qnav" id="qnav"><summary><span class="qnav-t">All questions</span> <span class="qnav-c">${done} of ${vis.length} answered</span></summary><ol>`;
  vis.forEach((q,k)=>{
    const st=ansState(q), cur=(k===i);
    h+=`<li><button type="button" class="qn ${cur?'cur':''} st-${st}" data-k="${k}" ${cur?'aria-current="step"':''}><span class="dot" aria-hidden="true">${st==="done"?"✓":(st==="unsure"?"?":"")}</span><span class="qn-l">${k+1}. ${NAV[q.id]||q.id}</span><span class="sr-only">${st==="done"?" — answered":(st==="unsure"?" — marked not sure":" — not answered yet")}</span></button></li>`;
  });
  h+=`</ol>${allDone?`<button type="button" class="btn prim qnav-res" id="navres">See my results &rarr;</button>`:""}</details>`;
  return h;
}
function wireNav(vis){
  const nav=document.getElementById("qnav"); if(!nav) return;
  if(window.innerWidth>=900) nav.open=true;
  nav.querySelectorAll(".qn").forEach(b=>b.onclick=()=>{ i=parseInt(b.dataset.k,10); render(); const m=document.querySelector(".qmain"); if(m&&window.innerWidth<900) m.scrollIntoView({block:"start"}); });
  const r=document.getElementById("navres"); if(r) r.onclick=()=>{ editMode=false; i=visible().length; render(); };
}

/* ---------- Anonymous completion counts (Ryan 2026-09-25: "just for statistical
   purposes to see if people finish it"). Sends ONLY: start / finish / leave, the
   id + number of the furthest question reached, the total shown, and phone vs
   desktop. Never answers, names or towns. The session id is random per page load
   and not stored, so visits can't be linked. Skipped if the browser asks not to be
   tracked (Do Not Track / Global Privacy Control). Worker: stats-worker/ ---------- */
/* ---------- Town data (data/towns.json, built by tools/build_towns.py) ----------
   DLS local-options records for all 351 cities/towns (which senior/veteran property-tax
   options each has adopted) + where-to-apply agencies. An absent key means "the source
   doesn't show it", NEVER "the town doesn't offer it" — the card always says to confirm
   with the assessor. Dollar amounts on file with DLS are deliberately NOT shown (they
   matched towns' own documents in only 3 of 7 spot checks). */
let TOWNS = null, AGENCIES = {}, TOWN_IDX = null;
const BOSTON_NBHD = ["allston","brighton","charlestown","dorchester","east boston","hyde park","jamaica plain",
  "mattapan","roslindale","roxbury","south boston","west roxbury","back bay","beacon hill","north end","south end",
  "fenway","mission hill","chinatown","west end","readville"];
function townKey(s){
  return String(s||"").toLowerCase().replace(/[.,]/g," ")
    .replace(/\b(ma|mass|massachusetts)\s*$/,"").replace(/^\s*(the\s+)?(town|city)\s+of\s+/,"")
    .replace(/\s+(town|city)\s*$/,"").replace(/[^a-z ]/g,"").replace(/\s+/g," ").trim();
}
function townLookup(s){
  if(!TOWNS || !s) return null;
  if(!TOWN_IDX){ TOWN_IDX={}; for(const n in TOWNS) TOWN_IDX[townKey(n)]=n; }
  let k=townKey(s), n=TOWN_IDX[k];
  if(!n && BOSTON_NBHD.includes(k)) n="Boston";
  return n ? {name:n, ...TOWNS[n]} : null;
}
function fillTownList(){
  const dl=document.getElementById("ma-towns");
  if(dl && TOWNS && !dl.options.length) dl.innerHTML=Object.keys(TOWNS).map(n=>`<option value="${n}">`).join("");
}
try{
  fetch("data/towns.json").then(r=>r.ok?r.json():null).then(d=>{
    if(d&&d.towns){ TOWNS=d.towns; AGENCIES=d.agencies||{}; fillTownList(); }
  }).catch(()=>{});
}catch(e){}
function agencyHTML(ids, nbhd){
  let list=(Array.isArray(ids)?ids:[ids]).map(i=>AGENCIES[i]).filter(Boolean);
  // Boston has 3 home-care agencies split by neighborhood: if we know the neighborhood, show just that one.
  if(list.length>1 && nbhd){ const m=list.filter(a=>(a.a||[]).some(x=>x.toLowerCase()===nbhd)); if(m.length) list=m; }
  return list.map(a=>`${a.u?`<a href="${a.u}" target="_blank" rel="noopener">${a.n}</a>`:a.n}${a.p?` — <a href="tel:${a.p.replace(/[^0-9+]/g,"")}">${a.p}</a>`:""}${list.length>1&&a.a?`<br><span class="tc-areas">Serves: ${a.a.join(", ")}</span>`:""}`).join("<br>");
}
function townTaxRows(t, ps){
  // Only list a town tax break if the engine did NOT rule the person out (age, income, assets, years owned).
  // 2026-09-25 bug: a 47-year-old saw the senior exemption because this card re-decided on its own.
  const st=id=>{ const p=(ps||[]).find(x=>x.id===id); return p?p.status:null; };
  const open=id=>{ const s=st(id); return s!==null && s!=="no"; };
  const age=Math.max(num(A.age)||0, A.marital==="married"?(num(A.spouseAge)||0):0);
  const rows=[];
  if(A.housing!=="own" || !t) return rows;
  const W=t.w||{}, src=u=>u?` <a class="tc-srcl" href="${u}" target="_blank" rel="noopener">(town source)</a>`:"";
  if(open("ex41c") && W.ex && (W.ex.amt||W.ex.age)){
    if(W.ex.age && age && age<W.ex.age) rows.push(`<b>Senior exemption</b> — in ${t.name} it starts at age <b>${W.ex.age}</b>, so it doesn't apply yet.${src(W.ex.src)}`);
    else rows.push(`<b>Senior exemption</b> — ${W.ex.amt?`<b>${typeof W.ex.amt==="number"?"$"+W.ex.amt.toLocaleString():W.ex.amt} a year</b> off the bill`:"money off the bill"}${W.ex.age?`, from age ${W.ex.age}`:""}${W.ex.fy?` (FY${W.ex.fy}, from ${t.name}'s own website)`:""}. Income and savings limits apply — the assessor has this year's numbers.${src(W.ex.src)}`);
  } else if(open("ex41c")){
    let ex="";
    if(t.c==="41C½") ex=`<b>Senior exemption (Clause 41C½)</b> — a larger version tied to home values in town, with <b>no savings limit</b> and an income limit that follows the state Circuit Breaker limit.`;
    else if(t.c==="41C"||t.c==="41B") ex=`<b>Senior exemption (Clause ${t.c})</b> — usually $500–$1,000 a year off the bill, with income and savings limits the town sets.`;
    if(ex){ ex+= t.age ? ` State records list the qualifying age as <b>${t.age}</b>.` : ` Starts at age 70, or 65 if the town lowered it.`; rows.push(ex); }
  }
  if(t.mt && open("ex41c")) rows.push(`<b>A local means-tested senior exemption</b> — ${t.name} has its own extra tax break for lower-income seniors.`);
  if(t.ss && open("ex17d")) rows.push(t.ss==="17D" ? `<b>Age 70+ / surviving spouse exemption (Clause 17D)</b> — about $175 a year, no income test, savings limit about $40,000 (home not counted).` : `<b>Age 70+ / surviving spouse exemption (Clause ${t.ss})</b> — about $175 a year, with a savings limit the town can confirm.`);
  if(open("vet22")) rows.push(`<b>Veterans exemption (Clause 22)</b> — every town offers it: $400+ a year with a 10%+ service-connected rating, more for higher ratings.`);
  if(open("blind37a")) rows.push(t.b37?`<b>Blind exemption (Clause 37A)</b> — $500 a year.`:`<b>Blind exemption</b> — $437.50 a year (or $500 if the town adopted Clause 37A).`);
  if(t.cpa && t.cpas && age>=60 && (open("ex41c")||open("cb"))) rows.push(`<b>Community Preservation Act surcharge exemption</b> — ${t.name} has the CPA surcharge on tax bills and exempts qualifying low- and moderate-income seniors from it.`);
  if(t.res) rows.push(`<b>Residential exemption (${t.res}%)</b> — ${t.name} lowers the taxable value of homes that are the owner's main residence. If it isn't on the bill, apply.`);
  if(open("workoff")){
    const o=W.wo;
    if(o && o.s==="offered") rows.push(`<b>${t.name} runs a senior tax work-off</b> — ${o.max?`volunteer for the town for up to <b>$${o.max.toLocaleString()} a year</b> off the bill`:"volunteer for the town in exchange for money off the bill"}.${o.win?` Sign-up: ${o.win}.`:""}${o.where?` Apply: ${o.where}${o.ph?`, ${o.ph}`:""}.`:(o.ph?` Call ${o.ph}.`:"")}${o.old?" <i>(From an older town notice — confirm this year's details.)</i>":""} Spots are often limited, so ask early.${src(o.src)}`);
    else if(o && o.s==="not_offered") {}
    else rows.push(`<b>Senior tax work-off</b> — many towns let people 60+ volunteer for up to <b>$2,000 a year</b> off the bill. We couldn't confirm whether ${t.name} runs one, so ask.`);
  }
  if(open("defer41a")) rows.push(`<b>Tax deferral (Clause 41A)</b> — postpone the tax until the home is sold (with interest).${t.d41?` ${t.d41} ${t.d41===1?"homeowner":"homeowners"} in ${t.name} used it last year.`:""}`);
  return rows;
}
function townCard(ps){
  const t=townLookup(A.town);
  if(!A.town) return "";
  if(!t) return `<div class="towncard"><h3>📍 Your town</h3><p>We couldn't match "${String(A.town).replace(/[<>&"]/g,"")}" to one of Massachusetts' 351 cities and towns, so we can't show town-specific details. If it's a village or neighborhood, tap <b>Change</b> next to "Town" below and pick the town it's part of.</p></div>`;
  const rows=townTaxRows(t, ps);
  const svc=[];
  if(t.fuel) svc.push(`<b>Heating help (fuel assistance):</b><br>${agencyHTML(t.fuel)}`);
  if(t.asap) svc.push(`<b>Home care and elder services (Aging Services Access Point):</b><br>${agencyHTML(t.asap, townKey(A.town))}`);
  if(t.coa) svc.push(`<b>Council on Aging / senior center:</b><br>${t.coa.u?`<a href="${t.coa.u}" target="_blank" rel="noopener">${t.coa.n||"Council on Aging"}</a>`:(t.coa.n||"Council on Aging")}${t.coa.p?` — <a href="tel:${t.coa.p.replace(/[^0-9+]/g,"")}">${t.coa.p}</a>`:""}`);
  if(t.shine) svc.push(`<b>Free Medicare counseling (SHINE):</b><br>${agencyHTML(t.shine)}`);
  if(t.rta) svc.push(`<b>Local buses (reduced fares for seniors):</b><br>${agencyHTML(t.rta)}`);
  if(t.ride) svc.push(`<b>MBTA:</b> reduced fares with a Senior CharlieCard (65+). The RIDE offers door-to-door rides for people who can't use regular buses and trains${t.ride==="partial"?" (in parts of town)":""}.`);
  if(!rows.length && !svc.length) return "";
  let h=`<div class="towncard"><h3>📍 Your town: ${t.name}</h3>`;
  if(rows.length){
    h+=`<p class="tc-lead"><b>Call the ${t.name} assessor's office</b>${(t.w&&t.w.ap)?` at <a href="tel:${t.w.ap.replace(/[^0-9+]/g,"")}">${t.w.ap}</a>`:""} (usually in town or city hall) and ask about these. Nobody signs you up automatically, and the deadline is <b>April 1 or 3 months after the tax bill is mailed</b>, whichever is later — late applications can't be accepted.</p><ul class="tc-list">${rows.map(r=>`<li>${r}</li>`).join("")}</ul>`;
    h+=`<p class="tc-more"><a href="property-tax-exemptions.html" target="_blank" rel="noopener">What each of these means, and what to ask →</a></p>`;
  }
  if(svc.length) h+=`<div class="tc-svc"><div class="tc-svch">Where to apply in ${t.name}</div>${svc.map(x=>`<p>${x}</p>`).join("")}</div>`;
  h+=`<p class="tc-src">From state Division of Local Services records and state agency directories (checked September 2026). Towns change these by vote, so confirm with the office before relying on it.</p></div>`;
  return h;
}

/* ---------- Claim packet (2026-09-25) ----------
   Pre-filled official forms + a Circuit Breaker worksheet, built ON THIS DEVICE.
   The optional name/address/phone boxes exist only in this page's memory: they are
   not saved, not added to A, and not included in anything sent anywhere. */
let PK = {fullName:"", street:"", zip:"", phone:""};
function loadScriptOnce(src){
  return new Promise((ok,bad)=>{ if(document.querySelector(`script[src="${src}"]`)) return ok();
    const el=document.createElement("script"); el.src=src; el.onload=ok; el.onerror=()=>bad(new Error("could not load "+src)); document.head.appendChild(el); });
}
const FORMS={
  msp:{file:"forms/medicare-savings-programs-application.pdf", fn:"fillMSP", out:"Medicare-Savings-application-prefilled.pdf"},
  "961":{file:"forms/form-96-1-senior-exemption.pdf", fn:"fill961", out:"Form-96-1-senior-exemption-prefilled.pdf"},
  "962":{file:"forms/form-96-2-surviving-spouse.pdf", fn:"fill962", out:"Form-96-2-surviving-spouse-exemption-prefilled.pdf"},
  "963":{file:"forms/form-96-3-blind.pdf", fn:"fill963", out:"Form-96-3-blind-exemption-prefilled.pdf"},
  "964":{file:"forms/form-96-4-veterans.pdf", fn:"fill964", out:"Form-96-4-veterans-exemption-prefilled.pdf"},
  "97":{file:"forms/form-97-senior-tax-deferral.pdf", fn:"fill97", out:"Form-97-senior-tax-deferral-prefilled.pdf"}
};
async function downloadForm(kind, btn){
  const old=btn.innerHTML; btn.disabled=true; btn.innerHTML="Filling in…";
  try{
    await loadScriptOnce("vendor/pdf-lib.min.js"); await loadScriptOnce("forms.js");
    const F=FORMS[kind]; if(!F) throw new Error("unknown form "+kind);
    const r=await fetch(F.file); if(!r.ok) throw new Error("form download failed ("+r.status+")");
    const bytes=new Uint8Array(await r.arrayBuffer());
    const town=(townLookup(A.town)||{}).name||A.town;
    const out = await BFForms[F.fn](PDFLib, bytes, A, PK, town);
    const url=URL.createObjectURL(new Blob([out],{type:"application/pdf"}));
    const a=document.createElement("a"); a.href=url; a.download = F.out;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 60000);
    btn.innerHTML="✓ Downloaded — tap again for a fresh copy";
  }catch(e){ btn.innerHTML="Couldn't build the form — try again"; console.error(e); }
  finally{ btn.disabled=false; setTimeout(()=>{ if(btn.innerHTML.startsWith("✓")||btn.innerHTML.startsWith("Couldn't")) btn.innerHTML=old; }, 8000); }
}
function cbWorksheet(ps){
  const cb=(ps||[]).find(p=>p.id==="cb"); if(!cb || cb.status==="no") return "";
  const inc=num(A.incomeSS)+num(A.incomeOther), ten=inc*0.10;
  const owner=A.housing==="own";
  const base = owner ? num(A.propTax) : num(A.rent)*12*0.25;
  const est=Math.max(0, Math.min(CB_MAX, base-ten));
  const known = inc>0 && base>0;
  return `<details class="pk-ws"><summary>🧮 Circuit Breaker worksheet (with ${who(A)==="this person"?"their":who(A)+"'s"} numbers)</summary><div class="pk-body">
    <table class="pk-tab">
      <tr><td>1. Total income for the year (estimate)</td><td>${money(inc)}</td></tr>
      <tr><td>2. 10% of line 1</td><td>${money(ten)}</td></tr>
      <tr><td>3. ${owner?"Property tax paid for the year <i>(add half of water &amp; sewer bills if billed separately)</i>":"25% of rent paid for the year"}</td><td>${base?money(base):"—"}</td></tr>
      <tr class="pk-tot"><td>4. Estimated credit: line 3 minus line 2 (max ${money(CB_MAX)})</td><td>${known?money(est):"—"}</td></tr>
    </table>
    <p>File <b>Schedule CB</b> with the Massachusetts Form 1 tax return — even if ${who(A)==="this person"?"they don't":who(A)+" doesn't"} normally file. Schedule CB has its own definition of "total income" (Social Security counts), so the form gives the exact number. <b>Missed years can be claimed up to 3 years back.</b> Free help: AARP Tax-Aide or a local Council on Aging.</p>
    <p><a href="circuit-breaker-tax-credit.html" target="_blank" rel="noopener">Full Circuit Breaker guide →</a></p>
  </div></details>`;
}
function packetCard(ps){
  const open=id=>{ const p=(ps||[]).find(x=>x.id===id); return p && p.status!=="no" && p.status!=="have"; };
  const town=(townLookup(A.town)||{}).name||A.town||"your town";
  const forms=[];
  if(open("msp")) forms.push(`<div class="pk-form"><button type="button" class="btn prim pk-dl" data-form="msp">⬇ Medicare Savings Program application — pre-filled</button>
    <p class="pk-note">Still to add by hand: date of birth, SSN, Medicare number, citizenship questions, each person's income by type, and the signature on page 3 (both spouses sign if married and living together). Mail to MassHealth Enrollment Center, PO Box 4405, Taunton, MA 02780-0968, or fax (857) 323-8300. Free help: SHINE, (800) 243-4636.</p></div>`);
  if(A.housing==="own" && (open("ex41c")||open("ex17d"))) forms.push(`<div class="pk-form"><button type="button" class="btn prim pk-dl" data-form="961">⬇ Senior exemption application (Form 96-1) — pre-filled</button>
    <p class="pk-note">Still to add by hand: date of birth, a breakdown of other income, bank and investment details, and the signature on page 3. Bring or mail it to the ${town} Board of Assessors by April 1, or within 3 months after the actual tax bills are mailed — whichever is later.</p></div>`);
  const age=Math.max(num(A.age)||0, A.marital==="married"?(num(A.spouseAge)||0):0);
  const assessorLine=`Bring or mail it to the ${town} Board of Assessors by April 1, or within 3 months after the actual tax bills are mailed — whichever is later.`;
  if(A.housing==="own" && open("ex17d") && A.marital==="widowed" && age<70) forms.push(`<div class="pk-form"><button type="button" class="btn prim pk-dl" data-form="962">⬇ Surviving-spouse exemption (Form 96-2) — pre-filled</button>
    <p class="pk-note">Still to add by hand: your late spouse's name and date of death, your bank and investment details, and your signature. Attach a copy of the death certificate the first year. ${assessorLine}</p></div>`);
  if(A.housing==="own" && open("vet22")) forms.push(`<div class="pk-form"><button type="button" class="btn prim pk-dl" data-form="964">⬇ Veterans exemption (Form 96-4) — pre-filled</button>
    <p class="pk-note">Still to add by hand: service details, your VA disability rating letter, and your signature. Attach discharge papers (DD-214) the first year. ${assessorLine} A free Veterans Service Officer can help.</p></div>`);
  if(A.housing==="own" && open("blind37a")) forms.push(`<div class="pk-form"><button type="button" class="btn prim pk-dl" data-form="963">⬇ Blind exemption (Form 96-3) — pre-filled</button>
    <p class="pk-note">Still to add by hand: your Mass. Commission for the Blind registration (or a doctor's letter) and your signature. ${assessorLine}</p></div>`);
  if(A.housing==="own" && open("defer41a")) forms.push(`<div class="pk-form"><button type="button" class="btn prim pk-dl" data-form="97">⬇ Senior tax deferral (Form 97) — pre-filled</button>
    <p class="pk-note">Still to add by hand: date of birth, how much tax to defer, mortgage details, a breakdown of other income, and your signature. It also needs the Tax Deferral and Recovery Agreement (Form 97-1) from the assessor. Talk it over with family first — it's repaid when the home is sold. ${assessorLine}</p></div>`);
  const ws=cbWorksheet(ps);
  // Keep the checklist short: every "apply now" match, then the most valuable "worth verifying" ones, max 8.
  const likely=(ps||[]).filter(p=>p.status==="likely"), maybes=(ps||[]).filter(p=>p.status==="maybe").sort((a,b)=>(b.val||0)-(a.val||0));
  const todo=likely.concat(maybes.filter(p=>(p.val||0)>0)).slice(0,8);
  const moreN=likely.length+maybes.length-todo.length;
  if(!forms.length && !ws && !todo.length) return "";
  let h=`<div class="packet" id="packet"><h3>📄 Your claim packet</h3>
    <p class="pk-lead">Forms and numbers filled in from your answers, <b>right here on this device — nothing is sent to us.</b></p>`;
  if(forms.length){
    h+=`<details class="pk-opt"><summary>Optional: add name and address so the forms come out more complete</summary><div class="pk-fields">
      <label>Full name<input type="text" data-pk="fullName" autocomplete="off" value="${PK.fullName.replace(/"/g,"&quot;")}"></label>
      <label>Street address<input type="text" data-pk="street" autocomplete="off" value="${PK.street.replace(/"/g,"&quot;")}"></label>
      <label>ZIP<input type="text" inputmode="numeric" data-pk="zip" autocomplete="off" value="${PK.zip.replace(/"/g,"&quot;")}"></label>
      <label>Phone<input type="tel" data-pk="phone" autocomplete="off" value="${PK.phone.replace(/"/g,"&quot;")}"></label>
      <p class="pk-note">Only used to fill in the forms below. Not saved, not sent.</p></div></details>`;
    h+=forms.join("");
  }
  h+=ws;
  if(todo.length){
    h+=`<div class="pk-check"><div class="pk-h">Checklist</div><ul>${todo.map(p=>`<li><span class="pk-box" aria-hidden="true"></span><span><b>${p.name}</b>${p.form?` — ${p.form}`:""}</span></li>`).join("")}</ul>${moreN>0?`<p class="pk-note">+ ${moreN} more worth a look in the full list below.</p>`:""}</div>`;
  }
  h+=`<button type="button" class="btn ghost pk-print">🖨 Print just this packet</button></div>`;
  return h;
}
function wirePacket(){
  document.querySelectorAll("[data-pk]").forEach(el=>el.addEventListener("input",()=>{ PK[el.dataset.pk]=el.value; }));
  document.querySelectorAll(".pk-dl").forEach(b=>b.addEventListener("click",()=>downloadForm(b.dataset.form,b)));
  const pr=document.querySelector(".pk-print");
  if(pr) pr.addEventListener("click",()=>{ document.body.classList.add("print-packet"); document.querySelectorAll(".pk-ws").forEach(d=>d.open=true); window.print(); });
}
window.addEventListener("afterprint",()=>document.body.classList.remove("print-packet"));

const STATS_URL = "https://benefighter-stats.pangserve.workers.dev/c";
const STATS_OFF = (navigator.doNotTrack==="1" || window.doNotTrack==="1" || navigator.globalPrivacyControl===true || navigator.webdriver===true || !/benefighter\.com$/.test(location.hostname));   // webdriver: skip automated browsers (our own tests, bots)
const SID = (()=>{ try{ const a=new Uint8Array(9); crypto.getRandomValues(a); return Array.from(a,b=>"abcdefghijklmnopqrstuvwxyz0123456789"[b%36]).join(""); }catch(e){ return "s"+Date.now().toString(36); } })();
let statStarted=false, statFinished=false, statLeft=false, furthestN=0, furthestId=null, lastTotal=0;
function stat(ev, extra){
  if(STATS_OFF) return;
  const body=JSON.stringify(Object.assign({ev, sid:SID, dev: window.innerWidth<700?"m":"d"}, extra||{}));
  try{ if(navigator.sendBeacon && navigator.sendBeacon(STATS_URL, body)) return; }catch(e){}
  try{ fetch(STATS_URL,{method:"POST",body,keepalive:true,mode:"no-cors"}); }catch(e){}
}
function statProgress(vis){
  if(!statStarted){ statStarted=true; stat("start",{qid:vis[0]&&vis[0].id, qn:1, qt:vis.length}); }
  if(i+1>furthestN){ furthestN=i+1; furthestId=vis[i]&&vis[i].id; }
  lastTotal=vis.length;
}
function statLeave(){
  if(statStarted && !statFinished && !statLeft){ statLeft=true; stat("leave",{qid:furthestId, qn:furthestN, qt:lastTotal}); }
}
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="hidden") statLeave(); });
window.addEventListener("pagehide", statLeave);

/* ---------- Render question ---------- */
function render(){
  const vis = visible();
  if(i>=vis.length){ editMode=false; return results(); }
  const q = vis[i];
  statProgress(vis);
  const doneN = vis.filter(x=>ansState(x)!=="empty").length;
  document.getElementById("bar").style.width = Math.round((doneN/(vis.length))*100)+"%";
  const qt = typeof q.q==="function"?q.q(A):q.q;
  const app = document.getElementById("app");
  let inner = `<div class="qwrap">`+navHTML(vis)+`<div class="qmain">`;
  inner += i===0 ? `<div class="reassure">Answer what you can. Not sure about something? Tap <b>"I'm not sure"</b> — we'll list it at the end so you can look it up. You can go back to any question from the list.</div>` : "";
  const isLast = (i===vis.length-1);
  const doWhat = q.type==="single" ? "Tap the answer that fits — it moves on by itself."
               : q.type==="multi" ? "Tap every one that applies, then tap Next."
               : "Type your answer, then tap Next.";
  inner += `<div class="card"><div class="qstep">Question ${i+1} of ${vis.length} &middot; <span>${doWhat}</span></div><div class="q">${qt}</div>`;
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
    const per = q.period ? (A[q.id+"_per"] || q.period) : null;
    let val = (A[q.id]!=null && A[q.id]!=="unknown")?A[q.id]:"";
    if(per==="mo" && val!=="") val = String(Math.round(num(val)/12));
    if(per){
      inner += `<div class="pertoggle" role="radiogroup" aria-label="Per month or per year">
        <button type="button" class="per ${per==='mo'?'sel':''}" data-per="mo" role="radio" aria-checked="${per==='mo'}">Per month</button>
        <button type="button" class="per ${per==='yr'?'sel':''}" data-per="yr" role="radio" aria-checked="${per==='yr'}">Per year</button>
      </div>`;
    }
    inner += `<div class="ipwrap ${isCur?'cur':''}">${isCur?'<span class="pre">$</span>':''}
      <input id="ip" type="${q.type==='text'?'text':'number'}" inputmode="${q.type==='text'?'text':'decimal'}"
      value="${val}" placeholder="${q.placeholder||''}" aria-label="${(NAV[q.id]||'Answer')}"${q.id==="town"?' list="ma-towns" autocomplete="off"':''}></div>${q.id==="town"?'<datalist id="ma-towns"></datalist>':''}`;
    if(per) inner += `<p class="hint" style="margin:8px 0 0" id="perhint">${per==='mo'?'dollars per month':'dollars per year'}</p>`;
    else if(q.suffix) inner += `<p class="hint" style="margin:8px 0 0">in ${q.suffix}</p>`;
  }

  inner += `<div class="nav">
      <button class="btn ghost" id="back" ${i===0?'disabled':''}>&larr; Back</button>
      <button class="btn prim" id="next">${isLast?"See my results &rarr;":"Next &rarr;"}</button>
    </div>`;
  if(isInput && !q.noSkip){ inner += `<button class="skip" id="skip">🤔 I'm not sure — skip &amp; flag it for later</button>`; }
  if(editMode && !isLast){ inner += `<button class="btn backres" id="backres">Done changing — back to my results</button>`; }
  inner += `</div></div></div>`;
  app.innerHTML = inner;
  if(q && q.id==="town") fillTownList();
  wireNav(vis);

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
    app.querySelectorAll(".per").forEach(b=>b.onclick=()=>{
      A[q.id+"_per"]=b.dataset.per;
      app.querySelectorAll(".per").forEach(x=>{const on=x===b; x.classList.toggle("sel",on); x.setAttribute("aria-checked",on);});
      const ph=document.getElementById("perhint"); if(ph) ph.textContent = b.dataset.per==="mo"?"dollars per month":"dollars per year";
      ip.focus();
    });
  }
  const back=document.getElementById("back"); if(back) back.onclick=()=>{i=Math.max(0,i-1);render();};
  const skip=document.getElementById("skip"); if(skip) skip.onclick=()=>{A[q.id]="unknown"; i++; render();};
  const br=document.getElementById("backres"); if(br) br.onclick=()=>{
    if(isInput){ const v=document.getElementById("ip").value.trim(); if(v) saveInput(q,v); }
    editMode=false; i=visible().length; render();
  };
  document.getElementById("next").onclick=()=>{
    if(isInput){
      const v=document.getElementById("ip").value.trim();
      if(!v && !q.optional){ document.getElementById("ip").focus(); document.getElementById("ip").style.borderColor="#d23"; return;}
      saveInput(q,v);
    }
    i++; render();
  };
}
// Store the answer the engine expects: currency questions with a month/year
// toggle are always stored as a YEARLY amount (the engine is unchanged).
function saveInput(q,v){
  if(q.period && v!==""){
    const per=A[q.id+"_per"]||q.period; A[q.id+"_per"]=per;
    A[q.id] = per==="mo" ? String(Math.round(num(v)*12)) : v;
  } else { A[q.id]=v; }
}

/* ---------- Eligibility engine ---------- */
// thresholds — each line: program year + source. REFRESH every fall (Oct: SNAP/HEAP; Jan: FPL/SSI/Part B/MassHealth; Dec: VA; CB TIR ~Nov)
const CB_INC = {single:75000, hof:94000, joint:112000, none:75000}; // Circuit Breaker caps by filing status, tax year 2025 (DOR TIR 25-7)
const CB_MAX = 2820;                            // Circuit Breaker max credit, TY2025
const CB_ASSESS = 1298000;                      // Circuit Breaker assessed-value ceiling, TY2025
const LIHEAP = {1:53585, 2:70073};              // HEAP 60% SMI, FY2027 season (Nov 1 2026–Apr 30 2027) — mass.gov HEAP page
const SNAP200 = {1:31920, 2:43284};             // 200% of 2026 FPL — MA SNAP gross test (broad-based categorical eligibility)
const MSP_INC = {1:35916, 2:48696};             // 225% of 2026 FPL — MA Medicare Savings Program (SLMB/QI); NO asset test (mass.gov, 130 CMR 519.011)
const MSP_QMB = {1:30324, 2:41124};             // 190% of 2026 FPL — QMB tier (also pays Medicare deductibles/coinsurance)
const FPL = {1:15960, 2:21640};                 // 2026 HHS poverty guidelines (91 FR 1797)
const FPL135 = {1:21546, 2:29214};              // 135% of 2026 FPL — Lifeline income gate (usac.org)
const PARTB = 202.90;                           // 2026 standard Part B premium / month (CMS)
const SSI_FBR = {1:994, 2:1491};                // 2026 SSI federal benefit rate / month (ssa.gov)
const VA_NETWORTH = 163699;                     // VA pension net-worth limit, 12/1/2025–11/30/2026 (va.gov)
const VA_MAPR_AA = {vet1:29093, vet2:34488, spouse:18697}; // VA pension MAPR with Aid & Attendance, eff. 12/1/2025 (va.gov)
const SNAP_MAX1 = 306;                          // SNAP max allotment, 1 person, from Oct 1 2026 (USDA FY2027 COLA)
const PA_OPEN = false;                          // Prescription Advantage: no new applications after Sept 11, 2026 (mass.gov)

function hhSize(){ return A.marital==="married"?2:1; }   // the person (+ spouse): used for MSP, SSI, SNAP, VA
function homeSize(){ const k=num(A.hhSize); return k>=1 ? Math.min(Math.round(k),10) : hhSize(); }   // everyone in the home: HEAP, utility discount, WAP, Lifeline
function fplFor(k){ return 15960 + 5680*(Math.max(1,k)-1); }   // 2026 HHS poverty guideline (48 states), 91 FR 1797
const HEAP_SMI60 = {1:53585,2:70073,3:86561,4:103049,5:119536,6:136024,7:139116,8:142207,9:145299,10:148390}; // FY2027, mass.gov HEAP page
// citizenship gate for federal means-tested programs (SNAP/MSP/SSI)
function citizenOK(){ return A.citizen!=="other"; } // citizen or qualified immigrant
function citizenNote(){ return A.citizen==="qualified"?" (qualified-immigrant rules can add a waiting period — verify.)":""; }

function programs(){
  const age=num(A.age), incSS=num(A.incomeSS), incOther=num(A.incomeOther), inc=incSS+incOther;
  const assets=num(A.assets), med=num(A.medExpenses), hh=hhSize();
  const homeHH=homeSize(), homeInc=inc+num(A.hhOtherInc);
  const spouseAge = A.marital==="married" ? num(A.spouseAge) : 0;
  const olderAge = Math.max(age, spouseAge);   // Circuit Breaker & 41C: ONE spouse at the age is enough (joint filers / joint owners)
  const out=[];
  const owner = A.housing==="own", renter = A.housing==="rent";
  const disabled = A.disability==="yes";

  // 1. Senior Circuit Breaker
  let cbEst = 0;
  (()=>{
    const cbAge = (A.marital==="married" && A.filing==="joint") ? olderAge : age;   // "You, or your spouse if married filing jointly, must be at least 65" (2025 Schedule CB)
    if(cbAge<65){ out.push(cb("no", A.marital==="married" ? "Requires age 65+ by December 31 (for a married couple filing jointly, one spouse being 65+ is enough)." : "Requires age 65+ by December 31.")); return; }
    if(A.dependent==="yes"){ out.push(cb("no","Can't be claimed as a dependent on someone else's return — that disqualifies the Circuit Breaker.")); return; }
    if(A.dependent==="unsure"){ out.push(cb("maybe","Eligible only if NOT claimed as a dependent by anyone — confirm this first.")); return; }
    if(A.filing==="mfs"){ out.push(cb("no","Married filing separately can't claim it — a married couple must file jointly.")); return; }
    const cap = (A.filing==="none" && A.marital==="married") ? CB_INC.joint : (CB_INC[A.filing] || CB_INC.single); // married non-filers must file jointly to claim
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
    // Estimated credit, not the maximum: owners = tax (+ half of water/sewer, not asked) − 10% of income; renters = 25% of rent − 10% of income. Capped at CB_MAX.
    let est = 0;
    if(owner){ est = num(A.propTax) - 0.10*inc; } else if(renter){ est = 0.25*num(A.rent)*12 - 0.10*inc; }
    est = Math.max(0, Math.min(CB_MAX, Math.round(est)));
    if(status==="likely" && est<=0) status="maybe";
    cbEst = est;
    out.push(cb(status, why + (A.filing==="none" && A.marital==="married" ? " A married couple would need to file a joint return to claim it." : "")));
    function cb(s,w){const e=(typeof cbEst==="number"&&cbEst>0)?cbEst:0; return {id:"cb",name:"Senior Circuit Breaker Credit",status:s,val:s==="no"?0:e,valTxt:s==="no"?"—":(e>0?`~${money(e)}/yr (max ${money(CB_MAX)})`:`up to ${money(CB_MAX)}/yr`),why:w,
      form:"Schedule CB (filed with the MA income tax return).",
      forml:"https://www.mass.gov/info-details/massachusetts-senior-circuit-breaker-tax-credit",
      docs:["Property tax bills + water/sewer bills (homeowners), or rent receipts/landlord statement","Last year's tax return / all income statements","Proof of age 65+ and MA principal residence"],
      where:`File Schedule CB with the MA Form 1. NOTE: "total income" on Schedule CB has its own definition (it adds back tax-exempt interest and counts Social Security) — verify the exact figure on the form. ${A.filing==="none"?"Even if "+who(A)+" doesn't normally file, they can file a return just to claim this refundable credit. ":""}Missed prior years? A Schedule CB can be filed up to 3 years after that year's original filing deadline (not counting extensions) — so tax year 2023 can still be claimed until April 2027.`};}
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
    const halfInc = CB_INC.single; // 41C½ income ceiling = the Circuit Breaker SINGLE limit for every filing status (c.59 §5 cl.41C½), unless the town adopted the household option
    const yrs = num(A.ownYears), yrsKnown = A.ownYears!=null && A.ownYears!=="" && A.ownYears!=="unknown";
    const age = olderAge;   // "either of whom has reached" the age, for a jointly owned home
    const ageNote = (age>=65 && age<70) ? ` Clauses 41C/41C½ start at age 70 — ages 65–69 qualify ONLY if ${A.town||"your town"} voted to lower the age to 65.` : "";
    const baseReq = " Also required: owned and lived in the home for 5 years, and lived in Massachusetts for the past 10 years.";
    if(age<65){ w="Senior clauses start at age 70 (65 only where the town lowered it; Clause 17D is 70+)."; }
    else if(yrsKnown && yrs<5){ s="no"; w=`Clause 41C needs 5 years of owning and living in the home (you said ~${yrs}).`+titleNote; }
    else if(A.maYears==="no"){ s="no"; w="Clause 41C needs 10 straight years of Massachusetts residence before the tax year."+titleNote; }
    else if(inc<=floorInc && assets<=floorAsset){
      s="maybe"; w=`At/under the unmodified state floor ($${floorInc.toLocaleString()} income / $${floorAsset.toLocaleString()} assets, home not counted) — the income/asset test is met in any MA town.`+ageNote+baseReq+titleNote;
    } else if(inc<=halfInc){
      s="maybe"; w=`Depends on which clause ${A.town||"the town"} adopted: limits run from ~$${floorInc.toLocaleString()} (classic 41C floor) up to ~$${halfInc.toLocaleString()} in towns that adopted 41C½ (its income limit tracks the Circuit Breaker single limit). Check ${A.town||"your town"}'s adopted clause + asset limit.`+ageNote+baseReq+titleNote;
    } else {
      s="no"; w=`Income (~${money(inc)}) is over even the most generous 41C½ limit (~$${halfInc.toLocaleString()}). The Clause 41A deferral below is the usual fallback for higher-income owners.`+titleNote;
    }
    out.push({id:"ex41c",name:"Property Tax Exemption (Clause 41C / 41C½)",status:s,val:s==="no"?0:750,valTxt:s==="no"?"—":"~$500–$1,000/yr (more in 41C½ towns)",why:w,
      form:"State Tax Form 96-1 (filed with your town assessor).",
      forml:"https://www.mass.gov/lists/property-tax-forms-and-guides",
      docs:["Prior-year income (tax return / SS statement)","Bank & investment balances","Deed / proof of ownership & residency","Birth date proof"],
      where:`Contact the ${A.town||"town"} Assessor's office — they confirm the town's adopted clause, limits, and amount. Statewide adopted values: https://dls-gw.dor.state.ma.us/reports/rdpage.aspx?rdreport=localoptions.propertytax . Deadline: April 1, or 3 months after the tax bills are mailed, whichever is later. Also ask: if ${A.town||"your town"} adopted the Community Preservation Act, low/moderate-income seniors (60+) can be exempted from the CPA surcharge (Form CP-4, apply each year).`});
  }

  // 3. Clause 17D (owner, 70+ or widowed — asset test, no income test)
  if(owner && (olderAge>=70 || A.marital==="widowed")){
    const overAssets = A.assets!=null && A.assets!=="" && A.assets!=="unknown" && assets>40000;
    out.push({id:"ex17d",name:"Property Tax Exemption (Clause 17D)",status:overAssets?"no":"maybe",val:overAssets?0:300,valTxt:overAssets?"—":"~$175–$350/yr",
      why: overAssets ? `Clause 17D has a $40,000 asset limit (home not counted; some towns index it higher) — savings of ~${money(assets)} are over it.` : "70+ (owned and lived there 5+ years) or surviving spouse, owner — no income test, but a $40,000 asset limit (home not counted; some towns index it higher). An alternative if income is too high for Clause 41C.",
      form:"State Tax Form 96-1 (age 70+) or the surviving-spouse version of Form 96 (town assessor).",forml:"https://www.mass.gov/lists/property-tax-forms-and-guides",
      docs:["Proof of ownership/residency","Whole-estate (asset) statement"],
      where:`${A.town||"Town"} Assessor. Choose whichever clause (17D vs 41C) gives the bigger break — you can't take both.`});
  }

  // 4. Veterans exemption Clause 22 (owner)
  if((A.veteran==="vet"||A.veteran==="spouse")){
    let s = owner ? "maybe":"no", w;
    if(!owner){ w="Veterans property-tax exemption applies to homeowners; renter — skip."; }
    else if(A.vaDis==="full"){ s="likely"; w="Owner + 100% service-connected rating — $1,000 exemption (Clause 22E). A full exemption is only for paraplegia or 100% service-connected blindness. If the rating is \"unemployable\" rather than 100%, confirm with the assessor."; }
    else if(A.vaDis==="partial"){ s="likely"; w="Owner + 10%+ service-connected disability — qualifies for the veterans' exemption (base $400)."; }
    else if(A.veteran==="spouse"){ s="maybe"; w="Surviving spouse of a veteran, owner — qualifies if the veteran would have qualified (10%+ service-connected rating, Purple Heart, POW, etc.); verify with the assessor."; }
    else { s="maybe"; w="Without a VA disability rating, this applies ONLY with a Purple Heart, former-POW status, or certain medals (Clause 22A and related) — otherwise not eligible. Verify with the assessor."; }
    out.push({id:"vet22",name:"Veterans' Property Tax Exemption (Cl. 22)",status:s,val:s==="no"?0:(A.vaDis==="full"?1000:400),valTxt:s==="no"?"—":(A.vaDis==="full"?"$1,000/yr (full for some)":"$400+/yr"),why:w,
      form:"State Tax Form 96-4 (town assessor).",forml:"https://www.mass.gov/info-details/local-property-tax-exemptions-for-veterans",
      docs:["DD-214 (discharge papers)","VA disability award letter","Proof of MA residency & ownership"],
      where:`${A.town||"Town"} Assessor. Also ask the local Veterans' Service Officer about state veterans' benefits (Chapter 115).`});
  }

  // 5. Blind exemption 37A
  if(A.blind==="yes" && owner){
    out.push({id:"blind37a",name:"Blind Person's Exemption (Cl. 37 / 37A)",status:"likely",val:500,valTxt:"~$440–$500/yr",
      why:"Legally blind homeowner — straightforward exemption: $500/yr in towns that adopted Clause 37A, $437.50 (Clause 37) elsewhere.",
      form:"State Tax Form 96-3 + Mass. Commission for the Blind certificate.",forml:"https://www.mass.gov/lists/property-tax-forms-and-guides",
      docs:["Certificate of blindness from the Mass. Commission for the Blind","Proof of ownership"],
      where:`${A.town||"Town"} Assessor (annual).`});
  }

  // 6. Fuel Assistance / LIHEAP
  (()=>{
    if(A.housing==="family"){ out.push(fa("maybe","May still qualify if responsible for any heat/utility costs.")); return;}
    const lim = HEAP_SMI60[homeHH]||HEAP_SMI60[10];
    const s = homeInc<=lim?"likely":"no";   // no eligibility above 60% of state median income
    out.push(fa(s, s==="no"?`Household income (~${money(homeInc)}) is above the ~${money(lim)} limit for a household of ${homeHH} (60% of state median income).`:`Household income under the ~${money(lim)} limit for a household of ${homeHH} — heating help. Renters qualify even if heat is included in rent.`));
    function fa(s,w){return {id:"liheap",name:"Fuel Assistance (HEAP)",status:s,val:s==="no"?0:400,valTxt:s==="no"?"—":"~$200–$600+/winter (depends on funding)",why:w,
      form:"Application through your local Community Action agency.",forml:"https://www.mass.gov/how-to/apply-for-home-energy-assistance-heap",
      docs:["Last 4 weeks of income (all sources)","Most recent heating + electric bill","Lease or mortgage statement"],
      where:"Applications open October 1; help covers Nov 1–Apr 30; re-apply every year. Find your local fuel-assistance (CAP) agency by ZIP. Also unlocks utility discount rates. Good to know: utilities can't shut off heating service for financial hardship Nov 15–Mar 15, and if everyone in the home is 65+, gas/electric can't be shut off without the DPU's permission."};}
  })();

  // 7. SNAP (food)
  (()=>{
    const lim=SNAP200[hh]||SNAP200[2];
    const sixty = olderAge>=60 || disabled;
    let s = inc<=lim?"likely":(sixty?"maybe":"no");
    let w;
    if(inc<=lim){ w = sixty ? `Under the ~${money(lim)} gross limit for a household of ${hh}. Age 60+ (or disabled) also gets extra deductions for medical costs and high housing costs.${med>0?` Their ~${money(med)}/yr medical costs help via that deduction.`:""}` : `Under the ~${money(lim)} gross limit for a household of ${hh}.`; }
    else if(sixty){ w = `Over the ~${money(lim)} gross limit, but households with someone 60+ or disabled can still qualify under the regular rules if medical and housing costs are high — worth a check.`; }
    else { w = `Income above ~${money(lim)} for a household of ${hh}.`; }
    if(s!=="no" && age>=55 && age<65 && !disabled && A.working!=="yes"){ w += " Note: adults 55–64 without a disability may face SNAP work rules and time limits — ask DTA."; }
    if(!citizenOK()){ s="no"; w="SNAP needs U.S. citizen or qualified-immigrant status — verify before applying."; }
    const hip = s!=="no" ? ` SNAP households also get HIP automatically: up to $${homeHH>=6?80:(homeHH>=3?60:40)}/mo back for fruits & vegetables bought at participating farms and markets.` : "";
    const shareNote = (s!=="no" && homeHH>hh) ? " (If they live with others and buy/prepare food together, the whole household applies together.)" : "";
    out.push({id:"snap",name:"SNAP (Food Assistance)",status:s,val:s==="no"?0:1200,valTxt:s==="no"?"—":"varies with income",why:w+` Amount depends on income and costs (maximum $${SNAP_MAX1}/mo for 1 person from Oct 1, 2026).`+hip+shareNote,
      form:"Online via DTAConnect or paper application.",forml:"https://www.mass.gov/snap-benefits-formerly-food-stamps",
      docs:["Proof of income","Housing + utility costs","Out-of-pocket medical expenses (60+ deduction)"],
      where:"Apply at DTAConnect.com or call DTA. Seniors can deduct medical expenses over $35/mo — push hard on this."});
  })();

  // 8. Medicare Savings Program (MA Buy-In) — no asset test in MA
  if(A.medicare==="yes"){
    const lim=MSP_INC[hh]||MSP_INC[2];
    const qmb = MSP_QMB[hh]||MSP_QMB[2];
    let s = inc<=lim?"likely":(inc<=lim*1.05?"maybe":"no");   // "maybe" only right at the line
    let mw = s==="no"?`Income above the ~${money(lim)} limit (225% of poverty) for a household of ${hh}; a free SHINE counselor can double-check.`:`Massachusetts covers incomes up to ~${money(lim)} for a household of ${hh} with NO asset test — it pays the Part B premium (~$${Math.round(PARTB)}/mo).${inc<=qmb?` At this income (under ~${money(qmb)}) the QMB level can also cover Medicare deductibles and coinsurance.`:""} High-value, often missed.${citizenNote()}`;
    if(!citizenOK()){ s="no"; mw="Needs U.S. citizen or qualified-immigrant status — verify."; }
    out.push({id:"msp",name:"Medicare Savings Program (pays Part B)",status:s,val:s==="no"?0:Math.round(PARTB*12),valTxt:s==="no"?"—":`~${money(PARTB*12)}+/yr`,
      why:mw,
      form:"MassHealth Buy-In application (MSP).",forml:"https://www.mass.gov/info-details/get-help-paying-medicare-costs",
      docs:["Medicare card","Proof of income","Social Security award letter"],
      where:"Apply through MassHealth or get free help from a SHINE counselor (1-800-AGE-INFO). Approval also triggers federal Extra Help for drug costs."});
    // Extra Help flag
    if(s!=="no"){
      out.push({id:"lis",name:"Extra Help — Part D Drug Costs",status:s,val:0,valTxt:"lower drug copays",
        why:"Qualifying for the Medicare Savings Program automatically grants Extra Help (lower drug copays).",
        form:"Automatic with MSP, or apply via SSA.",forml:"https://www.ssa.gov/medicare/part-d-extra-help",
        docs:["Same as MSP"],where:"Confirm enrollment when MSP is approved; otherwise apply at ssa.gov."});
    }
  }

  // 9. VA Aid & Attendance (requires WARTIME service)
  if((A.veteran==="vet"||A.veteran==="spouse") && A.adl==="yes" && A.wartime!=="no" && (age>=65 || disabled)){
    const wt = A.wartime==="yes";
    const mapr = A.veteran==="spouse" ? VA_MAPR_AA.spouse : (A.marital==="married" ? VA_MAPR_AA.vet2 : VA_MAPR_AA.vet1);
    // VA pays MAPR minus countable income; unreimbursed medical costs above 5% of MAPR are deducted from income. Net worth = assets + annual income.
    const medDed = Math.max(0, med - 0.05*mapr);
    const est = Math.max(0, Math.round(mapr - Math.max(0, inc - medDed)));
    const nw = assets + inc;
    const nwKnown = A.assets!=null && A.assets!=="" && A.assets!=="unknown";
    let st, why;
    if(nwKnown && nw > VA_NETWORTH){ st="no"; why=`VA's net-worth limit is $${VA_NETWORTH.toLocaleString()} (assets + a year of income); this household is at ~${money(nw)}. Transfers in the 3 years before applying can also trigger a penalty.`; }
    else if(!wt){ st="maybe"; why=`Big benefit IF the service included a wartime period (90 days active, 1 day wartime) — confirm the dates. Also needs net worth (assets + income) under $${VA_NETWORTH.toLocaleString()}.`; }
    else if(est>0){ st="likely"; why=`Wartime ${A.veteran==="spouse"?"veteran's surviving spouse":"veteran"} who needs help with daily activities, under the $${VA_NETWORTH.toLocaleString()} net-worth limit. VA pays the gap between income and ~${money(mapr)}/yr; after counting income, that's roughly ${money(est)}/yr — more if care costs are high (they reduce countable income).`; }
    else { st="maybe"; why=`Income is above the ~${money(mapr)}/yr pension limit, BUT paid care costs (home aides, assisted living) are deducted from income — with significant care bills this can still pay. Needs net worth under $${VA_NETWORTH.toLocaleString()}.`; }
    out.push({id:"aanda",name:"VA Aid & Attendance Pension",status:st,val:(st==="likely")?est:0,
      valTxt: st==="no"?"—":(est>0?`~${money(est)}/yr (max ${money(mapr)})`:`up to ${money(mapr)}/yr`),
      why: why,
      form:"VA Form 21-2680 + pension application.",forml:"https://www.va.gov/pension/aid-attendance-housebound/",
      docs:["DD-214 (shows service dates — confirms the wartime requirement)","Doctor's statement on care needs","Income & net-worth statement (limit $163,699 through Nov 30, 2026)","Care/medical expense records — these reduce countable income"],
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
  const ssiFbr = SSI_FBR[hh]||SSI_FBR[2];
  const ssiIncScreen = ssiFbr*12 + 240;   // federal rate + the $20/mo general income exclusion
  if((age>=65 || disabled) && assets<=ssiAssetCap+1000 && inc<ssiIncScreen){
    const s = citizenOK()?"maybe":"no";
    out.push({id:"ssi",name:"Supplemental Security Income (SSI)",status:s,
      val: s==="no"?0:6000, valTxt: s==="no"?"—":`up to ~$${ssiFbr.toLocaleString()}/mo`,
      why: citizenOK()?`Income and assets look low enough to be worth a hard look. SSI has a STRICT countable-asset limit (~$${ssiAssetCap.toLocaleString()}) and pays up to ~$${ssiFbr.toLocaleString()}/mo federal (2026) + a small MA supplement. Confirm exact countable assets & income — these limits are unforgiving, so this is a "verify," not a sure thing.${A.citizen==="qualified"?" Green-card holders generally also need 40 work quarters (plus a 5-year wait if they arrived after 8/22/1996), or a veteran connection.":""}`:"SSI needs U.S. citizen or qualified-immigrant status.",
      form:"Apply with the Social Security Administration.",forml:"https://www.ssa.gov/ssi/",
      docs:["Bank statements (asset limit is strict — ~$2,000 single / $3,000 couple)","Proof of income","ID & citizenship/immigration docs"],
      where:"Apply at ssa.gov or 1-800-772-1213. SSI in MA usually opens MassHealth automatically."});
  }

  // 13. Chapter 115 MA veterans' benefits (need-based; separate from the Cl.22 exemption)
  if((A.veteran==="vet"||A.veteran==="spouse") && inc < (hh===2?42300:31300)){
    out.push({id:"ch115",name:"MA Veterans' Benefits (Chapter 115)",status:"maybe",val:6000,valTxt:"need-based, can be substantial",
      why:"Need-based MA cash + medical benefit for low-income veterans and surviving spouses — separate from the property-tax exemption, and often missed. Income AND asset limits apply (roughly $31k single / $42k couple); medical-only help can apply a bit above that. The Veterans' Service Officer runs the exact budget.",
      form:"Through your city/town Veterans' Service Officer (VSO).",forml:"https://www.mass.gov/info-details/chapter-115-benefitssafety-net-program",
      docs:["DD-214","Income & asset statement","Proof of MA residency"],
      where:"Contact your municipal Veterans' Service Officer — every MA city/town has one; the service is free."});
  }

  // 14. Property tax deferral Clause 41A (owner 65+) — the income-too-high fallback
  if(owner && age>=65){
    out.push({id:"defer41a",name:"Property Tax Deferral (Clause 41A)",status:"maybe",val:0,valTxt:"defers up to 100% of the bill",
      why:"Lets a 65+ owner defer property tax, repaid (with interest up to 8%, or lower if the town sets it) when the home is sold or transferred; the total deferred plus interest is capped at 50% of your share of the home's value. The fallback when income is too high for the 41C exemption.",
      form:"State Tax Form 97 (town assessor) + a tax-deferral agreement.",forml:"https://www.mass.gov/info-details/ask-dls-property-tax-deferrals-for-qualifying-seniors",
      docs:["Proof of ownership & residency","Income statement","Note: it's a lien repaid later, not a giveaway"],
      where:`${A.town||"Town"} Assessor. Income limit is $20,000 by default; towns may raise it up to the Circuit Breaker single limit ($75,000 for 2025) — ask what ${A.town||"your town"} adopted. Once the home is sold or the owner dies, interest rises to 16% until paid; a surviving spouse can keep deferring. Joint owners and any mortgage holder must agree in writing. Discuss with family since it reduces home equity over time.`});
  }

  // 15. Senior property-tax Work-Off (owner 60+)
  if(owner && age>=60){
    out.push({id:"workoff",name:"Senior Property Tax Work-Off",status:"maybe",val:1500,valTxt:"up to ~$2,000/yr off the bill",
      why:"Many MA towns let seniors volunteer for the town in exchange for up to $2,000 off the property tax bill (some towns cap it at 125 hours instead). The credit isn't taxable income, and it comes on top of any exemption. Town-specific program; sign up every year.",
      form:"Sign up through the town (Council on Aging or Assessor).",forml:"https://www.mass.gov/lists/property-tax-forms-and-guides",
      docs:["Proof of age & residency"],
      where:`Ask the ${A.town||"town"} Council on Aging or Assessor if they run a Senior Work-Off program and whether slots are open.`});
  }

  // 16. Prescription Advantage (MA pharmacy assistance; 65+ or disabled)
  if(age>=65 || disabled){
    out.push({id:"rxadv",name:"Prescription Advantage (MA)",status:PA_OPEN?"maybe":"no",val:0,valTxt:PA_OPEN?"lowers drug costs":"closed to new applicants",
      why:PA_OPEN?"MA state pharmacy program that wraps around Medicare Part D.":"Massachusetts stopped accepting NEW Prescription Advantage applications after September 11, 2026. If already enrolled, keep renewing. New applicants: Extra Help (federal) and a free SHINE counselor are the paths for drug costs.",
      form:"Current members only (renewals).",forml:"https://www.mass.gov/info-details/prescription-advantage-documents-and-resources",
      docs:["Medicare card","Income info","Current drug list"],
      where:"Apply via mass.gov or a SHINE counselor; stacks on top of Part D / Extra Help."});
  }

  // 17. Utility low-income discount rate + arrearage forgiveness (income-eligible)
  if(A.housing!=="family"){
    const utilLim = HEAP_SMI60[homeHH]||HEAP_SMI60[10];
    if(homeInc<=utilLim){
      out.push({id:"utildisc",name:"Utility Discount Rate",status:"likely",val:450,valTxt:"significant monthly discount",
        why:"Households at or under 60% of state median income (or on Fuel Assistance, SNAP, MassHealth, etc.) get a discounted electric & gas rate (tiered by income), plus arrearage-forgiveness if bills are past due. Separate from — and stackable with — Fuel Assistance.",
        form:"Enroll with the electric/gas utility (often automatic with Fuel Assistance/SNAP/MassHealth).",forml:"https://www.mass.gov/info-details/help-paying-your-utility-bill",
        docs:["Proof of income or a benefit-program enrollment letter","A recent utility bill"],
        where:"Call the utility's low-income/discount line, or it auto-applies once Fuel Assistance/SNAP/MassHealth is approved."});
    }
  }

  // 18. Weatherization (WAP) — income-eligible
  if(A.housing!=="family"){
    const utilLim = HEAP_SMI60[homeHH]||HEAP_SMI60[10];
    if(homeInc<=utilLim){
      out.push({id:"wap",name:"Weatherization Assistance (WAP)",status:"maybe",val:0,valTxt:"free home energy upgrades",
        why:"Free insulation, air-sealing, and heating-system help for income-eligible homes (owners AND renters) — cuts heating bills long-term.",
        form:"Through the local Community Action / fuel-assistance agency.",forml:"https://www.mass.gov/info-details/weatherization-assistance-program-wap",
        docs:["Proof of income","A recent energy bill"],
        where:"Apply at the same local CAP agency as Fuel Assistance — they often screen for both together. Mass Save also offers a free Home Energy Assessment for any 1–4 unit home (masssave.com)."});
    }
  }

  // 19. Lifeline + ACP-style phone/broadband discount (income- or program-based)
  (()=>{
    const lim135 = Math.round(fplFor(homeHH)*1.35);   // Lifeline: 135% FPL for the household (usac.org 2026 table: 1=$21,546, 2=$29,214)
    const snapLim = 2*fplFor(homeHH);
    let s = homeInc<=lim135 ? "likely" : (homeInc<=snapLim ? "maybe" : "no");
    if(s==="no") return; // don't clutter for clearly-ineligible
    out.push({id:"lifeline",name:"Lifeline Phone/Internet Discount",status:s,val:111,valTxt:"up to $9.25/mo off",
      why:(s==="likely"?"Income looks within Lifeline's ~135% FPL limit":"You likely qualify *through* a benefit program (SNAP/MassHealth/SSI auto-qualify)")+" — a monthly federal discount (up to $9.25) on a phone or home-internet bill. Commonly missed.",
      form:"Apply via the Lifeline National Verifier, or through a participating phone/internet carrier.",forml:"https://www.lifelinesupport.org/",
      docs:["Proof of income OR proof of SNAP/MassHealth/SSI enrollment","ID"],
      where:"Easiest path: once SNAP/MassHealth is approved, the carrier can enroll you automatically. One discount per household."});
  })();

  // 20. Community MassHealth / Frail Elder (the FREE, no-lawyer, no-lookback path — distinct from LTC planning)
  if(A.adl==="yes" && (age>=65 || disabled)){
    out.push({id:"mhcommunity",name:"In-Home Care via MassHealth (Frail Elder Waiver)",status:"maybe",val:0,valTxt:"in-home care + dental",
      why:"Needs help with daily activities — community MassHealth + the Frail Elder Waiver / Personal Care Attendant / adult day health can pay for care AT HOME. Limits: income up to about $2,982/month and assets up to about $2,000 (a spend-down can apply), plus a nursing-home level of need. IMPORTANT: gifts or transfers of money in the past 5 years DO count for the Frail Elder Waiver — don't move or give away money before getting advice.",
      form:"Free eligibility screen through your local ASAP (Aging Services Access Point).",forml:"https://www.mass.gov/info-details/masshealth-coverage-types-for-individuals-and-families-including-people-with-disabilities",
      docs:["Income & asset info","Medicare/insurance cards","A note on the help needed at home"],
      where:"Call your local ASAP or 800-AGE-INFO for a free assessment. If any money was given away or moved in the last 5 years, talk to an elder-law attorney first (see the 'see a pro' card)."});
  }

  // 21. Reduced-fare senior transit (NOT income-based — universal for 65+/disabled)
  if(age>=65 || disabled){
    out.push({id:"transit",name:"Reduced-Fare Senior Transit",status:"likely",val:0,valTxt:"half-fare or free rides",
      why:`Not income-based — anyone 65+ gets reduced fares (MBTA Senior CharlieCard; regional transit authorities have their own senior fares).${A.blind==="yes"?" Legally blind riders ride the MBTA free (Blind Access Card).":""} The RIDE paratransit is based on disability, not age, and has its own application.`,
      form:"Apply to the local transit authority for a senior/disabled fare card.",forml:"https://www.mbta.com/fares/reduced/senior-charliecard",
      docs:["Proof of age (ID) or disability","A photo for the card"],
      where:"MBTA Senior CharlieCard office, or your regional transit authority (RTA). The RIDE needs a separate application."});
  }

  // ================= ADDED 2026-09-25 from the independent coverage review (each verified on the cited page) =================

  // 22. VA disability compensation (+ VA health care). Not means-tested. PACT Act presumptives for Agent Orange / burn-pit locations.
  if(A.veteran==="vet"){
    const rated = A.vaDis==="partial"||A.vaDis==="full";
    const ao = A.vetService==="ao", gw = A.vetService==="gw";
    let st="maybe", why;
    if(rated){ why="Already has a VA rating. If conditions have gotten worse — or a newer PACT Act presumptive condition applies — a free Veterans Service Officer can file for an increase."; }
    else if(ao){ st="likely"; why="Served in an Agent Orange location. Conditions like high blood pressure, type 2 diabetes, prostate cancer, Parkinson's disease and MGUS are PRESUMED service-connected — no need to prove service caused them. Monthly, tax-free, no income test, and no deadline to file."; }
    else if(gw){ st="likely"; why="Served in a burn-pit / Gulf War location. The PACT Act presumes 20+ conditions (including asthma diagnosed after service, COPD, chronic sinusitis/rhinitis and several cancers) are service-connected. Monthly, tax-free, no income test, no deadline."; }
    else { why="VA disability compensation is a monthly, tax-free payment for any condition caused or made worse by service — no income or asset test. Worth a free review with a Veterans Service Officer."; }
    out.push({id:"vacomp",name:"VA Disability Compensation + VA Health Care",status:st,val:0,valTxt:"monthly, tax-free (depends on rating)",
      why: why+" Most veterans in these groups can also enroll in VA health care without a disability rating.",
      form:"VA Form 21-526EZ (or file online at va.gov).",forml:"https://www.va.gov/resources/the-pact-act-and-your-va-benefits/",
      docs:["DD-214 (shows where and when they served)","Medical records or a list of diagnoses","Doctor's names and treatment dates"],
      where:"File free through a VA-accredited Veterans Service Officer (every MA city/town has one) or at va.gov. Never pay anyone to file a VA claim."});
  }

  // 23. DIC for surviving spouses (VA)
  if(A.veteran==="spouse"){
    out.push({id:"dic",name:"VA Dependency & Indemnity Compensation (DIC)",status:"maybe",val:0,valTxt:"$1,699/mo base (2026)",
      why:"A tax-free monthly VA payment for a surviving spouse if the veteran died from a service-connected condition — or had a 100% rating for at least 10 years before death (5 years from discharge, or 1 year for former POWs). Separate from the needs-based survivors pension.",
      form:"VA Form 21P-534EZ.",forml:"https://www.va.gov/family-and-caregiver-benefits/survivor-compensation/dependency-indemnity-compensation/",
      docs:["Veteran's DD-214","Death certificate","Marriage certificate","Veteran's VA rating letters, if any"],
      where:"A free Veterans Service Officer can check and file it. Never pay to file a VA claim."});
  }

  // 24. MA veteran annuity (Chapter 115 §6B) — $2,500/yr, NOT means-tested
  if(A.veteran==="vet" && A.vaDis==="full"){
    out.push({id:"vaannuity",name:"MA Veteran Annuity ($2,500/yr)",status:"likely",val:2500,valTxt:"$2,500/yr",
      why:"Massachusetts pays an annual $2,500 annuity to veterans with a 100% service-connected disability (or paid at the 100% rate). Not income-tested — separate from the need-based Chapter 115 program.",
      form:"Veteran Annuity application (MassVets).",forml:"https://www.mass.gov/how-to/how-to-apply-for-veteran-annuity-benefits",
      docs:["VA rating letter showing 100%","DD-214","Proof of MA residency"],
      where:"Apply online through MassVets or with the local Veterans Service Officer. Annual deadline June 30."});
  } else if(A.veteran==="spouse"){
    out.push({id:"vaannuity",name:"MA Veteran Annuity ($2,500/yr)",status:"maybe",val:0,valTxt:"$2,500/yr (if eligible)",
      why:"Massachusetts also pays this $2,500/yr annuity to some surviving spouses of deceased veterans (Gold Star families) — since July 2025 even after remarriage. Which spouses qualify is set by law; the Veterans Service Officer can confirm.",
      form:"Veteran Annuity application (MassVets).",forml:"https://www.mass.gov/how-to/how-to-apply-for-veteran-annuity-benefits",
      docs:["Veteran's DD-214","Death certificate / proof of service-connected death"],
      where:"Ask the local Veterans Service Officer. Annual deadline June 30."});
  }

  // 25. Health coverage before Medicare (ages under 65, not on Medicare)
  if(age<65 && A.medicare!=="yes" && A.healthCov!=="employer" && A.healthCov!=="masshealth"){
    const f = fplFor(hh), pct = inc/f;
    let st, why, name="Health Coverage Before Medicare";
    if(A.healthCov==="connector"){ st="have"; why="Already on a Health Connector plan. Re-check it during open enrollment (starts Oct 23, 2026) — income changes can move you to a cheaper ConnectorCare tier."; }
    else if(pct<=1.33){ st="likely"; why=`Income (~${money(inc)}) is at or under 133% of poverty — MassHealth (CarePlus/Standard) coverage, with no premium.`; }
    else if(pct<=4.0){ st="likely"; why=`Income (~${money(inc)}) is between 100% and 400% of poverty — ConnectorCare plans with low or $0 premiums (2026 plan year).`; }
    else { st="maybe"; why=`Income is above 400% of poverty (~${money(4*f)}), so the 2026 federal premium help no longer applies — full-price Connector plans are still available, and a broker or navigator can compare.`; }
    if(disabled) why += " With a disability, MassHealth CommonHealth can also cover people whose income is too high for regular MassHealth.";
    if(age>=64) why += " Turning 65 soon: sign up for Medicare on time — the Part B late penalty is 10% for each year you could have enrolled and didn't.";
    out.push({id:"health6064",name,status:st,val:0,valTxt:"health coverage",why:why+" Open enrollment for 2027 runs Oct 23 – Dec 23, 2026 (Dec 23 for Jan 1 coverage).",
      form:"Apply through the Massachusetts Health Connector (one application covers MassHealth and ConnectorCare).",forml:"https://www.mahealthconnector.org/learn/plan-information/connectorcare-plans",
      docs:["Proof of income","Social Security numbers","Current coverage information, if any"],
      where:"MAhealthconnector.org or 1-877-623-6765; free in-person help from Navigators."});
  }

  // 26. State Home Care Program (ASAP) — 60+, NOT MassHealth; income sets the co-pay, not eligibility
  if(A.adl==="yes" && (age>=60 || disabled)){
    const low = inc < 35784;
    out.push({id:"homecare",name:"State Home Care Program",status:"likely",val:0,valTxt:low?"in-home help, low or no co-pay":"in-home help (co-pay by income)",
      why:`Adults 60+ who need help at home can get care management plus services like homemaking, personal care, respite and meals through the local Aging Services Access Point — it is NOT MassHealth.${low?" At this income the monthly co-pay is small (or none for MassHealth members).":" Higher income means a percentage-based co-pay, not a no."}`,
      form:"Free in-home assessment by the local ASAP.",forml:"https://www.mass.gov/info-details/home-care-program",
      docs:["Income information","A note on the help needed at home"],
      where:"Call MassOptions at 800-243-4636 (Mon–Fri) to reach the local ASAP."});
  }

  // 27. Getting a family caregiver PAID (Adult Foster Care / PCA through MassHealth)
  if(A.adl==="yes" && (age>=60 || disabled)){
    out.push({id:"paidcare",name:"Getting a Family Caregiver Paid (Adult Foster Care / PCA)",status:"maybe",val:0,valTxt:"a paid stipend for the caregiver",
      why:"If they qualify for MassHealth (Standard or CommonHealth, or SCO/PACE), MassHealth can pay a relative who lives with them and gives daily care through Adult Foster Care — adult children, siblings and other relatives can be paid; a spouse cannot. The Personal Care Attendant program can also pay relatives other than a spouse.",
      form:"Through a MassHealth Adult Foster Care provider or a PCA agency.",forml:"https://www.mass.gov/info-details/masshealth-adult-foster-care-program-fact-sheet",
      docs:["MassHealth eligibility (or an application)","A doctor's statement of care needs"],
      where:"Ask the local ASAP (MassOptions 800-243-4636) or an Adult Foster Care provider. MassHealth eligibility comes first — see the other MassHealth cards."});
  }

  // 28. Home-delivered meals (Elder Nutrition Program) — 60+, frail/isolated/homebound, no income limit
  if(A.adl==="yes" && age>=60){
    out.push({id:"meals",name:"Home-Delivered Meals (Meals on Wheels)",status:"likely",val:0,valTxt:"free or low-cost meals",
      why:"Adults 60+ who are frail, isolated or homebound can get home-delivered meals — there is no income limit. A spouse or caregiver can get meals too.",
      form:"Sign up through the local ASAP / Elder Nutrition Program.",forml:"https://www.mass.gov/info-details/senior-nutrition-program",
      docs:["Basic contact information"],
      where:"Call MassOptions at 800-243-4636 to reach the local program."});
    out.push({id:"caregiver",name:"Family Caregiver Support (free respite)",status:"maybe",val:0,valTxt:"free help for the caregiver",
      why:"If a family member cares for them without pay, the Family Caregiver Support Program is free for that caregiver: respite breaks, training, counseling and help finding services.",
      form:"Through the local ASAP.",forml:"https://www.mass.gov/info-details/family-caregiver-support-program",
      docs:["None to start — just a call"],
      where:"MassOptions 800-243-4636."});
  }

  // 29. Medicare plan check-up (annual open enrollment)
  if(A.medicare==="yes"){
    out.push({id:"medicareoe",name:"Medicare Plan Check-Up (Oct 15 – Dec 7)",status:"maybe",val:0,valTxt:"often lowers drug & plan costs",
      why:"Every fall (Oct 15 – Dec 7) Medicare plans can be switched. A free, unbiased SHINE counselor can compare drug plans and Medicare Advantage vs. Medigap — plans change every year.",
      form:"Free SHINE appointment.",forml:"https://www.mass.gov/health-insurance-counseling",
      docs:["Medicare card","List of current prescriptions and doctors"],
      where:"Call 800-243-4636 (MassOptions) and ask for SHINE."});
  }

  // 30. Unclaimed property — everyone
  out.push({id:"unclaimed",name:"Unclaimed Money Held by the State",status:"maybe",val:0,valTxt:"one in ten people have some",
    why:"The State Treasurer holds billions of dollars in unclaimed property — old bank accounts, uncashed checks, insurance. Especially worth a search for widows and widowers (a late spouse's accounts).",
    form:"Free search and claim at FindMassMoney.gov.",forml:"https://www.mass.gov/how-to/find-unclaimed-property",
    docs:["ID","Proof of past address, if asked"],
    where:"Search online at findmassmoney.gov, or call (617) 367-0400. It's free — never pay a 'finder' to claim it."});

  // 31. For the family member who claims them as a dependent: MA Child and Family Tax Credit
  if(A.dependent==="yes" && age>=65){
    out.push({id:"cftc",name:"For the Family Member Who Claims Them: MA Child & Family Tax Credit",status:"likely",val:0,valTxt:"$440/yr (refundable, to the caregiver)",
      why:"Whoever claims them as a dependent can get the Massachusetts Child and Family Tax Credit — $440 per dependent aged 65+, refundable. Trade-off: while they're claimed as a dependent, THEY can't get the Circuit Breaker (up to $2,820). If their property tax or rent is high, the Circuit Breaker may be worth more — compare both.",
      form:"Claimed on the family member's MA Form 1.",forml:"https://www.mass.gov/info-details/massachusetts-child-and-family-tax-credit",
      docs:["The dependent's information on the family member's return"],
      where:"On the family member's own Massachusetts tax return."});
  }


  // ================= Batch 2 (2026-09-25, from the coverage review; each fact verified on the cited page) =================

  // 32. Senior public housing / vouchers — renters with a heavy rent burden
  if(renter && A.subsidized!=="yes" && (olderAge>=60 || disabled) && num(A.rent)>0 && inc>0 && (num(A.rent)*12)/inc > 0.30){
    const burden = Math.round(100*num(A.rent)*12/inc);
    out.push({id:"housing",name:"Senior Public Housing & Rental Vouchers",status:"maybe",val:0,valTxt:"rent at about 30% of income",
      why:`Rent takes about ${burden}% of income. Massachusetts public housing for older adults and people with disabilities, and MRVP rental vouchers (income up to 80% of area median), generally set rent at about 30% of income. Waiting lists are long, so getting on them NOW matters. Note: the state's Section 8 mobile-voucher waiting list has been closed since January 13, 2025 — public housing (through CHAMP) and MRVP are the open paths; some local housing authorities keep their own lists.`,
      form:"One online application (CHAMP) covers most state public housing; MRVP through local housing agencies.",forml:"https://www.mass.gov/how-to/apply-for-state-funded-public-housing",
      docs:["Proof of income","ID","Current lease"],
      where:"Apply online through CHAMP and pick the towns you'd accept. A local housing authority can help with the application."});
  }

  // 33. MA rental deduction (renters who file a MA return)
  if(renter && A.filing!=="none" && num(A.rent)>0){
    const cap = A.filing==="mfs" ? 2000 : 4000;
    const ded = Math.min(0.5*num(A.rent)*12, cap);
    out.push({id:"rentdeduct",name:"Massachusetts Rent Deduction (state taxes)",status:"maybe",val:Math.round(ded*0.05),valTxt:`up to ~${money(ded*0.05)}/yr in tax`,
      why:`Renters can deduct 50% of the rent paid for their Massachusetts home on the state return, up to a $4,000 deduction — about ${money(ded)} here, worth roughly ${money(ded*0.05)} in state tax. Only helps if they owe Massachusetts income tax; it can be claimed alongside the Circuit Breaker.`,
      form:"Claimed on the Massachusetts Form 1 return.",forml:"https://www.mass.gov/info-details/deductions-on-rent-paid-in-massachusetts",
      docs:["Landlord name and address","Total rent paid for the year"],
      where:"On the Massachusetts tax return — tax software or a preparer will ask for rent paid."});
  }

  // 34. Energy help just ABOVE the fuel-assistance line (60–80% of state median income)
  if(A.housing!=="family"){
    const lim60 = HEAP_SMI60[homeHH]||HEAP_SMI60[10], lim80 = Math.round(lim60*80/60);
    if(homeInc>lim60 && homeInc<=lim80){
      out.push({id:"energy6080",name:"Energy Help Just Above the Fuel-Assistance Limit",status:"maybe",val:0,valTxt:"one-time grant + low/no-cost upgrades",
        why:`Household income is a little over the Fuel Assistance limit, but between 60% and 80% of state median income. That opens: (1) the Salvation Army's Good Neighbor Energy Fund — a one-time grant when a month's energy bill is a hardship (call 800-334-3047); and (2) Mass Save's moderate-income offers — insulation, air-sealing and heating upgrades for up to no cost. A Mass Save Home Energy Assessment is free for any 1–4 unit home.`,
        form:"Good Neighbor: through the Salvation Army. Mass Save: book a free Home Energy Assessment.",forml:"https://www.mass.gov/info-details/learn-about-home-energy-assistance-heap-0",
        docs:["Proof of household income","A recent energy bill"],
        where:"Good Neighbor Energy Fund: 800-334-3047. Mass Save: book online at masssave.com."});
    }
  }

  // 35. Senior food extras: farmers-market coupons (SFMNP) + CSFP food boxes
  if(olderAge>=60){
    const SFMNP={1:29526,2:40034};   // Jul 1 2026 – Jun 30 2027, mass.gov
    const sf = SFMNP[hh]||SFMNP[2], csfp = Math.round(1.5*fplFor(hh));
    if(inc<=sf){
      out.push({id:"seniorfood",name:"Senior Food Extras (Farmers-Market Coupons, Food Boxes)",status:"maybe",val:0,valTxt:"free produce + monthly food box",
        why:`Adults 60+ under ~${money(sf)} (household of ${hh}) can get Senior Farmers Market coupons each summer while the season's supply lasts.${inc<=csfp?` At this income (under ~${money(csfp)}), the federal senior food box program (CSFP) is also available — a free monthly box of groceries through local food banks and Councils on Aging.`:""}`,
        form:"Coupons: apply through the state program. Food box: through the local food bank or Council on Aging.",forml:"https://www.mass.gov/info-details/applying-for-senior-farmers-market-nutrition-program-coupons",
        docs:["Proof of age","Proof of income"],
        where:"Ask the local Council on Aging — they usually hand out coupons and know the food-box sites."});
    }
  }

  // ---- Unknown-answer handling: a created card that depends on a skipped ("not sure") field becomes "verify — needs info" ----
  const DEP={
    cb:["filing","dependent","incomeSS","incomeOther","propTax","assessed","rent","subsidized","spouseAge"],
    ex41c:["incomeSS","incomeOther","assets","titling","maYears"],
    vet22:["vaDis"],
    aanda:["wartime"],
    liheap:["incomeSS","incomeOther","hhSize","hhOtherInc"],
    snap:["incomeSS","incomeOther","citizen"],
    msp:["incomeSS","incomeOther","citizen"],
    ssi:["incomeSS","incomeOther","assets","citizen"],
    ch115:["incomeSS","incomeOther"],
    utildisc:["incomeSS","incomeOther","hhSize","hhOtherInc"],
    wap:["incomeSS","incomeOther","hhSize","hhOtherInc"],
    lifeline:["incomeSS","incomeOther","hhSize"],
    health6064:["incomeSS","incomeOther"],
    housing:["incomeSS","incomeOther","rent"],
    rentdeduct:["rent","filing"],
    energy6080:["incomeSS","incomeOther","hhSize","hhOtherInc"],
    seniorfood:["incomeSS","incomeOther"],
    vacomp:["vetService"]
  };
  out.forEach(p=>{
    if(p.status==="have"||p.status==="refer"||p.status==="no") return;
    const miss=(DEP[p.id]||[]).filter(isUnknown);
    if(miss.length){ p.status="maybe"; p.why="⚠️ Can't confirm yet — still need: "+miss.map(qLabel).join(", ")+" (see the checklist up top). "+p.why; }
  });

  // ---- "Already receiving" override: don't tell people to apply for what they have ----
  const haveMap={cb:"cb",ex41c:"exemption",ex17d:"exemption",vet22:"exemption",blind37a:"exemption",liheap:"liheap",snap:"snap",msp:"msp",lis:"msp",masshealth:"masshealth",vacomp:"vacomp",homecare:"homecare"};
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
  if(!statFinished){ statFinished=true; stat("finish",{qn:furthestN, qt:visible().length}); }
  document.getElementById("bar").style.width="100%";
  document.getElementById("privacy").style.display="none";
  const ps=programs();
  const rank={likely:0,maybe:1,have:2,refer:3,no:4};
  ps.sort((a,b)=> (rank[a.status]-rank[b.status]) || (b.val-a.val));
  const likely=ps.filter(p=>p.status==="likely");
  // Property-tax exemptions generally can't be stacked — count only the largest one in the headline.
  const EXEMPT=["ex41c","ex17d","vet22","blind37a"];
  const exMax=Math.max(0,...likely.filter(p=>EXEMPT.includes(p.id)).map(p=>p.val||0));
  const total=likely.filter(p=>!EXEMPT.includes(p.id)).reduce((s,p)=>s+(p.val||0),0)+exMax;
  // Also show (clearly separated) what the "worth verifying" cards could add if they pan out.
  const maybes=ps.filter(p=>p.status==="maybe");
  const exMaxM=Math.max(0,...maybes.filter(p=>EXEMPT.includes(p.id)).map(p=>p.val||0));
  const maybeTotal=Math.max(0, maybes.filter(p=>!EXEMPT.includes(p.id)).reduce((s,p)=>s+(p.val||0),0) + Math.max(0, exMaxM-exMax));
  const haveN=ps.filter(p=>p.status==="have").length;
  const nm=who(A);

  const maybeN=ps.filter(p=>p.status==="maybe").length;
  const unknownN=Q.filter(q=>A[q.id]==="unknown").length;
  let h=`<div class="headline">
      <div class="pill" style="color:#fff;background:rgba(255,255,255,.18)">${(A.town||"Massachusetts")}</div>
      <div class="big">${total>0?"≈ "+money(total)+"/yr":"Let's dig in"}</div>
      <div class="lbl">in benefits ${nm==="this person"?"they":nm} may be leaving on the table — estimated, if approved for the strong matches</div>
      ${maybeTotal>0?`<div class="lbl" style="opacity:.9;margin-top:4px;">+ up to ~${money(maybeTotal)}/yr more in programs worth verifying</div>`:""}
      <div class="sub">${likely.length} to apply for now &middot; ${maybeN} worth verifying${haveN?` &middot; ${haveN} already active`:""}. Tap any card for the exact form, documents, and where to file.</div>
    </div>
    ${Math.max(num(A.age)||0, A.marital==="married"?(num(A.spouseAge)||0):0)<60 && A.disability!=="yes" ? `<div class="estnote" style="background:#FFF6E0;border-color:#EFD891"><b>Note:</b> most programs here are for people 60 and older (many start at 65). ${nm==="this person"?"They are":nm+" is"} ${num(A.age)||"under 60"}, so only programs with no age requirement are shown as possible matches.</div>`:""}
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
        ${townTaxRows(townLookup(A.town), ps).length?`<li><b>Call the ${townLookup(A.town)?.name||"town"} assessor's office</b> about senior property-tax breaks — see <b>"Your town"</b> just below for what to ask. This is the one people most often miss.</li>`:""}
        <li><b>Start with the green "Apply for these" cards below.</b> Tap <b>How to claim it</b> on each one to see the exact form, what to gather, and where to file.</li>
        ${unknownN?`<li><b>Track down the ${unknownN} answer${unknownN>1?"s":""} you weren't sure about</b> — the yellow box explains where to find each one.</li>`:""}
        <li><b>Print or save this page</b> with the button at the bottom, so you have the list when you make calls.</li>
        <li><b>Want help doing it?</b> Our Full Benefits Check turns this into a written plan and walks through it with you on a call — see the bottom of this page.</li>
      </ol>
    </div>`;
  h+=townCard(ps);
  h+=packetCard(ps);
  // Review / change answers — tap "Change" to jump back to any question, then return here.
  const visQ=visible();
  h+=`<details class="answers"><summary>✏️ Review or change your answers (${visQ.length})</summary><ul>`;
  visQ.forEach((q,k)=>{ h+=`<li><span class="a-q">${NAV[q.id]||q.id}</span><span class="a-v">${fmtAns(q)}</span><button type="button" class="a-edit" data-k="${k}">Change</button></li>`; });
  h+=`</ul></details>`;

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
      <div class="gitem" style="border-color:#cfe0fb"><div class="gq">Medicare Part B help / MassHealth</div><div class="gh">Is the ~$203/mo Part B premium NOT coming out of their Social Security check? Do they carry a MassHealth card?</div></div>
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
    <div class="disc"><b>Important:</b> This tool gives general information based on public Massachusetts and federal program rules (2026 figures). It is <b>not</b> legal, tax, or financial advice. Dollar amounts and eligibility shown are estimates — income limits, exemption amounts, and town rules change and must be confirmed with each program or a licensed professional before you rely on them. Figures last checked September 2026. Property-tax exemptions usually can't be combined — take the one that saves the most. MassHealth/long-term-care planning should go to a licensed elder-law attorney.</div>`;
  document.getElementById("app").innerHTML=h;
  wirePacket();
  document.querySelectorAll(".a-edit").forEach(b=>b.onclick=()=>{ editMode=true; i=parseInt(b.dataset.k,10); render(); window.scrollTo(0,0); });
  const dl=document.getElementById("dl");
  if(dl) dl.onclick=()=>{
    const blob=new Blob([JSON.stringify({answers:A,generated:"client-side",programs:ps},null,2)],{type:"application/json"});
    const u=URL.createObjectURL(blob);const a=document.createElement("a");
    a.href=u;a.download=`benefits-audit-${(A.name||"profile").replace(/\W+/g,"_")}.json`;a.click();URL.revokeObjectURL(u);
  };
  window.scrollTo(0,0);
}

render();
