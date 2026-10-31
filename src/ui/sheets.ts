import { app, loadStats, newGame, setMode } from "../local";
import { tcLabel } from "../online/clock";
import { acceptInvite, match, requestRematch, resign, shown, shownOpponent, type MatchState } from "../online/match";
import { social, type Invite, type Opponent } from "../online/social";
import { boardView, DIFF, onlineNames } from "../view";
import { $ } from "./dom";

export const gameUrl = (id: string) => `${location.origin}${location.pathname}?g=${id}`;
export function savedName() { try { return localStorage.getItem("pick15-name") ?? ""; } catch { return ""; } }
export function saveName(n: string) { try { localStorage.setItem("pick15-name", n); } catch {} }
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

interface Action {
  label: string;
  run?: () => void;
  variant?: "danger" | "glow";
  loading?: boolean;
  disabled?: boolean;
}

// ---------- Invites ----------
const dismissed = new Set<string>();
export const dismissInvite = (gid: string) => { dismissed.add(gid); };

/** The invite to pop up now, if any. Held back while you're mid-game. */
export function currentInvite(): Invite | null {
  const m = match.get();
  if (m.phase === "playing" || m.rematch === "accepting") return null;
  return social.get().incoming.find(i => !dismissed.has(i.gid) && i.gid !== m.gameId) ?? null;
}

/** A rematch request from the opponent on screen. */
function pendingRematch(m: MatchState): Invite | null {
  const opp = shownOpponent(m);
  return opp ? social.get().incoming.find(i => i.kind === "rematch" && i.from === opp) ?? null : null;
}

export function acceptAndGo(inv: Invite) {
  dismissed.add(inv.gid);
  if (app.get().mode !== "online") setMode("online");
  app.set({ sheet: shownOpponent() === inv.from ? "result" : null });
  void acceptInvite(inv, savedName());
}

// ---------- Primary actions (one source of truth for label + behaviour) ----------
let confirmResign = false;
let confirmTimer = 0;

function rematchAction(m: MatchState): Action {
  switch (m.rematch) {
    case "sending": return { label: "Rematch", loading: true };
    case "sent": return { label: "Rematch sent", disabled: true };
    case "accepting": return { label: "Accept rematch", loading: true };
    case "declined": return { label: "Declined", disabled: true };
  }
  const theirs = pendingRematch(m);
  if (theirs) return { label: "Accept rematch", run: () => acceptAndGo(theirs), variant: "glow" };
  return { label: "Rematch", run: requestRematch };
}

/** The button under the board. */
export function controlAction(): Action {
  const a = app.get(), m = match.get();
  if (a.mode !== "online") return { label: "New game", run: newGame };
  if (m.prev && m.rematch !== "none") return rematchAction(m);
  const player = m.seat !== null;
  if (m.phase === "waiting" && player) return { label: "Share link", run: () => app.set({ sheet: "online" }) };
  if (m.phase === "playing" && player) {
    if (m.busy === "resign") return { label: "Resign", variant: "danger", loading: true };
    if (confirmResign) return { label: "Tap again to resign", variant: "danger", run: () => { confirmResign = false; void resign(); } };
    return { label: "Resign", variant: "danger", run: () => {
      confirmResign = true;
      clearTimeout(confirmTimer);
      confirmTimer = window.setTimeout(() => { confirmResign = false; renderControls(); }, 2500);
      renderControls();
    } };
  }
  if (m.phase === "over" && player) return rematchAction(m);
  return { label: "New challenge", run: () => app.set({ sheet: "online" }) };
}

/** The primary button in the result sheet. */
export function resultAction(): Action {
  const a = app.get(), m = match.get();
  if (a.mode !== "online") return { label: "Play again", run: newGame };
  if (shown(m)?.seat === null) return { label: "Play vs AI", run: () => setMode("ai") };
  return rematchAction(m);
}

function applyAction(btn: HTMLButtonElement, action: Action) {
  btn.textContent = action.label;
  btn.classList.toggle("loading", !!action.loading);
  btn.classList.toggle("danger", action.variant === "danger");
  btn.classList.toggle("glow", action.variant === "glow");
  btn.disabled = !!action.disabled || !!action.loading;
  btn.setAttribute("aria-busy", String(!!action.loading));
}

