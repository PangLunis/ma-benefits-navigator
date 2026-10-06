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
    opts:[{v:"single",l:"Single"},{v:"married",l:"Married"},{v:"widowed",l:"Widowed"},{v:"divorced",l:"Divorced"}]},
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
    opts:[{v:"own",l:"Owns the home"},{v:"rent",l:"Rents",d:"Including assisted living"},{v:"family",l:"Lives with family (no rent)"}]},
  {id:"town", type:"text", q:"Which city or town in Massachusetts?", hint:"Property-tax breaks are set town-by-town, so we need this.", noSkip:true},
  {id:"hhSize", type:"number", q:n=>`How many people live in the home, counting ${who(n)}?`, hint:"Include a spouse, adult children, grandchildren — everyone who lives there.", suffix:"people",
    quick:["1","2","3","4","5"], more:"6 or more", unit1:"person"},
  {id:"hhOtherInc", type:"currency", period:"yr",
    // Ryan 2026-09-30: "not counting them or their spouse" was confusing (who is "them"? and a spouse was named even for a
    // widow). Now names the person, mentions a spouse only when married, and gives an example.
    q:n=>n.marital==="married" ? `Income of the other people who live with ${who(n)} and their spouse?` : `Income of the other people who live with ${who(n)}?`,
    hint:n=>(n.marital==="married" ? `Don't include ${who(n)} or their spouse — we ask about their own income later.` : `Don't include ${who(n)} — we ask about ${who(n)}'s own income later.`)
      + ` Example: if a grown son lives there and earns $30,000 a year, put in $30,000. Heating help and utility discounts look at the whole household. If no one else has income, tap None.`,
    optional:true, none:true,
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
  {id:"incomeSS", type:"currency", period:"mo", q:n=>n.marital==="married"?`Social Security income for ${who(n)==="this person"?"them":who(n)} and their spouse, combined?`:`${whoC(n)} Social Security income?`, hint:"Just Social Security, before Medicare is taken out. If married, add both spouses together. Pick per month or per year. If none, tap None.", none:true,
    help:"The yearly Social Security total BEFORE the Medicare premium comes out — it's on the annual Social Security letter (Social Security benefit statement, Form SSA-1099). If you only know the monthly deposit, add about $203/month for Medicare Part B, then × 12. A rough number is fine."},
  {id:"incomeOther", type:"currency", period:"yr", q:n=>n.marital==="married"?"Other income — both spouses combined?":"Other income?", hint:"Everything except Social Security — pensions, wages, individual retirement account (IRA) withdrawals, interest. If married, include the spouse's income too, even if the spouse still works. Pick per month or per year.", none:true,
    help:"Add up pensions, any wages, IRA/401(k) withdrawals, interest & dividends, and rental income — everything EXCEPT Social Security. A close estimate is fine."},
  {id:"pubPension", type:"single", q:n=>`Does ${who(n)} (or a spouse, living or late) get a pension from a government job that did NOT pay into Social Security?`, hint:"In Massachusetts this includes most public school teachers, and many police officers, firefighters, and city or state workers.",
    help:"Answer Yes if the job paid into a public retirement system (like the Massachusetts Teachers' Retirement System) instead of Social Security — whether it's their own pension or a spouse's. A 2025 law ended the rules that used to cut Social Security for these families, so some are now owed money they never applied for.",
    opts:[{v:"yes",l:"Yes"},{v:"no",l:"No"}], showIf:a=>Math.max(num(a.age), a.marital==="married"?num(a.spouseAge):0)>=55},
  {id:"assets", type:"currency", q:"Roughly, total savings & investments?", hint:"Do NOT count the home or one car.", none:true,
    help:"Add up checking, savings, CDs, and investment/IRA accounts. Do NOT count the home they live in or one car. A ballpark is fine."},
  {id:"medExpenses", type:"currency", q:"Yearly out-of-pocket medical costs?", hint:"A rough estimate is fine. Enter 0 if unsure.", optional:true, none:true,
    help:"Out-of-pocket health costs over a year: premiums, copays, prescriptions, dental, glasses. Seniors get extra food-assistance (SNAP) credit for these, so even a rough number helps."},
  {id:"propTax", type:"currency", q:"Yearly property tax bill?", hint:"Your best estimate is fine.", showIf:a=>a.housing==="own",
    help:"On the city/town property tax bill. It often comes quarterly — add the four quarters. You can also look it up free on the town's online assessor database by address."},
  {id:"assessed", type:"currency", q:"Assessed value of the home?", hint:"There's a value ceiling for the Circuit Breaker, so this matters.", showIf:a=>a.housing==="own",
    help:"Also on the property tax bill, labeled \"assessed value\" or \"total value\" — what the TOWN values the home at (often lower than market). Same assessor website has it. Truly can't find it? Tap \"I'm not sure.\""},
  // Added 2026-09-28 (gap audit #5). mass.gov "Massachusetts residential property tax credits", Title V section.
  {id:"septic", type:"single", q:n=>`This year or last, did ${who(n)} pay to fix or replace a failed septic system or cesspool — or to hook up to town sewer because of it?`, hint:"Massachusetts gives a tax credit for this. Most homes on town sewer can answer No.",
    help:"Counts: repairing or replacing a failed septic system or cesspool, or an upgrade or sewer hookup required by Title 5 (for example after failing the Title 5 inspection before a sale). Routine pumping doesn't count.",
    opts:[{v:"yes",l:"Yes"},{v:"no",l:"No"}], showIf:a=>a.housing==="own"},
  {id:"rent", type:"currency", q:"Monthly rent?", hint:"Your share of the rent each month.", showIf:a=>a.housing==="rent",
    help:"The monthly rent payment. If utilities are bundled in, just estimate the rent portion."},
  {id:"subsidized", type:"single", q:"Is the rental public, subsidized, or tax-exempt housing?", hint:"Affects the Circuit Breaker.",
    help:"\"Yes\" = public housing, a Section 8 voucher building, or housing run by a church/nonprofit at reduced rent. A normal private landlord at market rent = \"No.\"",
    opts:[{v:"no",l:"No — private market rental"},{v:"yes",l:"Yes, subsidized/public"}], showIf:a=>a.housing==="rent"},
  {id:"housingCrisis", type:"single", q:n=>`Is ${who(n)} behind on rent, mortgage or utility bills — or have they gotten a notice to quit, a foreclosure notice, or a shutoff notice?`, hint:"Massachusetts has emergency money for people about to lose their housing or utilities.",
    opts:[{v:"yes",l:"Yes"},{v:"no",l:"No"}],
    showIf:a=>(a.housing==="own"||a.housing==="rent") && (()=>{ const k=num(a.hhSize)>=1?Math.min(Math.round(num(a.hhSize)),8):(a.marital==="married"?2:1);
      const h=hudFor(a.town); const lim=h ? h.l50[k-1] : Math.max(HUD_MAX_L50[k-1], HEAP_SMI60[k]||0);
      return num(a.incomeSS)+num(a.incomeOther)+num(a.hhOtherInc) < lim; })()},
  {id:"veteran", type:"single", q:n=>`Military service?`, hint:"Veterans qualify for extra programs.",
    opts:[{v:"vet",l:"Is a veteran"},{v:"spouse",l:"Surviving spouse of a veteran"},{v:"no",l:"No military service"}]},
  {id:"vetService", type:"single", q:"Where did they serve?", hint:"For some places, certain health conditions are automatically treated as caused by service.",
    opts:[{v:"ao",l:"Vietnam, Thailand, Laos, Cambodia, Guam, or the Korean DMZ"},{v:"gw",l:"Gulf War, Iraq, Afghanistan, or another post-9/11 deployment"},{v:"other",l:"Somewhere else / stateside"}],
    showIf:a=>a.veteran==="vet"},
  {id:"vaDis", type:"single", q:"Service-connected disability rating?", hint:"From Veterans Affairs (the VA), if any.",
    help:"On the Veterans Affairs (VA) award/decision letter — a percentage like 30%, 70%, or 100%. Don't have it handy? Tap \"I'm not sure.\"",
    opts:[{v:"none",l:"None"},{v:"partial",l:"10% – 60%"},{v:"partial70",l:"70% – 90%"},{v:"full",l:"100% or unable to work"}],
    showIf:a=>a.veteran==="vet"||a.veteran==="spouse"},
  {id:"wartime", type:"single", q:"Did the service include a wartime period?", hint:"Required for the Veterans Affairs (VA) Aid & Attendance pension.",
    help:"At least 90 days of active duty with one day during a wartime window (anyone who entered after 9/7/1980 generally needs 24 months, or the full period called up) — e.g., WWII, Korea, Vietnam (8/5/1964–5/7/1975, or from 11/1/1955 if served in Vietnam itself), or the Gulf War (8/2/1990–present). Peacetime-only service doesn't qualify for this particular pension. Not sure of the dates? Tap \"I'm not sure.\"",
    opts:[{v:"yes",l:"Yes — served during a wartime period"},{v:"no",l:"No — peacetime only"}],
    showIf:a=>a.veteran==="vet"||a.veteran==="spouse"},
  {id:"disability", type:"single", q:n=>`Does ${who(n)} have a disability or get disability payments from Social Security (SSDI) or Supplemental Security Income (SSI)?`, hint:"Separate from veterans' disability — opens programs regardless of age.",
    opts:[{v:"yes",l:"Yes"},{v:"no",l:"No"}]},
  {id:"blind", type:"single", q:n=>`Is ${who(n)} legally blind?`,
    opts:[{v:"yes",l:"Yes"},{v:"no",l:"No"}]},
  {id:"medicare", type:"single", q:n=>`Is ${who(n)} on Medicare?`,
    opts:[{v:"yes",l:"Yes"},{v:"no",l:"No / not yet"}]},
  {id:"dementia", type:"single", q:n=>`Has a doctor diagnosed ${who(n)} with dementia or memory loss (such as Alzheimer's)?`, hint:"Medicare has a program that helps families caring for someone with dementia.",
    opts:[{v:"yes",l:"Yes"},{v:"no",l:"No"}], showIf:a=>a.medicare==="yes"},
  {id:"incomeDrop", type:"single", q:n=>`In the last 2 years, did ${who(n)}'s income drop a lot — for example because they retired, stopped working, or a spouse died?`, hint:"Medicare bases one of its charges on income from 2 years ago; a big drop can lower it.",
    opts:[{v:"yes",l:"Yes"},{v:"no",l:"No"}], showIf:a=>a.medicare==="yes"},
  {id:"healthCov", type:"single", q:n=>`What health coverage does ${who(n)} have now?`,
    opts:[{v:"employer",l:"Through a job or retiree plan"},{v:"masshealth",l:"MassHealth (Massachusetts Medicaid)"},{v:"connector",l:"A Health Connector plan"},{v:"none",l:"No coverage right now"}],
    showIf:a=>a.medicare==="no"},
  {id:"adl", type:"single", q:"Need help with daily activities?", hint:"Bathing, dressing, cooking, managing meds, getting around.",
    opts:[{v:"yes",l:"Yes, needs some help"},{v:"no",l:"No, fully independent"}]},
  // Added 2026-09-28 (Ryan: "add the assisted-living question"). Only renters who need daily help are asked.
  {id:"alRes", type:"single", q:n=>`Does ${who(n)} live in an assisted living residence?`, hint:"Assisted living changes a few answers: MassHealth can pay for daily help there, Supplemental Security Income (SSI) pays more, and the Circuit Breaker counts only the rent part of the fee.",
    opts:[{v:"yes",l:"Yes, assisted living"},{v:"no",l:"No, a regular apartment or house"}], showIf:a=>a.housing==="rent" && a.adl==="yes"},
  // The "Is <name> ALREADY getting any of these?" checklist was removed 2026-09-30 (Ryan: "I don't think anyone even knows if
  // they're getting it"). What they already get is now marked on the results with each card's "I already get this" button
  // (counted exactly like the old checklist answers -- see alreadyList), plus the Medicare question below for Medicare users.
  // Added 2026-09-28 (Ryan's dad, on "tier 3" MassHealth, didn't know which box to tick). MassHealth has no tiers; a
  // Medicare member can have full MassHealth (a card used at the doctor), the Medicare Savings Program (mass.gov: "previously
  // known as MassHealth Buy-In"; QMB, SLMB/QI levels; MassHealth pays the Part B premium), or both. These are things a person
  // can SEE without the letter. Only asked when they ticked MassHealth or "not sure".
  // 2026-09-30: asked of EVERY Medicare user (it used to follow only a "MassHealth" or "not sure" tick on the checklist), in
  // things they can see: the Social Security deposit and the cards in their wallet. Values are unchanged (neither / partb /
  // full / both), so alreadyList() reads them exactly as before.
  {id:"mhType", type:"single", noLetter:true, q:n=>`Medicare costs: which of these fits ${who(n)}?`, hint:"No letter needed. Look at the Social Security deposit (or the yearly benefit letter) and the cards in their wallet.",
    help:"MassHealth runs two different kinds of help for people on Medicare. The Medicare Savings Program (it used to be called MassHealth Buy-In) pays the Medicare Part B premium, so the ~$203 a month stops coming out of the Social Security check. Full MassHealth coverage comes with a MassHealth card that's used at the doctor and pharmacy. Some people have both.",
    opts:[{v:"neither",l:"About $203 a month comes out of their Social Security for Medicare",d:"Or they pay a Medicare bill themselves. No MassHealth card."},
          {v:"partb",l:"Nothing comes out for Medicare",d:"No Medicare bill either, and no MassHealth card. A state program is probably already paying the premium."},
          {v:"both",l:"Nothing comes out for Medicare, and they have a MassHealth card",d:"They show the MassHealth card at the doctor or pharmacy."},
          {v:"full",l:"They have a MassHealth card, but the ~$203 still comes out",d:"Less common. Pick this if both are true."}],
    showIf:a=>a.medicare==="yes"},
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
function qLabel(id){ const m={septic:"whether they paid for a septic repair",alRes:"whether they live in assisted living",mhType:"which kind of MassHealth help they have",housingCrisis:"whether they're behind on housing bills",dementia:"whether there's a dementia diagnosis",incomeDrop:"whether income dropped in the last 2 years",pubPension:"whether there's a government pension that didn't pay into Social Security",spouseAge:"spouse's age",hhSize:"household size",hhOtherInc:"other household income",maYears:"years living in Massachusetts",vetService:"where they served",healthCov:"current health coverage",filing:"tax filing status",dependent:"dependent status",incomeSS:"Social Security income",incomeOther:"other income",propTax:"property tax amount",assessed:"home assessed value",rent:"monthly rent",subsidized:"subsidized-housing status",assets:"savings/assets",titling:"how the home is titled",vaDis:"VA disability rating",wartime:"wartime-service status",citizen:"citizenship status"}; return m[id]||id; }

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
const NAV = {name:"Name",age:"Age",marital:"Marital status",spouseAge:"Spouse's age",filing:"Tax filing",dependent:"Claimed as a dependent?",citizen:"Citizenship",housing:"Own or rent",town:"City or town",hhSize:"People in the home",hhOtherInc:"Others' income",ownYears:"Years owned",maYears:"10+ years in MA",titling:"How the home is titled",incomeSS:"Social Security",incomeOther:"Other income",housingCrisis:"Behind on housing bills",dementia:"Dementia diagnosis",incomeDrop:"Income dropped in last 2 years",pubPension:"Government pension (no Social Security)",assets:"Savings",medExpenses:"Medical costs",propTax:"Property tax",assessed:"Assessed value",rent:"Monthly rent",subsidized:"Subsidized housing?",veteran:"Military service",vetService:"Where they served",vaDis:"VA rating",wartime:"Wartime service",disability:"Disability",blind:"Legally blind",medicare:"Medicare",healthCov:"Health coverage",adl:"Help with daily activities",alRes:"Assisted living",septic:"Septic repair",already:"Already getting",mhType:"Which MassHealth help",working:"Still working"};
/* What they already get, after the MassHealth follow-up (mhType) sorts out MassHealth coverage vs the Medicare Savings Program. */
function alreadyList(){
  let has=[...(A.already||[])];
  const t=A.mhType;
  if(A.medicare==="yes" && t && t!=="unknown"){
    if(t==="partb"||t==="neither") has=has.filter(x=>x!=="masshealth");
    if(t==="neither") has=has.filter(x=>x!=="msp");
    if((t==="full"||t==="both") && !has.includes("masshealth")) has.push("masshealth");
    if((t==="partb"||t==="both") && !has.includes("msp")) has.push("msp");
  }
  // "I already get this" on a results card (2026-09-30: the only way to say so now that the checklist is gone) counts exactly
  // like ticking the matching checklist box did. Applied after the Medicare question, so an explicit tap always wins.
  const TAP_KEY={cb:"cb",ex41c:"exemption",ex17d:"exemption",vet22:"exemption",blind37a:"exemption",liheap:"liheap",snap:"snap",
                 msp:"msp",masshealth:"masshealth",mhcommunity:"masshealth",rxadv:"rxadv",vacomp:"vacomp",homecare:"homecare"};
  (Array.isArray(A.haveAlso)?A.haveAlso:[]).forEach(id=>{ const k=TAP_KEY[id]; if(k && !has.includes(k)) has.push(k); });
  return has;
}
// mass.gov "New work and education requirements for MassHealth members" (checked 2026-09-28)
const MH_WORK_RULES = "Starting January 1, 2027, some MassHealth members aged 19–64 must work, volunteer or train at least 80 hours a month (or earn at least $580 a month) to keep coverage, unless they\'re excused — for example because of a disability, or because they live with and care for a disabled family member. MassHealth sends the renewal notice in a blue envelope saying what to do.";
// Everyone in the home is 65+ (for the utility shutoff protection, M.G.L. c.164 s.124E / 220 CMR 25.05)
function allOld65(){ const hh=homeSize(); return num(A.age)>=65 && (hh===1 || (hh===2 && A.marital==="married" && num(A.spouseAge)>=65)); }
/* Ways to find out what coverage someone has without the paperwork (Ryan 2026-09-28: "that could happen to elderly people").
   Phone numbers checked on mass.gov 2026-09-28 (MassHealth customer service; MassOptions, option 3 = Prescription Advantage). */
const NO_LETTER_HTML = `<ul style="margin:6px 0 0;padding-left:20px">
  <li><b>Ask the pharmacist.</b> They see what coverage is on file every time a prescription is filled — MassHealth, a Medicare drug plan, or Prescription Advantage.</li>
  <li><b>Look at the Social Security payment.</b> If the Medicare premium (about $203 a month) is <i>not</i> being taken out, MassHealth or the Medicare Savings Program is paying it. The yearly Social Security letter lists the premium too.</li>
  <li><b>Call MassHealth:</b> <a href="tel:+18008412900">(800) 841-2900</a> — they can tell you exactly what's active.</li>
  <li><b>Call MassOptions:</b> <a href="tel:+18002434636">(800) 243-4636</a> for a free Medicare counselor (SHINE) — press 3 for Prescription Advantage.</li>
</ul>`;
/* Tap-to-call: every phone number on screen becomes a link (2026-09-28: 17 of 27 numbers on a results page could not be tapped). */
// "Keeping it" help on an Already-have card (added 2026-10-05). Setting up DTA Connect for a real SNAP household showed what
// someone who ALREADY gets SNAP needs: how to check the balance, the chip-card deadline, PIN safety, and that the online
// account needs an email code and may need a phone call. The card used to say only "no action needed".
// Chip card: DTA Connect home-page banner, read 2026-10-05: "All Chip/Tap cards have been mailed to clients. Activate your new
// card by 11/29 by making a purchase or call 1-800-997-2555 to set a new PIN." The line hides itself from Nov 30, 2026.
const CHIP_CARD_DEADLINE = new Date(2026, 10, 30);
function keepTips(id){
  if(id!=="snap") return null;
  const chip = new Date() < CHIP_CARD_DEADLINE;
  return {
    why: "✓ Already receiving." + (chip ? " One thing to do by <b>November 29</b>: activate the new chip EBT card DTA mailed out — see “Keeping it” below." : " Answer DTA's renewal letter on time so it doesn't stop."),
    items: [
      ...(chip ? ["<b>New chip card:</b> DTA has mailed new chip/tap EBT cards. Activate it by <b>November 29, 2026</b>: make any purchase with it, or call 1-800-997-2555 to set a new PIN."] : []),
      "<b>Check the balance:</b> call 1-800-997-2555, the number on the back of the EBT card. A store receipt also shows it.",
      "<b>Keep the PIN private:</b> never give the PIN or card number to anyone who calls, texts or emails asking for it.",
      "<b>See the case online:</b> DTA Connect (DTAConnect.com or the DTA Connect app). Signing up needs an email address you can open right then, for a code. For someone already on SNAP it may then ask you to call the DTA Assistance Line, (877) 382-2363, to connect the account to the case.",
      "<b>Renewals:</b> DTA mails a letter when it's time to renew. Answer it by the date on the letter so benefits don't stop."
    ]
  };
}
// Hours next to phone numbers (added 2026-10-05): a number with no hours sends people to a line nobody answers (we called
// DTA at 8:40pm). Keyed by the 11-digit number; each value checked on the organization's own page, list + sources in
// ~/dispatch/benefighter/tests/out/adhoc/phone_hours.json. A number missing here simply shows no hours.
const PHONE_HOURS = {
  "16173588310":"Mon–Fri 8–4:30",
  "16173670400":"Mon–Fri 8:45–3:30",
  "16174321434":"Mon–Fri 8–5",
  "16176366998":"Mon–Thu 9–7, Fri 9–4",
  "18002434636":"Mon–Fri 9–5",
  "18004007242":"Mon–Fri 8–7",
  "18004311713":"Mon–Fri 7–6",
  "18006334227":"24/7",
  "18007721213":"Mon–Fri 8–7",
  "18008412900":"Mon–Fri 8–5",
  "18009972555":"24/7",
  "18337128027":"Mon–Fri 8:15–4:45",
  "18666162699":"Mon–Fri 8–6",
  "18668349991":"Mon–Fri 7–7",
  "18772116277":"24/7",
  "18773822363":"Mon–Fri 8:15–4:45",
  "18776236765":"Mon–Fri 8–6"
};
const HOURS_NEAR = /24\/7|\bMon|\ba\.m\.|\bp\.m\.|\bhours\b/i;
function hoursSpan(d){ const sp=document.createElement("span"); sp.className="hrs"; sp.textContent=" ("+PHONE_HOURS[d]+")"; return sp; }
function linkifyPhones(root){
  if(!root) return;
  // hand-written tel: links in the page HTML get their hours too
  root.querySelectorAll('a[href^="tel:"]:not(.tel)').forEach(a=>{
    a.classList.add("tel"); let d=a.getAttribute("href").replace(/[^0-9]/g,""); if(d.length===10) d="1"+d;
    const nx=a.nextSibling, after=nx && nx.nodeType===3 ? nx.nodeValue.slice(0,40) : "";
    if(PHONE_HOURS[d] && !HOURS_NEAR.test(after)) a.after(hoursSpan(d));
  });
  const RE=/(?:\b1[-. ])?\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b|\b1-800-[A-Z]{3}-[A-Z]{4}\b/g;
  const map={A:2,B:2,C:2,D:3,E:3,F:3,G:4,H:4,I:4,J:5,K:5,L:5,M:6,N:6,O:6,P:7,Q:7,R:7,S:7,T:8,U:8,V:8,W:9,X:9,Y:9,Z:9};
  const tw=document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {acceptNode:n=>{
    if(!RE.test(n.nodeValue)){ RE.lastIndex=0; return NodeFilter.FILTER_REJECT; } RE.lastIndex=0;
    return n.parentElement && n.parentElement.closest("a,button,script,style,textarea,input,select,option,summary") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }});
  const nodes=[]; while(tw.nextNode()) nodes.push(tw.currentNode);
  nodes.forEach(n=>{
    const frag=document.createDocumentFragment(); let last=0, t=n.nodeValue, m;
    RE.lastIndex=0;
    while((m=RE.exec(t))){
      // a fax number is not something to tap and call (2026-10-05: "fax (617) 887-8765" was a call link)
      if(/fax(?: to)?:?\s*$/i.test(t.slice(Math.max(0,m.index-12),m.index))) continue;
      frag.appendChild(document.createTextNode(t.slice(last,m.index)));
      let d=m[0].toUpperCase().replace(/[A-Z]/g,c=>map[c]).replace(/[^0-9]/g,""); if(d.length===10) d="1"+d;
      const a=document.createElement("a"); a.href="tel:+"+d; a.textContent=m[0]; a.className="tel"; frag.appendChild(a);
      last=m.index+m[0].length;
      const ext=t.slice(last).match(/^,?\s*ext\.?\s*\d+/i);   // keep "ext. 1" with its number, hours after it
      if(ext){ frag.appendChild(document.createTextNode(ext[0])); last+=ext[0].length; }
      if(PHONE_HOURS[d] && t[last]===")"){ frag.appendChild(document.createTextNode(")")); last+=1; }   // "1-800-MEDICARE (1-800-633-4227)" -> hours after the ")"
      if(PHONE_HOURS[d] && !HOURS_NEAR.test(t.slice(last,last+40))) frag.appendChild(hoursSpan(d));
    }
    frag.appendChild(document.createTextNode(t.slice(last))); n.parentNode.replaceChild(frag,n);
  });
}
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
  nav.querySelectorAll(".qn").forEach(b=>b.onclick=()=>{ if(tapTooSoon()) return; i=parseInt(b.dataset.k,10); render(); const m=document.querySelector(".qmain"); if(m&&window.innerWidth<900) m.scrollIntoView({block:"start"}); });
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
let TOWNS = null, AGENCIES = {}, TOWN_IDX = null, TOWN_WARNED = null, HUD = null;
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
// HUD FY2026 income limits for the town: l50 = 50% of area median (RAFT), l80 = 80% (public housing / vouchers). null if unknown.
function hudFor(town){ const t=townLookup(town); return (t && HUD && HUD[t.name]) || null; }
const HUD_MAX_L50 = [63750,72850,81950,91050,98350,105650,112950,120200];   // highest MA area (Nantucket), FY2026 — used before the town is known
/* Town suggestions. This used to be an HTML <datalist> of all 351 towns. On an iPhone, focusing that box
   froze the screen for several seconds and then opened a pop-up of all 351 towns ON TOP of the question —
   any extra taps made while waiting picked a random town (reported by Ryan 2026-09-28, reproduced in the iOS
   Simulator). Now: at most 6 matches, shown only after the person starts typing, as big buttons in the page. */
