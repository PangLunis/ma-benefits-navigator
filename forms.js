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
  function fillIncome(form, A){
    // "C. Gross receipts ... Applicant & Spouse" column: row 1 = Social Security/retirement benefits, last = TOTALS
    const all=names(form);
    const base=all.find(k=>/^Applicant\s+Spouse.*TOTALS$/.test(k));
    if(!base) return;
    const ss=n(A.incomeSS), other=n(A.incomeOther);
    if(known(A.incomeSS)) setText(form, base, "$"+usd(ss));
    if(known(A.incomeSS) && known(A.incomeOther) && (ss+other)>0 && all.includes(base+"_7")) setText(form, base+"_7", "$"+usd(ss+other));
  }

  // ---- Form 96-1: senior exemption (clauses 17, 17C, 17C½, 17D, 41, 41B, 41C, 41C½) ----
  async function fill961(PDFLib, bytes, A, extra, townName){
    const doc=await PDFLib.PDFDocument.load(bytes), form=doc.getForm();
    fillDORHeader(form, A, extra, townName, {yes:"Check Box10", sole:"Check Box12", others:"Check Box14"});
    const age=Math.max(n(A.age), A.marital==="married"?n(A.spouseAge):0);
    if(age>=65) check(form,"Check Box33");                          // "SENIOR 70 OR OLDER (65 or older by local option)"
    if(known(A.ownYears) && n(A.ownYears)>=11) check(form,"Check Box27");   // owned & occupied 11+ years: Yes
    fillIncome(form, A);
    if(known(A.assessed)) setText(form,"Assessed Valuation", "$"+usd(n(A.assessed)));
    form.updateFieldAppearances();
    return await doc.save();
  }
  // ---- Form 96-2: surviving spouse (clauses 17, 17C, 17C½, 17D) ----
  async function fill962(PDFLib, bytes, A, extra, townName){
    const doc=await PDFLib.PDFDocument.load(bytes), form=doc.getForm();
    fillDORHeader(form, A, extra, townName, {yes:"Check Box10", sole:"Check Box12", others:"Check Box14"});
    if(A.marital==="widowed"){ check(form,"Check Box31"); check(form,"Check Box34"); }   // SURVIVING SPOUSE; remarried: No
    if(known(A.assessed)) setText(form,"Domicile 1", "$"+usd(n(A.assessed)));
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
    fillIncome(form, A);
    form.updateFieldAppearances();
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
    // Income (gross MONTHLY). Social Security is only split per person when single.
    if(A.marital!=="married" && known(A.incomeSS) && n(A.incomeSS)>0) setText(form,"Your", "$"+usd(n(A.incomeSS)/12));
    form.updateFieldAppearances();
    return await doc.save();
  }

  const api={ fy, fill961, fill962, fill963, fill964, fill97, fillMSP };
  if(typeof module!=="undefined" && module.exports) module.exports=api; else global.BFForms=api;
})(typeof window!=="undefined"?window:globalThis);
