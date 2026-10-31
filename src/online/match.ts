import { createStore } from "../store";
import { findLine } from "../game/logic";
import { connect, type Backend, type GameWrite, type Unsub } from "./firebase";
import { clockMs, countdownLeft, COUNTDOWN, GRACE } from "./clock";
import type { Game, Seat, TimeControl } from "./types";

/**
 * Online match state machine.
 *
 *   idle ─create─▶ connecting ─▶ waiting (host) ──opponent joins──▶ playing ─▶ over
 *                       └──────▶ invited (guest) ─join─▶ joining ──▶ playing
 *   any ─failure─▶ error
 *
 * Rematch runs alongside `over`:
 *   none ─request─▶ sending ─▶ sent      (host of the new game; waits on it)
 *   none ─opponent asks─▶ offered ─accept─▶ accepting (joins the new game)
 * While a rematch is being set up, `prev` keeps the finished game on screen.
 */
export type Phase = "idle" | "connecting" | "waiting" | "invited" | "joining" | "playing" | "over" | "error";
export type Rematch = "none" | "sending" | "sent" | "offered" | "accepting";

export interface MatchError {
  emoji: string;
  title: string;
  text: string;
  retry: "open" | "create";
}

export interface Shown {
  id: string;
  game: Game;
  seat: Seat | null;
}

export interface MatchState {
  phase: Phase;
  gameId: string | null;
  game: Game | null;
  seat: Seat | null;
  prev: Shown | null;
  rematch: Rematch;
  rematchId: string | null;
  oppOnline: boolean | null;
  /** Lost the connection after having had one. */
  offline: boolean;
  busy: null | "create" | "join" | "move" | "resign";
  /** Recoverable error shown inline in the current sheet. */
  notice: string | null;
  error: MatchError | null;
  tc: TimeControl;
}

const initial: MatchState = {
  phase: "idle", gameId: null, game: null, seat: null, prev: null,
  rematch: "none", rematchId: null, oppOnline: null, offline: false,
  busy: null, notice: null, error: null, tc: { base: 30000, inc: 2000 },
};

export const match = createStore<MatchState>(initial);

/** One-off events for the UI (not state): "rejected" (detail: card), "error" (detail: message). */
export const matchEvents = new EventTarget();
const emit = (type: string, detail?: unknown) => matchEvents.dispatchEvent(new CustomEvent(type, { detail }));

const ERR = {
  load: { emoji: "📡", title: "Couldn't connect", text: "Online play didn't load. Check your connection (or ad blocker) and try again.", retry: "open" },
  notFound: { emoji: "🤷", title: "Game not found", text: "This challenge link doesn't exist. Start a new one?", retry: "create" },
  taken: { emoji: "😬", title: "Too late", text: "Someone else already accepted this challenge.", retry: "create" },
} satisfies Record<string, MatchError>;

let backend: Backend | null = null;
const subs: Unsub[] = [];    // listeners for the current game
const carried: Unsub[] = []; // the previous game's listeners, kept alive during a rematch handshake
let presenceOn = false;
let autoJoin: { name: string } | null = null;
let loadTimer = 0;
let flagClaimedAt: number | null = null;

const stopAll = (list: Unsub[]) => list.splice(0).forEach(u => u());
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
const handKey = (s: Seat): "h0" | "h1" => (s === 0 ? "h0" : "h1");
const bankKey = (s: Seat): "b0" | "b1" => (s === 0 ? "b0" : "b1");
const other = (s: Seat) => (1 - s) as Seat;

export const serverNow = () => backend?.now() ?? Date.now();

/** The game to draw: the finished one during a rematch handshake, otherwise the current one. */
export function shown(s = match.get()): Shown | null {
  if (s.prev && s.phase !== "playing" && s.phase !== "over") return s.prev;
  return s.game && s.gameId ? { id: s.gameId, game: s.game, seat: s.seat } : null;
}

export function canMove(s = match.get()) {
  const g = s.game;
  return !!g && s.phase === "playing" && s.seat !== null && g.turn === s.seat
    && s.busy !== "move" && countdownLeft(g, serverNow()) === 0;
}

export const setTimeControl = (tc: TimeControl) => match.set({ tc });

function fail(error: MatchError) {
  clearTimeout(loadTimer);
  stopAll(subs);
  stopAll(carried);
  presenceOn = false;
  autoJoin = null;
  match.set({ phase: "error", error, busy: null, prev: null, rematch: "none", rematchId: null });
}

