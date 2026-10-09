import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

export const config = { path: "/api/*" };

const VOTE_MS = 20000;      // length of a vote
const ACCEPT_MS = 1000;     // late votes still accepted (network delay)
const CLOSE_MS = 1500;      // votes are counted this long after the clock ends
const PER = 16;             // images per bracket

const store = () => getStore({ name: "tournament", consistency: "strong" });

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
const fail = (error, status = 400, extra = {}) => json({ error, ...extra }, status);

/* ---------- auth ---------- */
const digest = (s) => createHash("sha256").update(String(s)).digest();
function authState(req) {
  const pass = process.env.PRESENTER_PASSCODE;
  if (!pass) return "unset";
  const given = req.headers.get("x-passcode") || "";
  return timingSafeEqual(digest(given), digest(pass)) ? "ok" : "bad";
}

/* ---------- storage helpers ---------- */
async function getState(s) {
  return (await s.get("state", { type: "json" })) || { status: "setup", v: 0 };
}
async function putState(s, st) {
  st.v = (st.v || 0) + 1;
  await s.setJSON("state", st);
  return st;
}
async function getIndex(s) {
  return (await s.get("images-index", { type: "json" })) || [];
}
const idsOf = (index, bracket) =>
  index.filter((i) => i.bracket === bracket).sort((a, b) => a.t - b.t).map((i) => i.id);

/* ---------- tournament logic ---------- */
const clone = (o) => JSON.parse(JSON.stringify(o));
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function addRound(list, round, bracket, entrants) {
  for (let i = 0; i < entrants.length; i += 2) {
    list.push({ id: `r${round}-${bracket}-${i / 2 + 1}`, round, bracket, a: entrants[i], b: entrants[i + 1], w: null });
  }
}
function newTournament(index) {
  const matches = [];
  addRound(matches, 1, "cat", shuffle(idsOf(index, "cat")));
  addRound(matches, 1, "dog", shuffle(idsOf(index, "dog")));
  return {
    status: "running", runId: Date.now().toString(36), matches, cur: 0, phase: "intro",
    tryNo: 0, tie: false, key: "", endsAt: 0, result: null, v: 0,
  };
}
function setResult(st, a, b, hand) {
  const m = st.matches[st.cur];
  st.phase = "result";
  st.result = { a, b, hand: hand ? 1 : 0 };
  m.w = a === b ? null : a > b ? m.a : m.b;
}
function advance(st) {
  const m = st.matches[st.cur];
  if (!m.w) { st.phase = "ready"; st.tie = true; st.tryNo++; st.result = null; return; }   // tie: revote
  if (m.round === 5) { st.status = "complete"; st.phase = "done"; return; }
  if (st.cur === st.matches.length - 1) {                                                    // round finished
    if (m.round < 4) {
      for (const b of ["cat", "dog"]) {
        const winners = st.matches.filter((x) => x.round === m.round && x.bracket === b).map((x) => x.w);
        addRound(st.matches, m.round + 1, b, winners);
      }
    } else {
      const c = st.matches.find((x) => x.round === 4 && x.bracket === "cat").w;
      const d = st.matches.find((x) => x.round === 4 && x.bracket === "dog").w;
      const flip = Math.random() < 0.5;
      st.matches.push({ id: "r5-final-1", round: 5, bracket: "final", a: flip ? d : c, b: flip ? c : d, w: null });
    }
    st.cur++; st.phase = "intro";
  } else { st.cur++; st.phase = "ready"; }
  st.tryNo = 0; st.tie = false; st.result = null;
}

async function countVotes(s, key) {
  const { blobs } = await s.list({ prefix: `votes/${key}/` });
  const choices = await Promise.all(blobs.map((b) => s.get(b.key, { type: "text" })));
  let a = 0, b = 0;
  for (const c of choices) { if (c === "a") a++; else if (c === "b") b++; }
  return { a, b };
}
const voteKey = (st) => `${st.runId}.${st.matches[st.cur].id}.${st.tryNo}`;

// Counts the votes once the clock has run out. Safe to call from anywhere.
async function maybeClose(s, st) {
  if (st.phase !== "voting" || Date.now() < st.endsAt + CLOSE_MS) return st;
  const { a, b } = await countVotes(s, st.key);
  const fresh = await getState(s);
  if (fresh.v !== st.v || fresh.phase !== "voting") return fresh;       // someone else got there first
  setResult(fresh, a, b, false);
  return putState(s, fresh);
}

/* ---------- views ---------- */
function publicView(st) {
  const base = { status: st.status || "setup", serverNow: Date.now() };
  if (!st.matches || st.status === "setup") return base;
  const m = st.matches[st.cur];
  const same = st.matches.filter((x) => x.round === m.round);
  return {
    ...base, phase: st.phase, round: m.round, bracket: m.bracket,
    n: same.indexOf(m) + 1, total: same.length, key: st.key, endsAt: st.endsAt, tie: !!st.tie,
  };
}

