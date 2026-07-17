/* Status / setup-wizard view. State arrives from the main process (UiState in
 * orchestrator.ts); this file only renders it and reports button clicks back.
 * Opened outside Electron (no preload bridge) it renders a demo state, which
 * keeps the UI previewable in a plain browser. */
"use strict";

const api = window.switchyardDesktop ?? {
  getState: async () => DEMO_STATE,
  action: async (id) => console.log("action:", id),
  onState: () => {},
};

const DEMO_STATE = {
  version: "dev",
  phase: "starting",
  steps: [
    { id: "engine", label: "Container engine (Docker Desktop)", status: "done" },
    { id: "services", label: "Core services — Dokploy, Postgres, Redis", status: "active", note: "pulling images ..." },
    { id: "dokploy", label: "Dokploy API", status: "pending" },
    { id: "admin", label: "Admin account", status: "pending" },
    { id: "dashboard", label: "Switchyard dashboard", status: "pending" },
  ],
  logTail: ["[00:00:01] demo mode — no Electron bridge"],
};

const viewEl = document.getElementById("view");
const logEl = document.getElementById("log");
const versionEl = document.getElementById("version");

let lastViewKey = "";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

// ---- step list -----------------------------------------------------------------

function stepMark(status) {
  if (status === "done") return '<span class="mark">✓</span>';
  if (status === "failed") return '<span class="mark">✕</span>';
  if (status === "active") return '<span class="mark"><span class="spinner"></span></span>';
  return '<span class="mark"><span class="dot"></span></span>';
}

function stepsHtml(steps) {
  return `<ul class="steps">${steps
    .map(
      (s) =>
        `<li class="step ${s.status}">${stepMark(s.status)}<span class="label">${esc(s.label)}</span>${
          s.note ? `<span class="note">${esc(s.note)}</span>` : ""
        }</li>`,
    )
    .join("")}</ul>`;
}

// ---- views ------------------------------------------------------------------------

function startingView(state) {
  return `<h2>Getting everything ready</h2>
    <p>Switchyard is converging your stack. First runs download container images and can take a few minutes; after that it's seconds.</p>
    <div id="steps">${stepsHtml(state.steps)}</div>`;
}

function workingView() {
  return `<div class="center"><span class="spinner big"></span><p>Working ...</p></div>`;
}

function readyView() {
  return `<div class="center"><span class="spinner big"></span><p>Everything is up — opening your dashboard ...</p></div>`;
}

function stoppedView() {
  return `<h2>The stack is stopped</h2>
    <p>Your data is safe in Docker volumes. Start it again whenever you're ready.</p>
    <div class="actions"><button class="btn primary" data-action="start" type="button">Start Switchyard</button></div>`;
}

function wizardView(state) {
  const w = state.wizard ?? {};
  const notice = w.message ? `<div class="notice">${esc(w.message)}</div>` : "";
  switch (w.kind) {
    case "docker-missing": {
      const isMac = w.platform === "darwin";
      return `<h2>One-time setup: Docker Desktop</h2>
        <p>Switchyard runs your apps in containers, which needs <strong>Docker Desktop</strong> (free for personal use). This is the only prerequisite — Switchyard installs and manages everything else itself.</p>
        ${notice}
        <div class="actions">
          <button class="btn primary" data-action="installDocker" type="button">Install Docker Desktop for me</button>
          <button class="btn" data-action="recheckDocker" type="button">I already installed it — check again</button>
        </div>
        <p class="fineprint">Installing means you accept the
          <button class="linklike" data-action="openUrl" data-url="${esc(w.licenseUrl)}" type="button">Docker Subscription Service Agreement</button>.${
            isMac ? "" : " Windows will ask for administrator permission during the install."
          }</p>`;
    }
    case "downloading": {
      const pct = Math.round((w.progress ?? 0) * 100);
      return `<h2>Downloading Docker Desktop</h2>
        <p>Fetching the official installer from docker.com ...</p>
        <div class="progress"><div id="dlbar" style="width:${pct}%"></div></div>
        <p class="fineprint" id="dlpct">${pct}%</p>`;
    }
    case "installing":
      return `<h2>Installing Docker Desktop</h2>
        <div class="center"><span class="spinner big"></span></div>
        <p>Windows will show an <strong>administrator permission</strong> prompt — choose Yes. This takes a few minutes.</p>`;
    case "install-manual":
      return `<h2>Almost there</h2>
        <p>${esc(w.message ?? "Finish the Docker Desktop install, then continue.")}</p>
        <div class="actions"><button class="btn primary" data-action="recheckDocker" type="button">Continue</button></div>`;
    case "reboot-required":
      return `<h2>Restart required</h2>
        ${notice}
        <div class="actions"><button class="btn" data-action="recheckDocker" type="button">Check again</button></div>`;
    case "start-failed":
      return `<h2>Docker Desktop didn't start</h2>
        ${notice}
        <div class="actions">
          <button class="btn primary" data-action="recheckDocker" type="button">Try again</button>
          <button class="btn" data-action="logs" type="button">View logs</button>
        </div>`;
    default:
      return workingView();
  }
}