function townSuggest(s){
  const k=townKey(s); if(!TOWNS || k.length<2) return [];
  if(!TOWN_IDX){ TOWN_IDX={}; for(const n in TOWNS) TOWN_IDX[townKey(n)]=n; }
  const starts=[], within=[];
  for(const kk in TOWN_IDX){ if(kk.startsWith(k)) starts.push({v:TOWN_IDX[kk], l:TOWN_IDX[kk]}); else if(kk.includes(" "+k)) within.push({v:TOWN_IDX[kk], l:TOWN_IDX[kk]}); }
  BOSTON_NBHD.forEach(nb=>{ if(nb.startsWith(k)){ const v=nb.replace(/\b[a-z]/g,c=>c.toUpperCase()); starts.push({v, l:v+" (Boston)"}); } });
  const byLen=(a,b)=>a.l.length-b.l.length||a.l.localeCompare(b.l);
  return starts.sort(byLen).concat(within.sort(byLen)).slice(0,6);
}
try{
  fetch("data/towns.json").then(r=>r.ok?r.json():null).then(d=>{
    if(d&&d.towns){ TOWNS=d.towns; AGENCIES=d.agencies||{}; TOWN_IDX=null; }
  }).catch(()=>{});
  fetch("data/hud_limits.json").then(r=>r.ok?r.json():null).then(d=>{ if(d&&d.towns) HUD=d.towns; }).catch(()=>{});
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
let PK = {fullName:"", dob:"", street:"", zip:"", phone:"", medicareNo:"", spouseName:"", spouseDob:"", spouseSS:"", spouseOther:"",
          incPension:"", incWages:"", incInterest:"", incRental:"", incOther:"", assetBank:"", assetInvest:"", mortgage:"",
          rxList:"", pharmacy:"", doctors:"", currentPlan:"",
          heatFuel:"", heatVendor:"", heatAcct:"", elecVendor:"", elecAcct:"", heatHousehold:""};
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
  "97":{file:"forms/form-97-senior-tax-deferral.pdf", fn:"fill97", out:"Form-97-senior-tax-deferral-prefilled.pdf"},
  cp4:{file:"forms/form-cp-4-cpa-exemption.pdf", fn:"fillCP4", out:"Form-CP-4-CPA-surcharge-exemption-prefilled.pdf"},
  snap:{file:"forms/snap-application-for-seniors.pdf", fn:"fillSNAP", out:"SNAP-application-for-seniors-prefilled.pdf"},
  cb:{file:"forms/schedule-cb-2025-circuit-breaker.pdf", fn:"fillCB", out:"Schedule-CB-2025-Circuit-Breaker-prefilled.pdf", year:2025},
  cb2024:{file:"forms/schedule-cb-2024-circuit-breaker.pdf", fn:"fillCB", out:"Schedule-CB-2024-Circuit-Breaker-prefilled.pdf", year:2024},
  cb2023:{file:"forms/schedule-cb-2023-circuit-breaker.pdf", fn:"fillCB", out:"Schedule-CB-2023-Circuit-Breaker-prefilled.pdf", year:2023},
  saca2:{file:"forms/masshealth-senior-application-saca2.pdf", fn:"fillSACA2", out:"MassHealth-senior-application-SACA-2-prefilled.pdf"}
};
async function downloadForm(kind, btn){
  const old=btn.innerHTML; btn.disabled=true; btn.innerHTML="Filling in…";
  try{
    await loadScriptOnce("vendor/pdf-lib.min.js"); await loadScriptOnce("forms.js");
    const F=FORMS[kind]; if(!F) throw new Error("unknown form "+kind);
    const r=await fetch(F.file); if(!r.ok) throw new Error("form download failed ("+r.status+")");
    const bytes=new Uint8Array(await r.arrayBuffer());
    const town=(townLookup(A.town)||{}).name||A.town;
    let out = await BFForms[F.fn](PDFLib, bytes, A, PK, town, F.year);
    if(BFForms.signMarks) out = await BFForms.signMarks(PDFLib, out, kind, A.marital==="married");
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
function readySheets(ps){
  const open=id=>{ const p=(ps||[]).find(x=>x.id===id); return p && p.status!=="no" && p.status!=="have"; };
  const t=townLookup(A.town)||{};
  const ag=id=>{ const a=AGENCIES[Array.isArray(id)?id[0]:id]; return a?`<b>${a.n}</b>${a.p?` — <a href="tel:${a.p.replace(/[^0-9+]/g,"")}">${a.p}</a>`:""}`:""; };
  const hh=homeSize(), homeInc=num(A.incomeSS)+num(A.incomeOther)+num(A.hhOtherInc);
  let h="";
  if(open("liheap")) h+=heatSheet(t, ag, hh, homeInc);
  if(open("snap")) h+=`<details class="pk-ws"><summary>🛒 Food help (SNAP): have these ready</summary><div class="pk-body">
    <p>${num(A.age)>=60?`At 60 and up, call the DTA <b>Senior Assistance Office</b> at <a href="tel:8337128027">(833) 712-8027</a> for help applying, or use the shorter <a href="https://www.mass.gov/lists/snap-application-for-seniors" target="_blank" rel="noopener">SNAP Application for Seniors</a>.`:"Apply online at DTAConnect.com (signing up online needs an email address you can open right then, for a code), by phone, or at a local DTA office."}</p>
    <p><b>Have ready:</b> photo ID · Social Security and other income letters · rent or mortgage statement and utility bills · out-of-pocket medical costs (these can raise the benefit for people 60+).</p>
  </div></details>`;
  if(A.medicare==="yes" || open("medicareoe")) h+=medicareSheet();
  return h;
}
// Heating help (HEAP): Massachusetts has no statewide paper form - applications go through the online portal
// (opens October 1) or the local agency, with an intake appointment the first year. So instead of a PDF, a worksheet
// with every answer in one place, printable, kept only on this device.
function heatSheet(t, ag, hh, homeInc){
  const v=k=>String(PK[k]||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const d=x=>{ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(x||"")); return m?`${m[2]}/${m[3]}/${m[1]}`:""; };
  let hhText=PK.heatHousehold;          // only saved once they edit it; until then show a fresh default
  if(!hhText){
    const lines=[];
    const mine=(num(A.incomeSS)+num(A.incomeOther))/12;
    const incKnown = !isUnknown("incomeSS") && !isUnknown("incomeOther");   // (fixed 2026-09-27: "not sure" printed as $0)
    if(!incKnown){
      lines.push(`${PK.fullName||A.name||"Applicant"}${PK.dob?", born "+d(PK.dob):""} — monthly income: ______ (fill in — it wasn't answered)`);
      if(A.marital==="married") lines.push(`${PK.spouseName||"Spouse"}${PK.spouseDob?", born "+d(PK.spouseDob):""} — monthly income: ______`);
    } else if(A.marital==="married"){
      const sp=num(PK.spouseSS)+num(PK.spouseOther), you=Math.max(0,num(A.incomeSS)+num(A.incomeOther)-sp);
      lines.push(`${PK.fullName||A.name||"Applicant"}${PK.dob?", born "+d(PK.dob):""} — about ${money((sp?you:num(A.incomeSS)+num(A.incomeOther))/12)}/month${sp?"":" (couple, combined)"}`);
      lines.push(`${PK.spouseName||"Spouse"}${PK.spouseDob?", born "+d(PK.spouseDob):""}${sp?` — about ${money(sp/12)}/month`:""}`);
    } else lines.push(`${PK.fullName||A.name||"Applicant"}${PK.dob?", born "+d(PK.dob):""} — about ${money(mine)}/month`);
    if(isUnknown("hhOtherInc")) lines.push(`Others in the home — monthly income: ______ (fill in for each person)`);
    else if(num(A.hhOtherInc)>0) lines.push(`Others in the home — about ${money(num(A.hhOtherInc)/12)}/month combined (list each person)`);
    hhText=lines.join("\n");
  }
  const fuel=["","Oil","Natural gas","Electricity","Propane","Kerosene","Wood or coal","Heat is included in my rent"];
  return `<details class="pk-ws pk-heat"><summary>🔥 Heating help application worksheet</summary><div class="pk-body">
    <p>Massachusetts takes heating help applications <b>online from October 1</b> at <a href="https://www.toapply.org/MassHEAP" target="_blank" rel="noopener">toapply.org/MassHEAP</a>, or by phone or in person with ${t.fuel?`your local agency: ${ag(t.fuel)}`:"your local agency (call the Cold Relief Heatline, (800) 632-8175, to find it)"}. The first year there's an intake appointment. Fill this in once and keep it next to you — it stays on this device.</p>
    <label class="pk-ta">How the home is heated<select data-pk="heatFuel">${fuel.map(f=>`<option${PK.heatFuel===f?" selected":""}>${f}</option>`).join("")}</select></label>
    <label class="pk-ta">Heating company (the oil/gas/propane company, or landlord if heat is in the rent)<input type="text" data-pk="heatVendor" value="${v("heatVendor")}"></label>
    <label class="pk-ta">Heating account number (on the bill)<input type="text" data-pk="heatAcct" value="${v("heatAcct")}"></label>
    <label class="pk-ta">Electric company<input type="text" data-pk="elecVendor" value="${v("elecVendor")}" placeholder="e.g. National Grid, Eversource"></label>
    <label class="pk-ta">Electric account number — if approved, a discount rate may apply to this bill (investor-owned utilities)<input type="text" data-pk="elecAcct" value="${v("elecAcct")}"></label>
    <label class="pk-ta">Everyone who lives in the home: name, birth date, monthly income<textarea data-pk="heatHousehold" rows="4">${String(hhText).replace(/&/g,"&amp;").replace(/</g,"&lt;")}</textarea></label>
    <table class="pk-tab">
      <tr><td>People in the household</td><td>${hh}</td></tr>
      <tr><td>Household income for the year (estimate)</td><td>${(homeInc && !isUnknown("incomeSS") && !isUnknown("incomeOther") && !isUnknown("hhOtherInc"))?money(homeInc):"— (fill in)"}</td></tr>
    </table>
    <p><b>Bring:</b> photo ID · this list of everyone in the home · the heating and electric bills · your lease or mortgage statement · proof of the last 30 days of income (Social Security or pension letter, pay stubs).</p>
    <p>The same application also covers free weatherization and heating-system repair. It's free — nobody legitimate charges an application fee. <a href="fuel-assistance.html" target="_blank" rel="noopener">Heating help guide →</a></p>
    <p><button type="button" class="btn ghost pk-heatprint">🖨 Print this sheet</button> <button type="button" class="btn ghost pk-heatcal">📅 Oct 1 reminder</button></p>
  </div></details>`;
}
// ---- Guided "fill in my forms": one big question at a time (for people who won't open a collapsed box) ----
function guideSteps(formsHtml){
  const married=A.marital==="married", nm=(A.name||"").trim(), pos=nm?nm+"'s":"your";
  const has=k=>formsHtml.includes(`data-form="${k}"`);
  const steps=[
    {k:"fullName", q:`What's ${pos} full legal name?`, h:"As it's written on the Medicare card or a photo ID.", t:"text", ac:"name"},
    {k:"dob", q:`What's ${pos} date of birth?`, t:"date", ac:"bday"},
    {k:"street", q:`What's ${pos} street address?`, h:"The home in Massachusetts — street and number.", t:"text", ac:"street-address"},
    {k:"zip", q:"What's the ZIP code?", t:"text", im:"numeric", ac:"postal-code"},
    {k:"phone", q:"What's the best phone number?", h:"The agencies call this number if they have a question.", t:"tel", ac:"tel"}
  ];
  if(A.medicare==="yes") steps.push({k:"medicareNo", q:"What's the Medicare number?", h:"On the red, white and blue Medicare card — 11 letters and numbers. Skip it if the card isn't handy.", t:"text"});
  if(married){
    steps.push({k:"spouseName", q:"What's the spouse's full legal name?", t:"text"});
    steps.push({k:"spouseDob", q:"What's the spouse's date of birth?", t:"date"});
    if(has("msp")||has("saca2")) steps.push({k:"spouseSS", q:"How much of the Social Security is the spouse's, per year?", h:`The check has ${money(num(A.incomeSS))} a year for both. Skip if you're not sure.`, t:"money"});
  }
  if(has("961")||has("saca2")||has("97")) steps.push({k:"assetBank", q:"About how much is in checking and savings, all together?", h:"Some forms ask for this. Skip if you'd rather not say.", t:"money"});
  return steps;
}
function openGuide(){
  const forms=document.querySelector(".packet")?document.querySelector(".packet").innerHTML:"";
  const steps=guideSteps(forms); let k=Math.max(0, steps.findIndex(s=>!PK[s.k])); if(k<0) k=0;
  let ov=document.getElementById("pkGuide"); if(ov) ov.remove();
  ov=document.createElement("div"); ov.id="pkGuide"; ov.className="pk-guide-ov"; ov.setAttribute("role","dialog"); ov.setAttribute("aria-modal","true");
  document.body.appendChild(ov);
  const esc=x=>String(x||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");
  const draw=()=>{
    if(k>=steps.length){
      ov.innerHTML=`<div class="pk-guide-card"><div class="pg-step">All set ✓</div><div class="pg-q">Your forms will come out filled in.</div>
        <p class="pg-h">Tap a form in the list to download it. Sign where it's marked in yellow.</p>
        <button type="button" class="btn prim pg-next" id="pgDone">Show my forms</button></div>`;
      ov.querySelector("#pgDone").onclick=()=>{ ov.remove(); results(); const pk=document.getElementById("packet"); if(pk) pk.scrollIntoView({block:"start"}); };
      return;
    }
    const s=steps[k], val=PK[s.k]||"";
    const input = s.t==="money"
      ? `<input id="pgIn" type="text" inputmode="decimal" placeholder="$" value="${esc(val)}">`
      : `<input id="pgIn" type="${s.t==="date"?"date":s.t==="tel"?"tel":"text"}"${s.im?` inputmode="${s.im}"`:""}${s.ac?` autocomplete="${s.ac}"`:""} value="${esc(val)}">`;
    ov.innerHTML=`<div class="pk-guide-card"><button type="button" class="pg-x" aria-label="Close">✕</button>
      <div class="pg-step">Question ${k+1} of ${steps.length}</div>
      <label class="pg-q" for="pgIn">${s.q}</label>${s.h?`<p class="pg-h">${s.h}</p>`:""}${input}
      <div class="pg-btns">${k>0?`<button type="button" class="btn ghost pg-back">‹ Back</button>`:""}<button type="button" class="btn prim pg-next">Next ›</button></div>
      <button type="button" class="pg-skip">Skip this one</button></div>`;
    const inp=ov.querySelector("#pgIn"); setTimeout(()=>inp.focus(),50);
    const save=()=>{ PK[s.k]=inp.value.trim(); saveProgress(); };
    ov.querySelector(".pg-next").onclick=()=>{ save(); k++; draw(); };
    inp.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); save(); k++; draw(); } };
    const bk=ov.querySelector(".pg-back"); if(bk) bk.onclick=()=>{ save(); k--; draw(); };
    ov.querySelector(".pg-skip").onclick=()=>{ k++; draw(); };
    ov.querySelector(".pg-x").onclick=()=>{ save(); ov.remove(); results(); const pk=document.getElementById("packet"); if(pk) pk.scrollIntoView({block:"start"}); };
  };
  draw();
}
// One printed page: where each form in the packet goes, what to put in the envelope, and deadlines.
const SEND={
  msp:{to:["MassHealth Enrollment Center","PO Box 4405","Taunton, MA 02780-0968"], alt:"Or fax to (857) 323-8300."},
  saca2:{to:["MassHealth Enrollment Center","PO Box 290794","Charlestown, MA 02129-0214"], alt:"Or fax to (617) 887-8799."},
  snap:{to:["DTA Document Processing Center","P.O. Box 4406","Taunton, MA 02780-0420"], alt:"Or fax to 617-887-8765, or upload in DTA Connect."}
};
async function downloadMailingSheet(){
  await loadScriptOnce("vendor/pdf-lib.min.js");
  const kinds=[...document.querySelectorAll(".pk-dl")].map(b=>b.dataset.form);
  const town=(townLookup(A.town)||{}).name||A.town||"your town";
  const doc=await PDFLib.PDFDocument.create(), font=await doc.embedFont(PDFLib.StandardFonts.Helvetica), bold=await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
  let page=doc.addPage([612,792]), y=750;
  const wrap=(t,f,size,maxW)=>{ const out=[]; let line=""; for(const w of String(t).split(/\s+/)){ const tr=line?line+" "+w:w; if(f.widthOfTextAtSize(tr,size)>maxW && line){ out.push(line); line=w; } else line=tr; } if(line) out.push(line); return out; };
  const L=(t,o={})=>{ const f=o.bold?bold:font, size=o.size||11, x=o.x||54; for(const ln of wrap(t,f,size,504-(x-54))){ if(y<60){ page=doc.addPage([612,792]); y=750; } page.drawText(ln.replace(/[^\x20-\x7E]/g,"-"),{x,y,size,font:f}); y-=size+4; } };
  L("Where each form goes",{bold:true,size:18}); y-=2;
  L(`${PK.fullName||who(A)} - made ${new Date().toLocaleDateString("en-US")} at benefighter.com. Keep a copy of everything you send.`,{size:10}); y-=8;
  const done=new Set();
  for(const k of kinds){
    if(done.has(k)) continue; done.add(k);
    const F=FORM_INFO[k], cb=/^cb/.test(k), yr=cb?(FORMS[k]||{}).year:null;
    const title = cb ? `Circuit Breaker tax credit - Schedule CB for ${yr}` : (F?F.title:k);
    L("[ ]  "+title,{bold:true,size:13});
    if(cb){ L(`File it WITH the Massachusetts Form 1 tax return for ${yr}${yr<2025?" (an amended return if one was already filed for that year)":""}. This schedule has no signature line - sign the Form 1. Free help: AARP Tax-Aide or the Council on Aging.`,{x:72}); L("Include: property tax bills (or rent receipts) and income statements for that year.",{x:72}); }
    else if(F && F.to==="assessor"){ L(`Sign where it's marked in yellow. Bring or mail it to the ${town} Board of Assessors (town or city hall).`,{x:72}); L("Deadline: April 1, or within 3 months after the actual tax bills are mailed - whichever is later.",{x:72,bold:true}); if(F.docs) L("Include: "+F.docs.join("; ")+".",{x:72}); }
    else if(SEND[k]){ L("Sign where it's marked in yellow. Mail to: "+SEND[k].to.join(", ")+". "+SEND[k].alt,{x:72}); if(F&&F.docs) L("Include (copies, not originals): "+F.docs.join("; ")+".",{x:72}); }
    y-=6;
  }
  const liheap=(programs()||[]).find(p=>p.id==="liheap"&&p.status!=="no"&&p.status!=="have");
  if(liheap){ const t=townLookup(A.town)||{}, a=t.fuel&&AGENCIES[Array.isArray(t.fuel)?t.fuel[0]:t.fuel];
    L("[ ]  Heating help (no paper form)",{bold:true,size:13});
    L(`Apply online from October 1 at toapply.org/MassHEAP, or call ${a?a.n+(a.p?" at "+a.p:""):"your local agency (Cold Relief Heatline (800) 632-8175)"}. Bring the heating help worksheet from your packet.`,{x:72}); y-=6; }
  L("Questions? SHINE (free Medicare help): (800) 243-4636. MassHealth: (800) 841-2900.",{size:10});
  const out=await doc.save(); const url=URL.createObjectURL(new Blob([out],{type:"application/pdf"}));
  const a=document.createElement("a"); a.href=url; a.download="Where-each-form-goes.pdf"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function heatICS(){
  const now=new Date(), y=(now.getMonth()>9||(now.getMonth()===9&&now.getDate()>1))?now.getFullYear()+1:now.getFullYear();
  const stamp=now.toISOString().replace(/[-:]/g,"").replace(/\.\d+Z$/,"Z");
  const ics=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Benefighter//Heat//EN","BEGIN:VEVENT",`UID:heap-${y}@benefighter.com`,`DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${y}1001`,"SUMMARY:Apply for heating help (HEAP) - applications open today",
    "DESCRIPTION:Apply online at toapply.org/MassHEAP or call your local agency. Households must apply every year.",
    "BEGIN:VALARM","TRIGGER:-PT0M","ACTION:DISPLAY","DESCRIPTION:Heating help applications open","END:VALARM","END:VEVENT","END:VCALENDAR"].join("\r\n");
  const url=URL.createObjectURL(new Blob([ics],{type:"text/calendar"}));
  const a=document.createElement("a"); a.href=url; a.download="Heating-help-Oct-1.ics"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function medicareSheet(){
  const v=k=>String(PK[k]||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const t=townLookup(A.town)||{}, shine=t.shine&&AGENCIES[t.shine];
  return `<details class="pk-ws pk-med"><summary>💊 Medicare plan check-up sheet</summary><div class="pk-body">
    <p>Plans change every year. Between <b>October 15 and December 7</b> anyone on Medicare can switch plans for next year. Fill this in once, then use it on Medicare's plan finder or bring it to a free SHINE counselor. It stays on this device.</p>
    <label class="pk-ta">Prescriptions — one per line: name, dose, how often<textarea data-pk="rxList" rows="4" placeholder="e.g. Metformin 500 mg, twice a day">${v("rxList")}</textarea></label>
    <label class="pk-ta">Pharmacy you use<input type="text" data-pk="pharmacy" value="${v("pharmacy")}" placeholder="e.g. CVS on Main St"></label>
    <label class="pk-ta">Doctors you want to keep<textarea data-pk="doctors" rows="2" placeholder="e.g. Dr. Lee (primary care), Dr. Patel (cardiology)">${v("doctors")}</textarea></label>
    <label class="pk-ta">Current plan (name on the card)<input type="text" data-pk="currentPlan" value="${v("currentPlan")}" placeholder="e.g. Original Medicare + Medigap Core"></label>
    <p><b>Compare plans yourself:</b> <a href="https://www.medicare.gov/plan-compare" target="_blank" rel="noopener">Medicare Plan Finder</a> — enter the drugs and pharmacy above, and it shows each plan's yearly cost.</p>
    <p><b>Or get free, unbiased help:</b> ${shine?`${shine.n} — <a href="tel:${(shine.p||"").replace(/[^0-9+]/g,"")}">${shine.p||""}</a>`:"SHINE"} (statewide line: <a href="tel:8002434636">(800) 243-4636</a>). SHINE counselors don't sell insurance.</p>
    <button type="button" class="btn ghost pk-medprint">🖨 Print this sheet</button>
  </div></details>`;
}
const FORM_INFO={
  "961":{title:"Senior exemption application (State Tax Form 96-1)", to:"assessor", docs:["Copy of birth certificate (first year only)","Last year's income (tax return or Social Security statement)","Bank and investment statements"]},
  "962":{title:"Surviving-spouse exemption application (State Tax Form 96-2)", to:"assessor", docs:["Copy of spouse's death certificate (first year only)","Bank and investment statements"]},
  "963":{title:"Blind person's exemption application (State Tax Form 96-3)", to:"assessor", docs:["Mass. Commission for the Blind certificate, or a doctor's letter"]},
  "964":{title:"Veterans exemption application (State Tax Form 96-4)", to:"assessor", docs:["Discharge papers (DD-214) — first year","VA disability rating letter"]},
  "97":{title:"Senior tax deferral application (State Tax Form 97)", to:"assessor", docs:["Tax Deferral and Recovery Agreement (Form 97-1)","Last year's income (tax return or Social Security statement)"]},
  cp4:{title:"Community Preservation Act surcharge exemption application (Form CP-4)", to:"assessor", docs:["Income documents for everyone in the household (last year)"]},
  msp:{title:"Medicare Savings Programs application", to:"masshealth", docs:["Copy of Medicare card","Proof of income (Social Security letter, pension statements)"]},
  snap:{title:"SNAP Application for Seniors", to:"dta", docs:["Proof of income","Rent or mortgage statement and utility bills","Out-of-pocket medical costs"]},
  saca2:{title:"Application for Health Coverage for Seniors (SACA-2)", to:"saca", docs:["Copy of Medicare card","Proof of income (Social Security letter, pension statements)","Bank statements updated within the last 45 days","Proof of identity"]}
};
async function downloadLetter(kind){
  const F=FORM_INFO[kind]; if(!F) return;
  await loadScriptOnce("vendor/pdf-lib.min.js");
  const doc=await PDFLib.PDFDocument.create(), page=doc.addPage([612,792]);
  const font=await doc.embedFont(PDFLib.StandardFonts.Helvetica), bold=await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
  const t=townLookup(A.town)||{}, town=t.name||A.town||"", fyr=(new Date().getMonth()>=6?new Date().getFullYear()+1:new Date().getFullYear());
  let y=740; const L=(txt,o)=>{ const f=(o&&o.bold)?bold:font, size=(o&&o.size)||11.5;
    // simple word wrap at ~88 chars
    const words=String(txt).split(" "); let line="";
    words.forEach(w=>{ if((line+" "+w).trim().length>88){ page.drawText(line.trim(),{x:72,y,size,font:f}); y-=size+5; line=w; } else line+=" "+w; });
    if(line.trim()) { page.drawText(line.trim(),{x:72,y,size,font:f}); } y-=size+5; };
  const gap=n=>{ y-=n; };
  L(new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})); gap(10);
  L(PK.fullName||"[Your full name]"); L(PK.street||"[Street address]"); L(`${town}, MA ${PK.zip||""}`.trim()); if(PK.phone) L(PK.phone); gap(14);
  if(F.to==="assessor"){ L("Board of Assessors"); L(`${town}, Massachusetts`); }
  else if(F.to==="masshealth"){ L("MassHealth Enrollment Center"); L("PO Box 4405"); L("Taunton, MA 02780-0968"); }
  else if(F.to==="saca"){ L("MassHealth Enrollment Center"); L("PO Box 290794"); L("Charlestown, MA 02129-0214"); }
  else { L("DTA Document Processing Center"); L("P.O. Box 4406"); L("Taunton, MA 02780-0420"); }
  gap(14);
  L(`Re: ${F.title}${F.to==="assessor"?` — Fiscal Year ${fyr}`:""}`,{bold:true}); gap(10);
  L(F.to==="assessor"?"Dear Board of Assessors,":"To whom it may concern,"); gap(4);
  L(`Please find enclosed my completed ${F.title}${F.to==="assessor"?` for Fiscal Year ${fyr}`:""}. I have included copies of the documents listed below. Please contact me${PK.phone?` at ${PK.phone}`:""} if you need anything else to process my application.`);
  gap(8); L("Enclosed:",{bold:true}); F.docs.forEach(d=>L("•  "+d)); gap(18);
  L("Sincerely,"); gap(34); L("______________________________"); L(PK.fullName||"[Your name]");
  const out=await doc.save(); const url=URL.createObjectURL(new Blob([out],{type:"application/pdf"}));
  const a=document.createElement("a"); a.href=url; a.download=`Cover-letter-${kind}.pdf`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function downloadICS(kind){
  const F=FORM_INFO[kind]; const t=townLookup(A.town)||{}, town=t.name||A.town||"your town";
  const now=new Date(), fyr=(now.getMonth()>=6?now.getFullYear()+1:now.getFullYear());
  const due=`${fyr}0401`, stamp=now.toISOString().replace(/[-:]/g,"").replace(/\.\d+Z$/,"Z");
  const ics=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Benefighter//Deadlines//EN","BEGIN:VEVENT",
    `UID:${kind}-${fyr}-${Math.random().toString(36).slice(2)}@benefighter.com`,`DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${due}`,`SUMMARY:Deadline: ${F.title} to the ${town} assessor`,
    `DESCRIPTION:File with the ${town} Board of Assessors by April 1 (or within 3 months after the actual tax bills are mailed\\, whichever is later). Late applications can't be accepted.`,
    "BEGIN:VALARM","TRIGGER:-P14D","ACTION:DISPLAY","DESCRIPTION:Two weeks until the deadline","END:VALARM","END:VEVENT","END:VCALENDAR"].join("\r\n");
  const url=URL.createObjectURL(new Blob([ics],{type:"text/calendar"}));
  const a=document.createElement("a"); a.href=url; a.download=`Deadline-${kind}.ics`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function quickLinks(ps){
  const open=id=>{ const p=(ps||[]).find(x=>x.id===id); return p && p.status!=="no" && p.status!=="have"; };
  const L=[];
  if(open("unclaimed")) L.push(`<li><b>Unclaimed money:</b> search your name (and a late spouse's) at <a href="https://www.findmassmoney.gov" target="_blank" rel="noopener">FindMassMoney.gov</a> — free, 2 minutes.</li>`);
  if(open("lis")) L.push(`<li><b>Extra Help with drug costs:</b> apply online at <a href="https://www.ssa.gov/medicare/part-d-extra-help" target="_blank" rel="noopener">ssa.gov/extrahelp</a> or call Social Security at (800) 772-1213 (it's automatic if you get the Medicare Savings Program).</li>`);
  if(open("transit")) L.push(`<li><b>Reduced fares:</b> ask your local bus authority for a senior card${(townLookup(A.town)||{}).ride?" — or get an MBTA Senior CharlieCard (65+)":""}.</li>`);
  if(open("lifeline")) L.push(`<li><b>Phone/internet discount (Lifeline):</b> apply at <a href="https://www.lifelinesupport.org" target="_blank" rel="noopener">lifelinesupport.org</a>.</li>`);
  if(open("medicareoe")) L.push(`<li><b>Medicare plan check-up:</b> book a free SHINE counselor at (800) 243-4636 (Oct 15 – Dec 7 is open enrollment).</li>`);
  return L.length?`<details class="pk-ws"><summary>🔗 Quick links for the rest</summary><div class="pk-body"><ul class="pk-links">${L.join("")}</ul></div></details>`:"";
}
function packetCard(ps){
  const open=id=>{ const p=(ps||[]).find(x=>x.id===id); return p && p.status!=="no" && p.status!=="have"; };
  const town=(townLookup(A.town)||{}).name||A.town||"your town";
  const forms=[];
  if(open("msp")) forms.push(`<div class="pk-form"><button type="button" class="btn prim pk-dl" data-form="msp">⬇ Medicare Savings Program application — pre-filled</button>
    <p class="pk-note">Still to add by hand: SSN, ${A.citizen==="citizen"||A.citizen==="qualified"?"":"citizenship questions, "}anything you skipped in Step 1 (birth date, Medicare number, spouse's share of income), and the signature on page 3 (both spouses sign if married and living together). Mail to MassHealth Enrollment Center, PO Box 4405, Taunton, MA 02780-0968, or fax (857) 323-8300. Free help: SHINE, (800) 243-4636.</p></div>`);
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
  const tw=townLookup(A.town);
  if(A.housing==="own" && tw && tw.cpa && tw.cpas && age>=60 && (open("ex41c")||open("cb"))) forms.push(`<div class="pk-form"><button type="button" class="btn prim pk-dl" data-form="cp4">⬇ Community Preservation Act surcharge exemption (Form CP-4) — pre-filled</button>
    <p class="pk-note">For low- and moderate-income seniors 60+ in ${tw.name}. Still to add by hand: household members and their income (Schedules C–E), and your signature. ${assessorLine}</p></div>`);
  if(open("snap") && Math.max(num(A.age)||0, A.marital==="married"?(num(A.spouseAge)||0):0)>=60) forms.push(`<div class="pk-form"><button type="button" class="btn prim pk-dl" data-form="snap">⬇ Food help (SNAP) application for seniors — pre-filled</button>
    <p class="pk-note">Name, address, phone and date of birth are printed in. Still to add by hand: the rest of the questions and your signature on page 1. Send page 1 even if you don't finish the rest — DTA accepts it with a name, address and signature, and your benefits can count from that date. Upload at DTAConnect.com, fax (617) 887-8765, or mail to DTA Document Processing Center, P.O. Box 4406, Taunton, MA 02780-0420. Help: Senior Assistance Office, (833) 712-8027.</p></div>`);
  if(open("cb") && (A.housing==="own"||A.housing==="rent")) forms.push(`<div class="pk-form"><button type="button" class="btn prim pk-dl" data-form="cb">⬇ Circuit Breaker tax credit (Schedule CB, 2025) — pre-filled</button>
    <p class="pk-note">Printed in: name, address, ${A.housing==="own"?"homeowner, assessed value, Social Security and property tax":"renter, Social Security and rent"}. Still to add: Social Security number, lines 3, 5, 6 and 8 (they come from the tax return)${A.housing==="own"?", half of water and sewer bills (line 13)":", the landlord's name and address"}, and the math on the lines after that. File it <b>with the Massachusetts Form 1 tax return for 2025</b> — even if ${who(A)==="this person"?"they don't":who(A)+" doesn't"} normally file. Free help: AARP Tax-Aide or the Council on Aging. Missed years can be claimed up to 3 years back, each with that year's Schedule CB.</p></div>`);
  // MassHealth senior application: for 65+ who need MassHealth in-home care, or Health Safety Net above the
  // Medicare Savings income limit (the MSP application covers HSN below it).
  if(num(A.age)>=65 && (open("mhcommunity") || (open("hsn") && !open("msp")))) forms.push(`<div class="pk-form"><button type="button" class="btn prim pk-dl" data-form="saca2">⬇ MassHealth senior application (SACA-2) — pre-filled</button>
    <p class="pk-note">Covers MassHealth and the Health Safety Net. Printed in: name, birth date, address, phone, marriage and spouse, citizenship, own or rent, ${A.marital==="married"?"":"income by type, "}savings, and Medicare. Still to add: Social Security number, the optional background questions, ${A.marital==="married"?"each spouse's income (fill in the spouse's share in Step 1 above and it's split between you automatically), ":""}the details of each bank account, and signatures on page 24. It's a long form — a free SHINE counselor or the local Council on Aging can help. Mail to MassHealth Enrollment Center, PO Box 290794, Charlestown, MA 02129-0214, or fax (617) 887-8799.</p></div>`);
  // Missed years: Schedule CB can be claimed up to 3 years after that year's filing deadline, so in 2026 the
  // 2024 and 2023 credits are still open. Offer only years in which someone (either spouse, if married) was 65+.
  if(open("cb") && (A.housing==="own"||A.housing==="rent")){
    const nowY=new Date().getFullYear(), older=Math.max(num(A.age)||0, A.marital==="married"?(num(A.spouseAge)||0):0);
    const yrs=[2024,2023].filter(y=>older-(nowY-y)>=65 && nowY-y<=3);
    if(yrs.length) forms.push(`<div class="pk-form"><div class="pk-h2" style="margin:0 0 6px">Missed years? Claim them too</div>
      ${yrs.map(y=>`<button type="button" class="btn ghost pk-dl" style="white-space:normal;width:100%;margin:0 0 8px" data-form="cb${y}">⬇ ${y} Schedule CB (name &amp; address filled in)</button>`).join("")}
      <p class="pk-note">If ${who(A)==="this person"?"they":who(A)} qualified in ${yrs.join(" or ")} but didn't claim it, each year can still be claimed with that year's Schedule CB and that year's Massachusetts tax return (an amended one if a return was already filed). Only the name, address and ${A.housing==="own"?"homeowner":"renter"} box are printed in: fill in that year's income, ${A.housing==="own"?"property tax and assessed value":"and rent"} from that year's records. ${yrs.includes(2023)?"<b>The 2023 claim has to be filed by April 2027</b> — 3 years after that year's tax deadline.":""}</p></div>`);
  }
  // cover letter + calendar under each form (assessor forms + MSP + SNAP)
  for(let k=0;k<forms.length;k++){
    const m=/data-form="([^"]+)"/.exec(forms[k]); if(!m || /^cb/.test(m[1])) continue;   // CB goes with the tax return: no cover letter
    forms[k]=forms[k].replace("</div>",`<div class="pk-mini"><button type="button" class="pk-link pk-letter" data-form="${m[1]}">📄 Cover letter</button>${["msp","snap"].includes(m[1])?"":`<button type="button" class="pk-link pk-cal" data-form="${m[1]}">📅 Add the deadline to my calendar</button>`}</div></div>`);
  }
  const ws=cbWorksheet(ps)+readySheets(ps)+quickLinks(ps);
  // Keep the checklist short: every "apply now" match, then the most valuable "worth verifying" ones, max 8.
  const likely=(ps||[]).filter(p=>p.status==="likely"), maybes=(ps||[]).filter(p=>p.status==="maybe").sort((a,b)=>(b.val||0)-(a.val||0));
  const todo=likely.concat(maybes.filter(p=>(p.val||0)>0)).slice(0,8);
  const moreN=likely.length+maybes.length-todo.length;
  if(!forms.length && !ws && !todo.length) return "";
  let h=`<div class="packet" id="packet"><h3>📄 Your claim packet</h3>
    <p class="pk-lead">Forms and numbers filled in from your answers, <b>right here on this device — nothing is sent to us.</b></p>`;
  if(forms.length){
    const nSteps=guideSteps(forms.join("")).length, filled=guideSteps(forms.join("")).filter(s=>PK[s.k]).length;
    h+=`<div class="pk-guidebox"><button type="button" class="btn prim pk-guide">✍️ ${filled?"Finish filling in my forms":"Fill in my forms"} — ${nSteps} quick questions</button>
      <p class="pk-note">One question at a time. It puts your name, address and other details on every form below. Skip anything you'd rather not answer.${filled?` (${filled} of ${nSteps} done.)`:""}</p></div>`;
    const v=k=>String(PK[k]||"").replace(/"/g,"&quot;");
    const fld=(k,label,type,extra)=>`<label>${label}<input type="${type||"text"}" data-pk="${k}" autocomplete="off" value="${v(k)}"${extra||""}></label>`;
    const cash=(k,label)=>fld(k,label,"text",' inputmode="decimal" placeholder="$ per year"');
    h+=`<details class="pk-opt"><summary>📝 All details (review or change)</summary><div class="pk-fields">
      <p class="pk-note">Everything here stays on this device. It's only used to fill in the forms below — never sent to us. We never ask for a Social Security number.</p>
      <div class="pk-h2">About ${who(A)==="this person"?"them":who(A)}</div>
      ${fld("fullName","Full legal name")}${fld("dob","Date of birth","date")}
      ${fld("street","Street address")}${fld("zip","ZIP code","text",' inputmode="numeric"')}${fld("phone","Phone","tel")}
      ${fld("medicareNo","Medicare number (optional — on the red, white & blue card)")}
      ${A.marital==="married"?`<div class="pk-h2">Spouse</div>${fld("spouseName","Spouse's full name")}${fld("spouseDob","Spouse's date of birth","date")}
      <div class="pk-h2">Spouse's share of the income <span class="pk-sub">(for the applications that ask per person)</span></div>
      ${cash("spouseSS","Spouse's Social Security (per year)")}${cash("spouseOther","Spouse's other income (per year)")}
      <p class="pk-note">These are the spouse's part of the combined amounts from the check (about ${money(num(A.incomeSS))} Social Security and ${money(num(A.incomeOther))} other a year). The rest is counted as ${who(A)==="this person"?"the applicant's":who(A)+"'s"}. Leave blank if you're not sure.</p>`:""}
      <div class="pk-h2">Other income last year, by type <span class="pk-sub">(not Social Security)</span></div>
      ${cash("incPension","Pensions & retirement")}${cash("incWages","Wages from a job")}${cash("incInterest","Interest & dividends")}${cash("incRental","Rental income (after expenses)")}${cash("incOther","Anything else")}
      <p class="pk-note" id="pk-inc-sum"></p>
      <div class="pk-h2">Savings & home <span class="pk-sub">(for the exemption forms)</span></div>
      ${fld("assetBank","Checking & savings (total)","text",' inputmode="decimal" placeholder="$"')}${fld("assetInvest","Stocks, bonds, mutual funds, IRAs (total)","text",' inputmode="decimal" placeholder="$"')}${A.housing==="own"?fld("mortgage","Mortgage still owed on the home","text",' inputmode="decimal" placeholder="$ (0 if none)"'):""}
      <p class="pk-note">Then tap a form below — it comes out with these filled in.</p></div></details>`;
    h+=forms.join("");
    h+=`<p style="margin:10px 0 4px"><button type="button" class="btn ghost pk-mailsheet" style="white-space:normal;width:100%">📬 Print one page: where each form goes</button></p><p class="pk-note">Every form is marked in yellow where to sign.</p>`;
  }
  h+=ws;
  if(todo.length){
    h+=`<div class="pk-check"><div class="pk-h">Checklist</div><ul>${todo.map(p=>`<li><span class="pk-box" aria-hidden="true"></span><span><b>${p.name}</b>${p.form?` — ${p.form}`:""}</span></li>`).join("")}</ul>${moreN>0?`<p class="pk-note">+ ${moreN} more worth a look in the full list below.</p>`:""}</div>`;
  }
  h+=`<button type="button" class="btn ghost pk-print">🖨 Print just this packet</button></div>`;
  return h;
}
function wirePacket(){
  const sumEl=document.getElementById("pk-inc-sum");
  const updSum=()=>{ if(!sumEl) return; const ks=["incPension","incWages","incInterest","incRental","incOther"]; const any=ks.some(k=>PK[k]!==""&&PK[k]!=null);
    const tot=ks.reduce((a,k)=>a+(num(PK[k])||0),0), want=num(A.incomeOther)||0;
    sumEl.textContent = any ? `These add up to ${money(tot)}${want?` — your answer earlier was ${money(want)} a year`:""}.` : ""; };
  document.querySelectorAll("[data-pk]").forEach(el=>el.addEventListener("input",()=>{ PK[el.dataset.pk]=el.value; updSum(); saveProgress(); }));
  updSum();
  document.querySelectorAll(".pk-letter").forEach(b=>b.addEventListener("click",()=>downloadLetter(b.dataset.form)));
  const gd=document.querySelector(".pk-guide");
  if(gd) gd.addEventListener("click",openGuide);
  const fg=document.querySelector(".fr-guide");
  if(fg) fg.addEventListener("click",openGuide);
  const ms=document.querySelector(".pk-mailsheet");
  if(ms) ms.addEventListener("click",downloadMailingSheet);
  const hp=document.querySelector(".pk-heatprint");
  if(hp) hp.addEventListener("click",()=>{ document.body.classList.add("print-heat"); window.print(); });
  const hc=document.querySelector(".pk-heatcal");
  if(hc) hc.addEventListener("click",heatICS);
  const mp=document.querySelector(".pk-medprint");
  if(mp) mp.addEventListener("click",()=>{ document.body.classList.add("print-med"); window.print(); });
  document.querySelectorAll(".pk-cal").forEach(b=>b.addEventListener("click",()=>downloadICS(b.dataset.form)));
  document.querySelectorAll(".pk-dl").forEach(b=>b.addEventListener("click",()=>downloadForm(b.dataset.form,b)));
  const pr=document.querySelector(".pk-print");
  if(pr) pr.addEventListener("click",()=>{ document.body.classList.add("print-packet"); document.querySelectorAll(".pk-ws").forEach(d=>d.open=true); window.print(); });
}
window.addEventListener("afterprint",()=>{ document.body.classList.remove("print-packet"); document.body.classList.remove("print-med"); document.body.classList.remove("print-heat"); });

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
/* ---------- "Engine" animation between the last answer and the results (Ryan approved 2026-09-28; "all of these options flowing into
   something, then it comes out with the specific results"). The person's OWN answers flow into the Benefighter sun, it counts
   through the programs, and their actual top matches drop out. ~4.5 s, skippable, skipped entirely for reduced-motion users. */
