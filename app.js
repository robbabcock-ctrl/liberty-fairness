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
  if (params.get("code")) store.set("lf_code", params.get("code"));
  const accessCode = () => ($("code").value || store.get("lf_code") || "").trim();

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);
  const link = (text, url) => (safeUrl(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text));

  function show(view) {
    for (const id of ["landing", "working", "guide"]) $(id).hidden = id !== view;
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
      document.querySelectorAll(".working-steps li").forEach((li) => li.classList.toggle("on", s >= +li.dataset.at));
    };
    tick();
    clockTimer = setInterval(tick, 1000);
    clearTimeout(pollTimer);
    const poll = async () => {
      try {
        const r = await api(`/api/guide/${encodeURIComponent(rec.key)}`);
        if (r.status === "pending") { pollTimer = setTimeout(poll, 10000); return; }
        handle(r);
      } catch { pollTimer = setTimeout(poll, 15000); }
    };
    pollTimer = setTimeout(poll, 10000);
  }

  function handle(rec) {
    history.replaceState(null, "", `?g=${encodeURIComponent(rec.key)}`);
    if (rec.status === "pending") return startWorking(rec);
    clearInterval(clockTimer);
    if (rec.status === "ready") return renderGuide(rec);
    show("guide");
    $("guide").innerHTML = `<div class="error-box"><h2 class="section-title">We couldn't finish your guide</h2><p>${esc(rec.error)}</p><p><a class="btn" href="./">Start over</a></p></div>`;
  }

  // ---------- Guide rendering ----------
  const pickPill = (p) => (/^yes$/i.test(p) ? '<span class="pill yes">YES</span>' : /^no$/i.test(p) ? '<span class="pill no">NO</span>' : esc(p));
  const sources = (list) => (list?.length ? `<p class="sources">Sources: ${list.map((s) => link(s.title || s.url, s.url)).join(" · ")}</p>` : "");

  function bottomLine(g) {
    const rows = (g.bottom_line || []).map((b) => `<tr>
      <td class="race">${esc(b.race)}</td>
      <td class="pick">${pickPill(b.pick)}${b.judgment_call ? '<span class="pill call">Close call</span>' : ""}</td>
      <td class="reason">${esc(b.reason)}</td></tr>`).join("");
    return `<section class="guide-section bottom-line">
      <h2>The bottom line</h2>
      <p class="section-note">One pick per race, in ballot order. Print this card and take it with you; written notes are allowed in the voting booth in most states.</p>
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
    return `<article class="race" id="${esc(r.id || "")}">
      <h3>${esc(r.race)}</h3>
      <p class="pickline">Our pick: <b>${esc(r.pick)}</b>${r.judgment_call ? '<span class="pill call">Close call</span>' : ""}</p>
      ${r.summary ? `<p class="summary">${esc(r.summary)}</p>` : ""}
      ${tags ? `<div class="tags">${tags}</div>` : ""}
      ${r.alternative ? `<p class="alt"><b>If you see it differently:</b> ${esc(r.alternative)}</p>` : ""}
      ${cands.length > 1 || r.case_for_others ? `<details><summary>Full picture: ${cands.length} candidate${cands.length === 1 ? "" : "s"}</summary>
        <div class="cands">${cands.map((c) => candidate(c, r.pick)).join("")}</div>
        ${r.case_for_others ? `<p class="other"><b>The case for the other choices:</b> ${esc(r.case_for_others)}</p>` : ""}
        ${sources(r.sources)}</details>` : sources(r.sources)}
    </article>`;
  }

  function measure(m) {
    return `<article class="race" id="${esc(m.id || "")}">
      <h3>${esc(m.name)}</h3>
      <p class="pickline">Our pick: ${pickPill(m.pick)}${m.judgment_call ? '<span class="pill call">Close call</span>' : ""}</p>
      ${m.what_it_does ? `<p><b>What it does:</b> ${esc(m.what_it_does)}</p>` : ""}
      ${m.cost ? `<p><b>What it costs:</b> ${esc(m.cost)}</p>` : ""}
      ${m.summary ? `<p class="summary">${esc(m.summary)}</p>` : ""}
      ${m.case_for_other_side ? `<p class="other"><b>The case for the other side:</b> ${esc(m.case_for_other_side)}</p>` : ""}
      ${sources(m.sources)}
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
      <div class="guide-head"><div class="wrap">
        <p class="eyebrow">${esc(el.name || "Your ballot")}${el.date ? ` · ${esc(fmtDate(el.date))}` : ""}</p>
        <h1>Your voter guide</h1>
        <p class="guide-meta">${esc(j.summary || where(rec.districts))}${j.precinct ? ` · Precinct ${esc(j.precinct)}` : ""}${when ? ` · Researched ${esc(when)}` : ""}</p>
        <div class="guide-actions">
          <button class="btn" onclick="window.print()">Print the bottom line</button>
          <button class="btn ghost" id="copy-link">Copy link</button>
          <a class="btn ghost" href="./">New address</a>
        </div>
      </div></div>
      <div class="wrap guide-body">
        ${bottomLine(g)}
        ${dates || g.voting_info?.length ? `<section class="guide-section"><h2>Key dates and how to vote</h2>${dates ? `<div class="dates">${dates}</div>` : ""}${list(g.voting_info)}</section>` : ""}
        ${grouped(g.races, race, ["Federal", "Statewide", "Legislative", "Judicial", "County", "Local"])}
        ${g.measures?.length ? `<section class="guide-section"><h2>Propositions and measures</h2>${g.measures.map(measure).join("")}</section>` : ""}
        ${g.not_on_ballot?.length ? `<section class="guide-section"><h2>Not on your ballot this time</h2>${list(g.not_on_ballot)}</section>` : ""}
        ${g.caveats?.length ? `<section class="guide-section"><h2>Notes and open questions</h2>${list(g.caveats)}</section>` : ""}
        <section class="guide-section"><h2>Resources consulted</h2>
          <p class="section-note">Specific sources are linked under each race. These are the kinds of sources this guide draws on.</p>
          ${list(g.resources_consulted)}
          ${j.ballot_source && safeUrl(j.ballot_source.url) ? `<p>Ballot source: ${link(j.ballot_source.title || "Official sample ballot", j.ballot_source.url)}</p>` : ""}
        </section>
      </div>`;
    $("copy-link").onclick = async () => {
      try { await navigator.clipboard.writeText(location.href); $("copy-link").textContent = "Link copied"; } catch {}
    };
    show("guide");
  }

  // ---------- Wire up ----------
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
        body: JSON.stringify({ address: $("address").value, code: accessCode() }),
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
    const key = params.get("g");
    if (!key) return;
    try { handle(await api(`/api/guide/${encodeURIComponent(key)}`)); } catch { show("landing"); }
  }).catch(() => {
    $("form-error").textContent = "The guide service is offline right now. Please try again later.";
    $("form-error").hidden = false;
  });
})();