function credentialsView(state) {
  const c = state.credentials ?? {};
  return `<h2>Sign in to Dokploy</h2>
    <div class="notice" id="credmsg">${esc(c.message ?? "")}</div>
    <form id="credform">
      <div class="field"><label for="cred-email">Admin email</label>
        <input id="cred-email" type="email" autocomplete="username" value="${esc(c.email ?? "")}" required /></div>
      <div class="field"><label for="cred-password">Admin password</label>
        <input id="cred-password" type="password" autocomplete="current-password" required /></div>
      <div class="actions"><button class="btn primary" type="submit">Sign in</button></div>
    </form>`;
}

function errorView(state) {
  const err = state.error ?? { title: "Something went wrong", message: "", actions: [] };
  const buttons = (err.actions ?? [])
    .map(
      (a) =>
        `<button class="btn ${a.kind === "primary" ? "primary" : a.kind === "danger" ? "danger" : ""}" data-action="${esc(
          a.id,
        )}" type="button">${esc(a.label)}</button>`,
    )
    .join("");
  return `<h2>${esc(err.title)}</h2>
    <p class="errmsg">${esc(err.message)}</p>
    <div class="actions">${buttons}</div>
    ${err.detail ? `<details class="errdetail"><summary>Technical detail</summary><pre>${esc(err.detail)}</pre></details>` : ""}`;
}

// ---- render loop --------------------------------------------------------------------

function render(state) {
  if (!state) return;
  versionEl.textContent = `Switchyard Desktop v${state.version}`;

  const viewKey = `${state.phase}:${state.wizard?.kind ?? ""}`;
  const structural = viewKey !== lastViewKey;

  if (structural) {
    lastViewKey = viewKey;
    switch (state.phase) {
      case "boot":
      case "starting":
        viewEl.innerHTML = startingView(state);
        break;
      case "working":
        viewEl.innerHTML = workingView();
        break;
      case "ready":
        viewEl.innerHTML = readyView();
        break;
      case "stopped":
        viewEl.innerHTML = stoppedView();
        break;
      case "wizard":
        viewEl.innerHTML = wizardView(state);
        break;
      case "credentials":
        viewEl.innerHTML = credentialsView(state);
        wireCredForm();
        break;
      case "error":
        viewEl.innerHTML = errorView(state);
        break;
      default:
        viewEl.innerHTML = workingView();
    }
  } else {
    // In-place updates that must not clobber form inputs.
    if (state.phase === "starting" || state.phase === "boot") {
      const steps = document.getElementById("steps");
      if (steps) steps.innerHTML = stepsHtml(state.steps);
    } else if (state.phase === "wizard" && state.wizard?.kind === "downloading") {
      const pct = Math.round((state.wizard.progress ?? 0) * 100);
      const bar = document.getElementById("dlbar");
      const label = document.getElementById("dlpct");
      if (bar) bar.style.width = `${pct}%`;
      if (label) label.textContent = `${pct}%`;
    } else if (state.phase === "credentials") {
      const msg = document.getElementById("credmsg");
      if (msg) msg.textContent = state.credentials?.message ?? "";
    }
  }

  const stick = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 8;
  logEl.textContent = (state.logTail ?? []).join("\n");
  if (stick) logEl.scrollTop = logEl.scrollHeight;
}

function wireCredForm() {
  const form = document.getElementById("credform");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = document.getElementById("cred-email").value.trim();
    const password = document.getElementById("cred-password").value;
    if (email && password) void api.action("submitCredentials", { email, password });
  });
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const id = btn.dataset.action;
  if (id === "openUrl") void api.action("openUrl", btn.dataset.url);
  else void api.action(id);
});

api.onState(render);
api.getState().then(render);
