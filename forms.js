/* =========================================================================
   Benefighter — pre-filled state forms (runs entirely in the browser).
   The blank official PDFs are hosted in /forms/ (unchanged copies of the
   mass.gov files); pdf-lib (vendor/pdf-lib.min.js, MIT, v1.17.1, verified
   against the npm tarball) fills the form fields ON THE USER'S DEVICE.
   Nothing here makes a network request except loading those static files.

   Field names were mapped by rendering each page and matching field
   rectangles to the printed labels (2026-09-25/26). Several state field
   names are misleading (e.g. MSP "your spouse: gender: male" is actually
   the applicant's US-citizen box; checkbox numbers differ form to form),
   so NEVER re-map by name alone — render the filled PDF and look.

   Only fields we can fill honestly are filled. Anything we don't know
   (full legal name unless typed, SSN, date of birth, signature, the
   split of "other income" into pensions/wages/interest, itemized assets)
   is left blank for the person to complete.
   ========================================================================= */
(function(global){
  function fy(now){ const d=now||new Date(); const y=d.getFullYear(); return d.getMonth()>=6 ? y+1 : y; } // July starts the next fiscal year
  function n(x){ const v=parseFloat(String(x==null?"":x).replace(/[^0-9.]/g,"")); return isNaN(v)?0:v; }
  function known(x){ return x!=null && x!=="" && x!=="unknown"; }
  function usd(x){ return Math.round(x).toLocaleString("en-US"); }
  function names(form){ return form.getFields().map(f=>f.getName()); }
  function setText(form, name, val){ if(val==null||val==="") return; try{ form.getTextField(name).setText(String(val)); }catch(e){ /* field absent on this form */ } }
  function check(form, name){ try{ form.getCheckBox(name).check(); }catch(e){ console.warn("box", name, e.message); } }
  const MARITAL={single:"Single",married:"Married",widowed:"Widowed",divorced:"Divorced",separated:"Separated"};
  function mdy(iso){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso||"")); return m?`${m[2]}/${m[3]}/${m[1]}`:""; }
  function money$(v){ return (v==null||v===""||isNaN(v))?"":"$"+usd(v); }
  // Optional detail boxes (typed in the claim packet, kept in page memory only). Income/asset splits are yearly
  // amounts; if the person gave a split, use it, otherwise fall back to the single "other income" total.
  function split(extra){
    const g=k=>{ const v=extra&&extra[k]; return (v==null||v==="")?null:n(v); };
    return { pension:g("incPension"), wages:g("incWages"), interest:g("incInterest"), rental:g("incRental"), other:g("incOther"),
             bank:g("assetBank"), invest:g("assetInvest"), mortgage:g("mortgage") };
  }
  function hasSplit(S){ return [S.pension,S.wages,S.interest,S.rental,S.other].some(v=>v!=null); }

  // ---- Shared header of the DOR assessor forms (96-1, 96-2, 96-3, 96-4, 97) ----
  // own: checkbox names for [owned-on-July-1 Yes, sole owner, co-owner with others] on THIS form (verified by render).
  function fillDORHeader(form, A, extra, townName, own){
    const FY=fy(), july1=String(FY-1), town=townName||A.town;
    const all=names(form), has=k=>all.includes(k);
    // NOTE: Form 96-3 carries a second, slightly offset copy of each header field (CTown, App1, Resdom1…);
    // filling both prints the text twice. Only the primary field is filled.
    const put=(keys,val)=>keys.forEach(k=>{ if(has(k)) setText(form,k,val); });
    put(["Name of City or Town"], town);
    put(["FISCAL YEAR"], String(FY));
    put(["Name of Applicant"], extra.fullName);
    put(["Telephone Number"], extra.phone);
    put(["Marital Status"], MARITAL[A.marital]);
    put(["Legal Residence Domicile on July 1 1","Legal residence domicile on July 1 1"], july1);
    put(["Legal Residence Domicile on July 1 3","Legal residence domicile on July 1 3"], extra.street);
    put(["Legal Residence Domicile on July 1 4","Legal residence domicile on July 1 4"], town);
    put(["Legal Residence Domicile on July 1 5","Legal residence domicile on July 1 5"], extra.zip);
    if(A.housing==="own"){
      if(extra.street) put(["Location of Property","Location of property"], extra.street+", "+town);
      put(["Did you own the property on July 1","Did you own the property on July 1_2"], july1);
      if(own){
        if(own.yes) check(form, own.yes);
        if(A.titling==="own_name" && A.marital!=="married" && own.sole) check(form, own.sole);
        if(A.titling==="multi" && own.others) check(form, own.others);
      }
    }
  }
  function fillIncome(form, A, extra){
    // "C. Gross receipts ... Applicant & Spouse" column: row 1 = Social Security/retirement benefits, last = TOTALS
    const all=names(form);
    const base=all.find(k=>/^Applicant\s+Spouse.*TOTALS$/.test(k));
    if(!base) return;
    const ss=n(A.incomeSS), other=n(A.incomeOther), S=split(extra||{});
    if(known(A.incomeSS)) setText(form, base, "$"+usd(ss));
    if(hasSplit(S)){
      // rows: _2 other pensions, _3 wages, _4 net profits/rental, _5 interest & dividends, _6 other receipts, _7 totals
      if(S.pension!=null) setText(form, base+"_2", money$(S.pension));
      if(S.wages!=null) setText(form, base+"_3", money$(S.wages));
      if(S.rental!=null) setText(form, base+"_4", money$(S.rental));
      if(S.interest!=null) setText(form, base+"_5", money$(S.interest));
      if(S.other!=null) setText(form, base+"_6", money$(S.other));
      const tot=(known(A.incomeSS)?ss:0)+[S.pension,S.wages,S.rental,S.interest,S.other].reduce((a,v)=>a+(v||0),0);
      if(tot>0 && all.includes(base+"_7")) setText(form, base+"_7", money$(tot));
    } else if(known(A.incomeSS) && known(A.incomeOther) && (ss+other)>0 && all.includes(base+"_7")) setText(form, base+"_7", "$"+usd(ss+other));
  }

  // ---- Form 96-1: senior exemption (clauses 17, 17C, 17C½, 17D, 41, 41B, 41C, 41C½) ----
  async function fill961(PDFLib, bytes, A, extra, townName){
    const doc=await PDFLib.PDFDocument.load(bytes), form=doc.getForm();
    fillDORHeader(form, A, extra, townName, {yes:"Check Box10", sole:"Check Box12", others:"Check Box14"});
    const age=Math.max(n(A.age), A.marital==="married"?n(A.spouseAge):0);
    if(age>=65) check(form,"Check Box33");                          // "SENIOR 70 OR OLDER (65 or older by local option)"
    if(known(A.ownYears) && n(A.ownYears)>=11) check(form,"Check Box27");   // owned & occupied 11+ years: Yes
    fillIncome(form, A, extra);
    if(known(A.assessed)) setText(form,"Assessed Valuation", "$"+usd(n(A.assessed)));
    const dobField=names(form).find(k=>k.startsWith("If first year of application attach copy of birth"));
    if(dobField) setText(form, dobField, mdy(extra.dob));
    const S=split(extra);
    if(S.mortgage!=null) setText(form,"Amount Due on Mortgage 1", money$(S.mortgage));
    if(S.bank!=null){ setText(form,"Bank Accounts Name  Address of Bank 1","Checking & savings (total — list each account if asked)"); setText(form,"Text38", money$(S.bank)); }
    if(S.invest!=null){ const k=names(form).find(x=>x.startsWith("Stocks Bonds Securities etc Description")&&x.endsWith("1")); if(k) setText(form,k,"Stocks, bonds, mutual funds, IRAs (total)"); setText(form,"Text41", money$(S.invest)); }
    form.updateFieldAppearances();
    return await doc.save();
  }
  // ---- Form 96-2: surviving spouse (clauses 17, 17C, 17C½, 17D) ----
  async function fill962(PDFLib, bytes, A, extra, townName){
    const doc=await PDFLib.PDFDocument.load(bytes), form=doc.getForm();
    fillDORHeader(form, A, extra, townName, {yes:"Check Box10", sole:"Check Box12", others:"Check Box14"});
    if(A.marital==="widowed"){ check(form,"Check Box31"); check(form,"Check Box34"); }   // SURVIVING SPOUSE; remarried: No
    if(known(A.assessed)) setText(form,"Domicile 1", "$"+usd(n(A.assessed)));
    const S=split(extra);
    if(S.mortgage!=null) setText(form,"Amount due on mortgage 1", money$(S.mortgage));
    if(S.bank!=null){ setText(form,"1","Checking & savings (total)"); setText(form,"1_5", money$(S.bank)); }
    if(S.invest!=null){ setText(form,"1_2","Stocks, bonds, mutual funds, IRAs (total)"); setText(form,"1_6", money$(S.invest)); }
    form.updateFieldAppearances();
    return await doc.save();
  }
  // ---- Form 96-3: blind persons (clauses 37, 37A) ----
  async function fill963(PDFLib, bytes, A, extra, townName){
    const doc=await PDFLib.PDFDocument.load(bytes), form=doc.getForm();
    fillDORHeader(form, A, extra, townName, {yes:"Check Box10", sole:"Check Box14", others:"Check Box12"});
    form.updateFieldAppearances();
    return await doc.save();
  }
  // ---- Form 96-4: veterans (clauses 22, 22A–22F) ----
  async function fill964(PDFLib, bytes, A, extra, townName){
    const doc=await PDFLib.PDFDocument.load(bytes), form=doc.getForm();
    fillDORHeader(form, A, extra, townName, {yes:"Check Box11", sole:"Check Box13", others:"Check Box15"});
    form.updateFieldAppearances();
    return await doc.save();
  }
  // ---- Form 97: senior tax deferral (clause 41A) ----
  async function fill97(PDFLib, bytes, A, extra, townName){
    const doc=await PDFLib.PDFDocument.load(bytes), form=doc.getForm();
    fillDORHeader(form, A, extra, townName, {sole:"Check Box23", others:"Check Box25"});
    if(A.housing==="own" && known(A.ownYears) && n(A.ownYears)>=10) check(form,"Check Box7");   // owned July 1 and prior 10 years: Yes
    setText(form,"Date of birth", mdy(extra.dob));
    fillIncome(form, A, extra);
    const S=split(extra);
    if(S.mortgage!=null){ setText(form,"Was there a mortgage on the property as of July 1", String(fy()-1)); check(form, S.mortgage>0?"Check Box26":"Check Box27"); if(S.mortgage>0) setText(form,"If yes amount due on mortgage", usd(S.mortgage)); }
    form.updateFieldAppearances();
    return await doc.save();
  }

  // Pick one option of a Yes/No pair stored as ONE field with two widgets (e.g. CP-4 "undefined_2": /Yes and /No).
  function choose(PDFLib, form, name, onValue){
    try{
      const f=form.getField(name);
      if(f.constructor && f.constructor.name==="PDFRadioGroup"){ f.select(onValue); return; }
      const af=f.acroField, N=PDFLib.PDFName;
      af.setValue(N.of(onValue));
      af.getWidgets().forEach(w=>{ const on=w.getOnValue(); w.setAppearanceState(on && on.decodeText && on.decodeText()===onValue ? N.of(onValue) : (on && on.asString && on.asString()==="/"+onValue ? N.of(onValue) : N.of("Off"))); });
    }catch(e){ console.warn("choose", name, e.message); }
  }
  // ---- Form CP-4: Community Preservation Act surcharge exemption (low income / low-moderate income seniors) ----
  // Status for CPA is judged as of JANUARY 1 (not July 1): for FY2027 that is January 1, 2026.
  async function fillCP4(PDFLib, bytes, A, extra, townName){
    const doc=await PDFLib.PDFDocument.load(bytes), form=doc.getForm();
    const FY=fy(), jan1=String(FY-1), town=townName||A.town;
    setText(form,"Name of City or Town", town);
    setText(form,"FISCAL YEAR", String(FY));
    setText(form,"Name of Applicant", extra.fullName);
    setText(form,"Telephone Number", extra.phone);
    setText(form,"Marital Status", MARITAL[A.marital]);
    setText(form,"Year1", jan1);
    const age=Math.max(n(A.age), A.marital==="married"?n(A.spouseAge):0);
    if(age>=61) choose(PDFLib, form, "undefined_2", "Yes");          // 60+ on Jan 1 (61+ today is certain)
    setText(form,"Year2", jan1);                                       // legal residence on Jan 1 / owned on Jan 1 (same field)
    setText(form,"Street", extra.street); setText(form,"CityTown", town); setText(form,"Zip Code", extra.zip);
    if(A.housing==="own"){
      if(extra.street) setText(form,"Location of property", extra.street+", "+town);
      choose(PDFLib, form, "undefined_3", "Yes_2");                    // owned the property on Jan 1: Yes
      if(A.titling==="own_name" && A.marital!=="married") check(form,"Sole owner");
      if(A.titling==="multi") check(form,"Coowner with others");
    }
    if(A.marital!=="married" && known(A.incomeSS)){                    // Schedule: applicant's own Social Security (single only)
      if(extra.fullName) setText(form,"Name", extra.fullName);
      setText(form,"Social Security", "$"+usd(n(A.incomeSS)));
      const S=split(extra);
      if(S.pension!=null) setText(form,"Other pensionretirement benefits", money$(S.pension));
      if(S.interest!=null) setText(form,"Interestdividends", money$(S.interest));
      if(S.rental!=null) setText(form,"Rental income", money$(S.rental));
    }
    form.updateFieldAppearances();
    return await doc.save();
  }

  // ---- DTA SNAP Application for Seniors (SNAP-App-Seniors Rev. 7/2026): NO fillable fields, so text is
  // printed at measured positions (pdfplumber label coordinates, verified by render). Only page 1 (the page DTA
  // needs to accept the application: name, address, signature) and date of birth on page 4. ----
  async function fillSNAP(PDFLib, bytes, A, extra, townName){
    const doc=await PDFLib.PDFDocument.load(bytes);
    const font=await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const pages=doc.getPages(), H=792, ink=PDFLib.rgb(0.1,0.2,0.55);
    const put=(pg,text,x,topBaseline,size)=>{ if(!text) return; pages[pg].drawText(String(text),{x, y:H-topBaseline, size:size||11, font, color:ink}); };
    const parts=String(extra.fullName||"").trim().split(/\s+/).filter(Boolean);
    if(parts.length>=2){ put(0, parts[parts.length-1], 48, 347); put(0, parts[0], 222, 347); if(parts.length===3) put(0, parts[1].replace(".",""), 381, 347); }
    else if(parts.length===1) put(0, parts[0], 222, 347);
    put(0, extra.street, 48, 387);
    const town=townName||A.town;
    if(town) put(0, `${town}, MA ${extra.zip||""}`.trim(), 381, 387);
    put(0, extra.phone, 48, 467);
    put(3, mdy(extra.dob), 291, 101);
    return await doc.save();
  }

  // ---- MassHealth Medicare Savings Programs application (MSP_2026-03) ----
  async function fillMSP(PDFLib, bytes, A, extra, townName){
    const doc=await PDFLib.PDFDocument.load(bytes), form=doc.getForm();
    const parts=String(extra.fullName||"").trim().split(/\s+/).filter(Boolean);
    if(parts.length>=2){ setText(form,"You: first name", parts[0]); setText(form,"You: last name", parts[parts.length-1]);
      if(parts.length===3 && parts[1].replace(".","").length===1) setText(form,"You: middle intial", parts[1].replace(".","")); }
    else if(parts.length===1){ setText(form,"You: first name", parts[0]); }
    else if(A.name) setText(form,"You: first name", A.name);
    setText(form,"You: street address", extra.street);
    setText(form,"You: city", townName||A.town);
    setText(form,"You: state", "MA");
    if(A.marital!=="married") check(form,"You");                     // "Who is applying?  [x] You"
    setText(form,"You: ZIP", extra.zip);
    setText(form,"telephone number", extra.phone);
    setText(form,"Date of birth (MM)", mdy(extra.dob));
    setText(form,"Medicare claim number", extra.medicareNo);
    if(A.marital==="married" && extra.spouseName){
      const sp=String(extra.spouseName).trim().split(/\s+/);
      if(sp.length>=2){ setText(form,"First name", sp[0]); setText(form,"Last name", sp[sp.length-1]); } else setText(form,"First name", sp[0]);
      setText(form,"Date of birth_2", mdy(extra.spouseDob));
    }
    // Income (gross MONTHLY). Only split per person when single; a couple's combined totals can't be divided honestly.
    if(A.marital!=="married"){
      if(known(A.incomeSS) && n(A.incomeSS)>0) setText(form,"Your", "$"+usd(n(A.incomeSS)/12));
      const S=split(extra), mo=v=>v!=null&&v>0?"$"+usd(v/12):"";
      if(S.pension!=null) setText(form,"Your_2", mo(S.pension));
      if(S.interest!=null) setText(form,"Your_5", mo(S.interest));
      if(S.wages!=null) setText(form,"Your_6", mo(S.wages));
      if(S.rental!=null) setText(form,"Your_7", mo(S.rental));
      if(S.other!=null && S.other>0){ setText(form,"Your_8", mo(S.other)); setText(form,"Other please specify","Other income"); }
    }
    form.updateFieldAppearances();
    return await doc.save();
  }

  const api={ fy, mdy, fill961, fill962, fill963, fill964, fill97, fillCP4, fillSNAP, fillMSP };
  if(typeof module!=="undefined" && module.exports) module.exports=api; else global.BFForms=api;
})(typeof window!=="undefined"?window:globalThis);
