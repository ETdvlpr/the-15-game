# The 15-Game

Take turns claiming numbers 1–9. First to hold **three that add up to exactly 15** wins.

Play at https://the-15-game.vercel.app

- Play against an Easy, Medium or Hard (unbeatable) AI, or pass-and-play with a friend
- **Online:** send a challenge link for a live, timed match (15s+1, 30s+2 or 60s+3 per player)
- Optional hints show winning and blocking moves
- Single static `index.html`, no build step

## Online play

Live matches use Firebase Realtime Database with anonymous sign-in, entirely client-side.
There is no server code: `database.rules.json` enforces turns, legal cards, the chess clock
(checked against server time) and results, so a client can't move out of turn, add time or fake a win.

The rules are generated, so edit the generator rather than the JSON:

```sh
python3 scripts/gen-rules.py
firebase deploy --only database
```

The Firebase web config in `index.html` is public by design; access is controlled by the rules.
