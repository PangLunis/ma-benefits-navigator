/* =========================================================================
   Benefighter — pre-filled state forms (runs entirely in the browser).
   The blank official PDFs are hosted in /forms/ (unchanged copies of the
   mass.gov files); pdf-lib (vendor/pdf-lib.min.js, MIT, v1.17.1, verified
   against the npm tarball) fills the form fields ON THE USER'S DEVICE.
   Nothing here makes a network request except loading those static files.

   Field names were mapped by rendering each page and matching field
   rectangles to the printed labels (2026-09-25). Several state field names
   are misleading (e.g. MSP "your spouse: gender: male" is actually the
   applicant's US-citizen Yes/No box), so NEVER re-map by name alone —
   render the filled PDF and look.

   Only fields we can fill honestly are filled. Anything we don't know
   (full legal name unless typed, SSN, date of birth, signature, the
   split of "other income" into pensions/wages/interest) is left blank.
   ========================================================================= */
(function(global){
  function fy(now){ const d=now||new Date(); const y=d.getFullYear(); return d.getMonth()>=6 ? y+1 : y; } // July starts the next fiscal year
  function n(x){ const v=parseFloat(String(x==null?"":x).replace(/[^0-9.]/g,"")); return isNaN(v)?0:v; }
  function usd(x){ return Math.round(x).toLocaleString("en-US"); }
  function setText(form, name, val){ if(val==null||val==="") return; try{ form.getTextField(name).setText(String(val)); }catch(e){ console.warn("field", name, e.message); } }
  function check(form, name){ try{ form.getCheckBox(name).check(); }catch(e){ console.warn("box", name, e.message); } }
  const MARITAL={single:"Single",married:"Married",widowed:"Widowed",divorced:"Divorced",separated:"Separated"};

  // ---- State Tax Form 96-1 (senior exemption: clauses 17, 17C, 17C½, 17D, 41, 41B, 41C, 41C½) ----
  async function fill961(PDFLib, bytes, A, extra, townName){
    const doc=await PDFLib.PDFDocument.load(bytes), form=doc.getForm();
    const FY=fy(), july1=String(FY-1);
    setText(form,"Name of City or Town", townName||A.town);
    setText(form,"FISCAL YEAR", String(FY));
    setText(form,"Name of Applicant", extra.fullName);
    setText(form,"Telephone Number", extra.phone);
    setText(form,"Marital Status", MARITAL[A.marital]);
    setText(form,"Legal Residence Domicile on July 1 1", july1);
    setText(form,"Legal Residence Domicile on July 1 3", extra.street);
    setText(form,"Legal Residence Domicile on July 1 4", townName||A.town);
    setText(form,"Legal Residence Domicile on July 1 5", extra.zip);
    if(A.housing==="own" && extra.street) setText(form,"Location of Property", extra.street+", "+(townName||A.town));
    if(A.housing==="own"){
      setText(form,"Did you own the property on July 1", july1);
      check(form,"Check Box10");                                   // Yes, owned on July 1
      if(A.titling==="own_name" && A.marital!=="married") check(form,"Check Box12");   // Sole owner
    }
    const age=Math.max(n(A.age), A.marital==="married"?n(A.spouseAge):0);
    if(age>=65) check(form,"Check Box33");                          // "SENIOR 70 OR OLDER (65 or older by local option)"
    if(A.ownYears!=null && A.ownYears!=="" && A.ownYears!=="unknown"){
      if(n(A.ownYears)>=11) check(form,"Check Box27");              // owned & occupied 11+ years: Yes
    }
    // C. Gross receipts, preceding calendar year (Applicant & Spouse column)
    const ss=n(A.incomeSS), other=n(A.incomeOther);
    const C="Applicant  SpouseRetirement Benefits Social Security Railroad Federal MA  Political Subdivisions Other Pensions and Retirement Allowances Wages Salaries and other Compensation Net Profits from Business Profession or Property Rental Interest and Dividends Other Receipts Capital Gains Public Assistance etc TOTALS";
    if(A.incomeSS!=null && A.incomeSS!=="unknown") setText(form, C, "$"+usd(ss));          // row 1: Social Security
    if(A.incomeSS!=="unknown" && A.incomeOther!=="unknown" && (ss+other)>0) setText(form, C+"_7", "$"+usd(ss+other));  // TOTALS
    // D. Property
    if(A.assessed && A.assessed!=="unknown") setText(form,"Assessed Valuation", "$"+usd(n(A.assessed)));
    if(A.assets!=null && A.assets!=="" && A.assets!=="unknown") setText(form,"Text46", "$"+usd(n(A.assets)));  // personal estate TOTAL
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
    if(A.marital!=="married" && A.incomeSS!=null && A.incomeSS!=="unknown" && n(A.incomeSS)>0) setText(form,"Your", "$"+usd(n(A.incomeSS)/12));
    form.updateFieldAppearances();
    return await doc.save();
  }

  const api={ fy, fill961, fillMSP };
  if(typeof module!=="undefined" && module.exports) module.exports=api; else global.BFForms=api;
})(typeof window!=="undefined"?window:globalThis);
