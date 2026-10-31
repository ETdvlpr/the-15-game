import { connect } from "./firebase";

/** Public half of the VAPID key pair; the private half lives only in the Vercel environment. */
const VAPID_PUBLIC = "BOgxEtQ0BimlysYgm7sdZwy9YVJEc6KzP98nLOfL9GYbrJbZ_YlZeSsd5mdQnvWwH12ZoF_QlXXG3y9Xrgi5tM0";

export type PushState = "unsupported" | "needs-install" | "default" | "granted" | "denied";

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
export const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export function pushState(): PushState {
  // iOS only offers Web Push to apps added to the home screen.
  if (!supported()) return isIOS() && !isStandalone() ? "needs-install" : "unsupported";
  return Notification.permission === "default" ? "default" : Notification.permission;
}

const b64ToBytes = (b64: string) => {
  const s = atob((b64 + "=".repeat((4 - b64.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};
const hashId = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
  .map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 24);

async function subscribe() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription()
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) });
  const { endpoint, keys } = sub.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error("incomplete subscription");
  const b = await connect();
  await b.write(`push/${b.uid}/${await hashId(endpoint)}`, { endpoint, p256dh: keys.p256dh, auth: keys.auth, at: b.serverTime });
}

/** Asks for permission (call from a tap) and stores the subscription. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return pushState();
  const permission = await Notification.requestPermission();
  if (permission === "granted") await subscribe().catch(() => {});
  return pushState();
}

/** Re-saves the subscription on each visit; push endpoints can rotate. */
export function refreshPush() {
  if (supported() && Notification.permission === "granted") void subscribe().catch(() => {});
}

/** Asks the server to notify `to` about the invite we just put in their inbox. Best effort. */
export async function notify(to: string, gid: string) {
  try {
    const b = await connect();
    await fetch("/api/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to, gid, token: await b.idToken() }),
      keepalive: true,
    });
  } catch {}
}
