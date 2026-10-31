export type Hands = [number[], number[]];
export type Difficulty = "easy" | "medium" | "hard";

export const CARDS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export const LINES = [[1,5,9],[1,6,8],[2,4,9],[2,5,8],[2,6,7],[3,4,8],[3,5,7],[4,5,6]];

const bit = (n: number) => 1 << n;
const toMask = (cards: readonly number[]) => cards.reduce((m, n) => m | bit(n), 0);
const LINE_MASKS = LINES.map(toMask);
const FULL = toMask(CARDS);
const hasLine = (m: number) => LINE_MASKS.some(l => (m & l) === l);
const popcount = (m: number) => { let c = 0; while (m) { m &= m - 1; c++; } return c; };

export const rnd = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
export const findLine = (hand: readonly number[]) => LINES.find(l => l.every(n => hand.includes(n))) ?? null;
export const freeCards = (hands: Hands) => CARDS.filter(n => !hands[0].includes(n) && !hands[1].includes(n));
export const winningCards = (hand: readonly number[], free: readonly number[]) =>
  free.filter(n => hasLine(toMask(hand) | bit(n)));

// Negamax over bitmasks. Positive = good for the player to move; faster wins score higher.
const memo = new Map<number, number>();
function negamax(me: number, opp: number): number {
  const key = me * 1024 + opp;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const used = me | opp;
  let best = used === FULL ? 0 : -Infinity;
  for (let n = 1; n <= 9; n++) {
    if (used & bit(n)) continue;
    const m = me | bit(n);
    const v = hasLine(m) ? 100 - popcount(m | opp) : -negamax(opp, m);
    if (v > best) best = v;
  }
  memo.set(key, best);
  return best;
}

// A model of a human who hasn't cracked the game: they take a win when they see one and
// block a single threat, but otherwise don't plan ahead (no forks, no "take the 5").
const chanceMemo = new Map<number, number>();

/** Chance that we (to move, mask `me`) win against that human, playing only perfect moves. */
function winChance(me: number, opp: number): number {
  const key = me * 1024 + opp;
  const hit = chanceMemo.get(key);
  if (hit !== undefined) return hit;
  let best = 0;
  for (const m of perfectMoves(me, opp)) best = Math.max(best, hasLine(m) ? 1 : humanReplies(m, opp));
  chanceMemo.set(key, best);
  return best;
}

function humanReplies(ai: number, human: number): number {
  const free = CARDS.filter(n => !((ai | human) & bit(n)));
  if (!free.length) return 0;
  if (free.some(n => hasLine(human | bit(n)))) return 0; // they see their win
  const blocks = free.filter(n => hasLine(ai | bit(n)));
  const options = blocks.length ? blocks : free;
  return options.reduce((sum, n) => sum + winChance(ai, human | bit(n)), 0) / options.length;
}

/** Our moves (as resulting masks) that keep the game-theoretic best result. */
function perfectMoves(me: number, opp: number): number[] {
  const scored = CARDS.filter(n => !((me | opp) & bit(n))).map(n => {
    const m = me | bit(n);
    return { m, v: hasLine(m) ? 100 - popcount(m | opp) : -negamax(opp, m) };
  });
  const top = Math.max(...scored.map(s => s.v));
  return scored.filter(s => s.v === top).map(s => s.m);
}

/**
 * Perfect play (it can't lose), but among equally good moves it picks the one most likely to
 * beat a real person: the traps and forks. Without this it drifts into safe draws.
 */
function bestMove(me: number[], opp: number[]) {
  const mm = toMask(me), om = toMask(opp);
  const options = perfectMoves(mm, om).map(m => ({ n: Math.log2(m ^ mm), c: hasLine(m) ? 2 : humanReplies(m, om) }));
  const top = Math.max(...options.map(o => o.c));
  return rnd(options.filter(o => o.c >= top - 1e-9).map(o => o.n));
}