export function leave() {
  clearTimeout(loadTimer);
  stopAll(subs);
  stopAll(carried);
  presenceOn = false;
  autoJoin = null;
  match.set({ ...initial, tc: match.get().tc });
  history.replaceState(null, "", location.pathname);
}

export async function openGame(id: string, opts: { autoJoinAs?: string; keepBoard?: boolean } = {}) {
  const s = match.get();
  clearTimeout(loadTimer);
  if (opts.keepBoard) {
    carried.push(...subs.splice(0)); // keep showing the old game and our presence in it
    match.set({ prev: shown(s) });
  } else {
    stopAll(subs);
    stopAll(carried);
    match.set({ prev: null, rematch: "none", rematchId: null, oppOnline: null });
  }
  presenceOn = false;
  flagClaimedAt = null;
  autoJoin = opts.autoJoinAs !== undefined ? { name: opts.autoJoinAs } : null;
  match.set({ phase: "connecting", gameId: id, game: null, seat: null, busy: null, notice: null, error: null });
  history.replaceState(null, "", `?g=${id}`);

  try {
    backend = await connect();
  } catch {
    if (match.get().gameId === id) fail(ERR.load);
    return;
  }
  if (match.get().gameId !== id) return; // superseded by a newer action
  loadTimer = window.setTimeout(() => {
    if (match.get().gameId === id && !match.get().game) fail(ERR.load);
  }, 12000);
  let wasConnected = false;
  subs.push(backend.watchGame(id, g => onGame(id, g), () => fail(ERR.load)));
  subs.push(backend.watchConnected(c => {
    wasConnected ||= c;
    if (match.get().offline !== (wasConnected && !c)) match.set({ offline: wasConnected && !c });
  }));
}

function onGame(id: string, g: Game | null) {
  const s = match.get();
  if (s.gameId !== id || !backend) return;
  clearTimeout(loadTimer);
  if (!g) return fail(ERR.notFound);

  const seat: Seat | null = g.host === backend.uid ? 0 : g.guest === backend.uid ? 1 : null;
  const phase: Phase = g.status !== "waiting" ? g.status
    : seat === 0 ? "waiting" : s.phase === "joining" ? "joining" : "invited";

  let { rematch, rematchId, prev } = s;
  if (g.status === "over" && g.rematch && rematch === "none") {
    rematch = "offered";
    rematchId = g.rematch;
  }
  if (phase === "playing" && s.phase !== "playing") {
    stopAll(carried); // the rematch (if any) has started; drop the old game
    prev = null;
    rematch = "none";
    rematchId = null;
  }
  match.set({ game: g, seat, phase, rematch, rematchId, prev });

  if (seat !== null && g.status !== "waiting" && !presenceOn) {
    presenceOn = true;
    subs.push(backend.announce(id, seat));
    subs.push(backend.watchPresence(id, other(seat), on => match.set({ oppOnline: on })));
  }
  if (phase === "invited" && autoJoin) {
    const { name } = autoJoin;
    autoJoin = null;
    void join(name);
  }
}

async function createGame(name: string, starter: Seat, tc: TimeControl): Promise<string | null> {
  try {
    backend = await connect();
    const id = newId();
    const g: GameWrite = { host: backend.uid, base: tc.base, inc: tc.inc, starter,
      createdAt: backend.serverTime, status: "waiting", h0: "", h1: "" };
    if (name) g.hostName = name;
    await backend.createGame(id, g);
    return id;
  } catch {
    return null;
  }
}

export async function startChallenge(name: string) {
  if (match.get().busy) return;
  match.set({ busy: "create", notice: null });
  const id = await createGame(name, Math.random() < .5 ? 0 : 1, match.get().tc);
  match.set({ busy: null });
  if (!id) return match.set({ notice: "Couldn't create the game. Check your connection and try again." });
  await openGame(id);
}

