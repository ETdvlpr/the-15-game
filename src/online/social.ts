import { createStore } from "../store";
import { connect, type Backend, type Unsub } from "./firebase";
import { notify, refreshPush } from "./push";
import type { Game, Seat, TimeControl } from "./types";

/** Someone you've played, from your private /users/{you}/opponents list. */
export interface Opponent {
  uid: string;
  name: string;
  last: number;
  gameId: string;
  w: number;
  d: number;
  l: number;
}

/** A challenge or rematch request waiting in your /inbox. */
export interface Invite {
  gid: string;
  from: string;
  fromName?: string;
  kind: "challenge" | "rematch";
  base: number;
  inc: number;
  at: number;
}

export interface SocialState {
  ready: boolean;
  opponents: Opponent[];
  /** uid -> has The 15-Game open right now */
  online: Record<string, boolean>;
  incoming: Invite[];
}

export const social = createStore<SocialState>({ ready: false, opponents: [], online: {}, incoming: [] });

const INVITE_TTL = 15 * 60 * 1000;
const MAX_OPPONENTS = 20;

let backend: Backend | null = null;
let starting: Promise<void> | null = null;
const statusSubs = new Map<string, Unsub>();

/** Connects and starts listening to your opponents list and inbox. Safe to call repeatedly. */
export function startSocial(): Promise<void> {
  try { localStorage.setItem("pick15-online", "1"); } catch {}
  starting ??= (async () => {
    const b = await connect();
    backend = b;
    const me = b.uid;
    b.announce(`status/${me}`);
    refreshPush();
    b.watch<Record<string, Omit<Opponent, "uid">>>(`users/${me}/opponents`, v => {
      const opponents = Object.entries(v ?? {})
        .map(([uid, o]) => ({ uid, name: o.name ?? "", last: o.last ?? 0, gameId: o.gameId, w: o.w ?? 0, d: o.d ?? 0, l: o.l ?? 0 }))
        .sort((a, b) => b.last - a.last)
        .slice(0, MAX_OPPONENTS);
      social.set({ opponents });
      for (const { uid } of opponents) {
        if (!statusSubs.has(uid)) {
          statusSubs.set(uid, b.watch<boolean>(`status/${uid}`, on =>
            social.set(s => ({ online: { ...s.online, [uid]: !!on } }))));
        }
      }
    });
    b.watch<Record<string, Omit<Invite, "gid">>>(`inbox/${me}`, v => {
      const now = b.now();
      const all = Object.entries(v ?? {}).map(([gid, i]) => ({ gid, ...i }));
      all.filter(i => now - i.at > INVITE_TTL).forEach(i => void b.remove(`inbox/${me}/${i.gid}`).catch(() => {}));
      social.set({ incoming: all.filter(i => now - i.at <= INVITE_TTL).sort((a, b) => a.at - b.at) });
    });
    social.set({ ready: true });
  })().catch(e => { starting = null; throw e; });
  return starting;
}

export const opponentOf = (g: Game, seat: Seat) => (seat === 0 ? g.guest : g.host) ?? null;

/** Upserts the opponent in your list (and bumps your record against them when a result is given). */
export function recordOpponent(g: Game, gameId: string, seat: Seat, result?: "w" | "d" | "l") {
  const opp = opponentOf(g, seat);
  if (!backend || !opp) return Promise.resolve();
  const name = ((seat === 0 ? g.guestName : g.hostName) ?? "").slice(0, 20);
  const prev = social.get().opponents.find(o => o.uid === opp);
  const entry: Record<string, unknown> = { last: backend.serverTime, gameId, w: prev?.w ?? 0, d: prev?.d ?? 0, l: prev?.l ?? 0 };
  if (name || prev?.name) entry.name = name || prev!.name;
  if (result) entry[result] = (entry[result] as number) + 1;
  return backend.write(`users/${backend.uid}/opponents/${opp}`, entry).catch(() => {});
}

export function sendInvite(to: string, gid: string, kind: Invite["kind"], tc: TimeControl, fromName: string) {
  if (!backend) return Promise.reject(new Error("offline"));
  const inv: Record<string, unknown> = { from: backend.uid, kind, base: tc.base, inc: tc.inc, at: backend.serverTime };
  if (fromName) inv.fromName = fromName;
  return backend.write(`inbox/${to}/${gid}`, inv).then(() => void notify(to, gid));
}

/** Calls onGone once the invite is removed (declined, accepted or expired). */
export function watchSent(to: string, gid: string, onGone: () => void): Unsub {
  if (!backend) return () => {};
  let seen = false;
  return backend.watch(`inbox/${to}/${gid}`, v => {
    if (v) seen = true;
    else if (seen) onGone();
  });
}

export const cancelInvite = (to: string, gid: string) => backend?.remove(`inbox/${to}/${gid}`).catch(() => {});
export const clearInvite = (gid: string) => backend?.remove(`inbox/${backend.uid}/${gid}`).catch(() => {});