export function aiChoose(diff: Difficulty, me: number[], opp: number[]): number {
  const free = freeCards([me, opp]);
  const wins = winningCards(me, free), threats = winningCards(opp, free);
  if (diff === "hard") return bestMove(me, opp);
  if (diff === "medium") {
    if (wins.length) return rnd(wins);
    if (threats.length && Math.random() < .9) return rnd(threats);
    return Math.random() < .5 ? bestMove(me, opp) : rnd(free);
  }
  if (wins.length && Math.random() < .6) return rnd(wins);
  if (threats.length && Math.random() < .35) return rnd(threats);
  return rnd(free);
}

// ---------- Analysis (coaching and post-game insights) ----------
export interface Move { n: number; side: 0 | 1 }

/** Moves in play order, rebuilt from both hands and who started (turns strictly alternate). */
export function moveOrder(hands: Hands, starter: 0 | 1): Move[] {
  const out: Move[] = [], next = [0, 0];
  let side = starter;
  while (next[side] < hands[side].length) {
    out.push({ n: hands[side][next[side]++], side });
    side = (1 - side) as 0 | 1;
  }
  return out;
}

/** The two cards in `hand` that make 15 with `card`. */
export const pairFor = (hand: readonly number[], card: number) =>
  LINES.find(l => l.includes(card) && l.filter(n => n !== card).every(n => hand.includes(n)))?.filter(n => n !== card) ?? [];

/** One sentence on how the game was decided, from `me`'s point of view (null if nothing notable). */
export function insight(hands: Hands, starter: 0 | 1, winner: 0 | 1 | null, me: 0 | 1, them: string): string | null {
  if (winner === null) return null;
  const Them = them[0].toUpperCase() + them.slice(1);
  const loser = (1 - winner) as 0 | 1;
  const h: Hands = [[], []];
  let missedWin: { card: number; hand: number[] } | null = null;
  let last: { threats: number[]; played: number } | null = null;
  for (const m of moveOrder(hands, starter)) {
    if (m.side === loser) {
      const free = freeCards(h), wins = winningCards(h[loser], free);
      if (wins.length && !wins.includes(m.n) && !missedWin) missedWin = { card: wins[0], hand: [...h[loser]] };
      last = { threats: winningCards(h[winner], free), played: m.n };
    }
    h[m.side].push(m.n);
  }
  const fork = last && last.threats.length >= 2 ? last.threats.slice(0, 2) : null;
  if (winner === me) return fork ? `You had two ways to make 15 (${fork[0]} or ${fork[1]}). ${Them} could only stop one.` : null;
  if (missedWin) {
    const [a, b] = pairFor(missedWin.hand, missedWin.card);
    return `You had a win: ${a} + ${b} + ${missedWin.card} = 15.`;
  }
  if (fork) return `${Them} had two ways to make 15 (${fork[0]} or ${fork[1]}). You could only stop one.`;
  if (last && last.threats.length === 1 && last.played !== last.threats[0]) return `You missed a block: ${Them} needed ${last.threats[0]}.`;
  return null;
}

/**
 * A tip for the player to move, for coaching mode. Deliberately limited to the rule and the
 * arithmetic (what you or they need for 15); the strategy is left for players to discover.
 */
export function coachTip(hands: Hands, me: 0 | 1, them: string): { text: string; win: number[]; block: number[] } | null {
  them = them[0].toUpperCase() + them.slice(1);
  const free = freeCards(hands), mine = hands[me], theirs = hands[1 - me];
  const wins = winningCards(mine, free), threats = winningCards(theirs, free);
  if (wins.length) {
    const [a, b] = pairFor(mine, wins[0]);
    return { text: `🎯 Take ${wins[0]} to win: ${a} + ${b} + ${wins[0]} = 15`, win: wins, block: [] };
  }
  if (threats.length >= 2) return { text: `😬 ${them} can make 15 with ${threats[0]} or ${threats[1]}. You can only take one.`, win: [], block: threats };
  if (threats.length) {
    const [a, b] = pairFor(theirs, threats[0]);
    return { text: `⚠️ ${them} needs ${threats[0]} (${a} + ${b} + ${threats[0]}). Block it!`, win: [], block: threats };
  }
  if (!mine.length) return { text: "👋 Take turns picking cards. First to hold three that add up to exactly 15 wins.", win: [], block: [] };
  return null;
}