/* ---------- handler ---------- */
export default async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [p0, p1, p2] = parts;
  const s = store();

  try {
    /* public: current state for phones */
    if (req.method === "GET" && p0 === "state") {
      const st = await maybeClose(s, await getState(s));
      return json(publicView(st));
    }

    /* public: cast or change a vote */
    if (req.method === "POST" && p0 === "vote") {
      const body = await req.json().catch(() => ({}));
      const { key, choice, voter } = body;
      if (!/^[a-z0-9]{8,40}$/.test(String(voter || ""))) return fail("bad_voter");
      if (choice !== "a" && choice !== "b") return fail("bad_choice");
      const st = await getState(s);
      if (st.phase !== "voting" || !key || key !== st.key) return fail("closed", 409);
      if (Date.now() > st.endsAt + ACCEPT_MS) return fail("closed", 409);
      await s.set(`votes/${st.key}/${voter}`, choice);
      return json({ ok: true });
    }

    /* public: image bytes */
    if (req.method === "GET" && p0 === "image" && p1) {
      if (!/^[a-z]+-[a-z0-9]+$/.test(p1)) return fail("not_found", 404);
      const data = await s.get(`images/${p1}`, { type: "arrayBuffer" });
      if (!data) return fail("not_found", 404);
      return new Response(data, {
        headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
      });
    }

    /* everything below is presenter-only */
    if (p0 === "admin") {
      const auth = authState(req);
      if (auth === "unset") return fail("passcode_unset", 500);
      if (auth === "bad") return fail("bad_passcode", 401);

      if (req.method === "GET" && p1 === "state") {
        const st = await maybeClose(s, await getState(s));
        return json({ state: st, images: await getIndex(s), serverNow: Date.now() });
      }

      if (req.method === "POST" && p1 === "image") {
        const bracket = url.searchParams.get("bracket");
        if (bracket !== "cat" && bracket !== "dog") return fail("bad_bracket");
        const st = await getState(s);
        if (st.status === "running") return fail("tournament_running", 409);
        const index = await getIndex(s);
        if (idsOf(index, bracket).length >= PER) return fail("bracket_full", 409);
        const buf = await req.arrayBuffer();
        if (buf.byteLength < 1000 || buf.byteLength > 1_500_000) return fail("bad_size");
        const head = new Uint8Array(buf, 0, 3);
        if (!(head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)) return fail("not_jpeg");
        const id = `${bracket}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        await s.set(`images/${id}`, buf);
        index.push({ id, bracket, t: Date.now() });
        await s.setJSON("images-index", index);
        return json({ images: index });
      }

      if (req.method === "DELETE" && p1 === "image" && p2) {
        const st = await getState(s);
        if (st.status === "running") return fail("tournament_running", 409);
        const index = (await getIndex(s)).filter((i) => i.id !== p2);
        await s.delete(`images/${p2}`);
        await s.setJSON("images-index", index);
        return json({ images: index });
      }

      if (req.method === "POST" && p1 === "clear-images") {
        const index = await getIndex(s);
        await Promise.all(index.map((i) => s.delete(`images/${i.id}`)));
        await s.setJSON("images-index", []);
        await putState(s, { status: "setup", v: (await getState(s)).v });
        return json({ images: [] });
      }

      if (req.method === "POST" && p1 === "action") {
        const body = await req.json().catch(() => ({}));
        let st = await getState(s);
        if (body.v !== undefined && body.v !== st.v) return fail("stale", 409, { state: st });
        const phase = st.phase;
        switch (body.type) {
          case "start": {
            if (st.status === "running") return fail("already_running", 409, { state: st });
            const index = await getIndex(s);
            if (idsOf(index, "cat").length !== PER || idsOf(index, "dog").length !== PER) return fail("need_images", 409);
            const nt = newTournament(index);
            nt.v = st.v;
            st = nt;
            break;
          }
          case "begin":
            if (phase !== "intro") return fail("wrong_phase", 409, { state: st });
            st.phase = "ready"; break;
          case "startVote":
            if (phase !== "ready") return fail("wrong_phase", 409, { state: st });
            st.phase = "voting"; st.tie = false; st.result = null;
            st.key = voteKey(st); st.endsAt = Date.now() + VOTE_MS; break;
          case "endEarly":
            if (phase !== "voting") return fail("wrong_phase", 409, { state: st });
            st.endsAt = Date.now() - CLOSE_MS; break;
          case "hand": {
            if (phase !== "voting" && phase !== "result") return fail("wrong_phase", 409, { state: st });
            const a = Math.max(0, Math.min(999, parseInt(body.a, 10) || 0));
            const b = Math.max(0, Math.min(999, parseInt(body.b, 10) || 0));
            setResult(st, a, b, true); break;
          }
          case "next":
            if (phase !== "result") return fail("wrong_phase", 409, { state: st });
            advance(st); break;
          case "reset":
            st = { status: "setup", v: st.v }; break;
          case "close":
            st = await maybeClose(s, st);
            return json({ state: st, images: await getIndex(s), serverNow: Date.now() });
          default:
            return fail("bad_action");
        }
        st = await putState(s, st);
        if (body.type === "endEarly") st = await maybeClose(s, st);
        return json({ state: st, images: await getIndex(s), serverNow: Date.now() });
      }
    }

    return fail("not_found", 404);
  } catch (e) {
    console.error(e);
    return fail("server_error", 500, { detail: String((e && e.message) || e) });
  }
};
