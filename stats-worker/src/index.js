// Benefighter free-check stats: anonymous start / finish / leave counts.
// Stores NO answers, names, towns or IP addresses. See ../schema.sql.
const ALLOWED = ["https://benefighter.com", "https://www.benefighter.com"];
const EVENTS = new Set(["start", "finish", "leave"]);

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED.includes(origin) ? origin : ALLOWED[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST" || url.pathname !== "/c") return new Response("not found", { status: 404, headers: cors });
    // Only accept events from the real site (junk protection, not security).
    if (origin && !ALLOWED.includes(origin)) return new Response(null, { status: 403, headers: cors });

    const txt = await req.text();
    if (txt.length > 400) return new Response(null, { status: 413, headers: cors });
    let d;
    try { d = JSON.parse(txt); } catch { return new Response(null, { status: 400, headers: cors }); }

    const ev = EVENTS.has(d.ev) ? d.ev : null;
    const sid = typeof d.sid === "string" && /^[a-z0-9]{8,24}$/.test(d.sid) ? d.sid : null;
    if (!ev || !sid) return new Response(null, { status: 400, headers: cors });
    const qid = typeof d.qid === "string" && /^[A-Za-z0-9_]{1,24}$/.test(d.qid) ? d.qid : null;
    const int = (v) => (Number.isInteger(v) && v >= 0 && v < 200 ? v : null);
    const dev = d.dev === "m" || d.dev === "d" ? d.dev : null;

    await env.DB.prepare("INSERT INTO events (ts, sid, ev, qid, qn, qt, dev) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(new Date().toISOString(), sid, ev, qid, int(d.qn), int(d.qt), dev)
      .run();
    return new Response(null, { status: 204, headers: cors });
  },
};