let engineShown = false;
const PROGRAM_TOTAL = 57;   // program ids the engine evaluates (tests/program_list.json)
function engineWanted(){
  if(/[?&]anim=0\b/.test(location.search)) return false;
  if(renderCount===0) return false;   // only right after answering the last question — not when saved answers reopen on the results
  try{ if(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return false; }catch(e){}
  return true;
}
function answerChips(){
  const c=[], inc=num(A.incomeSS)+num(A.incomeOther);
  if(num(A.age)>0) c.push(`${Math.round(num(A.age))} years old`);
  const t=townLookup(A.town); if(t) c.push(t.name);
  if(A.marital==="married") c.push("Married"); else if(A.marital==="widowed") c.push("Widowed"); else if(A.marital==="divorced") c.push("Divorced");
  c.push(A.housing==="own"?"Owns the home":A.housing==="rent"?(A.alRes==="yes"?"Assisted living":"Rents"):"Lives with family");
  if(inc>0) c.push(`${money(inc)} a year`);
  if(A.medicare==="yes") c.push("On Medicare");
  if(A.veteran==="vet") c.push("Veteran"); else if(A.veteran==="spouse") c.push("Veteran's spouse");
  if(A.adl==="yes") c.push("Needs some help at home");
  if(A.disability==="yes") c.push("Has a disability");
  return c.slice(0,8);
}
// Results reveal (Ryan 2026-09-30, "a big unveil"): right after the checking animation, the yearly total counts up
// from $0 while each strong match drops in underneath with its amount. Only after finishing the questions in this
// visit (never when saved answers reopen, never with reduced motion); any tap, key or scroll shows the end state.
let revealPending=false, revealStop=null;
function runReveal(items, total, delay){
  const hl=document.querySelector("#app .headline"); if(!hl) return;
  const odo=hl.querySelector(".odo"), lis=[...hl.querySelectorAll(".rv-item")];
  const n=Math.max(1,lis.length), step=Math.max(260, Math.min(520, 2600/n));
  const fmt=v=>"≈ "+money(v)+"/yr";
  const marks=[]; items.reduce((acc,p)=>{ acc+=(p.val||0); marks.push(acc); return acc; }, 0);
  let raf=0, stopped=false; const timers=[];
  const EVS=["pointerdown","keydown","wheel","touchmove"];
  const end=()=>{ if(stopped) return; stopped=true; cancelAnimationFrame(raf); timers.forEach(clearTimeout);
    lis.forEach(li=>li.classList.add("in")); if(odo) odo.textContent=fmt(total);
    hl.classList.remove("rv-anim"); if(total>0) hl.classList.add("rv-done");
    EVS.forEach(ev=>removeEventListener(ev,end,true)); revealStop=null; };
  revealStop=end;
  const tween=(from,to,ms)=>{ cancelAnimationFrame(raf); const t0=performance.now();
    const f=now=>{ if(stopped) return; const x=Math.min(1,(now-t0)/ms), e=1-Math.pow(1-x,3); if(odo) odo.textContent=fmt(from+(to-from)*e); if(x<1) raf=requestAnimationFrame(f); };
    raf=requestAnimationFrame(f); };
  lis.forEach((li,k)=>timers.push(setTimeout(()=>{ li.classList.add("in"); const from=k?marks[k-1]:0;
    if(total>0 && marks[k]>from) tween(from, marks[k], step*0.9); }, delay+k*step)));
  timers.push(setTimeout(end, delay+n*step+350));
  EVS.forEach(ev=>addEventListener(ev,end,{capture:true,passive:true}));
}
function playEngine(done){
  const app=document.getElementById("app");
  // Ryan 2026-09-30 ("slim the checking part"): this layer only shows the CHECKING -- answers flowing into the sun and
  // the program count. It used to also list the top matches and a total, so the money appeared twice; now the money is
  // shown once, by the count-up reveal on the results page (runReveal).
  const chips=answerChips();
  const SUN = `<svg viewBox="0 0 44 44" aria-hidden="true" focusable="false"><path d="M22 3.5 37.5 8.8V21.2c0 9.6-6.6 16.6-15.5 19.6C13.1 37.8 6.5 30.8 6.5 21.2V8.8Z" fill="#FFFFFF" stroke="#1E4E3C" stroke-width="3.2" stroke-linejoin="round"/><path d="M14.5 22.3l5.3 5.3 10.4-11" fill="none" stroke="#E4A126" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;   // shield-and-check mark (2026-10-01; was the sun)
  // a full-screen layer, so it's on screen wherever the page was scrolled
  const host=document.querySelector(".tool")||document.body;
  const ov=document.createElement("div"); ov.className="eng-ov"; host.appendChild(ov);
  ov.innerHTML=`<div class="eng" role="status" aria-live="polite">
    <button type="button" class="eng-skip">Skip ›</button>
    <div class="eng-lbl">${esc(who(A)==="this person"?"Your answers":who(A)+"'s answers")}</div>
    <div class="eng-in">${chips.map((c,k)=>`<span class="eng-chip" style="--k:${k}">${esc(c)}</span>`).join("")}</div>
    <div class="eng-core"><div class="eng-sun">${SUN}</div>
      <div class="eng-count">Checking <b id="engN">0</b> of ${PROGRAM_TOTAL} Massachusetts programs…</div></div>
  </div>`;
  let finished=false; const timers=[];
  const finish=()=>{ if(finished) return; finished=true; timers.forEach(clearTimeout); done();
    const hdr=document.querySelector(".site-header"), hb=hdr?hdr.getBoundingClientRect().bottom:0, a=document.getElementById("app").getBoundingClientRect().top;
    window.scrollTo({top:Math.max(0, window.scrollY + a - hb - 8), left:0, behavior:"instant"});   // land on the results, not the page intro
    ov.classList.add("gone"); setTimeout(()=>ov.remove(), 450); };
  ov.querySelector(".eng-skip").onclick=finish;
  const root=ov.querySelector(".eng");
  timers.push(setTimeout(()=>root.classList.add("s1"), 60));      // answers appear
  timers.push(setTimeout(()=>{   // answers flow into the sun: aim each chip at the sun's centre
    const sun=root.querySelector(".eng-sun").getBoundingClientRect(), cx=sun.left+sun.width/2, cy=sun.top+sun.height/2;
    root.querySelectorAll(".eng-chip").forEach(c=>{ const r=c.getBoundingClientRect(); c.style.setProperty("--dx",(cx-(r.left+r.width/2))+"px"); c.style.setProperty("--dy",(cy-(r.top+r.height/2))+"px"); });
    root.classList.add("s2"); }, 1100));
  const n=document.getElementById("engN"), t0=1300, dur=1400;
  for(let k=1;k<=20;k++) timers.push(setTimeout(()=>{ if(n) n.textContent=Math.round(PROGRAM_TOTAL*k/20); }, t0+dur*k/20));
  timers.push(setTimeout(()=>{ root.classList.add("s3"); const c=root.querySelector(".eng-count"); if(c) c.innerHTML=`Checked all <b>${PROGRAM_TOTAL}</b> Massachusetts programs.`; }, 2800));
  timers.push(setTimeout(finish, 3500));   // then the results open with the reveal
}
function esc(x){ return String(x).replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c])); }
let renderedAt = -1e9, renderCount = 0;
let lastQid = null;   // which question was on screen last render (audit F6)
/* Each new question must open with its first line on screen (Ryan 2026-09-28: "sometimes you have to slide the screen to see the
   top part of the question"). The page keeps its scroll position between questions, so after tapping an answer low on a long
   question — or when the phone keyboard pushes the page up — the next question's top ended up under the sticky header. */
function keepQuestionInView(){
  const card=document.querySelector("#app .qmain .card"); if(!card) return;
  const hdr=document.querySelector(".site-header");
  const top=(hdr && /sticky|fixed/.test(getComputedStyle(hdr).position)) ? hdr.getBoundingClientRect().bottom : 0;
  const r=card.getBoundingClientRect();
  if(r.top < top+4 || r.top > window.innerHeight*0.75) window.scrollTo({top: Math.max(0, window.scrollY + r.top - top - 12), left: 0, behavior: "instant"});
}
/* Phones (Ryan 2026-09-30: "these pages don't load at the top"): the page auto-focused each text box, so the iPhone
   keyboard popped up and Safari scrolled the page to make room, pushing the question under the sticky header; when the
   keyboard closed the page stayed there. On touch screens we no longer auto-focus (the person taps the box), we close
   the keyboard before showing the next question, and we line the question up again once the keyboard has closed. */
const TOUCH = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
function realignAfterKeyboard(){
  if(!TOUCH || !window.visualViewport) return;
  const vv = window.visualViewport; let done = false;
  const once = () => { if(done) return; done = true; vv.removeEventListener("resize", once); setTimeout(keepQuestionInView, 80); };
  vv.addEventListener("resize", once);
  setTimeout(() => { if(!done){ done = true; vv.removeEventListener("resize", once); } }, 1500);
}
function tapTooSoon(){ const g = (typeof window.BF_TAP_GUARD_MS==="number") ? window.BF_TAP_GUARD_MS : 350; return performance.now()-renderedAt < g; }
function render(){
  if(TOUCH){ const ae=document.activeElement; if(ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName)) ae.blur(); }   // close the phone keyboard first
  saveProgress();
  const vis = visible();
  if(i>=vis.length){ editMode=false; if(!engineShown && engineWanted()){ engineShown=true; revealPending=true; return playEngine(results); } return results(); }
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
               : q.quick ? "Tap the number — it moves on by itself."
               : "Type your answer, then tap Next.";
  // Question 1 carries the length that used to sit in the page intro (2026-09-29, "Question first" start)
  const stepTxt = i===0 ? `Question 1 of about ${vis.length} &middot; <span>5–10 minutes</span>`
                        : `Question ${i+1} of ${vis.length} &middot; <span>${doWhat}</span>`;
  // Audit F7 (2026-09-29): the question is a heading and names its answer group / text box; the hint describes them.
  inner += `<div class="card"><div class="qstep">${stepTxt}</div><h2 class="q" id="qtext" tabindex="-1">${qt}</h2>`;
  if(q.hint) inner += `<p class="hint" id="qhint">${typeof q.hint==="function"?q.hint(A):q.hint}</p>`;
  if(q.help) inner += `<details class="help"><summary>ⓘ What's this? Where do I find it?</summary><div class="hbox">${q.help}</div></details>`;
  if(q.noLetter) inner += `<details class="help noletter"><summary>📄 Can't find the letter? How to check without it</summary><div class="hbox">${NO_LETTER_HTML}</div></details>`;

  const isInput = (q.type==="number"||q.type==="currency"||q.type==="text");
  if(q.type==="single"||q.type==="multi"){
    inner += `<div class="opts ${q.type==='multi'?'ms':''}" role="${q.type==='multi'?'group':'radiogroup'}" aria-labelledby="qtext"${q.hint?' aria-describedby="qhint"':''}>`;
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
    // Tap-to-answer (Ryan, 2026-09-30): household size is a row of number buttons; the box only opens for "6 or more"
    // (or when a bigger number is already saved). A tap stores exactly what typing that number would.
    const quick = q.quick || null;
    const boxOpen = !quick || (val!=="" && !quick.includes(String(val)));
    if(quick){
      inner += `<div class="quick" role="radiogroup" aria-labelledby="qtext"${q.hint?' aria-describedby="qhint"':''}>`;
      quick.forEach(v=>{ const on = String(val)===v;
        inner += `<button type="button" class="qk${on?' sel':''}" data-v="${v}" role="radio" aria-checked="${on}" aria-label="${v} ${v==="1"&&q.unit1?q.unit1:q.suffix}">${v}</button>`; });
      const moreOn = boxOpen && val!=="";
      inner += `<button type="button" class="qk more${moreOn?' sel':''}" id="qmore" role="radio" aria-checked="${moreOn}">${q.more}</button></div>`;
    }
    if(per){
      inner += `<div class="pertoggle" role="radiogroup" aria-label="Per month or per year">
        <button type="button" class="per ${per==='mo'?'sel':''}" data-per="mo" role="radio" aria-checked="${per==='mo'}">Per month</button>
        <button type="button" class="per ${per==='yr'?'sel':''}" data-per="yr" role="radio" aria-checked="${per==='yr'}">Per year</button>
      </div>`;
    }
    inner += `<div class="ipwrap ${isCur?'cur':''}" id="ipbox"${boxOpen?'':' hidden'}>${isCur?'<span class="pre">$</span>':''}
      <input id="ip" type="${q.type==='text'?'text':'number'}" inputmode="${q.type==='text'?'text':'decimal'}"
      value="${boxOpen?val:''}" placeholder="${q.placeholder||''}" aria-label="${(NAV[q.id]||'Answer')}" aria-labelledby="qtext"${q.hint?' aria-describedby="qhint"':''}${q.id==="town"?' autocomplete="off" autocapitalize="words" aria-autocomplete="list" aria-controls="townsug"':''}></div>${q.id==="town"?'<div id="townsug" class="townsug" role="listbox" aria-label="Matching Massachusetts towns"></div>':''}`;
    if(per) inner += `<p class="hint" style="margin:8px 0 0" id="perhint">${per==='mo'?'dollars per month':'dollars per year'}</p>`;
    else if(q.suffix) inner += `<p class="hint" style="margin:8px 0 0" id="sfxhint"${boxOpen?'':' hidden'}>in ${q.suffix}</p>`;
    // "None ($0)" where zero is a common, honest answer (other income, others' income, savings, medical costs)
    if(q.none){ const on = A[q.id]!=null && A[q.id]!=="" && A[q.id]!=="unknown" && num(A[q.id])===0;
      inner += `<button type="button" class="nonebtn${on?' sel':''}" id="none0" aria-pressed="${on}">None ($0)</button>`; }
  }

  inner += `<div class="nav">
      <button class="btn ghost" id="back" ${i===0?'disabled':''}>&larr; Back</button>
      <button class="btn prim" id="next">${isLast?"See my results &rarr;":"Next &rarr;"}</button>
    </div>`;
  if(isInput && !q.noSkip){ inner += `<button class="skip" id="skip">🤔 I'm not sure — skip &amp; flag it for later</button>`; }
  if(editMode && !isLast){ inner += `<button class="btn backres" id="backres">Done changing — back to my results</button>`; }
  inner += `</div></div></div>`;
  if(RESTORED){ inner = `<div class="restored">✓ We brought back your answers from last time. <button type="button" id="freshBtn">Start fresh</button></div>` + inner; RESTORED=false; }
  app.innerHTML = inner;
  const fb=document.getElementById("freshBtn"); if(fb) fb.onclick=startFresh;
  wireNav(vis);
  linkifyPhones(app);
  renderedAt = performance.now();
  if(renderCount++ > 0){ keepQuestionInView(); realignAfterKeyboard(); }   // not on first load: the intro text above the first question stays visible

  // wire choices
  if(q.type==="single"){
    app.querySelectorAll(".opt").forEach(b=>b.onclick=()=>{ if(tapTooSoon()) return; A[q.id]=b.dataset.v;i++;render();});
  } else if(q.type==="multi"){
    const excl=q.exclusive||[];
    app.querySelectorAll(".opt").forEach(b=>b.onclick=()=>{
      const v=b.dataset.v; let set=new Set(A[q.id]||[]);
      if(excl.includes(v)){ set = set.has(v)?new Set():new Set([v]); }     // exclusive choice
      else { excl.forEach(e=>set.delete(e)); set.has(v)?set.delete(v):set.add(v); }
      A[q.id]=[...set]; render();
      const nb=document.querySelector('#app .opt[data-v="'+v+'"]'); if(nb) try{ nb.focus({preventScroll:true}); }catch(e){ nb.focus(); }   // keep focus on the ticked box
    });
  } else {
    const ip=document.getElementById("ip"); if(!TOUCH){ try{ ip.focus({preventScroll:true}); }catch(e){ ip.focus(); } }   // no auto-keyboard on phones
    ip.onkeydown=e=>{if(e.key==="Enter")document.getElementById("next").click();};
    app.querySelectorAll(".quick .qk[data-v]").forEach(b=>b.onclick=()=>{ if(tapTooSoon()) return; saveInput(q,b.dataset.v); i++; render(); });
    const qm=document.getElementById("qmore"); if(qm) qm.onclick=()=>{
      document.getElementById("ipbox").hidden=false; const sh=document.getElementById("sfxhint"); if(sh) sh.hidden=false;
      app.querySelectorAll(".quick .qk").forEach(x=>{ const on=x===qm; x.classList.toggle("sel",on); x.setAttribute("aria-checked",on); });
      const pw=document.getElementById("pickone"); if(pw) pw.remove();
      try{ ip.focus({preventScroll:true}); }catch(e){ ip.focus(); }   // they chose to type, so the keyboard opening is wanted
    };
    const n0=document.getElementById("none0"); if(n0) n0.onclick=()=>{ if(tapTooSoon()) return; saveInput(q,"0"); i++; render(); };
    app.querySelectorAll(".per").forEach(b=>b.onclick=()=>{
      A[q.id+"_per"]=b.dataset.per;
      app.querySelectorAll(".per").forEach(x=>{const on=x===b; x.classList.toggle("sel",on); x.setAttribute("aria-checked",on);});
      const ph=document.getElementById("perhint"); if(ph) ph.textContent = b.dataset.per==="mo"?"dollars per month":"dollars per year";
      ip.focus();
    });
  }
  // Audit F6 (2026-09-29): after an answer, move focus to the new question. The answer button that had focus is destroyed
  // by the re-render, which dropped keyboard and screen-reader users back to the top of the page (23 Tab presses to get
  // back on a desktop). Not on first load; text-box screens already focus their box.
  if((q.type==="single"||q.type==="multi") && renderCount>1 && q.id!==lastQid){ const qh=document.getElementById("qtext"); if(qh){ try{ qh.focus({preventScroll:true}); }catch(e){ qh.focus(); } } }
  lastQid=q.id;
  const qst=document.getElementById("qstatus"); if(qst) qst.textContent=`Question ${i+1} of ${vis.length}`;   // the live region is now just this line (F7)
  const back=document.getElementById("back"); if(back) back.onclick=()=>{ if(tapTooSoon()) return; i=Math.max(0,i-1);render();};
  const skip=document.getElementById("skip"); if(skip) skip.onclick=()=>{ if(tapTooSoon()) return; A[q.id]="unknown"; i++; render();};
  if(q.id==="town"){
    const ip=document.getElementById("ip"), box=document.getElementById("townsug");
    const draw=()=>{ const m=townSuggest(ip.value); const exact=m.length===1 && townKey(m[0].v)===townKey(ip.value);
      box.innerHTML = exact ? "" : m.map(o=>`<button type="button" class="tsug" role="option" data-v="${o.v}">${o.l}</button>`).join("");
      box.querySelectorAll(".tsug").forEach(b=>b.onclick=()=>{ ip.value=b.dataset.v; box.innerHTML=""; ip.style.borderColor=""; const w=document.getElementById("townwarn"); if(w) w.remove(); ip.blur(); }); };
    ip.addEventListener("input", draw);
  }
  const br=document.getElementById("backres"); if(br) br.onclick=()=>{
    if(isInput){ const v=document.getElementById("ip").value.trim(); if(v) saveInput(q,v); }
    editMode=false; i=visible().length; render();
  };
  document.getElementById("next").onclick=()=>{
    if(tapTooSoon()) return;
    // a single-choice question needs a tapped answer ("I'm not sure" counts); Next used to skip it silently
    if(q.type==="single" && (A[q.id]==null || A[q.id]==="")){
      let w=document.getElementById("pickone");
      if(!w){ w=document.createElement("p"); w.id="pickone"; w.className="hint"; w.setAttribute("role","alert");
        w.style.cssText="margin:10px 0 0;padding:10px 12px;border-radius:10px;background:#FBEECB;color:#5B4210;font-weight:600";
        w.textContent = q.noSkip ? "Tap one of the answers above to continue." : "Tap one of the answers above — or \"I'm not sure\" — to continue.";
        app.querySelector(".opts").after(w); }
      return;
    }
    if(isInput && q.quick && document.getElementById("ipbox").hidden){
      if(A[q.id]!=null && q.quick.includes(String(A[q.id]))){ i++; render(); return; }   // came back and kept the tapped answer
      let w=document.getElementById("pickone");
      if(!w){ w=document.createElement("p"); w.id="pickone"; w.className="hint"; w.setAttribute("role","alert");
        w.style.cssText="margin:10px 0 0;padding:10px 12px;border-radius:10px;background:#FBEECB;color:#5B4210;font-weight:600";
        w.textContent = "Tap a number above — or \"I'm not sure\" — to continue.";
        app.querySelector(".quick").after(w); }
      return;
    }
    if(isInput){
      const v=document.getElementById("ip").value.trim();
      if(!v && !q.optional){ document.getElementById("ip").focus(); document.getElementById("ip").style.borderColor="#d23"; return;}
      // Massachusetts only, for now: warn (once per value) when the town isn't one of the 351, then let them continue
      if(q.id==="town" && TOWNS && v && !townLookup(v) && TOWN_WARNED!==v){
        TOWN_WARNED=v;
        let w=document.getElementById("townwarn");
        if(!w){ w=document.createElement("p"); w.id="townwarn"; w.className="hint"; w.setAttribute("role","alert");
          w.style.cssText="margin:10px 0 0;padding:10px 12px;border-radius:10px;background:#FBEECB;color:#5B4210;font-weight:600";
          document.getElementById("ip").closest(".ipwrap").after(w); }
        w.textContent=`We couldn't find "${v}" among Massachusetts cities and towns. Benefighter only covers Massachusetts right now, so results won't apply outside the state. Check the spelling (pick from the list), or tap Next again to continue anyway.`;
        return;
      }
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
const SSI_SSP = {1:1122.82, 2:1692.72};         // 2026 SSI + MA State Supplement, aged, living independently (SLA A): $994+$128.82; couple $846.36 x 2 (mass.gov CY2026 payment levels PDF)
const VA_MAPR = {vet1:17441, vet2:22839, spouse:11699}; // VA basic pension MAPR (no Housebound/A&A), eff. 12/1/2025 (va.gov pension + survivors pension rates)
const EAEDC_INC = {1:441.10, 2:573.90};          // EAEDC gross monthly income limit, living alone / with spouse, with shelter costs (mass.gov EAEDC page)
const VA_NETWORTH = 163699;                     // VA pension net-worth limit, 12/1/2025–11/30/2026 (va.gov)
const VA_MAPR_AA = {vet1:29093, vet2:34488, spouse:18697}; // VA pension MAPR with Aid & Attendance, eff. 12/1/2025 (va.gov)
const SNAP_MAX1 = 306;
const SNAP_STD = {1:217,2:217,3:217,4:229,5:268,6:308};   // FY2027 standard deduction / month (mass.gov, 106 CMR 364.400)
const SNAP_SUA = 945;                           // FY2027 heating standard utility allowance / month (mass.gov, 106 CMR 364.945)
const SNAP_ASSET_ELDERLY = 4750;                // FY2027 asset limit, elderly/disabled households NOT categorically eligible (106 CMR 363.110)                          // SNAP max allotment, 1 person, from Oct 1 2026 (USDA FY2027 COLA)
const PA_OPEN = false;                          // Prescription Advantage: no new applications after Sept 11, 2026 (mass.gov)

function hhSize(){ return A.marital==="married"?2:1; }   // the person (+ spouse): used for MSP, SSI, SNAP, VA
function homeSize(){ const k=num(A.hhSize); return k>=1 ? Math.min(Math.round(k),10) : hhSize(); }   // everyone in the home: HEAP, utility discount, WAP, Lifeline
function fplFor(k){ return 15960 + 5680*(Math.max(1,k)-1); }   // 2026 HHS poverty guideline (48 states), 91 FR 1797
const HEAP_SMI60 = {1:53585,2:70073,3:86561,4:103049,5:119536,6:136024,7:139116,8:142207,9:145299,10:148390}; // FY2027, mass.gov HEAP page
// Mass Save 'Enhanced Incentive' upper limits (80% SMI), 2026-2027 heating season, masssave.com income-based-offers
// (checked 2026-09-30). Used instead of round(60% x 4/3), which came out $1 low for 5, 6 and 8 people.
const MASSSAVE_ENH80 = {1:71447,2:93431,3:115415,4:137399,5:159382,6:181366,7:185488,8:189610,9:193732,10:197854};
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
    // Schedule CB line 9 "Qualifying income" = total income (incl. all Social Security) minus line 8 = the Form 1 exemptions:
    // $700 for each person 65+, $2,200 if legally blind. (Fixed 2026-09-27: the independent answer key caught that we skipped this.)
    const cbJoint = A.marital==="married" && (A.filing==="joint" || A.filing==="none");
    const cbEx = (age>=65?700:0) + (cbJoint && spouseAge>=65?700:0) + (A.blind==="yes"?2200:0);
    const cinc = Math.max(0, inc - cbEx);
    if(cinc>cap){ out.push(cb("no",`Qualifying income ~${money(cinc)} (total income minus the $700 age-65${A.blind==="yes"?" and $2,200 blindness":""} exemption${cbEx>700?"s":""}) is over the $${cap.toLocaleString()} limit for this filing status.`)); return; }
    let status="maybe", why="";
    if(owner){
      const tax=num(A.propTax);
      const burden = tax > 0.10*cinc;
      if(A.assessed && num(A.assessed)>CB_ASSESS){ out.push(cb("no",`Home assessed over the $${CB_ASSESS.toLocaleString()} value ceiling.`)); return; }
      const assessedKnown = A.assessed && num(A.assessed)>0;
      if(burden && assessedKnown){ status="likely"; why=`Property tax (${money(tax)}) tops 10% of income and the home is under the value ceiling — strong match. (50% of water/sewer also counts toward the test.)`; }
      else if(burden && !assessedKnown){ status="maybe"; why=`Property tax tops 10% of income — likely, but you MUST confirm the home is assessed under $${CB_ASSESS.toLocaleString()} (hard cutoff).`; }
      else if(A.propTax!=null && A.propTax!=="unknown" && tax + 1500 <= 0.10*cinc){ out.push(cb("no",`Property tax (${money(tax)}) plus even a large water/sewer bill stays under 10% of income (${money(0.10*cinc)}), so the credit works out to $0.`)); return; }
      else { status="maybe"; why=`Income qualifies; confirm property tax + 50% of water/sewer exceeds 10% of income (${money(0.10*cinc)}).`; }
    } else if(renter){
      if(A.subsidized==="yes"){ out.push(cb("no","Renters in public/subsidized/tax-exempt housing can't claim it — no property tax is paid on the unit.")); return; }
      const rentYr=num(A.rent)*12; const burden = (0.25*rentYr) > 0.10*cinc;
      if(!burden && A.rent!=null && A.rent!=="unknown" && A.subsidized!=="unsure"){ out.push(cb("no",`For renters the credit is 25% of rent (${money(0.25*rentYr)}) minus 10% of income (${money(0.10*cinc)}) — that works out to $0 here.`)); return; }
      if(A.alRes==="yes"){
        cbEst = 0;
        out.push(cb("maybe",`In assisted living, only the RENT part of the monthly fee counts — and only if the residence pays property tax and there's a real landlord-tenant agreement (usually the bill lists rent separately). Use that rent amount: the credit is 25% of it minus 10% of income (${money(0.10*cinc)}). Residences that don't pay property tax (public housing, church-run homes) don't qualify.`));
        return;
      }
      status = burden?(A.subsidized==="unsure"?"maybe":"likely"):"maybe";
      why = burden?`25% of rent (${money(0.25*rentYr)}) tops 10% of income — qualifies as a renter${A.subsidized==="unsure"?" (confirm the unit isn't subsidized/tax-exempt).":"."}`:`Income qualifies; 25% of rent must top 10% of income (${money(0.10*cinc)}).`;
    } else { out.push(cb("no","Income qualifies, but the Circuit Breaker is a refund of property tax or rent actually paid on a Massachusetts home they own or rent. If they pay rent to family, answer \"rent\" instead.")); return; }
    // Estimated credit, not the maximum: owners = tax (+ half of water/sewer, not asked) − 10% of income; renters = 25% of rent − 10% of income. Capped at CB_MAX.
    let est = 0;
    if(owner){ est = num(A.propTax) - 0.10*cinc; } else if(renter){ est = 0.25*num(A.rent)*12 - 0.10*cinc; }
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
    else if(A.vaDis==="partial"||A.vaDis==="partial70"){ s="likely"; w="Owner + 10%+ service-connected disability — qualifies for the veterans' exemption (base $400)."; }
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
    const lim = HEAP_SMI60[homeHH]||HEAP_SMI60[10];
    if(A.housing==="family"){   // the application counts everyone in the home (2026-09-27: was "maybe" at any income)
      if(homeInc>lim){ out.push(fa("no",`Everyone in the home counts: household income (~${money(homeInc)}) is above the ~${money(lim)} limit for ${homeHH} people.`)); return; }
      out.push(fa("maybe",`Household income is under the ~${money(lim)} limit for ${homeHH} people — the household applies together, for the home's heating costs.`)); return;
    }
    const s = homeInc<=lim?"likely":"no";   // no eligibility above 60% of state median income
    out.push(fa(s, s==="no"?`Household income (~${money(homeInc)}) is above the ~${money(lim)} limit for a household of ${homeHH} (60% of state median income).`:`Household income under the ~${money(lim)} limit for a household of ${homeHH} — heating help. Renters qualify even if heat is included in rent.`));
    function fa(s,w){return {id:"liheap",name:"Fuel Assistance (HEAP)",status:s,val:s==="no"?0:400,valTxt:s==="no"?"—":"~$200–$600+/winter (depends on funding)",why:w,
      form:"Application through your local Community Action agency.",forml:"https://www.mass.gov/how-to/apply-for-home-energy-assistance-heap",
      docs:["Last 4 weeks of income (all sources)","Most recent heating + electric bill","Lease or mortgage statement"],
      where:"Applications open October 1; help covers Nov 1–Apr 30; re-apply every year. Find your local fuel-assistance (CAP) agency by ZIP. Also unlocks utility discount rates. Good to know: utilities can't shut off heating service for financial hardship Nov 15–Mar 15, and if everyone in the home is 65+, gas/electric can't be shut off without the DPU's written approval — tell the utility that everyone is 65+ (DPU consumer line: 877-886-5066)."};}
  })();

  // 7. SNAP (food)
  (()=>{
    const lim=SNAP200[hh]||SNAP200[2];
    const sixty = olderAge>=60 || disabled;
    let s = inc<=lim?"likely":(sixty?"maybe":"no");
    let w, netMo = null;
    if(inc>lim && sixty){   // regular rules: net income test only (7 CFR 273.9), shelter deduction uncapped for 60+/disabled
      const g = inc/12, std = SNAP_STD[Math.min(hh,6)]||217;
      const medD = Math.max(0, med/12 - 35);
      const adj = Math.max(0, g - std - medD);
      const shelter = (renter ? num(A.rent) : owner ? num(A.propTax)/12 : 0) + ((renter||owner) ? SNAP_SUA : 0);
      netMo = Math.max(0, adj - Math.max(0, shelter - 0.5*adj));
      const netLim = fplFor(hh)/12;
      const assetsKnown = A.assets!=null && A.assets!=="" && A.assets!=="unknown";
      if(netMo > netLim*1.10 || (assetsKnown && assets > SNAP_ASSET_ELDERLY)) s="no";
    }
    if(inc<=lim){ w = sixty ? `Under the ~${money(lim)} gross limit for a household of ${hh}. Age 60+ (or disabled) also gets extra deductions for medical costs and high housing costs.${med>0?` Their ~${money(med)}/yr medical costs help via that deduction.`:""}` : `Under the ~${money(lim)} gross limit for a household of ${hh}.`; }
    else if(sixty && s!=="no"){ w = `Over the ~${money(lim)} gross limit, but households with someone 60+ or disabled are judged on NET income: after the medical (over $35/mo) and housing deductions it comes to roughly ${money(netMo)}/mo against a ~${money(fplFor(hh)/12)}/mo limit — worth a check (savings must be under $${SNAP_ASSET_ELDERLY.toLocaleString()}).`; }
    else if(sixty){ w = `Over the ~${money(lim)} gross limit, and even after the medical and housing deductions seniors get, net income (~${money(netMo)}/mo) is over the ~${money(fplFor(hh)/12)}/mo limit${(A.assets!=null && assets>SNAP_ASSET_ELDERLY)?` (savings are also over the $${SNAP_ASSET_ELDERLY.toLocaleString()} limit)`:""}.`; }
    else { w = `Income above ~${money(lim)} for a household of ${hh}.`; }
    if(s!=="no" && age>=55 && age<65 && !disabled && A.working!=="yes"){ w += " Note: adults 55–64 without a disability may face SNAP work rules and time limits — ask DTA."; }
    // 7 CFR 273.1: "Individuals must be considered residents of an institution when the institution provides them with the majority of
    // their meals (over 50 percent of three meals daily)" — ineligible, with narrow exceptions. The screener doesn't ask about meals.
    if(s!=="no" && A.alRes==="yes"){ s="maybe"; w += " In assisted living: if the residence provides most meals (more than half of three meals a day), federal rules usually count it as an institution and SNAP isn't available — ask DTA about the specific residence."; }
    if(!citizenOK()){ s="no"; w="SNAP needs U.S. citizen or qualified-immigrant status — verify before applying."; }
    const hip = s!=="no" ? ` SNAP households also get HIP automatically: up to $${homeHH>=6?80:(homeHH>=3?60:40)}/mo back for fruits & vegetables bought at participating farms and markets.` : "";
    const shareNote = (s!=="no" && homeHH>hh) ? " (If they live with others and buy/prepare food together, the whole household applies together.)" : "";
    out.push({id:"snap",name:"SNAP (Food Assistance)",status:s,val:s==="no"?0:1200,valTxt:s==="no"?"—":"varies with income",why:w+` Amount depends on income and costs (maximum $${SNAP_MAX1}/mo for 1 person from Oct 1, 2026).`+hip+shareNote,
      form:"Online via DTAConnect or paper application.",forml:"https://www.mass.gov/snap-benefits-formerly-food-stamps",
      docs:["Proof of income","Housing + utility costs","Out-of-pocket medical expenses (60+ deduction)"],
      where:"Apply at DTAConnect.com (signing up online needs an email address you can open right then, for a code) or call the DTA Assistance Line, (877) 382-2363. Seniors can deduct medical expenses over $35/mo — push hard on this."});
  })();

  // 8. Medicare Savings Program (MA Buy-In) — no asset test in MA
  if(A.medicare==="yes"){
    const lim=MSP_INC[hh]||MSP_INC[2];
    const qmb = MSP_QMB[hh]||MSP_QMB[2];
    let s = inc<=lim?"likely":(inc<=lim+240?"maybe":"no");   // "maybe" only within the $20/mo general income disregard of the line
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
    const baseMapr = A.veteran==="spouse" ? VA_MAPR.spouse : (A.marital==="married" ? VA_MAPR.vet2 : VA_MAPR.vet1);
    const medDed = Math.max(0, med - 0.05*baseMapr);   // va.gov: deduct only medical costs above 5% of the BASIC MAPR ($872 / $1,141 / $584)
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

  // 9b. VA Veterans Pension / Survivors Pension WITHOUT Aid & Attendance (added 2026-09-27, gap audit #2).
  // Basic pension needs no care need: veteran 65+ (or permanently disabled); a surviving spouse who hasn't remarried has no age test.
  // MAPR minus countable income; medical costs (incl. Medicare premiums) above 5% of MAPR are deducted. va.gov pension/survivors rates, eff. 12/1/2025.
  if((A.veteran==="vet"||A.veteran==="spouse") && A.adl!=="yes" && A.wartime!=="no" && (A.veteran==="spouse" || age>=65 || disabled)){
    const wt = A.wartime==="yes", sp = A.veteran==="spouse";
    const mapr = sp ? VA_MAPR.spouse : (A.marital==="married" ? VA_MAPR.vet2 : VA_MAPR.vet1);
    const medDed = Math.max(0, med - 0.05*mapr);
    const countable = Math.max(0, inc - medDed);
    const est = Math.max(0, Math.round(mapr - countable));
    const nw = assets + inc;
    const nwKnown = A.assets!=null && A.assets!=="" && A.assets!=="unknown";
    const who2 = sp ? "surviving spouse of a wartime veteran" : "wartime veteran";
    let st, why;
    if(nwKnown && nw > VA_NETWORTH){ st="no"; why=`VA's net-worth limit is $${VA_NETWORTH.toLocaleString()} (savings + a year of income); this household is at ~${money(nw)}.`; }
    else if(est<=0){ st="no"; why=`Countable income (~${money(countable)}) is above the ~${money(mapr)}/yr pension limit. Medical costs — including Medicare premiums and other health insurance — are subtracted from income, so if those are higher than you entered, check again.`; }
    else if(!wt){ st="maybe"; why=`Could pay up to ~${money(est)}/yr IF the service included a wartime period (usually 90 days of active duty with at least 1 day in wartime) — confirm the dates on the DD-214.`; }
    else { st="likely"; why=`A ${who2} with income under the VA pension limit. VA pays the gap between countable income and ~${money(mapr)}/yr — about ${money(est)}/yr here. No need for help with daily activities; that's only for the larger Aid & Attendance rate.${sp?" The surviving spouse must not have remarried.":""}`; }
    out.push({id:"vapension",name: sp ? "VA Survivors Pension" : "VA Veterans Pension",status:st,val:(st==="likely")?est:0,
      valTxt: st==="no"?"—":`~${money(est)}/yr (limit ${money(mapr)})`,
      why: why,
      form: sp ? "VA Form 21P-534EZ (survivors pension)." : "VA Form 21P-527EZ (veterans pension).",forml: sp ? "https://www.va.gov/pension/survivors-pension/" : "https://www.va.gov/pension/eligibility/",
      docs:["DD-214 (shows the service dates)","Income and net-worth statement","Medical and insurance costs, including Medicare premiums — they lower countable income"].concat(sp?["Marriage certificate and the veteran's death certificate"]:[]),
      where:"File with the VA; a free accredited Veterans Service Officer or the town Veterans' Agent can do it with you — never pay someone to file."});
  }

  // 10. Social Security review (informational)
  {
    const tips=[];
    if(num(A.age)<70 && A.working==="no") tips.push("delaying claiming raises the monthly check ~8%/yr until 70");
    if(A.marital==="married") tips.push("a spousal benefit can be worth up to 50% of the higher earner's");
    if(A.marital==="widowed") tips.push("survivor benefits may pay more than the current check — worth checking");
    if(A.marital==="divorced") tips.push("if the marriage lasted at least 10 years, Social Security may pay benefits on the former spouse's record — ask about it");
    if(A.working==="yes" && num(A.age)<67) tips.push("the earnings test may be reducing the check while still working");
    // 2026-09-28 gap audit #2, verified on ssa.gov: SSA EM-25029 REV (default overpayment withholding changed from 10% to 50%,
    // effective April 25, 2025; a waiver or reconsideration request stops collection) + ssa.gov/forms/ssa-632.html (SSA-632 / SSA-634).
    const overpay = (num(A.incomeSS)>0 || A.incomeSS==="unknown") ? " Got a letter saying Social Security overpaid them? Since April 25, 2025, Social Security takes 50% of the monthly check by default to get it back. If they didn't cause the overpayment and can't afford to repay it, Form SSA-632 asks to have it waived; if they can repay but not at that rate, Form SSA-634 asks for a lower rate. Social Security stops collecting while it decides." : "";
    out.push({id:"ss",name:"Social Security Review",status:"maybe",val:0,valTxt:"strategy",
      why: (tips.length?("Worth a one-time look: "+tips.join("; ")+"."):"A one-time claiming/strategy review is usually worthwhile.")+overpay,
      form:"Free review with a fee-only advisor or SSA.",forml:"https://www.ssa.gov/myaccount/",
      docs:["my Social Security account statement","Spouse's or former spouse's earnings record (if married, widowed or divorced)"],
      where:"Open a my Social Security account to see the actual numbers. NOTE: this is information, not financial advice — confirm with a licensed advisor before changing anything."});
  }

  // 10b. Social Security Fairness Act (added 2026-09-27, gap audit #1). The Act (signed 1/5/2025) ended WEP and GPO. SSA:
  // "If you never applied for retirement due to WEP or spouse's or surviving spouse's benefits because of GPO: You may need to file an application."
  // Retroactivity is "generally limited to six months" — so every month of waiting costs money. ssa.gov/benefits/retirement/social-security-fairness-act.html
  if((A.pubPension==="yes"||A.pubPension==="unknown") && (age>=62 || (A.marital==="widowed" && age>=60))){
    const noSS = incSS<=0;
    out.push({id:"ssfa",name:"Social Security You May Never Have Claimed (Fairness Act)",status: noSS?"likely":"maybe",val:0,valTxt:"monthly Social Security",
      why:(noSS
        ? "A government pension that didn't pay into Social Security used to shrink or wipe out Social Security — so many teachers, police, firefighters and public workers (and their husbands, wives and widows) never applied. A 2025 law ended those rules. With a pension like that and no Social Security coming in yet, it's worth applying now: their own retirement benefit if they ever worked a job that paid into Social Security, or a spouse's or widow's benefit on a husband's or wife's record."
        : "A 2025 law ended the rules that cut Social Security for people with a government pension that didn't pay into it. Social Security raised checks it was already paying — but a spouse's or widow's benefit that was never applied for (because the old rules made it $0) has to be applied for now.")
        +" Back pay generally only reaches 6 months before the month you apply, so don't wait.",
      form:"Apply with Social Security.",forml:"https://www.ssa.gov/benefits/retirement/social-security-fairness-act.html",
      docs:["Social Security number (and the spouse's or late spouse's)","The government pension statement","Marriage certificate (and death or divorce papers, if they apply)"],
      where:"Call Social Security at 1-800-772-1213. Survivor (widow's) benefits can't be applied for online — it has to be by phone or at an office."});
  }

  // 11. MassHealth — REFER, never advise
  if(age>=65 && A.adl==="yes"){   // 2026-09-27: was also shown to anyone 65+ with <$100k savings and no care need
    out.push({id:"masshealth",name:"MassHealth / Long-Term Care",status:"refer",val:0,valTxt:"see an attorney",
      why:"Potentially major help with care costs — BUT eligibility & asset planning is legal work (5-year lookback, estate recovery). Don't DIY.",
      form:"Handled by an elder-law attorney.",forml:"https://www.mass.gov/masshealth",
      docs:["Bring a full asset/income picture to the consult"],
      where:"Refer to a licensed MA elder-law attorney — many offer a free first consult. This is the ONE area we do not advise on directly, by design."});
  }

  // 12. SSI (very low income + STRICT asset limit; aged 65+ or disabled)
  const ssiAssetCap = A.marital==="married"?3000:2000;
  const ssiFbr = SSI_FBR[hh]||SSI_FBR[2];
  const ssiAL = A.alRes==="yes";
  const ssiSsp = ssiAL ? (hh===2 ? 2172 : 1448) : (SSI_SSP[hh]||SSI_SSP[2]);
  const ssiIncScreen = ssiSsp*12 + 240;   // federal rate + MA State Supplement + the $20/mo general income exclusion (2026-09-27: was federal-only)
  if((age>=65 || disabled) && assets<=ssiAssetCap+1000 && inc<ssiIncScreen){
    const s = citizenOK()?"maybe":"no";
    out.push({id:"ssi",name:"Supplemental Security Income (SSI)",status:s,
      val: s==="no"?0:Math.round(12*Math.max(0, ssiSsp - Math.max(0, inc/12 - 20))),
      valTxt: s==="no"?"—":`~${money(Math.max(0, ssiSsp - Math.max(0, inc/12 - 20)))}/mo (federal + MA supplement)`,
      why: citizenOK()?`Income and assets look low enough to be worth a hard look. SSI has a STRICT countable-asset limit (~$${ssiAssetCap.toLocaleString()}) and pays up to ~$${ssiFbr.toLocaleString()}/mo federal (2026), and Massachusetts adds a State Supplement — ~${money(ssiSsp)}/mo in total for ${hh===2?"a couple":"someone"} ${ssiAL?"in assisted living (the state's assisted-living rate — ask the residence whether it qualifies)":"living independently"}. Some people with income a bit too high for federal SSI still qualify for the state supplement alone. Confirm exact countable assets & income — these limits are unforgiving, so this is a "verify," not a sure thing.${A.citizen==="qualified"?" Green-card holders generally also need 40 work quarters (plus a 5-year wait if they arrived after 8/22/1996), or a veteran connection.":""}`:"SSI needs U.S. citizen or qualified-immigrant status.",
      form:"Apply with the Social Security Administration.",forml:"https://www.ssa.gov/ssi/",
      docs:["Bank statements (asset limit is strict — ~$2,000 single / $3,000 couple)","Proof of income","ID & citizenship/immigration docs"],
      where:"Apply at ssa.gov or 1-800-772-1213. SSI in MA usually opens MassHealth automatically."});
  }

  // 13. Chapter 115 MA veterans' benefits (need-based; separate from the Cl.22 exemption)
  if((A.veteran==="vet"||A.veteran==="spouse") && inc <= 2*fplFor(hh)){   // 108 CMR 5: medical budget up to 200% of the current FPL
    out.push({id:"ch115",name:"MA Veterans' Benefits (Chapter 115)",status:"maybe",val:6000,valTxt:"need-based, can be substantial",
      why:"Need-based MA cash + medical benefit for low-income veterans and surviving spouses — separate from the property-tax exemption, and often missed. Income AND asset limits apply (roughly $31k single / $42k couple); medical-only help can apply a bit above that. The Veterans' Service Officer runs the exact budget.",
      form:"Through your city/town Veterans' Service Officer (VSO).",forml:"https://www.mass.gov/info-details/chapter-115-benefitssafety-net-program",
      docs:["DD-214","Income & asset statement","Proof of MA residency"],
      where:"Contact your municipal Veterans' Service Officer — every MA city/town has one; the service is free."});
  }

  // 14. Property tax deferral Clause 41A (owner 65+) — the income-too-high fallback
  if(owner && age>=65 && inc<=CB_INC.single && A.maYears!=="no"){   // above the highest limit a town can adopt, no town can grant it
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

  // 15b. Clause 18 hardship exemption (added 2026-09-27, gap audit #9). Statewide, but DISCRETIONARY: assessors may excuse all or part
  // of the tax for an owner who, by age, infirmity AND financial hardship, can't pay. State Tax Form 98 ("You must meet both age and
  // infirmity requisites"); owned and occupied as of July 1; filed by April 1 or 3 months after actual bills are mailed, if later.
  if(owner && age>=65 && (A.adl==="yes" || disabled || A.blind==="yes")){
    out.push({id:"cl18",name:"Hardship Property-Tax Exemption (Clause 18)",status:"maybe",val:0,valTxt:"part or all of the tax bill, if approved",
      why:"For an older homeowner with an illness or disability who is also struggling financially, the town's assessors can excuse part or all of the property tax. It's case by case — the board decides — so it's worth asking, especially if the regular senior exemptions aren't enough.",
      form:"State Tax Form 98 (to the town assessors).",forml:"https://www.mass.gov/lists/property-tax-forms-and-guides",
      docs:["Proof of age (birth certificate)","A doctor's description of the illness or disability","A picture of income, savings and monthly bills"],
      where:`${A.town||"Town"} Assessor. File by April 1, or within 3 months after the actual (not preliminary) tax bills are mailed, if that's later — the deadline can't be extended.`});
  }

  // 15b. Title V septic credit (added 2026-09-28). mass.gov "Massachusetts residential property tax credits": not a dependent, own and occupy
  // as principal residence; "The credit is 60% (.60) of the costs (not to exceed $30,000). The total amount of the credit cannot exceed
  // $18,000."; claimed for the year the work is completed; excess carries forward "for up to the next 5 tax years"; reduced by interest subsidies.
  if(owner && A.septic==="yes"){
    const dep = A.dependent==="yes";
    out.push({id:"septic",name:"Massachusetts Septic Repair Tax Credit (Title V)",status: dep?"no":"likely",val:0,valTxt: dep?"—":"60% of the cost, up to $18,000",
      why: dep ? "Someone claimed as a dependent on another person's return can't take this credit." :
        `Massachusetts gives a state tax credit of 60% of what they paid to repair or replace a failed septic system or cesspool — or for a Title 5-required upgrade or sewer hookup — on up to $30,000 of costs, so up to $18,000 in total. It's claimed on the state return for the year the work is finished. It only reduces tax owed, but anything left over carries forward for up to 5 more years${A.filing==="none"?" — since they don't file now, they'd need to file (and owe tax) to use it":""}. A low-interest septic loan or betterment reduces the credit by the interest savings. If the work finished last year and the credit wasn't claimed, an amended return can still claim it.`,
      form:"Schedule SC (Septic Credit) plus Schedule CMS (credit code SEPTIC), filed with the Massachusetts Form 1.",forml:"https://www.mass.gov/info-details/massachusetts-residential-property-tax-credits",
      docs:["Contractor invoices and proof of payment","The Certificate of Compliance (or, if there isn't one, a verification letter from the city or town)","Any septic loan or betterment paperwork"],
      where:"On the Massachusetts tax return for the year the work was completed (tax software or a preparer; free help through AARP Tax-Aide or VITA)."});
  }

  // 16. Prescription Advantage (MA pharmacy assistance; 65+ or disabled)
  // Existing members keep it: mass.gov "Prescription Advantage will stop accepting new applications after September 11, 2026. If you are
  // currently enrolled, your participation in the program will continue." (2026-09-28: members could not say so before.)
  if(alreadyList().includes("rxadv")){
    out.push({id:"rxadv",name:"Prescription Advantage (MA)",status:"have",val:0,valTxt:"keep it — renew",
      why:"✓ Already a member. New applications closed after September 11, 2026, but current members keep it — renew on time and report income changes so it doesn't lapse. The category on their letter (S0–S5) is set by income; S3 and below may also qualify for the Medicare Savings Program, which pays the Part B premium.",
      form:"Member forms (renewal, income change).",forml:"https://www.mass.gov/info-details/prescription-advantage-documents-and-resources",
      docs:["Prescription Advantage member card","Latest income information"],
      where:"MassOptions 1-800-243-4636, option 3 (Prescription Advantage questions)."});
  } else if(age>=65 || disabled){
    out.push({id:"rxadv",name:"Prescription Advantage (MA)",status:PA_OPEN?"maybe":"no",val:0,valTxt:PA_OPEN?"lowers drug costs":"closed to new applicants",
      why:PA_OPEN?"MA state pharmacy program that wraps around Medicare Part D.":"Massachusetts stopped accepting NEW Prescription Advantage applications after September 11, 2026. If already enrolled, keep renewing. New applicants: Extra Help (federal) and a free SHINE counselor are the paths for drug costs.",
      form:"Current members only (renewals).",forml:"https://www.mass.gov/info-details/prescription-advantage-documents-and-resources",
      docs:["Medicare card","Income info","Current drug list"],
      where:"Apply via mass.gov or a SHINE counselor; stacks on top of Part D / Extra Help."});
  }

  // 17. Utility low-income discount rate + arrearage forgiveness (income-eligible)
  if(A.housing!=="family"){
    const utilLim = HEAP_SMI60[homeHH]||HEAP_SMI60[10];
    if(homeInc<=utilLim || A.subsidized==="yes"){
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
        why:"Free insulation, air-sealing, and heating-system help for income-eligible homes (owners AND renters) — cuts heating bills long-term."+(A.housing==="own"?" If the furnace or boiler breaks or isn't safe, the same agency runs HEARTWAP, which repairs or replaces heating systems for homeowners at this income (sometimes with a co-payment).":""),
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

  // 20a. MassHealth Standard for 65+ living at home (added 2026-09-27; found by the independent answer key). mass.gov senior guide:
  // Standard is for people "with income at or below 100% of the federal poverty level"; countable assets $2,000 single / $3,000 couple.
  if(A.adl!=="yes" && age>=65 && (!alreadyList().includes("masshealth") || (A.haveAlso||[]).includes("mhcommunity")) && A.healthCov!=="masshealth" && inc <= fplFor(hh)){
    const assetsKnown = A.assets!=null && A.assets!=="" && A.assets!=="unknown";
    const cap = hh===2 ? 3000 : 2000;
    if(!assetsKnown || assets <= cap){
      out.push({id:"mhcommunity",name:"MassHealth Standard (full health coverage)",status: assetsKnown?"likely":"maybe",val:0,valTxt:"full coverage + Medicare costs",
        why:`With income under the poverty line (~${money(fplFor(hh))}/yr for ${hh===2?"a couple":"one person"}) and savings under $${cap.toLocaleString()}${assetsKnown?"":" (confirm savings)"}, a person 65+ can get MassHealth Standard on top of Medicare: it pays Medicare premiums and cost-sharing and adds coverage Medicare lacks, like dental and eyeglasses. It isn't long-term-care planning — no lawyer needed.`,
        form:"MassHealth senior application (SACA-2) — this site can pre-fill it.",forml:"https://www.mass.gov/info-details/masshealth-coverage-types-for-individuals-and-families-including-people-with-disabilities",
        docs:["Proof of income","Bank statements","Medicare card","ID and citizenship/immigration papers"],
        where:"Mail or fax the SACA-2 to MassHealth (the mailing page lists the address), or get free help from a SHINE counselor at 1-800-243-4636."});
    }
  }

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
    const rated = A.vaDis==="partial"||A.vaDis==="partial70"||A.vaDis==="full";
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
  // 25a. Already on MassHealth under 65: the 2027 work rules are aimed at exactly this group (mass.gov "New work and education
  // requirements for MassHealth members": "adults who are 19 through 64 years old AND do not have young children, a disability, or a
  // medical condition..."). Added 2026-09-28; before this, people already on MassHealth got no card at all.
  if(age<65 && A.medicare!=="yes" && (A.healthCov==="masshealth" || (A.healthCov!=="employer" && alreadyList().includes("masshealth")))){
    out.push({id:"health6064",name:"Keeping MassHealth in 2027: New Work Rules",status:"maybe",val:0,valTxt:"keep the coverage",
      why:`Already on MassHealth. ${MH_WORK_RULES}${disabled?" With a disability they're likely excused — MassHealth decides, so answer the renewal notice.":""} Open the renewal notice as soon as it comes — coverage can end if it isn't answered.`,
      form:"Nothing to file now — answer the MassHealth renewal notice when it arrives.",forml:"https://www.mass.gov/info-details/new-work-and-education-requirements-for-masshealth-members",
      docs:["Proof of work, volunteering or training hours, or of the reason they're excused (for example a disability)"],
      where:"MassHealth customer service: (800) 841-2900."});
  }
  else if(age<65 && A.medicare!=="yes" && A.healthCov!=="employer" && A.healthCov!=="masshealth"){
    const f = fplFor(hh), pct = inc/f;
    let st, why, name="Health Coverage Before Medicare";
    if(A.healthCov==="connector"){ st="have"; why="Already on a Health Connector plan. Re-check it during open enrollment (starts Oct 23, 2026) — income changes can move you to a cheaper ConnectorCare tier."; }
    else if(pct<=1.33){ st="likely"; why=`Income (~${money(inc)}) is at or under 133% of poverty — MassHealth (CarePlus/Standard) coverage, with no premium. ${MH_WORK_RULES}`; }
    else if(pct<=4.0){ st="likely"; why=`Income (~${money(inc)}) is between 100% and 400% of poverty — ConnectorCare plans with low or $0 premiums (2026 plan year).`; }
    else { st="maybe"; why=`Income is above 400% of poverty (~${money(4*f)}), so the 2026 federal premium help no longer applies — full-price Connector plans are still available, and a broker or navigator can compare.`; }
    if(disabled) why += " With a disability, MassHealth CommonHealth can also cover people whose income is too high for regular MassHealth.";
    if(age>=64) why += " Turning 65 soon: sign up for Medicare on time — the Part B late penalty is 10% for each year you could have enrolled and didn't.";
    out.push({id:"health6064",name,status:st,val:0,valTxt:"health coverage",why:why+" Open enrollment for 2027 runs Oct 23 – Dec 23, 2026 (Dec 23 for Jan 1 coverage).",
      form:"Apply through the Massachusetts Health Connector (one application covers MassHealth and ConnectorCare).",forml:"https://www.mahealthconnector.org/learn/plan-information/connectorcare-plans",
      docs:["Proof of income","Social Security numbers","Current coverage information, if any"],
      where:"MAhealthconnector.org or 1-877-623-6765; free in-person help from Navigators."});
  }

  // 23b. CHAMPVA (added 2026-09-27, catalog click-through #1). va.gov: spouse of a veteran "rated permanently and totally disabled from a
  // service-connected disability", or surviving spouse of a veteran who "died from a service-connected disability" or was P&T-rated at death;
  // not eligible if TRICARE-eligible; at Medicare age must have Parts A and B (or Medicare Advantage). "CHAMPVA is a cost-sharing program." Form 10-10d.
  if(A.veteran==="spouse" || (A.veteran==="vet" && A.marital==="married" && A.vaDis==="full")){
    const sp = A.veteran==="spouse";
    out.push({id:"champva",name: sp ? "VA Health Coverage for a Veteran's Widow or Widower (CHAMPVA)" : "VA Health Coverage for the Veteran's Spouse (CHAMPVA)",status:"maybe",val:0,valTxt:"VA shares health costs",
      why:(sp
        ? "If the veteran died from a service-connected condition, or was rated permanently and totally disabled when they died, the surviving spouse can get CHAMPVA — the VA shares the cost of health care and supplies. It's separate from the monthly DIC payment."
        : "Because the veteran's rating is 100%, their husband or wife may get CHAMPVA — VA health cost-sharing — IF the rating is permanent and total (the VA letter says so).")
        +" Not available to anyone who can get TRICARE. At 65 or older, they need Medicare Part A and Part B (or a Medicare Advantage plan) to keep it.",
      form:"VA Form 10-10d (Application for CHAMPVA Benefits).",forml:"https://www.va.gov/family-and-caregiver-benefits/health-and-disability/champva/",
      docs:["The veteran's VA rating letter"+(sp?" and death certificate":""),"Marriage certificate","Medicare card (if 65 or older)"],
      where:"Apply online at va.gov or by mail. A free Veterans Service Officer or the town Veterans' Agent can help."});
  }

  // 23c. VA-paid help at home (catalog click-through #2): Veteran-Directed Care ("given a budget ... hire their own workers", which "might
  // include their own family member or neighbor") and Respite Care ("pays for care for a short time when family caregivers need a break").
  // Both: "All enrolled Veterans are eligible ... if they meet the clinical criteria ... and it is available. Services vary by location."
  if(A.veteran==="vet" && A.adl==="yes"){
    out.push({id:"vahomecare",name:"VA-Paid Help at Home for the Veteran",status:"maybe",val:0,valTxt:"paid in-home help",
      why:"Veterans enrolled in VA health care who need help with daily activities can get the VA to pay for care at home. Veteran-Directed Care gives a budget to hire their own helpers — which can include a family member or neighbor — and Respite Care pays for someone to come in (or for adult day health care) so a family caregiver can take a break. Services vary by location, and respite can carry a copay.",
      form:"Ask the veteran's VA social worker or care team.",forml:"https://www.va.gov/GERIATRICS/pages/Veteran-Directed_Care.asp",
      docs:["VA health care enrollment (apply at va.gov if not enrolled)","A list of the daily help needed"],
      where:"The veteran's VA medical center social worker. Not enrolled in VA health care yet? A Veterans Service Officer can help with that first."});
  }

  // 23d. VA HISA home-change grant (catalog click-through #3). prosthetics.va.gov: lifetime $6,800 for a service-connected disability (or any
  // disability if rated at least 50%); $2,000 otherwise. Needs a VA physician's prescription; excludes porch lifts, stair glides, routine repairs.
  if(A.veteran==="vet" && (A.adl==="yes" || disabled)){
    const hisaHi = A.vaDis==="partial" || A.vaDis==="partial70" || A.vaDis==="full";
    out.push({id:"hisa",name:"VA Grant for Home Changes (HISA)",status:"maybe",val:0,valTxt: hisaHi ? "up to $6,800 (lifetime)" : "up to $2,000 (lifetime)",
      why:"A VA grant (not a loan) for medically needed changes to the veteran's home — getting in and out, a roll-in shower, lower counters and sinks, permanent ramps. It's $6,800 over a lifetime for a service-connected disability (or for any disability if the rating is at least 50%), and $2,000 for other disabilities. It doesn't cover porch lifts, stair glides or routine repairs.",
      form:"HISA application with a prescription from a VA doctor.",forml:"https://www.prosthetics.va.gov/psas/HISA2.asp",
      docs:["A prescription from a VA doctor for the change","A written, itemized contractor estimate","A color photo of the area to be changed","Renters: a signed, notarized OK from the owner"],
      where:"Ask the VA doctor, or the Prosthetic and Sensory Aids Service at the local VA medical center."});
  }

  // 23e. VA caregiver stipend, PCAFC (batch 2, 2026-09-27). va.gov: the veteran has "a VA disability rating ... of 70% or higher",
  // "needs at least 6 months of continuous, in-person personal care services", "needs to be enrolled in VA health care";
  // Primary Family Caregivers may receive "A monthly stipend (payment)", CHAMPVA, "At least 30 days of respite care per year". VA Form 10-10CG.
  if(A.veteran==="vet" && (A.vaDis==="partial70"||A.vaDis==="full") && A.adl==="yes"){
    out.push({id:"pcafc",name:"VA Stipend for the Family Caregiver (PCAFC)",status:"maybe",val:0,valTxt:"monthly stipend to the caregiver",
      why:"With a VA rating of 70% or more and a need for in-person personal care for at least 6 months, the family member who provides that care can apply to be the veteran's Primary Family Caregiver. The VA can then pay the caregiver a monthly stipend, and give health coverage through CHAMPVA if they have none, at least 30 days of respite a year, and training. The veteran must be enrolled in VA health care.",
      form:"VA Form 10-10CG (joint application by the veteran and the caregiver).",forml:"https://www.va.gov/family-and-caregiver-benefits/health-and-disability/comprehensive-assistance-for-family-caregivers/",
      docs:["The veteran's VA rating letter","Details of the daily care provided"],
      where:"Apply online at va.gov, by mail, or with the Caregiver Support team at the local VA medical center. A Veterans Service Officer can help for free."});
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
      why:(A.alRes==="yes"?"In assisted living, MassHealth does NOT pay Adult Foster Care (MassHealth rule 130 CMR 408.437) — there, Group Adult Foster Care is how MassHealth pays for daily help (see that card). The rest applies only if they move home with a relative: ":"")+"If they qualify for MassHealth (Standard or CommonHealth, or SCO/PACE), MassHealth can pay a relative who lives with them and gives daily care through Adult Foster Care — adult children, siblings and other relatives can be paid; a spouse cannot. The Personal Care Attendant program can also pay relatives other than a spouse.",
      form:"Through a MassHealth Adult Foster Care provider or a PCA agency.",forml:"https://www.mass.gov/info-details/masshealth-adult-foster-care-program-fact-sheet",
      docs:["MassHealth eligibility (or an application)","A doctor's statement of care needs"],
      where:"Ask the local ASAP (MassOptions 800-243-4636) or an Adult Foster Care provider. MassHealth eligibility comes first — see the other MassHealth cards. Paying for care out of pocket instead? On a federal tax return that itemizes, medical costs above 7.5% of adjusted gross income can be deducted, including qualified long-term care services — and an adult child who could claim the parent as a dependent except for the parent's income can count the parent's costs too (IRS Publication 502)."});
  }

  // 27b. Group Adult Foster Care — assisted living (added 2026-09-28)
  if(A.alRes==="yes" && A.adl==="yes" && age>=22){
    const mhHas = alreadyList().includes("masshealth") || A.healthCov==="masshealth";
    const assetsKnown = A.assets!=null && A.assets!=="" && A.assets!=="unknown", cap = hh===2 ? 3000 : 2000;
    let st=null, lead="";
    if(mhHas){ st="likely"; lead="They're already on MassHealth — if it's MassHealth Standard or CommonHealth, this is open to them now."; }
    else if(age>=65 && inc<=fplFor(hh) && (!assetsKnown || assets<=cap)){ st=assetsKnown?"likely":"maybe"; lead=`At this income (under ~${money(fplFor(hh))}/yr) and ${assetsKnown?"savings":"if savings are under $"+cap.toLocaleString()}, MassHealth Standard looks within reach — apply for that first.`; }
    else if(age<65 && disabled){ st="maybe"; lead="With a disability, MassHealth CommonHealth has no upper income limit (a premium may apply) — that opens this program."; }
    if(st) out.push({id:"gafc",name:"MassHealth Help With Daily Care in Assisted Living (GAFC)",status:st,val:0,valTxt:"personal care paid by MassHealth",
      why:`${lead} MassHealth's Group Adult Foster Care pays for help with daily activities — bathing, dressing, getting around, medication reminders — with a nurse and case manager overseeing the care, delivered where they live. It's for adults who need hands-on help or reminders with at least one daily activity and qualify for MassHealth Standard or CommonHealth. Many assisted living residences work with a GAFC agency; ask the residence.`,
      form:"Through a GAFC agency (the assisted living residence can usually connect you) — MassHealth eligibility comes first.",forml:"https://www.mass.gov/info-details/masshealth-group-adult-foster-care-program-fact-sheet",
      docs:["MassHealth card or application","A doctor's note on the daily help needed"],
      where:"Ask the assisted living residence which GAFC agency it works with, or call MassHealth customer service: (800) 841-2900."});
  }

  // 28. Home-delivered meals (Elder Nutrition Program) — 60+, frail/isolated/homebound, no income limit
  if(A.adl==="yes" && age>=60){
    out.push({id:"meals",name:"Home-Delivered Meals (Meals on Wheels)",status:"likely",val:0,valTxt:"free or low-cost meals",
      why:"Adults 60+ who are frail, isolated or homebound can get home-delivered meals — there is no income limit. A spouse or caregiver can get meals too.",
      form:"Sign up through the local ASAP / Elder Nutrition Program.",forml:"https://www.mass.gov/info-details/senior-nutrition-program",
      docs:["Basic contact information"],
      where:"Call MassOptions at 800-243-4636 to reach the local program."});

  }

  // 28d. Family Caregiver Support (+ PFML). mass.gov FCSP eligibility: the care recipient is an "Individual age 60 or older, OR individual
  // of any age who is living with Alzheimer's" disease or a related dementia. (2026-09-27: was only shown for ADL + 60+.)
  if((A.adl==="yes" && age>=60) || A.dementia==="yes"){
    out.push({id:"caregiver",name:"Family Caregiver Support (free respite)",status:"maybe",val:0,valTxt:"free help for the caregiver",
      why:"If a family member cares for them without pay, the Family Caregiver Support Program is free for that caregiver: respite breaks, training, counseling and help finding services. And if that family member has a job covered by Massachusetts Paid Family and Medical Leave, they can take up to 12 weeks of paid leave a year to care for a parent, spouse, grandparent or other family member with a serious health condition (up to $1,230.39 a week in 2026; a health care provider must certify the condition, and there's a 7-day wait before payments start).",
      form:"Through the local ASAP.",forml:"https://www.mass.gov/info-details/family-caregiver-support-program",
      docs:["None to start — just a call"],
      where:"MassOptions 800-243-4636."});
  }

  // 28a. REquipment (catalog click-through #4). dmereuse.org: "Find free, gently used, durable home medical equipment and assistive
  // technology ... delivered to people of all ages throughout Massachusetts. No prescription necessary." Main office (508) 713-9690 (dmereuse.org/contact-us, read 2026-10-05; the 1-800-261-9841
  // listed here before is not on either REquipment site, only third-party directories).
  if(A.adl==="yes" || disabled || A.blind==="yes"){
    out.push({id:"requip",name:"Free Medical Equipment (REquipment)",status:"likely",val:0,valTxt:"free, gently used",
      why:"Anyone in Massachusetts can get free, cleaned and refurbished home medical equipment — wheelchairs, walkers, shower chairs, big-button phones and more. No prescription is needed. Handy for things Medicare doesn't cover, like shower chairs. There may be a fee for delivery or pickup.",
      form:"Search the inventory online or call.",forml:"https://dmereuse.org/",
      docs:["None — just what's needed"],
      where:"REquipment: dmereuse.org or (508) 713-9690."});
  }

  // 28b. Community group meals (added 2026-09-27, gap audit #20) — any adult 60+, no income limit, 325+ sites (mass.gov Senior Nutrition Program)
  if(age>=60){
    out.push({id:"commmeals",name:"Free or Low-Cost Community Meals (60+)",status:"likely",val:0,valTxt:"hot meals + company",
      why:"Any adult 60 or older can eat community meals at senior centers, Councils on Aging, senior housing and other sites — more than 325 locations in Massachusetts, with no income limit. A spouse can come too.",
      form:"Just call to reserve a seat.",forml:"https://www.mass.gov/info-details/senior-nutrition-program",
      docs:["None"],
      where:`Ask the ${A.town||"town"} Council on Aging, or call MassOptions at 1-800-243-4636.`});
  }

  // 28c. Medicare GUIDE dementia model (batch 2). cms.gov: "respite services up to $2,500 annually", care navigation, 24/7 support line,
  // caregiver training; began July 1, 2024 and runs 8 years. Fact sheet: doctor's referral confirmed by a GUIDE doctor; "Medicare is your
  // primary insurance, including enrollment in Medicare Parts A and B"; not in Medicare hospice or PACE; not living in a long-term nursing home.
  if(A.dementia==="yes" && A.medicare==="yes"){
    out.push({id:"guide",name:"Medicare Dementia Care Program (GUIDE)",status:"maybe",val:0,valTxt:"up to $2,500/yr of respite + a care team",
      why:"Medicare's GUIDE program gives people with dementia a care team, a care navigator, a 24/7 support line and training for the family caregiver — plus up to $2,500 a year for respite (in-home help, adult day programs or a short stay) so the caregiver can get a break. It needs a doctor's referral confirmed by a GUIDE doctor, Medicare Parts A and B as the main insurance, and not being in hospice, PACE or a long-term nursing home.",
      form:"A referral from the doctor to a GUIDE program.",forml:"https://www.cms.gov/priorities/innovation/innovation-models/guide",
      docs:["Medicare card","The dementia diagnosis from the doctor"],
      where:"Ask the doctor about a GUIDE program, or call 1-800-MEDICARE (1-800-633-4227) to find one nearby."});
  }

  // 29. Medicare plan check-up (annual open enrollment) — dates/cap from Medicare & You 2027; Medigap rule 211 CMR 71.10 (medical factsheet §4)
  if(A.medicare==="yes"){
    out.push({id:"medicareoe",name:"Medicare Plan Check-Up (Oct 15 – Dec 7)",status:"maybe",val:0,valTxt:"often lowers drug & plan costs",
      why:"Plans change their drug lists, costs and doctor networks every year. From October 15 to December 7, 2026, anyone on Medicare can switch plans for 2027 (the new plan starts January 1). In 2027, out-of-pocket costs for covered drugs are capped at $2,400. Someone in a Medicare Advantage plan also gets one change between January 1 and March 31. In Massachusetts, Medigap plans can't turn anyone down or charge more because of their health. A free SHINE counselor compares plans and doesn't sell insurance.",
      form:"Compare on Medicare's Plan Finder, or book a free SHINE appointment.",forml:"https://www.mass.gov/shine-program",
      docs:["Medicare card","Every prescription, with the dose and how often","The pharmacy they use","Doctors they want to keep"],
      where:"Medicare Plan Finder: medicare.gov/plan-compare. SHINE (free, unbiased): (800) 243-4636. The Medicare plan check-up sheet on this page keeps the list in one place."});
  }

  // 30. Unclaimed property — everyone
  out.push({id:"unclaimed",name:"Unclaimed Money: the State, Old Pensions & Life Insurance",status:"maybe",val:0,valTxt:"one in ten people have some",
    why:"There's no single place to look for money you're owed, so check each of these (all free): the Massachusetts Treasurer holds old bank accounts, uncashed checks and insurance payouts; every other state you've lived in has its own list; the federal PBGC holds pensions from company plans that ended; the Labor Department's Lost and Found finds old 401(k)s and pensions; and the free NAIC Life Insurance Policy Locator finds a late relative's life insurance policies."+(A.marital==="widowed"?" For a widow or widower, the life-insurance search and the late spouse's old accounts are especially worth it.":""),
    form:"Free search and claim at FindMassMoney.gov.",forml:"https://www.mass.gov/how-to/find-unclaimed-property",
    docs:["ID","Past addresses and old employers","For a late relative: the death certificate"],
    where:"Massachusetts: findmassmoney.gov or (617) 367-0400. Old company pensions: pbgc.gov (\"Find unclaimed retirement benefits\") or 1-800-400-7242. Old 401(k)s and pensions: lostandfound.dol.gov (needs a Login.gov account). Life insurance: the NAIC Life Insurance Policy Locator at naic.org. All free — never pay a \"finder\" to claim it."});

  // 31. For the family member who claims them as a dependent: MA Child and Family Tax Credit
  if(A.dependent==="yes" && age>=65){
    out.push({id:"cftc",name:"For the Family Member Who Claims Them: MA Child & Family Tax Credit",status:"likely",val:0,valTxt:"$440/yr (refundable, to the caregiver)",
      why:"Whoever claims them as a dependent can get the Massachusetts Child and Family Tax Credit — $440 per dependent aged 65+, refundable. Trade-off: while they're claimed as a dependent, THEY can't get the Circuit Breaker (up to $2,820). If their property tax or rent is high, the Circuit Breaker may be worth more — compare both. On the federal return, the same family member may also get the $500 Credit for Other Dependents (it lowers tax owed but isn't refunded), and if they pay for care so they can work, the Child and Dependent Care Credit can apply when the parent can't care for themselves and lives with them more than half the year. If their job offers a Dependent Care FSA, it can pay for that same care (adult day care, for example) with pre-tax money — the limit rose from $5,000 to $7,500 for 2026 (IRS Publication 15-B).",
      form:"Claimed on the family member's MA Form 1 (and federal Form 1040).",forml:"https://www.mass.gov/info-details/massachusetts-child-and-family-tax-credit",
      docs:["The dependent's information on the family member's return"],
      where:"On the family member's own Massachusetts tax return."});
  }


  // ================= Batch 2 (2026-09-25, from the coverage review; each fact verified on the cited page) =================

  // 32. Senior public housing / vouchers — renters with a heavy rent burden
  const hH = hudFor(A.town), hLim = hH ? hH.l80[Math.min(homeHH,8)-1] : null;
  if(renter && A.subsidized!=="yes" && (olderAge>=60 || disabled) && num(A.rent)>0 && (inc<=0 || (num(A.rent)*12)/inc > 0.30) && !(hLim && homeInc > hLim)){
    const burden = inc>0 ? Math.round(100*num(A.rent)*12/inc) : 100;
    out.push({id:"housing",name:"Senior Public Housing & Rental Vouchers",status:"maybe",val:0,valTxt:"rent at about 30% of income",
      why:`${inc>0?`Rent takes about ${burden}% of income.`:"With no income reported, rent is the whole burden."} Massachusetts public housing for older adults and people with disabilities, and MRVP rental vouchers (income up to 80% of area median), generally set rent at about 30% of income. Waiting lists are long, so getting on them NOW matters. Note: the state's Section 8 mobile-voucher waiting list has been closed since January 13, 2025 — public housing (through CHAMP) and MRVP are the open paths; some local housing authorities keep their own lists.`,
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
    const lim60 = HEAP_SMI60[homeHH]||HEAP_SMI60[10], lim80 = MASSSAVE_ENH80[homeHH]||MASSSAVE_ENH80[10];
    if(homeInc>lim60 && homeInc<=lim80){
      out.push({id:"energy6080",name:"Energy Help Just Above the Fuel-Assistance Limit",status:"maybe",val:0,valTxt:"one-time grant + low/no-cost upgrades",
        why:`Household income is a little over the Fuel Assistance limit, but between 60% and 80% of state median income. That opens: (1) the Salvation Army's Good Neighbor Energy Fund — a one-time grant when a month's energy bill is a hardship (call 800-334-3047, or 800-262-1320 in area code 413); and (2) Mass Save's moderate-income offers — insulation, air-sealing and heating upgrades for up to no cost. A Mass Save Home Energy Assessment is free for any 1–4 unit home.`,
        form:"Good Neighbor: through the Salvation Army. Mass Save: book a free Home Energy Assessment.",forml:"https://www.mass.gov/info-details/learn-about-home-energy-assistance-heap-0",
        docs:["Proof of household income","A recent energy bill"],
        where:"Good Neighbor Energy Fund: 800-334-3047 (area code 413: 800-262-1320). Mass Save: book online at masssave.com."});
    }
  }

  // 35. Senior food extras: farmers-market coupons (SFMNP) + CSFP food boxes
  if(olderAge>=60){
    const SFMNP={1:29526,2:40034};   // Jul 1 2026 – Jun 30 2027, mass.gov
    // These count the whole HOUSEHOLD (everyone who lives and eats together), not just the person + spouse.
    const fh = homeHH, finc = homeInc;
    const sf = SFMNP[fh]||Math.round(1.85*fplFor(fh)), csfp = Math.round(1.5*fplFor(fh));
    if(finc<=sf){
      out.push({id:"seniorfood",name:"Senior Food Extras (Farmers-Market Coupons, Food Boxes)",status:"maybe",val:0,valTxt:"free produce + monthly food box",
        why:`Adults 60+ under ~${money(sf)} (household of ${fh}) can get Senior Farmers Market coupons each summer while the season's supply lasts.${finc<=csfp?` At this income (under ~${money(csfp)}), the federal senior food box program (CSFP) is also available — a free monthly box of groceries through local food banks and Councils on Aging.`:""}`,
        form:"Coupons: apply through the state program. Food box: through the local food bank or Council on Aging.",forml:"https://www.mass.gov/info-details/applying-for-senior-farmers-market-nutrition-program-coupons",
        docs:["Proof of age","Proof of income"],
        where:"Ask the local Council on Aging — they usually hand out coupons and know the food-box sites."});
    }
  }

  // ================= Medical help (2026-09-26; every fact from reviews/2026-09-26_medical_factsheet.md, fetched that day) =================

  // 36. Health Safety Net — pays hospital & community-health-center bills; any age; income up to 300% of poverty (101 CMR 613)
  (()=>{
    const has=alreadyList();
    if(has.includes("masshealth") || A.healthCov==="masshealth") return;   // MassHealth itself covers these bills
    const f=fplFor(hh), pct=inc/f, lim150=Math.round(1.5*f), lim300=Math.round(3*f);
    const mc=A.medicare==="yes", priv=A.healthCov==="employer";
    const pays = mc ? " With Medicare, it pays the Medicare copays, coinsurance and deductibles."
               : (priv ? " Alongside a job or retiree plan, it pays only for services the plan doesn't cover — not the plan's copays." : "");
    const common=" It works only at Massachusetts hospitals and community health centers, and doctors at many hospitals bill separately (HSN doesn't cover those doctor bills). There's no card, and it renews every year.";
    let st, why, name="Health Safety Net (hospital & health-center bills)";
    if(mc && has.includes("msp")){ st="have"; why="✓ Comes with the Medicare Savings Program they already get: it pays Medicare copays, coinsurance and deductibles at Massachusetts hospitals and community health centers. Tell the billing office they have Health Safety Net."+common; }
    else if(pct<=1.5){ st=priv?"maybe":"likely"; why=`Income (~${money(inc)}) is under ~${money(lim150)} for a household of ${hh}, so Health Safety Net has no deductible.`+pays+common; }
    else if(pct<=3){ st="maybe"; why=`Income (~${money(inc)}) is under the ~${money(lim300)} limit for a household of ${hh}. At this income it's "Partial" Health Safety Net: it pays after a yearly deductible that depends on income.`+pays+common; }
    else {
      const thr = pct<=3.05?0.15:pct<=4.05?0.20:pct<=6.05?0.30:0.40;   // Medical Hardship: bills over this share of income (101 CMR 613.05)
      if(!(med>0 && med>thr*inc)) return;
      st="maybe"; name="Health Safety Net: Medical Hardship (big medical bills)";
      why=`Income is over the regular Health Safety Net limit, but medical bills (~${money(med)} a year) are more than ${Math.round(thr*100)}% of income. "Medical Hardship" works at any income and can pay hospital and health-center bills from the past 12 months. It's a one-time decision, not ongoing coverage.`;
    }
    if(mc && st!=="have" && name.indexOf("Hardship")<0 && inc<=(MSP_INC[hh]||MSP_INC[2])) why+=" Applying for the Medicare Savings Program gets this too — the same application.";
    out.push({id:"hsn",name,status:st,val:0,valTxt:st==="have"?"already included":"pays hospital & health-center bills",why,
      form: age>=65 ? "The MassHealth senior application (SACA-2) — it checks MassHealth, the Medicare Savings Program and Health Safety Net together." : "The Massachusetts health coverage application (ACA-3, or online through the Health Connector) — it checks MassHealth and Health Safety Net together.",
      forml:"https://www.mass.gov/info-details/health-safety-net-for-patients",
      docs:["Proof of income (Social Security letter, pension statements)","Proof of Massachusetts address","ID","Hospital or health-center bills, if asking about past bills"],
      where:"Apply through MassHealth — customer service (800) 841-2900. No tax return is needed to apply. Keep receipts toward any deductible yourself; HSN doesn't track it."});
  })();

  // 37. Rides to medical appointments
  if(age>=60 || disabled || A.veteran==="vet"){
    const t=townLookup(A.town);
    const mh=alreadyList().includes("masshealth") || A.healthCov==="masshealth";
    const bits=[];
    if(mh) bits.push("MassHealth Standard, CommonHealth and CarePlus members who can't use the bus or a car get free rides to medical and dental appointments — the doctor's office asks for them online (a \"PT-1\"). The Medicare Savings Program alone doesn't include rides.");
    if(age>=60) bits.push("Councils on Aging often run rides to appointments for people 60+ — each town sets its own rules.");
    if(disabled) bits.push("With a disability that makes buses and trains hard, door-to-door paratransit is available: The RIDE around Boston ($3.35 a trip, $1.70 with a senior card), or the local transit authority's version elsewhere (by law no more than twice the bus fare).");
    if(A.veteran==="vet") bits.push("Veterans enrolled in VA health care can get free rides to VA appointments (VetRide, or DAV vans in some areas), and some get mileage paid back.");
    if(A.medicare==="yes") bits.push("Some Medicare Advantage plans include rides — check the plan's benefits.");
    const coa = t&&t.coa ? `${t.coa.n||"The Council on Aging"}${t.coa.p?` — <a href="tel:${t.coa.p.replace(/[^0-9+]/g,"")}">${t.coa.p}</a>`:""}` : "the town Council on Aging";
    out.push({id:"rides",name:"Rides to Medical Appointments",status:"maybe",val:0,valTxt:"free or low-cost rides",
      why:bits.join(" "),
      form: mh ? "The doctor's office submits a PT-1 request; then book the ride." : "Call to register — rules vary by town and program.",
      forml: mh ? "https://www.mass.gov/info-details/get-a-ride-to-masshealth-medical-appointments" : "https://www.mass.gov/info-details/health-care-transportation",
      docs:["Appointment dates and addresses","MassHealth or Medicare card","Proof of disability, for paratransit"],
      where:`Start with ${coa}.`+(mh?` MassHealth rides: MART (866) 834-9991 or GATRA (800) 431-1713 — book at least 3 days ahead.`:"")+(disabled?` The RIDE: (617) 337-2727 (needs an in-person assessment).`:"")+(A.veteran==="vet"?` VA: ask the transportation office at the VA clinic, or request a ride through VetRide on va.gov.`:"")});
  }

  // 38. Dental, glasses & hearing aids — Original Medicare doesn't cover them
  if(age>=60 || A.medicare==="yes"){
    const mh=alreadyList().includes("masshealth") || A.healthCov==="masshealth";
    const hsnOK = !isUnknown("incomeSS") && !isUnknown("incomeOther") && inc <= 3*fplFor(hh);
    let why;
    if(mh) why="MassHealth (Standard, CommonHealth, CarePlus or Family Assistance) covers adult dental — cleanings, fillings, root canals, crowns and dentures — up to $1,750 a year (a new limit since August 1, 2026; certain emergency care, extractions and first full dentures after extractions are still covered past it). It also pays for an eye exam and glasses every 24 months, and hearing aids. The Medicare Savings Program alone covers none of these.";
    else why=`${A.medicare==="yes"?"Original Medicare doesn't pay for routine dental care, glasses or hearing aids, and Medigap generally doesn't either. ":""}Lower-cost options: the Tufts, BU and Harvard dental school clinics charge less than most private dentists (all three accept MassHealth); over-the-counter hearing aids need no prescription for mild to moderate hearing loss${A.medicare==="yes"?"; and some Medicare Advantage plans add dental, vision and hearing (compare during the fall plan check-up)":""}.${hsnOK?" At this income, Health Safety Net can also cover adult dental at a community health center (up to $1,750 a year).":""}`;
    out.push({id:"dvh",name:"Dental, Glasses & Hearing Aids",status:"maybe",val:0,valTxt:mh?"covered by MassHealth":"lower-cost options",why,
      form: mh ? "Covered with the MassHealth card — use a dentist or eye doctor who takes MassHealth." : "No application — call a clinic, or buy OTC hearing aids in a store or online.",
      forml: mh ? "https://www.mass.gov/info-details/learn-about-masshealth-dental-benefits" : "https://www.medicare.gov/coverage/dental-services",
      docs:["Insurance cards","A list of any dental or hearing problems"],
      where: mh ? "MassHealth dental customer service: (866) 616-2699 (finds dentists who take MassHealth)." : "Dental school clinics: Tufts (617) 636-6998 · BU (617) 358-8310 · Harvard (617) 432-1434 ext. 1. If hearing loss seems severe, see an audiologist or doctor rather than buying over the counter."});
  }

  // 39. EAEDC (added 2026-09-27, gap audit #17): state cash for people 65+ who aren't on SSI. Gross income limit $441.10/mo living alone
  // ($573.90 with a spouse), with shelter costs; citizen or eligible noncitizen; benefits go back to the application date. mass.gov EAEDC page.
  if(age>=65 && citizenOK() && inc/12 < (EAEDC_INC[hh]||EAEDC_INC[2])){
    out.push({id:"eaedc",name:"Emergency Aid to the Elderly (EAEDC cash)",status:"maybe",val:0,valTxt:"monthly state cash",
      why:`State cash help for people 65+ who aren't getting SSI. The gross income limit is $${(EAEDC_INC[hh]||EAEDC_INC[2]).toFixed(2)}/month ${hh===2?"for a couple":"for someone living alone"}, so it only fits very low incomes. If SSI is possible, apply for that first.${citizenNote()}`,
      form:"Apply with the Department of Transitional Assistance (DTA).",forml:"https://www.mass.gov/info-details/emergency-aid-to-the-elderly-disabled-and-children-eaedc",
      docs:["ID","Proof of income","Proof of rent or housing costs","Immigration papers, if not a citizen"],
      where:"Apply online at DTA Connect (signing up online needs an email address you can open right then, for a code) or call the DTA Assistance Line at (877) 382-2363."});
  }

  // 40. Federal tax refund for people who don't file (added 2026-09-27, gap audit #12). IRS: "taxpayers usually have three years to file
  // and claim their tax refunds. If they do not file within three years, the money becomes the property of the U.S. Treasury."
  if(A.filing==="none" && incOther>0){
    out.push({id:"irsrefund",name:"A Federal Tax Refund They Never Claimed",status:"maybe",val:0,valTxt:"any tax withheld, back",
      why:"If federal tax was taken out of a pension, an IRA withdrawal or a paycheck and no tax return was filed, the IRS may be holding a refund. You usually have three years to file and claim it — after that the money goes to the U.S. Treasury for good. In Massachusetts the median unclaimed refund for 2022 was $786.",
      form:"File the missing year's return (free help is available).",forml:"https://www.irs.gov/newsroom/time-is-running-out-to-claim-1-point-2-billion-in-refunds-for-tax-year-2022-taxpayers-face-april-15-deadline",
      docs:["Form 1099-R from the pension or IRA (shows tax withheld)","Form SSA-1099","Any W-2s"],
      where:"Free tax preparation for seniors: AARP Foundation Tax-Aide and the IRS's free volunteer sites — ask the Council on Aging where the nearest one is."});
  }

  // 41. Home Modification Loan Program (added 2026-09-27, gap audit #15). mass.gov: "All eligible borrowers receive a zero-interest
  // deferred-payment loan"; a household member with a disability or over 60; documentation of need; income-based requirements.
  if(owner && (age>=60 || disabled) && (A.adl==="yes" || disabled || A.blind==="yes")){
    out.push({id:"hmlp",name:"Zero-Interest Loan for Home Changes (HMLP)",status:"maybe",val:0,valTxt:"0% deferred-payment loan",
      why:"For ramps, stair lifts, bathroom and kitchen changes and other work that helps someone over 60 or with a disability keep living at home, the state's Home Modification Loan Program gives a zero-interest, deferred-payment loan. Income limits apply.",
      form:"Apply through the regional HMLP provider.",forml:"https://www.mass.gov/home-modification-loan-program-hmlp",
      docs:["Proof of ownership","A note from a doctor or therapist about the need","Contractor estimates","Proof of income"],
      where:"See the program page for the regional provider, or ask MassOptions at 1-800-243-4636."});
  }

  // 42. SCSEP paid job training (added 2026-09-27, gap audit #19). DOL: "Participants must be at least 55, unemployed, and have a family
  // income of no more than 125% of the federal poverty level." Paid at the highest of the federal, state or local minimum wage.
  const scsepInc = Math.max(0, homeInc - 0.25*incSS);   // TEGL 12-06: 25% of Social Security (title II) is not counted
  if(age>=55 && A.working==="no" && scsepInc <= 1.25*fplFor(homeHH)){   // "working" is only asked under 70
    out.push({id:"scsep",name:"Paid Part-Time Job Training for 55+ (SCSEP)",status:"maybe",val:0,valTxt:"paid community-service work",
      why:`A federal program that pays people 55+ who are out of work and have low income to train in community-service jobs (at a senior center, library, school or nonprofit) as a bridge to a regular job. The family income limit is 125% of the poverty line — about ${money(1.25*fplFor(homeHH))}/yr for ${homeHH===1?"one person":homeHH+" people"}. Veterans and people over 65 get priority.`,
      form:"Enroll with the local SCSEP provider.",forml:"https://www.dol.gov/agencies/eta/seniors",
      docs:["ID and proof of age","Proof of income"],
      where:"Ask a MassHire career center or the Council on Aging for the nearest SCSEP provider."});
  }

  // 43. RAFT emergency housing money (batch 2). mass.gov: "RAFT provides up to $7,000 per 12-month period ... for rent, utilities,
  // moving costs, and mortgage payments"; at risk of losing housing (Notice to Quit, eviction notice, behind on the mortgage, utility
  // shutoff notice ...); income "less than 50% of your city/town's Area Median Income (AMI)". Questions: Massachusetts 2-1-1.
  const raftH = hudFor(A.town), raftLim = raftH ? raftH.l50[Math.min(homeHH,8)-1] : null;
  if(A.housingCrisis==="yes" && !(raftLim && homeInc >= raftLim)){
    out.push({id:"raft",name:"Emergency Money to Keep Your Home (RAFT)",status: raftLim ? "likely" : "maybe",val:0,valTxt:"up to $7,000 a year",
      why:`When someone is behind on rent, mortgage or utilities — or has a notice to quit, an eviction or foreclosure notice, or a shutoff notice — RAFT can pay up to $7,000 in a 12-month period toward rent, utilities, moving costs or mortgage payments. Income must be under 50% of the town's area median income${raftLim?` — about ${money(raftLim)}/yr for ${homeHH===1?"one person":homeHH+" people"} in ${townLookup(A.town).name}`:" (check the town's limit on the application)"}. Apply quickly: a landlord also fills out a short form.`,
      form:"RAFT application (online, or through the regional agency).",forml:"https://www.mass.gov/how-to/apply-for-raft-emergency-help-for-housing-costs",
      docs:["The notice or past-due bill","Proof of income","Lease or mortgage statement","ID"],
      where:"Apply online at mass.gov (search 'RAFT'), or call Massachusetts 2-1-1 (dial 211, or 877-211-6277) for help finding the regional agency."+(allOld65()?" Behind on gas or electric? Because everyone in the home is 65 or older, tell the utility company that — it then needs the state Department of Public Utilities' written approval before it can shut service off. DPU consumer line: (877) 886-5066.":"")});
  }

  // 44. Lowering the Medicare income surcharge (IRMAA) after a big income drop (batch 2). ssa.gov: higher Part B/D premiums apply when MAGI
  // is "greater than $109,000" (single) / "$218,000" (joint); a new decision can be made if "You married or divorced, or your spouse died",
  // "You or your spouse stopped working or reduced your work hours" ...; "you may also use Form SSA-44 to request a reduction".
  if(A.incomeDrop==="yes" && A.medicare==="yes" && inc < (A.marital==="married" && A.filing==="joint" ? 750000 : 500000)){
    out.push({id:"irmaa",name:"Lower Medicare Premiums After an Income Drop (IRMAA)",status:"maybe",val:0,valTxt:"can remove a monthly surcharge",
      why:"Medicare adds a surcharge to the Part B and drug-plan premiums when income from 2 years earlier was over $109,000 (over $218,000 for a married couple filing jointly). If they're paying that extra and their income has since dropped because they retired or cut back work, married or divorced, or a spouse died, Social Security can recalculate it using the lower, current income.",
      form:"Form SSA-44 (Medicare Income-Related Monthly Adjustment Amount – Life-Changing Event).",forml:"https://www.ssa.gov/benefits/medicare/medicare-premiums.html",
      docs:["The latest Medicare premium notice from Social Security","Proof of the change (retirement letter, death certificate, etc.)","An estimate of this year's income"],
      where:"Send Form SSA-44 to Social Security, or call 1-800-772-1213."});
  }

  // ---- Unknown-answer handling: a created card that depends on a skipped ("not sure") field becomes "verify — needs info" ----
  const DEP={
    cb:["filing","dependent","incomeSS","incomeOther","propTax","assessed","rent","subsidized","spouseAge"],
    ex41c:["incomeSS","incomeOther","assets","titling","maYears"],
    vet22:["vaDis"],
    aanda:["wartime"],
    pcafc:["vaDis"],
    vapension:["wartime","incomeSS","incomeOther"],
    ssfa:["pubPension"],
    eaedc:["incomeSS","incomeOther","citizen"],
    scsep:["incomeSS","incomeOther","hhSize","hhOtherInc"],
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
    vacomp:["vetService"],
    hsn:["incomeSS","incomeOther"]
  };
  out.forEach(p=>{
    if(p.status==="have"||p.status==="refer"||p.status==="no") return;
    const miss=(DEP[p.id]||[]).filter(isUnknown);
    if(miss.length){ p.status="maybe"; p.why="⚠️ Can't confirm yet — still need: "+miss.map(qLabel).join(", ")+" (see the checklist up top). "+p.why; }
  });

  // ---- "Already receiving" override: don't tell people to apply for what they have ----
  const haveMap={cb:"cb",ex41c:"exemption",ex17d:"exemption",vet22:"exemption",blind37a:"exemption",liheap:"liheap",snap:"snap",msp:"msp",lis:"msp",masshealth:"masshealth",vacomp:"vacomp",homecare:"homecare"};
  const has=alreadyList();
  out.forEach(p=>{
    const k=haveMap[p.id];
    if(k && has.includes(k) && p.status!=="no"){
      p.status="have"; p.val=0;
      p.why="✓ Already receiving this — no action needed. Just re-confirm it stays active (most must be re-filed/redetermined every year).";
    }
  });
  // Marked on the results page with "I already get this" (added 2026-09-28): only 12 of 57 programs are on the "already getting" question.
  const mine = Array.isArray(A.haveAlso) ? A.haveAlso : [];
  out.forEach(p=>{
    if(mine.includes(p.id) && p.status!=="no"){
      if(p.status!=="have"){ p.status="have"; p.val=0;
        p.why="✓ Marked as something they already get. Re-confirm it stays active — most programs must be renewed every year."; }
      p.userHave=true;   // 2026-09-30: a tap now also feeds alreadyList(), which can mark the card "have" first; it still needs its Undo
    }
  });
  out.forEach(p=>{ if(p.status!=="have") return; const k=keepTips(p.id); if(k){ p.why=k.why; p.keep=k.items; } });

  return out;
}

/* ---------- Results screen ---------- */
function results(){
  { const qst=document.getElementById("qstatus"); if(qst) qst.textContent="Your results are ready."; }
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
  // Forms callout near the top: the claim packet is far down the page, and older users may never scroll to it.
  const pkHtml=packetCard(ps);
  const nForms=new Set([...pkHtml.matchAll(/class="btn [^"]*pk-dl[^"]*" [^>]*data-form="([^"]+)"/g)].map(m=>m[1])).size;
  const nQ=nForms?guideSteps(pkHtml).length:0;
  const formsReady = nForms ? `<div class="formsready"><div class="fr-t">📄 ${nForms} official form${nForms>1?"s are":" is"} ready for ${nm==="this person"?"you":nm}, already filled in from these answers</div>
      <button type="button" class="btn prim fr-guide">✍️ Fill in my forms — ${nQ} quick questions</button>
      <a class="fr-see" href="#packet">See the forms ↓</a></div>` : "";
  // The reveal list = exactly what the headline total is made of: every strong match that isn't a property-tax
  // exemption, plus the single largest exemption (they don't stack). With no strong matches, the ones worth verifying.
  const exTop = likely.filter(p=>EXEMPT.includes(p.id)).sort((a,b)=>(b.val||0)-(a.val||0))[0];
  const rvItems = (total>0 ? likely.filter(p=>!EXEMPT.includes(p.id)).concat(exTop?[exTop]:[]) : maybes.slice())
                    .sort((a,b)=>(b.val||0)-(a.val||0));
  if(revealStop) revealStop();
  const rvAnim = revealPending && rvItems.length>0; revealPending=false;
  const whoO = nm==="this person"?"them":nm;
  let h=`<div class="headline${rvAnim?" rv-anim":""}">
      <h2 class="sr-only">Your results</h2>
      <div class="pill" style="color:#fff;background:rgba(255,255,255,.18)">${String((townLookup(A.town)||{}).name||A.town||"Massachusetts").replace(/[<>&"]/g,"")}</div>
      <div class="big">${total>0?`<span class="odo" aria-hidden="true">≈ ${money(rvAnim?0:total)}/yr</span><span class="sr-only">About ${money(total)} a year</span>`:"Let's dig in"}</div>
      ${total>0 ? `<div class="lbl">in benefits ${nm==="this person"?"they":nm} may be leaving on the table — estimated, if approved for the strong matches</div>`
      /* no strong matches (2026-09-30): "Let's dig in" used to run straight into "in benefits ... leaving on the table" */
      : `<div class="lbl">${maybeTotal>0 ? `Up to ~${money(maybeTotal)}/yr in programs worth verifying for ${whoO}`
          : maybeN ? `No strong matches yet, but ${maybeN} program${maybeN>1?"s":""} worth a closer look for ${whoO}`
          : `No strong matches for ${whoO} right now`}</div>`}
      ${rvItems.length?`<ol class="rv-list">${rvItems.map(p=>`<li class="rv-item"><a href="#prog-${p.id}"><span class="rv-nm">${p.name}</span><span class="rv-v">${p.valTxt}</span></a></li>`).join("")}</ol>
      <div class="rv-have">Already getting one of these? Tap it, then tap “I already get this”. The total updates.</div>`:""}
      ${total>0 && maybeTotal>0?`<div class="lbl" style="opacity:.9;margin-top:10px;">+ up to ~${money(maybeTotal)}/yr more in programs worth verifying</div>`:""}
      <div class="sub">${likely.length} to apply for now &middot; ${maybeN} worth verifying${haveN?` &middot; ${haveN} already active`:""}. Tap any one for the exact form, documents, and where to file.</div>
      <div class="rv-est">Estimates, not guarantees — each program must be applied for and confirmed.</div>
    </div>
    ${formsReady}
    ${Math.max(num(A.age)||0, A.marital==="married"?(num(A.spouseAge)||0):0)<60 && A.disability!=="yes" ? `<div class="estnote" style="background:#FFF6E0;border-color:#EFD891"><b>Note:</b> most programs here are for people 60 and older (many start at 65). ${nm==="this person"?"They are":nm+" is"} ${num(A.age)||"under 60"}, so only programs with no age requirement are shown as possible matches.</div>`:""}
    <div class="legend">
      <span><i style="background:var(--green)"></i>Apply now</span>
      <span><i style="background:var(--amber)"></i>Verify / need info</span>
      ${haveN?`<span><i style="background:#0a5"></i>Already have</span>`:""}
      <span><i style="background:var(--blue)"></i>See a pro</span>
    </div>`;
  // Ryan 2026-09-30: the money and the benefit cards come first; the guidance, fine print, town notes, forms and the
  // answer review follow the cards (they used to be ~1,500 words between the total and the first card on a phone).
  let tail=`<div class="nextsteps">
      <h3>What to do next</h3>
      <ol>
        ${townTaxRows(townLookup(A.town), ps).length?`<li><b>Call the ${townLookup(A.town)?.name||"town"} assessor's office</b> about senior property-tax breaks — see <b>"Your town"</b> just below for what to ask. This is the one people most often miss.</li>`:""}
        <li><b>Start with the green "Apply for these" cards above.</b> Tap <b>How to claim it</b> on each one to see the exact form, what to gather, and where to file.</li>
        ${unknownN?`<li><b>Track down the ${unknownN} answer${unknownN>1?"s":""} you weren't sure about</b> — the yellow box explains where to find each one.</li>`:""}
        <li><b>Print or save this page</b> with the button at the bottom, so you have the list when you make calls.</li>
      </ol>
    </div>
    <div class="estnote">These are <b>estimates, not guarantees</b> — each program must be applied for and confirmed, and amounts vary by income and town. This tool finds what to chase; it doesn't approve anything.</div>`;
  tail+=townCard(ps);
  tail+=pkHtml;
  // Review / change answers — tap "Change" to jump back to any question, then return here.
  const visQ=visible();
  tail+=`<details class="answers"><summary>✏️ Review or change your answers (${visQ.length})</summary><ul>`;
  visQ.forEach((q,k)=>{ tail+=`<li><span class="a-q">${NAV[q.id]||q.id}</span><span class="a-v">${fmtAns(q)}</span><button type="button" class="a-edit" data-k="${k}">Change</button></li>`; });
  tail+=`</ul></details>`;

  // "I'm not sure" checklist — resurface every skipped answer with how-to-find-it help
  const unknownQs = Q.filter(q=>A[q.id]==="unknown");
  if(unknownQs.length){
    const many=unknownQs.length>1;
    tail+=`<div class="gaps"><h3>⚠️ ${unknownQs.length} answer${many?"s":""} to track down</h3>
      <p class="lead">You marked ${many?"these":"this"} "not sure." Find ${many?"them":"it"} and re-run — ${many?"they":"it"} can change what ${nm==="this person"?"they"  : nm} qualif${nm==="this person"?"y":"ies"} for.</p>`;
    unknownQs.forEach(q=>{ const qt=typeof q.q==="function"?q.q(A):q.q; tail+=`<div class="gitem"><div class="gq">${qt}</div>${q.help?`<div class="gh">${q.help}</div>`:""}</div>`; });
    tail+=`</div>`;
  }
  if((A.already||[]).includes("unsure") || A.mhType==="unknown"){
    tail+=`<div class="gaps" style="background:#e6effb;border-color:#bcd0f5"><h3 style="color:#1551a8">ℹ️ First, check what's already in place</h3>
      <p class="lead" style="color:#33507e">You weren't sure which of these ${nm==="this person"?"they"  : nm} already gets. Here's how to check each, so you don't re-apply for something already active:</p>
      <div class="gitem" style="border-color:#cfe0fb"><div class="gq">Circuit Breaker credit</div><div class="gh">Last year's MA state tax return — a "Schedule CB" credit line.</div></div>
      <div class="gitem" style="border-color:#cfe0fb"><div class="gq">Property-tax exemption</div><div class="gh">The town property tax bill — an "exemption"/"senior" line lowering the amount owed.</div></div>
      <div class="gitem" style="border-color:#cfe0fb"><div class="gq">Fuel Assistance / SNAP</div><div class="gh">Did they apply for winter heating help at a local agency? Do they have an EBT card?</div></div>
      <div class="gitem" style="border-color:#cfe0fb"><div class="gq">Medicare Part B help / MassHealth</div><div class="gh">Is the ~$203/mo Part B premium NOT coming out of their Social Security check? Do they carry a MassHealth card?</div></div>
      <div class="gitem" style="border-color:#cfe0fb"><div class="gq">Prescription Advantage</div><div class="gh">A Prescription Advantage member card, or a letter showing a category like S1–S5. It's the state's prescription help — not MassHealth.</div></div>
      <div class="gitem" style="border-color:#cfe0fb"><div class="gq">Anything else below</div><div class="gh">If they already get a program listed below, tap "I already get this" on its card to move it out of the way.</div></div>
    </div>`;
  }

  const groups=[["likely","✅ Apply for these"],["maybe","🔎 Worth verifying"],["have","✓ Already receiving — keep these going"],["refer","⚖️ Get professional help"],["no","Not a match right now"]];
  groups.forEach(([st,label])=>{
    const g=ps.filter(p=>p.status===st);
    if(!g.length) return;
    const collapse = st==="no";   // tuck the non-matches behind a toggle to cut clutter
    if(collapse){ h+=`<details class="nomatch"><summary class="sech" style="cursor:pointer;list-style:none">▸ ${label} (${g.length}) — tap to view</summary>`; }
    else { h+=`<div class="sech">${label}</div>`; }
    g.forEach(p=>{
      const bc={likely:"b-likely",maybe:"b-maybe",have:"b-have",refer:"b-refer",no:"b-no"}[p.status];
      const bt={likely:"Likely eligible",maybe:"Need to verify",have:"Already have",refer:"See a pro",no:"Not a match"}[p.status];
      h+=`<div class="prog" id="prog-${p.id}" data-pid="${p.id}" data-status="${p.status}">
        <div class="top"><h3>${p.name}</h3><span class="val">${p.valTxt}</span></div>
        <span class="badge ${bc}">${bt}</span>
        <p class="why">${p.why}</p>`;
      if(p.status==="likely"||p.status==="maybe"||p.status==="refer") h+=`<button type="button" class="gotit" data-pid="${p.id}">✓ I already get this</button>`;
      else if(p.userHave) h+=`<button type="button" class="gotit undo" data-pid="${p.id}">Undo — they don't get this</button>`;
      if(p.status==="have" && p.keep){
        h+=`<details class="keep" open><summary>Keeping it →</summary><div class="body"><ul>${p.keep.map(t=>`<li>${t}</li>`).join("")}</ul>
          <a href="${p.forml}" target="_blank" rel="noopener">Official program page →</a></div></details>`;
      } else if(p.status!=="no"){
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
  h+=tail;

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
      <a class="offer-btn" href="${CHECKOUT_URL||'#'}">Get my audit &rarr;</a>
      <div class="offer-fine">Optional paid help — everything here can also be done yourself for free. We are not a government agency and are not affiliated with one. We do <b>not</b> prepare VA claims or tax returns for a fee; those are referred to free, accredited experts. By continuing you agree to our <a href="terms.html" target="_blank">Terms</a> &amp; <a href="privacy.html" target="_blank">Privacy Policy</a>.</div>
    </div>`;
  }
  h+=`
    <div class="acts">
      <button type="button" class="btn prim" id="printPlan">Print or save this plan</button>
    </div>
    <div class="disc"><b>Important:</b> This tool gives general information based on public Massachusetts and federal program rules (2026 figures). It is <b>not</b> legal, tax, or financial advice. Dollar amounts and eligibility shown are estimates — income limits, exemption amounts, and town rules change and must be confirmed with each program or a licensed professional before you rely on them. Figures last checked September 2026. Property-tax exemptions usually can't be combined — take the one that saves the most. MassHealth/long-term-care planning should go to a licensed elder-law attorney.</div>`;
  h+=`<p class="forget"><button type="button" id="forgetBtn">🗑 Forget my answers on this device</button></p>`;
  document.getElementById("app").innerHTML=h;
  linkifyPhones(document.getElementById("app"));
  saveProgress();
  document.querySelectorAll(".gotit").forEach(b=>b.onclick=()=>{
    const id=b.dataset.pid, set=new Set(Array.isArray(A.haveAlso)?A.haveAlso:[]);
    if(b.classList.contains("undo")) set.delete(id); else set.add(id);
    A.haveAlso=[...set]; saveProgress();
    const y=window.scrollY; results(); window.scrollTo({top:y, left:0, behavior:"instant"});   // stay put (the page scrolls smoothly by default)
    const t=document.createElement("div"); t.className="gotit-toast"; t.setAttribute("role","status");
    t.textContent = b.classList.contains("undo") ? "Moved back to the list to apply for." : "Moved to “Already receiving”.";
    document.body.appendChild(t); setTimeout(()=>t.remove(), 2600);
  });
  // 2026-09-30: this was onclick="window.print()", which the page's Content-Security-Policy blocks (no inline handlers),
  // so the button did nothing on the live site since 2026-09-28. Wired here instead.
  const pp=document.getElementById("printPlan"); if(pp) pp.onclick=()=>window.print();
  const ob=document.querySelector(".offer-btn"); if(ob && !CHECKOUT_URL) ob.onclick=e=>e.preventDefault();
  const fg=document.getElementById("forgetBtn"); if(fg) fg.onclick=()=>{ forgetProgress(); fg.textContent="✓ Forgotten — nothing is saved on this device"; fg.disabled=true; try{ localStorage.setItem("bf_remember","0"); }catch(e){} };
  wirePacket();
  document.querySelectorAll(".a-edit").forEach(b=>b.onclick=()=>{ editMode=true; i=parseInt(b.dataset.k,10); render(); window.scrollTo(0,0); });
  const dl=document.getElementById("dl");
  if(dl) dl.onclick=()=>{
    const blob=new Blob([JSON.stringify({answers:A,generated:"client-side",programs:ps},null,2)],{type:"application/json"});
    const u=URL.createObjectURL(blob);const a=document.createElement("a");
    a.href=u;a.download=`benefits-audit-${(A.name||"profile").replace(/\W+/g,"_")}.json`;a.click();URL.revokeObjectURL(u);
  };
  window.scrollTo(0,0);
  if(rvAnim) runReveal(rvItems, total, 650);   // starts as the checking animation fades out
}

/* ---------- Save progress on THIS device (2026-09-26) ----------
   Answers (and the optional form details) are kept in this browser's localStorage so an
   older user can stop and come back. Nothing is sent anywhere. "Remember" is on by default,
   can be switched off on the first screen, and "Forget my answers" wipes it. */
const SAVE_KEY="bf_check_v1";
function remembering(){ try{ return localStorage.getItem("bf_remember")!=="0"; }catch(e){ return false; } }
function saveProgress(){ if(!remembering()) return; try{ localStorage.setItem(SAVE_KEY, JSON.stringify({A, i, PK, ts:Date.now()})); }catch(e){} }
function forgetProgress(){ try{ localStorage.removeItem(SAVE_KEY); }catch(e){} }
let RESTORED=false;
(function(){ try{ const sv=JSON.parse(localStorage.getItem(SAVE_KEY)||"null");
  if(sv && sv.A && Object.keys(sv.A).length && remembering() && (Date.now()-(sv.ts||0)) < 1000*60*60*24*120){
    A=sv.A; i=Math.max(0, sv.i||0); if(sv.PK) PK=Object.assign(PK, sv.PK); RESTORED=true; }
}catch(e){} })();
function startFresh(){ forgetProgress(); A={}; i=0; Object.keys(PK).forEach(k=>PK[k]=""); RESTORED=false; editMode=false; render(); window.scrollTo(0,0); }

render();
