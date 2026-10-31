export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let toastTimer = 0;
export function toast(msg: string) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 2200);
}

export function confetti() {
  if (reducedMotion()) return;
  const colors = ["#ffcf5c", "#2fd4a7", "#ff7a5c", "#f6efe2", "#7aa2ff"];
  for (let i = 0; i < 70; i++) {
    const el = document.createElement("div");
    el.className = "confetti";
    Object.assign(el.style, {
      left: Math.random() * 100 + "vw",
      background: colors[i % colors.length],
      animationDuration: 1.6 + Math.random() * 1.4 + "s",
      animationDelay: Math.random() * .3 + "s",
      borderRadius: Math.random() < .5 ? "50%" : "2px",
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
}

export async function share(text: string) {
  try {
    if (navigator.share) return void await navigator.share({ text });
    await navigator.clipboard.writeText(text);
    toast("Copied! Paste it anywhere");
  } catch (e) {
    if ((e as Error)?.name !== "AbortError") toast("Couldn't share. Try copying the URL");
  }
}

export async function copy(text: string, done = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast("Couldn't copy. Long-press the link instead");
  }
}

export function shake(el: Element) {
  el.animate(
    [{ transform: "translateX(0)" }, { transform: "translateX(-8px)" }, { transform: "translateX(8px)" },
     { transform: "translateX(-5px)" }, { transform: "translateX(0)" }],
    { duration: 380, easing: "ease-out" },
  );
}