export async function join(name = "") {
  const s = match.get(), g = s.game, id = s.gameId;
  if (!backend || !g || !id || g.status !== "waiting" || s.busy) return;
  match.set({ phase: "joining", busy: "join", notice: null });
  const u: GameWrite = { guest: backend.uid, status: "playing", turn: g.starter, turnAt: backend.serverTime, owe: -1,
    b0: g.base + (g.starter === 0 ? COUNTDOWN : 0), b1: g.base + (g.starter === 1 ? COUNTDOWN : 0) };
  if (name) u.guestName = name;
  try {
    await backend.updateGame(id, u);
    match.set({ busy: null });
  } catch {
    match.set({ busy: null });
    const fresh = await backend.readGame(id).catch(() => null);
    if (match.get().gameId !== id) return;
    if (fresh && fresh.status !== "waiting") fail(ERR.taken);
    else match.set({ phase: "invited", notice: "Couldn't join. Check your connection and try again." });
  }
}

export function move(n: number) {
  const s = match.get(), g = s.game, p = s.seat, id = s.gameId;
  if (!backend || !g || p === null || !id || !canMove(s)) return;
  if (g.h0.includes(String(n)) || g.h1.includes(String(n))) return;
  const q = other(p), hand = g[handKey(p)] + n;
  const u: GameWrite = { last: String(n), turnAt: backend.serverTime, prevAt: g.turnAt, owe: p, turn: q };
  u[handKey(p)] = hand;
  if (g.owe === q) u[bankKey(q)] = g[bankKey(q)]! - (g.turnAt! - g.prevAt!) + g.inc; // settle their last turn
  if (findLine([...hand].map(Number))) Object.assign(u, { status: "over", winner: p, reason: "line" });
  else if (hand.length + g[handKey(q)].length === 9) Object.assign(u, { status: "over", winner: -1, reason: "draw" });
  match.set({ busy: "move" });
  backend.updateGame(id, u)
    .catch(() => emit("rejected", n))
    .finally(() => match.set({ busy: null }));
}

export async function resign() {
  const s = match.get();
  if (!backend || !s.gameId || s.seat === null || s.phase !== "playing" || s.busy) return;
  match.set({ busy: "resign" });
  try {
    await backend.updateGame(s.gameId, { status: "over", winner: other(s.seat), reason: "resign" });
  } catch {
    emit("error", "Couldn't resign. The game may have just ended.");
  } finally {
    match.set({ busy: null });
  }
}

/** Called on every clock tick; the rules only accept the claim once the server agrees time is up. */
export function checkFlag() {
  const s = match.get(), g = s.game;
  if (!backend || !g || !s.gameId || s.phase !== "playing" || s.seat === null || g.turn === undefined) return;
  if (flagClaimedAt === g.turnAt || clockMs(g, g.turn, backend.now()) > -(GRACE + 250)) return;
  flagClaimedAt = g.turnAt!;
  backend.updateGame(s.gameId, { status: "over", winner: other(g.turn), reason: "time" })
    .catch(() => setTimeout(() => { flagClaimedAt = null; }, 1000));
}

const myName = (g: Game, seat: Seat) => (seat === 0 ? g.hostName : g.guestName) ?? "";

export async function requestRematch() {
  const s = match.get(), g = s.game, oldId = s.gameId;
  if (!backend || !g || !oldId || s.seat === null || s.phase !== "over") return;
  if (s.rematch === "offered") return acceptRematch();
  if (s.rematch !== "none") return;

  match.set({ rematch: "sending", notice: null });
  const starter: Seat = s.seat === g.starter ? 1 : 0; // whoever didn't start last time goes first
  const id = await createGame(myName(g, s.seat), starter, { base: g.base, inc: g.inc });
  if (match.get().gameId !== oldId) return;
  try {
    if (!id) throw new Error("create failed");
    await backend.updateGame(oldId, { rematch: id });
  } catch {
    // Most likely they asked at the same moment: join theirs instead.
    const theirs = (await backend.readGame(oldId).catch(() => null))?.rematch;
    if (theirs) {
      match.set({ rematch: "offered", rematchId: theirs });
      return acceptRematch();
    }
    return match.set({ rematch: "none", notice: "Couldn't send the rematch. Try again." });
  }
  match.set({ rematch: "sent", rematchId: id });
  await openGame(id, { keepBoard: true });
}

export async function acceptRematch() {
  const s = match.get();
  if (s.rematch !== "offered" || !s.rematchId || !s.game || s.seat === null) return;
  match.set({ rematch: "accepting" });
  await openGame(s.rematchId, { autoJoinAs: myName(s.game, s.seat), keepBoard: true });
}

export function retry() {
  const { error, gameId } = match.get();
  if (error?.retry === "open" && gameId) return openGame(gameId);
  leave();
}
