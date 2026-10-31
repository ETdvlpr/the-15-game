import webpush from "web-push";

// Sends a Web Push for a fresh challenge/rematch in someone's inbox.
// It reads the database with the *caller's* Firebase ID token, so database.rules.json decides:
// the inbox entry must exist and be from the caller, and only people the recipient has played
// may read their push subscriptions. The VAPID private key never leaves the server.
const DB = "https://the-15-game-live-default-rtdb.firebaseio.com";
const MAX_AGE = 60_000; // only notify for invites created in the last minute
const ID = /^[A-Za-z0-9]{1,128}$/;

webpush.setVapidDetails("https://the-15-game.vercel.app", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

const read = async (path, token) => {
  const res = await fetch(`${DB}/${path}.json?auth=${encodeURIComponent(token)}`);
  if (!res.ok) throw Object.assign(new Error(`read ${path}: ${res.status}`), { status: res.status });
  return res.json();
};
const json = (body, status = 200) => Response.json(body, { status });

export async function POST(request) {
  let input;
  try { input = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const { to, gid, token } = input ?? {};
  if (!ID.test(to ?? "") || !/^[a-z0-9]{8}$/.test(gid ?? "") || typeof token !== "string") return json({ error: "bad request" }, 400);

  let invite, subs;
  try {
    invite = await read(`inbox/${to}/${gid}`, token);
    if (!invite) return json({ error: "no such invite" }, 404);
    if (Date.now() - invite.at > MAX_AGE) return json({ error: "invite too old" }, 410);
    subs = (await read(`push/${to}`, token)) ?? {};
  } catch (e) {
    return json({ error: "forbidden" }, e.status === 401 ? 401 : 403);
  }

  const who = invite.fromName || "Someone";
  const payload = JSON.stringify({
    title: invite.kind === "rematch" ? `${who} wants a rematch` : `${who} challenges you`,
    body: `A live game of The 15-Game, ${invite.base / 1000}s +${invite.inc / 1000} per player. Tap to play.`,
    url: `/?g=${gid}`,
    tag: gid,
  });
  const results = await Promise.allSettled(Object.values(subs).map(s =>
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 600, urgency: "high" })));
  return json({ sent: results.filter(r => r.status === "fulfilled").length, failed: results.filter(r => r.status === "rejected").length });
}
