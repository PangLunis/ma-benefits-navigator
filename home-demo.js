/* Home-page demo of the check (Ryan 2026-09-28: "a looping demo with a sample person"). A made-up example person's answers flow
   into the Benefighter sun, it counts through the programs, and her matches drop out. The matches and total below are what the
   real check (check.js programs()) returned for exactly these answers on 2026-09-28 — tests/interaction_test.py re-checks that
   they still match. Plays only while on screen; reduced-motion visitors see the finished state, still. */
(function(){
  const el = document.getElementById("hdemo"); if(!el) return;
  const SAMPLE = {
    who: "Margaret, 74 — a widowed renter in Worcester on Medicare",
    answers: {name:"Margaret",age:"74",marital:"widowed",filing:"single",dependent:"no",citizen:"citizen",housing:"rent",town:"Worcester",hhSize:"1",
      incomeSS:"22000",incomeOther:"0",pubPension:"no",assets:"4000",medExpenses:"1500",rent:"1300",subsidized:"no",housingCrisis:"no",veteran:"no",
      disability:"no",blind:"no",medicare:"yes",dementia:"no",incomeDrop:"no",adl:"no",already:["none"]},
    chips: ["74 years old","Worcester","Widowed","Rents","$22,000 a year","On Medicare"],
    outs: [["msp","Medicare Savings Program (pays Part B)","~$2,435+/yr"],["cb","Senior Circuit Breaker Credit","~$1,770/yr"],
           ["snap","SNAP (Food Assistance)",""],["utildisc","Utility Discount Rate",""],["liheap","Fuel Assistance (HEAP)",""]],
    total: 6255, programs: 57
  };
  window.BF_HOME_DEMO = SAMPLE;   // read by the test that keeps this in step with the real check
  const money = n => "$" + Math.round(n).toLocaleString("en-US");
  const SUN = '<svg viewBox="0 0 44 44" aria-hidden="true" focusable="false"><path d="M22 3.5 37.5 8.8V21.2c0 9.6-6.6 16.6-15.5 19.6C13.1 37.8 6.5 30.8 6.5 21.2V8.8Z" fill="#FFFFFF" stroke="#1E4E3C" stroke-width="3.2" stroke-linejoin="round"/><path d="M14.5 22.3l5.3 5.3 10.4-11" fill="none" stroke="#E4A126" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';   // shield-and-check mark (2026-10-01; was the sun)
  el.innerHTML = `<div class="hd" aria-hidden="true">
      <div class="hd-in">${SAMPLE.chips.map((c,k)=>`<span class="hd-chip" style="--k:${k}">${c}</span>`).join("")}</div>
      <div class="hd-core"><div class="hd-sun">${SUN}</div><div class="hd-count">Checking <b>0</b> of ${SAMPLE.programs} Massachusetts programs…</div></div>
      <div class="hd-out">${SAMPLE.outs.map(([id,n,v],k)=>`<div class="hd-res" style="--k:${k}"><span>✅</span><span class="hd-nm">${n}</span>${v?`<span class="hd-v">${v}</span>`:""}</div>`).join("")}</div>
      <div class="hd-total" style="--k:${SAMPLE.outs.length}">≈ ${money(SAMPLE.total)} a year found</div>
    </div>
    <p class="hd-cap">Example: ${SAMPLE.who}. Her results come from our real check.</p>
    <p class="sr-only">Animation: a sample person's answers go into the Benefighter check, which finds the Medicare Savings Program, the Senior Circuit Breaker credit, food assistance, a utility discount and fuel assistance — about ${money(SAMPLE.total)} a year.</p>`;
  const root = el.querySelector(".hd"), n = root.querySelector(".hd-count b");
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(reduce){ root.classList.add("s1","s3","still"); n.textContent = SAMPLE.programs; return; }
  let timers=[], running=false;
  const at=(ms,f)=>timers.push(setTimeout(f,ms));
  function cycle(){
    timers.forEach(clearTimeout); timers=[]; root.className="hd"; n.textContent="0";
    at(80, ()=>root.classList.add("s1"));
    at(1300, ()=>{ const s=root.querySelector(".hd-sun").getBoundingClientRect(), cx=s.left+s.width/2, cy=s.top+s.height/2;
      root.querySelectorAll(".hd-chip").forEach(c=>{ const r=c.getBoundingClientRect(); c.style.setProperty("--dx",(cx-(r.left+r.width/2))+"px"); c.style.setProperty("--dy",(cy-(r.top+r.height/2))+"px"); });
      root.classList.add("s2"); });
    for(let k=1;k<=20;k++) at(1500+70*k, ()=>{ n.textContent=Math.round(SAMPLE.programs*k/20); });
    at(3000, ()=>root.classList.add("s3"));
    at(3000+350*SAMPLE.outs.length+1400+3200, ()=>root.classList.add("fade"));
    at(3000+350*SAMPLE.outs.length+1400+3900, ()=>{ if(running) cycle(); });
  }
  const io = new IntersectionObserver(es=>es.forEach(e=>{
    if(e.isIntersecting && !running){ running=true; cycle(); }
    else if(!e.isIntersecting && running){ running=false; timers.forEach(clearTimeout); timers=[]; }
  }), {threshold:0.35});
  io.observe(el);
})();
