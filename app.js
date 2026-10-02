(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let apiBase = "";
  let pollTimer = null, clockTimer = null;

  // Access code arrives in the QR link (?code=...) and is remembered on this device.
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const accessCode = () => ($("code").value || store.get("lf_code") || "").trim();
  const KEY_RE = /^[0-9a-z]{1,8}-[pd][0-9a-f]{1,16}$/;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);
  const link = (text, url) => (safeUrl(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text));

  function show(view) {
    for (const id of ["landing", "working", "queued", "guide"]) $(id).hidden = id !== view;
    window.scrollTo(0, 0);
  }

  async function loadConfig() {
    // config.json points the public page at the API; without it, same origin.
    const res = await fetch("config.json", { cache: "no-store" }).catch(() => null);
    const cfg = res && res.ok ? await res.json().catch(() => ({})) : {};
    apiBase = (cfg.apiBase || "").replace(/\/$/, "");
  }

  async function api(path, opts) {
    const res = await fetch(apiBase + path, opts);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail || "Something went wrong. Please try again.");
    return body;
  }

  function where(d) {
    if (!d) return "";
    const parts = [d.place?.name, d.county?.name, d.state?.name].filter(Boolean);
    return parts.join(", ").replace(/ city\b/i, "");
  }

  function startWorking(rec) {
    show("working");
    $("working-where").textContent = where(rec.districts);
    const started = (rec.started_at || Date.now() / 1000) * 1000;
    clearInterval(clockTimer);
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - started) / 1000));
      $("elapsed").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    };
    renderActivity(rec.progress);
    tick();
    clockTimer = setInterval(tick, 1000);
    clearTimeout(pollTimer);
    const poll = async () => {
      try {
        const r = await api(`/api/guide/${encodeURIComponent(rec.key)}`);
        if (r.status === "pending") { renderActivity(r.progress); pollTimer = setTimeout(poll, 5000); return; }
        justFinished = r.status === "ready";
        handle(r);
      } catch { pollTimer = setTimeout(poll, 15000); }
    };
    pollTimer = setTimeout(poll, 10000);
  }

  let justFinished = false;

  function prettyLine(line) {
    const m = /^Reading: (https?:\/\/\S+)/.exec(line);
    if (!m) return line;
    try {
      const u = new URL(m[1]);
      const path = u.pathname.length > 1 ? u.pathname.slice(0, 60) : "";
      return `Reading ${u.hostname.replace(/^www\./, "")}${path}`;
    } catch { return "Reading a source"; }
  }

  function renderActivity(lines) {
    if (!lines || !lines.length) return;
    $("activity").innerHTML = lines.slice(-8).map((p) => `<li>${esc(prettyLine(p.line))}</li>`).join("");
  }

  const QUOTES = [
    ["Whenever the people are well-informed, they can be trusted with their own government.", "Thomas Jefferson"],
    ["A popular Government, without popular information, or the means of acquiring it, is but a Prologue to a Farce or a Tragedy; or, perhaps both.", "James Madison"],
    ["Let us dare to read, think, speak, and write.", "John Adams"],
    ["The ignorance of one voter in a democracy impairs the security of all.", "John F. Kennedy"],
    ["If a nation expects to be ignorant and free, in a state of civilization, it expects what never was and never will be.", "Thomas Jefferson"],
  ];

  function readyBanner() {
    const [q, who] = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    return `<div class="ready"><div class="wrap"><div class="big">It's ready!</div><blockquote>${esc(q)}<cite>${esc(who)}</cite></blockquote></div></div>`;
  }

  function handle(rec) {
    if (!KEY_RE.test(rec.key || "")) { show("landing"); return; }
    history.replaceState(null, "", `?g=${encodeURIComponent(rec.key)}`);
    if (rec.status === "pending") return startWorking(rec);
    if (rec.status === "queued") { clearInterval(clockTimer); $("queued-where").textContent = where(rec.districts); show("queued"); return; }
    clearInterval(clockTimer);
    if (rec.status === "ready") return renderGuide(rec);
    show("guide");
    $("guide").innerHTML = `<div class="error-box"><h2 class="section-title">We couldn't finish your guide</h2><p>${esc(rec.error)}</p><p><a class="btn" href="./">Start over</a></p></div>`;
  }

  // ---------- Guide rendering ----------
  const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const words = (s) => new Set(String(s || "").toLowerCase().replace(/\(.*?\)/g, " ").split(/[^a-z0-9]+/).filter((w) => w && !["the", "of", "and", "a", "for", "texas", "county", "collin", "district", "no", "place"].includes(w)));
  // Bottom-line rows point at the card with the same name; fall back to the best word overlap.
  function targetFor(name, ids) {
    const exact = "x-" + slug(name);
    if (ids.has(exact)) return exact;
    const w = words(name);
    let best = null, score = 0;
    for (const id of ids) {
      const w2 = ids.get(id);
      let inter = 0; for (const t of w) if (w2.has(t)) inter++;
      const s = inter / Math.max(1, Math.min(w.size, w2.size));
      if (s > score) { score = s; best = id; }
    }
    return score >= 0.6 ? best : null;
  }
  const compactDates = (dates) => (dates || []).slice(0, 4).map((d) => `<span class="date-pill"><b>${esc(d.when)}</b> ${esc(d.what)}</span>`).join("");
  const pickPill = (p) => (/^yes$/i.test(p) ? '<span class="pill yes">YES</span>' : /^no$/i.test(p) ? '<span class="pill no">NO</span>' : esc(p));
  const sources = (list) => (list?.length ? `<p class="sources">Sources: ${list.map((s) => link(s.title || s.url, s.url)).join(" · ")}</p>` : "");

  function bottomLine(g) {
    const ids = new Map();
    for (const r of g.races || []) ids.set("x-" + slug(r.race), words(r.race));
    for (const m of g.measures || []) ids.set("x-" + slug(m.name), words(m.name));
    const rows = (g.bottom_line || []).map((b) => {
      const t = targetFor(b.race, ids);
      const name = t ? `<a class="bl-link" href="#${t}">${esc(b.race)}</a>` : esc(b.race);
      return `<tr>
      <td class="race">${name}</td>
      <td class="pick">${pickPill(b.pick)}${b.judgment_call ? '<span class="pill call">Close call</span>' : ""}</td>
      <td class="reason">${esc(b.reason)}</td></tr>`; }).join("");
    return `<section class="guide-section bottom-line" id="bottom-line">
      <h2>The bottom line</h2>
      <p class="section-note">One pick per race, in ballot order. Click a race for the full reasoning. Print this card and take it with you; written notes are allowed in the voting booth in most states.</p>
      <table class="card-table"><thead><tr><th>Race</th><th>Our pick</th><th>Why</th></tr></thead><tbody>${rows}</tbody></table>
    </section>`;
  }

  function candidate(c, pick) {
    const picked = pick && c.name && pick.toLowerCase().includes(c.name.toLowerCase().split(" ").slice(-1)[0]);
    const endorse = (c.endorsements || []).length
      ? `<p><span class="label">Endorsements:</span></p><ul>${c.endorsements.map((e) => `<li>${link(e.name, e.url)}</li>`).join("")}</ul>` : "";
    return `<div class="cand${picked ? " picked" : ""}">
      <h4>${esc(c.name)}</h4>
      <p class="party">${esc(c.party)}${c.incumbent ? " · Incumbent" : ""}${safeUrl(c.campaign_url) ? ` · ${link("Campaign site", c.campaign_url)}` : ""}</p>
      ${c.positions ? `<p><span class="label">Positions:</span> ${esc(c.positions)}</p>` : ""}
      ${c.record ? `<p><span class="label">Record:</span> ${esc(c.record)}</p>` : ""}
      ${c.shifts ? `<p class="shift"><span class="label">Recent shifts:</span> ${esc(c.shifts)}</p>` : ""}
      ${endorse}
    </div>`;
  }

  function race(r) {
    const tags = (r.principles || []).map((p) => `<span class="tag">${esc(p)}</span>`).join("");
    const cands = r.candidates || [];
    return `<article class="race" id="x-${slug(r.race)}">
      <h3>${esc(r.race)}</h3>
      <p class="pickline">Our pick: <b>${esc(r.pick)}</b>${r.judgment_call ? '<span class="pill call">Close call</span>' : ""}</p>
      ${r.summary ? `<p class="summary">${esc(r.summary)}</p>` : ""}
      ${tags ? `<div class="tags">${tags}</div>` : ""}
      ${r.alternative ? `<p class="alt"><b>If you see it differently:</b> ${esc(r.alternative)}</p>` : ""}
      ${cands.length > 1 || r.case_for_others ? `<details><summary>Full picture: ${cands.length} candidate${cands.length === 1 ? "" : "s"}</summary>
        <div class="cands">${cands.map((c) => candidate(c, r.pick)).join("")}</div>
        ${r.case_for_others ? `<p class="other"><b>The case for the other choices:</b> ${esc(r.case_for_others)}</p>` : ""}
        ${sources(r.sources)}</details>` : sources(r.sources)}
      <a class="back" href="#bottom-line">Back to the bottom line</a>
    </article>`;
  }

  function measure(m) {
    return `<article class="race" id="x-${slug(m.name)}">
      <h3>${esc(m.name)}</h3>
      <p class="pickline">Our pick: ${pickPill(m.pick)}${m.judgment_call ? '<span class="pill call">Close call</span>' : ""}</p>
      ${m.what_it_does ? `<p><b>What it does:</b> ${esc(m.what_it_does)}</p>` : ""}
      ${m.cost ? `<p><b>What it costs:</b> ${esc(m.cost)}</p>` : ""}
      ${m.summary ? `<p class="summary">${esc(m.summary)}</p>` : ""}
      ${m.case_for_other_side ? `<p class="other"><b>The case for the other side:</b> ${esc(m.case_for_other_side)}</p>` : ""}
      ${sources(m.sources)}
      <a class="back" href="#bottom-line">Back to the bottom line</a>
    </article>`;
  }

  function grouped(items, render, order) {
    const groups = {};
    for (const it of items || []) (groups[it.section || "Other"] ||= []).push(it);
    const keys = Object.keys(groups).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    return keys.map((k) => `<section class="guide-section"><h2>${esc(k)}</h2>${groups[k].map(render).join("")}</section>`).join("");
  }

  function fmtDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return iso;
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }

  function renderGuide(rec) {
    const g = rec.guide || {};
    const el = g.election || {};
    const when = rec.generated_at ? new Date(rec.generated_at * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
    const j = g.jurisdiction || {};
    const dates = (g.key_dates || []).map((d) => `<div class="date"><b>${esc(d.when)}</b>${esc(d.what)}</div>`).join("");
    const list = (arr) => (arr?.length ? `<ul class="plain-list">${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");

    $("guide").innerHTML = `
      ${justFinished ? readyBanner() : ""}
      <div class="guide-head"><div class="wrap">
        <p class="eyebrow">${esc(el.name || "Your ballot")}${el.date ? ` · ${esc(fmtDate(el.date))}` : ""}</p>
        <h1>Your voter guide</h1>
        <p class="guide-meta">${esc(j.summary || where(rec.districts))}${j.precinct ? ` · Precinct ${esc(j.precinct)}` : ""}${when ? ` · Researched ${esc(when)}` : ""}</p>
        ${g.key_dates?.length ? `<p class="date-strip">${compactDates(g.key_dates)}</p>` : ""}
        <div class="guide-actions">
          <button class="btn" onclick="window.print()">Print the bottom line</button>
          <button class="btn ghost" id="copy-link">Copy link</button>
          <a class="btn ghost" href="./">New address</a>
        </div>
      </div></div>
      <div class="wrap guide-body">
        ${bottomLine(g)}
        ${grouped(g.races, race, ["Federal", "Statewide", "Legislative", "State courts", "Appellate and district courts", "Judicial", "County", "Local"])}
        ${g.measures?.length ? `<section class="guide-section"><h2>Propositions and measures</h2>${g.measures.map(measure).join("")}</section>` : ""}
        ${feedbackForm(rec.key)}
        <section class="guide-section more"><h2>More information</h2>
          ${dates || g.voting_info?.length ? `<details><summary>Key dates and how to vote</summary>${dates ? `<div class="dates">${dates}</div>` : ""}${list(g.voting_info)}</details>` : ""}
          ${g.not_on_ballot?.length ? `<details><summary>Not on your ballot this time</summary>${list(g.not_on_ballot)}</details>` : ""}
          ${g.caveats?.length ? `<details><summary>Notes and open questions</summary>${list(g.caveats)}</details>` : ""}
          <details><summary>Resources consulted</summary>
            <p class="section-note">Specific sources are linked under each race. These are the kinds of sources this guide draws on.</p>
            ${list(g.resources_consulted)}
            ${j.ballot_source && safeUrl(j.ballot_source.url) ? `<p>Ballot source: ${link(j.ballot_source.title || "Official sample ballot", j.ballot_source.url)}</p>` : ""}
          </details>
        </section>
      </div>`;
    justFinished = false;
    $("guide").addEventListener("click", (e) => {
      const a = e.target.closest("a.bl-link");
      if (!a) return;
      const target = document.getElementById(a.getAttribute("href").slice(1));
      if (!target) return;
      e.preventDefault();
      const d = target.querySelector("details");
      if (d) d.open = true;
      target.classList.add("flash");
      setTimeout(() => target.classList.remove("flash"), 1600);
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    wireFeedback(rec.key);
    $("copy-link").onclick = async () => {
      try { await navigator.clipboard.writeText(location.href); $("copy-link").textContent = "Link copied"; } catch {}
    };
    show("guide");
  }

  // ---------- Feedback ----------
  function feedbackForm(key) {
    return `<section class="guide-section feedback" id="feedback">
      <h2>Tell us what you think</h2>
      <p>The good and the bad both help. What was useful? What was wrong, missing, or unfair?</p>
      <form id="fb-form">
        <div class="rating">
          <label><input type="radio" name="rating" value="helpful"><span>Helpful</span></label>
          <label><input type="radio" name="rating" value="mixed"><span>Mixed</span></label>
          <label><input type="radio" name="rating" value="not-helpful"><span>Not helpful</span></label>
        </div>
        <label class="lbl" for="fb-good">What worked</label>
        <textarea id="fb-good" maxlength="2000"></textarea>
        <label class="lbl" for="fb-bad">What didn't</label>
        <textarea id="fb-bad" maxlength="2000"></textarea>
        <button class="btn" type="submit">Send feedback</button>
        <span id="fb-msg" style="margin-left:12px"></span>
      </form>
    </section>`;
  }

  function wireFeedback(key) {
    const form = $("fb-form");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const rating = (form.querySelector('input[name=rating]:checked') || {}).value || "";
      try {
        await api("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, rating, good: $("fb-good").value, bad: $("fb-bad").value }) });
        form.innerHTML = '<p class="thanks">Thank you. We read every note.</p>';
      } catch (err) { $("fb-msg").textContent = err.message; }
    });
  }

  $("queued-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const key = new URLSearchParams(location.search).get("g") || "";
    try {
      await api("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, email: $("queued-email").value.trim() }) });
      $("queued-form").innerHTML = '<p class="notify-msg">Thanks. We will email you the link when your guide is ready.</p>';
    } catch (err) { $("queued-msg").style.color = "#b3262e"; $("queued-msg").textContent = err.message; }
  });

  $("notify-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const key = new URLSearchParams(location.search).get("g") || "";
    try {
      await api("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, email: $("notify-email").value.trim() }) });
      $("notify-form").innerHTML = '<p class="notify-msg">We will email you the link as soon as it is ready. You can close this page.</p>';
    } catch (err) { $("notify-msg").style.color = "#b3262e"; $("notify-msg").textContent = err.message; }
  });

  // ---------- Wire up ----------
  $("remind").addEventListener("change", () => { $("email-row").hidden = !$("remind").checked; if ($("remind").checked) $("email").focus(); });
  $("lookup").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("form-error").hidden = true;
    const btn = e.submitter || $("lookup").querySelector("button");
    btn.disabled = true; btn.textContent = "Finding your ballot…";
    try {
      if (accessCode()) store.set("lf_code", accessCode());
      const rec = await api("/api/guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: $("address").value, code: accessCode(),
          subscribe_email: $("remind").checked ? $("email").value.trim() : "" }),
      });
      handle(rec);
    } catch (err) {
      $("form-error").textContent = err.message;
      $("form-error").hidden = false;
      if (/access code/i.test(err.message)) $("code-row").hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = "Get my guide";
    }
  });

  loadConfig().then(async () => {
    const key = params.get("g") || "";
    if (!KEY_RE.test(key)) { if (key) history.replaceState(null, "", "./"); return; }
    try { handle(await api(`/api/guide/${encodeURIComponent(key)}`)); } catch { show("landing"); }
  }).catch(() => {
    $("form-error").textContent = "The guide service is offline right now. Please try again later.";
    $("form-error").hidden = false;
  });
})();