// ---------- Rendering ----------
export function renderControls() {
  const a = app.get(), online = a.mode === "online";
  document.querySelectorAll<HTMLButtonElement>("#modeSeg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === a.mode)));
  document.querySelectorAll<HTMLButtonElement>("#diffSeg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.diff === a.diff)));
  $("diffSeg").hidden = a.mode !== "ai";
  $("hintsSwitch").hidden = online;
  $<HTMLInputElement>("hints").checked = a.hints;
  applyAction($("newBtn") as HTMLButtonElement, controlAction());
  const streak = loadStats().streak ?? 0;
  $("streak").hidden = online || streak < 2;
  $("streak").textContent = `🔥 ${streak}`;
}

let lastPart: string | null = null;

export function renderSheets() {
  const a = app.get(), m = match.get(), online = a.mode === "online";
  $("helpSheet").hidden = a.sheet !== "help";
  $("resultSheet").hidden = a.sheet !== "result";
  const part = online && a.sheet === "online" ? onlinePart(m) : null;
  $("onlineSheet").hidden = part === null;
  if (part) renderOnlineSheet(m, part);
  lastPart = part;
  if (a.sheet === "result") online ? renderOnlineResult(m) : renderLocalResult();
  renderInvite();
  $("netBanner").hidden = !(online && m.offline);
}

function renderInvite() {
  const inv = currentInvite(), pop = $("invitePop");
  pop.hidden = !inv;
  if (!inv) return;
  const name = inv.fromName || "Someone";
  const known = social.get().opponents.find(o => o.uid === inv.from);
  $("ipEmoji").textContent = inv.kind === "rematch" ? "🔁" : "⚔️";
  $("ipTitle").textContent = inv.kind === "rematch" ? `${name} wants a rematch` : `${name} challenges you`;
  const record = known && known.w + known.d + known.l ? ` You're ${known.w}–${known.l}${known.d ? `–${known.d}` : ""} against them.` : "";
  $("ipText").textContent = `A live game, ${tcLabel(inv)} per player.${record}`;
}

function onlinePart(m: MatchState): string | null {
  if (m.prev) return null; // rematch handshakes happen in the result sheet
  switch (m.phase) {
    case "idle": return "olCreate";
    case "connecting": return "olLoading";
    case "waiting": return "olWaiting";
    case "invited": case "joining": return "olInvite";
    case "error": return "olMsg";
    default: return null;
  }
}

function ago(ms: number) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  if (min < 60 * 24) return `${Math.round(min / 60)}h ago`;
  return `${Math.round(min / 1440)}d ago`;
}

function renderFriends(m: MatchState) {
  const { opponents, online } = social.get(), box = $("olFriends");
  box.hidden = opponents.length === 0;
  if (!opponents.length) return;
  const row = (o: Opponent) => {
    const on = !!online[o.uid], name = esc(o.name || "Anonymous");
    const record = `${o.w}W ${o.l}L${o.d ? ` ${o.d}D` : ""}`;
    const busy = m.busy === "create" && m.busyFor === o.uid;
    return `<li class="friend">
      <span class="avatar">${esc((o.name || "?")[0].toUpperCase())}</span>
      <span class="who"><b>${name}</b><small><span class="presence ${on ? "on" : ""}"></span>${on ? "online now" : ago(o.last)} · ${record}</small></span>
      <button class="btn small ${on ? "primary" : "ghost"}${busy ? " loading" : ""}" data-uid="${esc(o.uid)}" ${m.busy ? "disabled" : ""}>Challenge</button>
    </li>`;
  };
  const html = `<span class="label">Recent opponents</span><ul>${opponents.map(row).join("")}</ul>`;
  if (box.innerHTML !== html) box.innerHTML = html;
}

function renderOnlineSheet(m: MatchState, part: string) {
  const entering = part !== lastPart;
  for (const id of ["olCreate", "olLoading", "olWaiting", "olInvite", "olMsg"]) $(id).hidden = id !== part;
  const notice = (id: string) => { $(id).hidden = !m.notice; $(id).textContent = m.notice ?? ""; };

  if (part === "olCreate") {
    if (entering) $<HTMLInputElement>("olName").value ||= savedName();
    document.querySelectorAll<HTMLButtonElement>("#tcSeg button").forEach(b =>
      b.setAttribute("aria-pressed", String(+b.dataset.base! === m.tc.base)));
    applyAction($("olCreateBtn") as HTMLButtonElement, { label: "Create challenge link", loading: m.busy === "create" && !m.busyFor, disabled: !!m.busy });
    notice("olCreateNotice");
    renderFriends(m);
  }
  if (part === "olWaiting" && m.gameId) {
    $<HTMLInputElement>("olLink").value = gameUrl(m.gameId);
    $("olWaitTitle").textContent = m.invitee ? `Challenge sent to ${m.invitee.name}` : "Send this link";
    $("olWaitText").textContent = m.invitee
      ? "They'll get a pop-up if they have The 15-Game open. You can also send them this link."
      : "The clock starts when your opponent accepts. Keep this page open.";
  }
  if (part === "olInvite" && m.game) {
    const g = m.game, host = g.hostName || "Someone";
    $("olInviteTitle").textContent = `${host} challenged you`;
    $("olInviteText").textContent = `A live game of The 15-Game, ${tcLabel(g)} per player. Hold three numbers that add up to 15 to win. ${g.starter === 0 ? `${host} moves first.` : "You move first."}`;
    if (entering) $<HTMLInputElement>("olName2").value = savedName();
    applyAction($("olAccept") as HTMLButtonElement, { label: "Accept & play", loading: m.phase === "joining" });
    notice("olInviteNotice");
  }
  if (part === "olMsg" && m.error) {
    $("olMsgEmoji").textContent = m.error.emoji;
    $("olMsgTitle").textContent = m.error.title;
    $("olMsgText").textContent = m.error.text;
    $("olMsgRetry").textContent = m.error.retry === "open" ? "Try again" : "New challenge";
  }
}

function setResult(emoji: string, title: string, text: string, line: number[] | null) {
  $("resEmoji").textContent = emoji;
  $("resTitle").textContent = title;
  $("resText").textContent = text;
  $("resEq").innerHTML = line
    ? line.map(n => `<span class="chip">${n}</span>`).join("<span>+</span>") + `<span>=</span><span class="chip total">15</span>`
    : "";
}

function renderLocalResult() {
  const { mode, diff, game: g } = app.get(), ai = mode === "ai";
  if (g.winner === null) setResult("🤝", "Draw", ai && diff === "hard" ? "You held the unbeatable AI. That's the best anyone can do." : "Every card gone, no 15. Evenly matched.", null);
  else if (ai && g.winner === 0) setResult("🏆", "You win!", `Beat the ${DIFF[diff].label} AI in ${g.hands[0].length} picks.`, g.line);
  else if (ai) setResult("🤖", "AI wins", diff === "easy" ? "Even the casual AI got you. Rematch?" : "Watch for forks — two threats at once.", g.line);
  else setResult("🏆", `Player ${g.winner + 1} wins!`, `Won in ${g.hands[g.winner].length} picks.`, g.line);

  const stats = loadStats(), d = stats[diff] ?? { w: 0, d: 0, l: 0 };
  $("resStats").hidden = !ai;
  $("resStats").innerHTML = `<div class="stat"><b>${d.w}</b><span>Won</span></div><div class="stat"><b>${d.d}</b><span>Drawn</span></div><div class="stat"><b>${d.l}</b><span>Lost</span></div><div class="stat"><b>${stats.streak ?? 0}</b><span>Streak</span></div>`;
  $("rmWait").hidden = $("resNotice").hidden = true;
  applyAction($("againBtn") as HTMLButtonElement, resultAction());
}

function renderOnlineResult(m: MatchState) {
  const sh = shown(m);
  if (!sh || sh.game.status !== "over") return;
  const g = sh.game, names = onlineNames(sh), opp = names[1], spectator = sh.seat === null;
  const { winner, line } = boardView();
  const why = (w: "you" | "them" | "spec") => ({
    time: { you: `${opp} ran out of time.`, them: "You ran out of time.", spec: "Won on time." },
    resign: { you: `${opp} resigned.`, them: "You resigned.", spec: "Won by resignation." },
    line: { you: `Beat ${opp} in a live game.`, them: `${opp} found 15 first.`, spec: "" },
    draw: { you: "", them: "", spec: "" },
  }[g.reason ?? "line"][w]);

  if (winner === null) setResult("🤝", "Draw", "All nine cards gone, no 15.", null);
  else if (spectator) setResult("🏆", `${names[winner]} wins`, why("spec"), line);
  else if (winner === 0) setResult("🏆", "You win!", why("you"), line);
  else setResult(g.reason === "time" ? "⏱" : "😤", `${opp} wins`, why("them"), line);
  $("resStats").hidden = true;

  // Rematch handshake
  const states: Partial<Record<MatchState["rematch"], string>> = {
    sent: `Waiting for ${opp} to accept…`,
    accepting: "Starting the rematch…",
    declined: `${opp} declined the rematch.`,
  };
  const msg = states[m.rematch];
  $("rmWait").hidden = !msg;
  $("rmWait").classList.toggle("declined", m.rematch === "declined");
  $("rmWaitText").textContent = msg ?? "";
  $("rmLeft").hidden = !(m.rematch === "sent" && m.oppOnline === false);
  $("rmLeftText").textContent = `${opp} has left the game.`;
  $("resNotice").hidden = !m.notice;
  $("resNotice").textContent = m.notice ?? "";
  applyAction($("againBtn") as HTMLButtonElement, resultAction());
}
