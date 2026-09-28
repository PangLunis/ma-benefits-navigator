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
  // Married couples answer income COMBINED. If the packet's "spouse's share" boxes are filled, split it per person:
  // the applicant gets the rest. Returns null when not married, not given, or inconsistent (share > combined).
  function perPerson(A, extra){
    if(A.marital!=="married" || !known(A.incomeSS) || !known(A.incomeOther)) return null;
    const g=k=>{ const v=extra&&extra[k]; return (v==null||v==="")?null:n(v); };
    const sss=g("spouseSS"), sso=g("spouseOther");
    if(sss==null && sso==null) return null;
    const ss=n(A.incomeSS), ot=n(A.incomeOther), s1=sss||0, o1=sso||0;
    if(s1>ss+0.5 || o1>ot+0.5) return null;
    return { you:{ss:ss-s1, other:ot-o1}, sp:{ss:s1, other:o1} };
  }

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
      // pdf-lib only accepts the FIRST widget's "on" value here; for the second option of a pair, set /V directly.
      try{ af.setValue(N.of(onValue)); }catch(e){ af.dict.set(N.of("V"), N.of(onValue)); }
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
    // Known yes/no answers (checked by render: several fields are misnamed in the PDF). Page 1 of the application:
    //   "Are you a US citizen or US national?"      -> field "your spouse: gender: male" (Yes/No)
    //   "...do you have an eligible immigration status?" -> "Check Box2";  veteran / spouse-of-veteran -> "Check Box8"
    if(A.citizen==="citizen") choose(PDFLib, form, "your spouse: gender: male", "Yes");
    else if(A.citizen==="qualified"){ choose(PDFLib, form, "your spouse: gender: male", "No"); choose(PDFLib, form, "Check Box2", "Yes"); }
    if(A.veteran==="vet"||A.veteran==="spouse") choose(PDFLib, form, "Check Box8", "Yes");
    else if(A.veteran==="no") choose(PDFLib, form, "Check Box8", "No");
    if(A.marital==="married" && extra.spouseName){
      const sp=String(extra.spouseName).trim().split(/\s+/);
      if(sp.length>=2){ setText(form,"First name", sp[0]); setText(form,"Last name", sp[sp.length-1]); } else setText(form,"First name", sp[0]);
      setText(form,"Date of birth_2", mdy(extra.spouseDob));
    }
    // Income (gross MONTHLY). Per person: single = all theirs; married = only when the spouse's share was given.
    const PP=perPerson(A, extra);
    if(PP){
      const mo=v=>v>0?"$"+usd(v/12):"";
      setText(form,"Your", mo(PP.you.ss)); setText(form,"Your spouses", mo(PP.sp.ss));
      if(PP.you.other>0||PP.sp.other>0){ setText(form,"Other please specify","Pensions, interest & other income"); setText(form,"Your_8", mo(PP.you.other)); setText(form,"Your spouses_8", mo(PP.sp.other)); }
    }
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

  // ---- Schedule CB (2025): Senior Circuit Breaker credit, filed WITH the Massachusetts Form 1 ----
  // Only numbers the person gave us directly are printed: name/address, homeowner or renter, assessed value (line 2),
  // Social Security (line 4), real estate tax (line 10) or yearly rent (line 18a/18). Lines 3, 5, 6 and 8 come from the
  // tax return itself, so they - and every line computed from them - are left for the person or their preparer.
  // Every money box is a comb field of whole dollars with a fixed number of digits: never truncate, skip instead.
  async function fillCB(PDFLib, bytes, A, extra, townName, year){
    // year = tax year of the form (2025 current; 2024/2023 = missed back years). For back years only who and where are
    // printed - that year's income, tax and assessment aren't the numbers the person gave us for this year.
    const back = year && year < 2025;
    const doc=await PDFLib.PDFDocument.load(bytes), form=doc.getForm();
    const parts=String(extra.fullName||"").trim().split(/\s+/).filter(Boolean);
    if(parts.length){
      setText(form,"First Name", parts[0]);
      if(parts.length>1) setText(form,"Last Name", parts[parts.length-1]);
      if(parts.length>2) setText(form,"Middle Initial", parts[1].replace(/[^A-Za-z]/g,"").charAt(0).toUpperCase());
    }
    setText(form,"Address of Principal Residence in Massachusetts (DO NOT ENTER PO BOX)", extra.street);
    setText(form,"City/Town", townName||A.town);
    setText(form,"State", "MA");
    if(/^\d{5}$/.test(String(extra.zip||"").trim())) setText(form,"Zip Code", String(extra.zip).trim());
    const digits=(field, v, max)=>{ if(!known(v)) return; const d=String(Math.round(n(v))); if(d.length<=max && n(v)>0) setText(form, field, d); };
    const own=A.housing==="own", rent=A.housing==="rent";
    // The homeowner/renter radio has a different name and option spelling each year (2023 uses "/Renter").
    const rq=form.getFields().find(f=>/Living quarters status during/i.test(f.getName()));
    if(rq && (own||rent)){
      try{ const want=(rq.getOptions?rq.getOptions():[]).find(o=>new RegExp("^"+(own?"homeowner":"renter")+"$","i").test(o)); if(want) rq.select(want); }
      catch(e){ console.warn("cb radio", e.message); }
    }
    if(back){ form.updateFieldAppearances(); return await doc.save(); }
    if(own) digits("line2", A.assessed, 8);
    digits("line4", A.incomeSS, 6);
    if(own) digits("line10", A.propTax, 5);
    if(rent && known(A.rent) && n(A.rent)>0){ const yr=Math.round(n(A.rent)*12); digits("line18a", yr, 5); digits("line18", Math.round(yr/4), 5); }
    form.updateFieldAppearances();
    return await doc.save();
  }

  // ---- MassHealth senior application (SACA-2, 08/26): MassHealth + Health Safety Net for people 65+ ----
  // 42 pages / 1,259 fields; we fill only what the person told us. Yes/No questions are radio pairs whose export
  // values are "1"/"2" (Yes/No, left/right) or "Yes"/"No". Income questions are PER PERSON: our income answers are
  // a couple's combined totals, so for a married couple the per-person income lines are left for them to split.
  function yesNo(PDFLib, form, name, yes){
    // These pairs are one field with two widgets whose "on" values are 1/2 or Yes/No (pdf-lib sees a checkbox).
    try{
      const f=form.getField(name);
      const ons=f.acroField.getWidgets().map(w=>{ const o=w.getOnValue(); return o ? (o.decodeText ? o.decodeText() : String(o).replace(/^\//,"")) : null; });
      const want=ons.find(o=>o && (yes?/^(1|yes)$/i:/^(2|no)$/i).test(o));
      if(want) choose(PDFLib, form, name, want); else console.warn("yesNo: no option for", name, ons);
    }catch(e){ console.warn("yesNo", name, e.message); }
  }
  async function fillSACA2(PDFLib, bytes, A, extra, townName){
    const doc=await PDFLib.PDFDocument.load(bytes), form=doc.getForm();
    const town=townName||A.town, married=A.marital==="married";
    const dob=d=>{ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d||"")); return m?`${m[2]}/${m[3]}/${m[1]}`:""; };
    check(form,"MassHealth or the Health Safety Net HSN");
    // Step 1: contact person (the applicant) and address
    setText(form,"1 First name middle name last name and suffix", extra.fullName);
    setText(form,"2 Date of birth mmddyy", dob(extra.dob));
    setText(form,"3 Street address Check this box if homeless You must provide a mailing address", extra.street);
    setText(form,"5 City", town);
    setText(form,"6 State", "MA");
    if(/^\d{5}$/.test(String(extra.zip||"").trim())) setText(form,"7 ZIP code", String(extra.zip).trim());
    if(extra.street) check(form,"Check if same as street address");
    setText(form,"17 Other phone number", extra.phone);
    setText(form,"19. # of people listed on the application", married?"2":"1");
    yesNo(PDFLib, form,"14. Are you living in Massachusetts?", true);
    // Step 2: Person 1
    setText(form,"1 First name middle name last name and suffix_2", extra.fullName);
    yesNo(PDFLib, form,"4 Are you applying for health or dental coverage for YOURSELF?", true);
    if(["married","single","widowed","divorced"].includes(A.marital)) yesNo(PDFLib, form,"Are you legally married?", married);
    if(married && (extra.spouseName||extra.spouseDob)) setText(form,"If Yes, list name of spouse and date of birth", [extra.spouseName, dob(extra.spouseDob)].filter(Boolean).join(", "));
    if(A.dependent==="yes"||A.dependent==="no") yesNo(PDFLib, form,"Will you be claimed as a dependent on someone else's federal income tax return?", A.dependent==="yes");
    if(A.citizen==="citizen") yesNo(PDFLib, form,"12. Are you a U.S. citizen or U.S. national?", true);
    else if(A.citizen==="qualified") yesNo(PDFLib, form,"12. Are you a U.S. citizen or U.S. national?", false);
    if(A.housing==="rent") yesNo(PDFLib, form,"18. Do you rent or own your property?", true);        // "1" = Rent (left)
    else if(A.housing==="own") yesNo(PDFLib, form,"18. Do you rent or own your property?", false);   // "2" = Own
    // The form: "19. Do you have a disability? (If legally blind, answer Yes.)"  (fixed 2026-09-27, found by the forms test)
    if(A.disability==="yes"||A.blind==="yes") yesNo(PDFLib, form,"19. Do you have a disability?", true);
    else if(A.disability==="no") yesNo(PDFLib, form,"19. Do you have a disability?", false);
    const ss=n(A.incomeSS), other=n(A.incomeOther), S=split(extra), PP=perPerson(A, extra);
    if(!married && known(A.incomeSS) && known(A.incomeOther)) yesNo(PDFLib, form,"22. Do you have any income?", ss+other>0);
    if(PP){
      // Person 1 = the applicant's share; Person 2 = the spouse's share (types unknown -> "other taxable income", yearly)
      const P1=PP.you, P2=PP.sp;
      yesNo(PDFLib, form,"22. Do you have any income?", P1.ss+P1.other>0);
      if(P1.ss>0){ check(form,"28. Social Security benefits"); setText(form,"Social Security benefits  $", usd(P1.ss/12)); setText(form,"How often Social Security benefits","Monthly"); }
      if(P1.other>0){ check(form,"Other taxable income include type"); setText(form,"Other taxable income   $", usd(P1.other)); setText(form,"How often Other taxable income","Yearly"); setText(form,"Other taxable income Type","Pensions, interest & other (total)"); }
      if(P1.ss+P1.other>0) setText(form,"33. What is your total expected income for the current calendar year?", "$"+usd(P1.ss+P1.other));
      yesNo(PDFLib, form,"32. Does this person have any income?", P2.ss+P2.other>0);
      if(P2.ss>0){ check(form,"38. Social Security benefits_P2"); setText(form,"38.  Social Security benefits_2_P2", usd(P2.ss/12)); setText(form,"38. Social Security benefits How often_P2","Monthly"); }
      if(P2.other>0){ check(form,"38. Other taxable income include type_2_P2"); setText(form,"38. Other taxable income $_P2", usd(P2.other)); setText(form,"38. Other taxable income How often_2_P2","Yearly"); setText(form,"38. Other taxable income Type_2_P2","Pensions, interest & other (total)"); }
      if(P2.ss+P2.other>0) setText(form,"43. What is your total expected income for the current calendar year?_P2", "$"+usd(P2.ss+P2.other));
    }
    if(!married){
      if(known(A.incomeSS) && ss>0){ check(form,"28. Social Security benefits"); setText(form,"Social Security benefits  $", usd(ss/12)); setText(form,"How often Social Security benefits","Monthly"); }
      if(S.pension){ check(form,"28. Retirement or Pension"); setText(form,"Retirement or Pension   $", usd(S.pension)); setText(form,"How often Retirement or Pension","Yearly"); }
      if(S.interest){ check(form,"29 Interest dividends and other investment income"); setText(form,"Interest, dividends, and other investment income   $", usd(S.interest)); setText(form,"How often Interest, dividends, and other investment income","Yearly"); }
      if(S.wages){ setText(form,"24a.  Wagestips before taxes", usd(S.wages)); check(form,"Yearly Subtract any pretax deductions such as nontaxable health insurance premiums"); }
      // Whatever part of "other income" isn't itemized above (rental, anything else, or all of it when no breakdown was
      // given) goes on the "Other taxable income" line, so the lines add up to the Q33 total. (fixed 2026-09-27, forms test)
      if(known(A.incomeOther)){
        // Rental income has its own question (29, "You must answer this question") — it goes there, not under "other".
        const rest = other - (S.pension||0) - (S.interest||0) - (S.wages||0) - (S.rental||0);
        if(rest>0.5){
          check(form,"Other taxable income include type"); setText(form,"Other taxable income   $", usd(rest)); setText(form,"How often Other taxable income","Yearly");
          setText(form,"Other taxable income Type", hasSplit(S) ? "Other income" : "Pensions, interest & other (total)");
        }
        if(S.rental!=null){
          yesNo(PDFLib, form,"29. Do you get rental income?", S.rental>0);
          if(S.rental>0) setText(form,"How much monthly rental income or loss do you get from each rental unit from the real estate indicated above", usd(S.rental/12));
        }
      }
      if(known(A.incomeSS) && known(A.incomeOther) && ss+other>0) setText(form,"33. What is your total expected income for the current calendar year?", "$"+usd(ss+other));
    }
    // Person 2: the spouse (name, birth date, same address)
    if(married){
      setText(form,"1 First name middle name last name and suffix_P2", extra.spouseName);
      setText(form,"2 Date of birth mmddyy_P2", dob(extra.spouseDob));
      setText(form,"4 Relationship to Person 1_P2", "Spouse");
      // "5 Does this person live with Person 1? Yes / No. If No, provide street address" — a married couple applying
      // together lives together, so Yes and the address block stays empty. (fixed 2026-09-27, found by the forms test)
      yesNo(PDFLib, form,"5 Does this person live with Person 1?_P2", true);
    }
    // Step 5: assets (a couple's assets count together, so totals are fine here)
    if(A.housing==="own"||A.housing==="rent") yesNo(PDFLib, form,"Do you own or have a legal interest in your primary residence?", A.housing==="own");
    if(S.bank!=null){ setText(form,"Name on account", extra.fullName); setText(form,"Account type","Checking & savings (total - list each account)"); setText(form,"Current balance", usd(S.bank)); }
    if(S.invest!=null) yesNo(PDFLib, form,"Securities brokerage accounts?", S.invest>0);
    // Step 6: Medicare
    if(A.medicare==="yes"){
      yesNo(PDFLib, form,"2. Does anyone qualify for or is anyone enrolled in the following types of health coverage?", true);
      check(form,"Enrolled in Medicare or qualifies for a Medicare Part A plan with no premium");
      setText(form,"Name_3", extra.fullName);
      setText(form,"Medicare claim number", extra.medicareNo);
      yesNo(PDFLib, form,"2b. Do any of the persons above want to apply for help paying for the Medicare Part B premiums?", true);
      setText(form,"If Yes names", extra.fullName);
    }
    form.updateFieldAppearances();
    return await doc.save();
  }

  // ---- "SIGN HERE" marks: a translucent yellow band over each signature line + a red label at its right end ----
  // Positions measured with pdfplumber on the official PDFs (top = distance of the "Signature" label from the page top).
  const SIGN={
    msp:[{p:7,x:34,top:112,w:270},{p:7,x:34,top:153,w:270,spouse:1}],
    "961":[{p:3,x:45,top:103,w:360}], "962":[{p:2,x:45,top:724,w:360}], "963":[{p:2,x:45,top:224,w:360}],
    "964":[{p:2,x:45,top:737,w:360}], "97":[{p:2,x:45,top:500,w:360}], cp4:[{p:1,x:60,top:651,w:350}],
    snap:[{p:1,x:100,y0:693,y1:733,w:268}], saca2:[{p:26,x:58,y0:208,y1:235,w:286}]
  };
  async function signMarks(PDFLib, bytes, kind, married){
    const spots=(SIGN[kind]||[]).filter(s=>!s.spouse||married);
    if(!spots.length) return bytes;
    const doc=await PDFLib.PDFDocument.load(bytes), font=await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    for(const s of spots){
      const pg=doc.getPage(s.p-1), H=pg.getHeight();
      // line forms: band just above the "Signature" label; boxed forms: y0..y1 = the signature cell (from the top)
      const bottom = s.y1!=null ? H-s.y1 : H-(s.top-2), h = s.y1!=null ? s.y1-s.y0 : 22;
      pg.drawRectangle({x:s.x-3, y:bottom, width:s.w, height:h, color:PDFLib.rgb(1,0.86,0.2), opacity:0.35});
      pg.drawText("SIGN HERE", {x:s.x+s.w-64, y:bottom+h-10, size:8.5, font, color:PDFLib.rgb(0.72,0.05,0.05)});
    }
    return await doc.save();
  }

  const api={ fy, mdy, fill961, fill962, fill963, fill964, fill97, fillCP4, fillSNAP, fillMSP, fillCB, fillSACA2, signMarks, SIGN };
  if(typeof module!=="undefined" && module.exports) module.exports=api; else global.BFForms=api;
})(typeof window!=="undefined"?window:globalThis);
