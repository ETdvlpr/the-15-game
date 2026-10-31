import type { BoardView } from "../view";
import { $, reducedMotion } from "./dom";
import { sfx } from "./sound";

const cards: Record<number, HTMLButtonElement> = {};
let lastKey = "";

export function initBoard(onPick: (n: number) => void) {
  const deck = $("deck");
  for (let n = 1; n <= 9; n++) {
    const b = document.createElement("button");
    b.className = "card";
    b.innerHTML = `<span class="corner">${n}</span><span class="num">${n}</span><span class="corner br">${n}</span><span class="tag"></span>`;
    b.addEventListener("click", () => onPick(n));
    deck.appendChild(b);
    cards[n] = b;
  }
  for (const side of [0, 1]) {
    const hand = $("hand" + side);
    for (let i = 0; i < 5; i++) hand.appendChild(Object.assign(document.createElement("div"), { className: "slot" }));
  }
}

export const cardEl = (n: number) => cards[n];

function deal() {
  const deck = $("deck");
  deck.classList.remove("deal");
  void deck.offsetWidth; // restart the animation
  deck.classList.add("deal");
  setTimeout(() => deck.classList.remove("deal"), 900);
}

/** Animates a card from its place in the deck into the hand slot (FLIP). */
function fly(mini: HTMLElement, n: number) {
  if (reducedMotion()) return;
  const from = cards[n].getBoundingClientRect(), to = mini.getBoundingClientRect();
  mini.classList.add("fly");
  Object.assign(mini.style, { position: "relative", zIndex: "5" });
  mini.animate([
    { transformOrigin: "top left", transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})` },
    { transformOrigin: "top left", transform: "none" },
  ], { duration: 420, easing: "cubic-bezier(.2,.9,.25,1.05)" }).finished.then(() => { mini.style.zIndex = ""; }, () => {});
}

export function renderBoard(v: BoardView) {
  const newBoard = v.key !== lastKey;
  if (newBoard) {
    if (lastKey) sfx.deal();
    lastKey = v.key;
    deal();
  }

  for (const side of [0, 1] as const) {
    $("name" + side).textContent = v.names[side];
    $("avatar" + side).textContent = v.avatars[side];
    $("panel" + side).classList.toggle("active", v.active === side);
    const hand = $("hand" + side);
    hand.classList.toggle("won", v.winner === side);
    [...hand.children].forEach((el, i) => {
      const slot = el as HTMLElement, n = v.hands[side][i];
      if (n === undefined) {
        slot.innerHTML = "";
        slot.classList.remove("has");
        delete slot.dataset.n;
        return;
      }
      if (slot.dataset.n !== String(n)) {
        slot.dataset.n = String(n);
        slot.classList.add("has");
        slot.innerHTML = `<div class="mini">${n}</div>`;
        if (!newBoard) {
          fly(slot.firstElementChild as HTMLElement, n);
          (side === 0 ? sfx.pick : sfx.oppPick)();
        }
      }
      slot.firstElementChild!.classList.toggle("trio", !!(v.line && v.winner === side && v.line.includes(n)));
    });
    const needs = v.hints?.needs[side] ?? [];
    $("needs" + side).textContent = needs.length ? `needs ${needs.join(" or ")}` : "";
  }
  $("sub1").innerHTML = v.subtitle;

  const owner = (n: number) => v.hands[0].includes(n) ? 0 : v.hands[1].includes(n) ? 1 : null;
  $("deck").classList.toggle("waiting", !v.canPick);
  for (let n = 1; n <= 9; n++) {
    const c = cards[n], o = owner(n);
    const win = !!v.hints?.win.includes(n), block = !!v.hints?.block.includes(n);
    c.classList.toggle("taken", o !== null);
    c.classList.toggle("by0", o === 0);
    c.classList.toggle("by1", o === 1);
    c.classList.toggle("hint-win", win);
    c.classList.toggle("hint-block", block);
    c.querySelector(".tag")!.textContent = win ? "WIN" : block ? "BLOCK" : "";
    c.disabled = o !== null || !v.canPick;
    c.setAttribute("aria-label", o === null ? `Take ${n}` : `${n}, taken by ${v.names[o]}`);
  }
  $("status").innerHTML = v.status;
}
