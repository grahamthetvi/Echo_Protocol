# Echo Protocol

A free, open-source, **audio-first** zombie escape game for blind and visually impaired players.
It speaks everything itself (self-voicing), so the player can turn their screen reader **off**.
It needs no mouse and no sight. It is plain HTML, CSS and JavaScript, with no build step and no
server code, so it runs on **GitHub Pages**.

> You are **Subject 23**, a patient at the Clearwater Research Facility. Your blood carries the
> antibody that can cure the zombie pathogen. A containment breach has overrun the building, and the
> military will sterilize the site when the countdown ends. Wake up, listen, and get out through the
> forest edge before time runs out.

- **Play length:** choose 5, 15, 30 or 60 minutes. Each length builds a different-sized facility.
- **Sound:** 3D positional audio (HRTF), footsteps that change with the floor, echolocation, and
  zombies you can tell apart by their sounds.
- **Teachers:** spoken seed codes to replay a layout, a hidden teacher panel, a session log you can
  export (CSV or JSON), and an optional Game Boy–style map for sighted helpers and low-vision players.

---

## Quick start

### Play locally

ES modules need a web server; opening `index.html` directly as a file will not work.

```bash
npm run serve
```

Then open <http://localhost:8080> in Chrome or Edge and press **Enter**. Any static server works
(for example `python3 -m http.server`). No `npm install` is needed: the project has no dependencies.

### Run the tests

```bash
npm test
```

The tests run in Node 20 or newer with the built-in test runner. They:

- generate **200 seeds for each length** and fail if any layout breaks the fastest-route rule (below)
  or the structure rules (room counts, at least one lock on every route, keys off the fastest path);
- play real games through the engine with an "autopilot" that presses the same actions a person
  would, opening every lock type and escaping, at every length;
- play the whole tutorial, test the puzzles, saves, keymap, session log, and sound recipes;
- check audio and site size limits.

### Host on GitHub Pages

1. Push to `main`.
2. In the repository settings, under **Pages**, set **Source** to **GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` runs the tests and the size check, builds `_site/`
   (only the files the browser needs), and deploys it.

After the first visit, a service worker caches the game so it also works **offline**.

---

## Controls

Every key gives immediate sound feedback. Unknown or invalid keys give a low buzz that is different
from the success sounds. All keys can be remapped in **Settings, Controls**.

| Key | Action |
| --- | --- |
| Up / W, Down / S | Step forward, step back |
| Left / A, Right / D | Turn left, turn right (facing is spoken) |
| Space / Enter | Interact: open doors, search, read, use |
| R / Shift+R | Repeat last message / repeat full room description |
| Q | Where am I, and what can I do here |
| C | Compass: facing, room and floor |
| L | Listen: what you hear, which direction, how far |
| P | Echolocation ping |
| X | Tap your cane ahead |
| I | Inventory (Up/Down to browse, Enter to use, Right arrow to hear about an item) |
| H | Hint (costs game time) |
| T | Time remaining |
| Z | Health, exhaustion, infection, noise |
| M | Tactile map: arrow keys move your finger from room to room |
| F / E | Fight / hide (when a hiding spot is within reach) |
| Hold Shift / hold Ctrl | Run (fast, loud) / sneak (slow, quiet) |
| V | Switch walk, sneak and run without holding keys |
| Hold Esc 1.5 s | Pause menu (a quick tap just plays a soft "hold to pause" cue) |
| Slash or F1 | Hear the controls |

**Teacher panel:** hold **Ctrl + Shift + ` (back quote)** for 3 seconds.

---

## How the session length works

Every action has a **game-time cost** in one shared table (`src/generator/costs.js`): a walking step,
a turn, opening a door, searching, swiping a keycard, entering a code, and so on. The game uses the
same numbers at runtime (for example, opening a door keeps you busy for 1.2 seconds), so the rule
describes the game that is actually played.

The generator builds a graph of the facility and runs **Dijkstra** over it:

- the **direct** route from the bed to the exit, paying the time each lock needs;
- the **complete** route, which must also go and collect every key or clue before its lock
  (Dijkstra over *position + keys held*).

Both must take **no more than 25%** of the chosen length (5 min: 1:15, 15 min: 3:45, 30 min: 7:30,
60 min: 15:00). If a layout fails, the generator tries again with a shorter layout. The other 75% is
slack for exploring, listening, reading clues, fighting, hiding and solving puzzles.

| Length | Rooms | Locks | Zombies | Audio logs | Zombie types |
| --- | --- | --- | --- | --- | --- |
| 5 min | 5–7 | 1 | 1–2 | 1 | Shambler, Crawler |
| 15 min | 10–14 | 2 | 3–4 | 3 | + Runner |
| 30 min | 18–24 | 3 | 6–8 | 6 | + Screamer |
| 60 min | 28–40 | 4–5 | 10–14 | 12 | + Armored Guard |

Every route to the exit passes at least one locked door, and the key or clue for every lock is in a
side room, never on the fastest path, so exploring is rewarded.

**The clock:** it runs in real time while you play. It pauses while the pause menu is open, while
an audio log you chose to hear is playing, during mandatory narration, and while room descriptions
are being spoken. Teachers can turn off the pause for descriptions (Settings, Gameplay, *Pause clock
while descriptions play*, or the teacher panel), since otherwise repeating Q, L or Shift+R stops the
clock; story logs and narration always pause it. It is announced automatically at 75%, 50%, 25% and 10% left, at 5 minutes and
1 minute, and for each of the final 10 seconds. Press **T** any time.

**Seed codes:** each game starts by speaking a short code such as "amber fox 42". The same code and
length always build the same layout. Teachers can set the next seed in the teacher panel, or share a
link such as `https://<you>.github.io/<repo>/?seed=amber-fox-42&length=15`.

---

## Teacher setup

### What the browser can and cannot lock

Lockdown mode goes **full screen**, uses **Keyboard Lock** (Chrome and Edge) so Esc can be captured,
uses **Pointer Lock** and hides the cursor, and blocks right-click, text selection, dragging, and
scroll or pinch zoom. A full-screen cover means nothing on the page can be clicked.

Being honest about the limits: **no web page can block the Windows key, Alt+Tab, or Ctrl+Alt+Del**,
and browsers always let the player leave full screen by holding Esc. So the game:

- **autosaves every 20 seconds**, and whenever the window loses focus or the tab is hidden;
- **pauses automatically** when focus is lost or full screen ends, and on return says
  "Game paused. Press Enter to resume.";
- asks before the tab is closed during a game.

### Optional: a true lockdown

- **Windows kiosk (Assigned Access):** Settings, Accounts, Other users, *Set up a kiosk*. Choose
  Microsoft Edge in kiosk mode, "As a digital sign or interactive display", with the game's URL.
- **Chrome shortcut:** create a shortcut to
  `chrome.exe --kiosk --autoplay-policy=no-user-gesture-required "https://<you>.github.io/<repo>/"`.
  Close it with Alt+F4.
- **Chromebooks** managed by a school can use a kiosk app policy with the same URL.

### Teacher panel

Hold **Ctrl + Shift + `** for 3 seconds (Ctrl+Shift+T is reserved by browsers for reopening tabs,
so it cannot be used). The spoken panel lets you:

- set the default session length;
- hear and see the current seed, and the fastest possible route for this layout;
- set the seed for the next game;
- change the speech rate;
- turn on visuals, high contrast and the reveal-whole-map view;
- switch Assist mode and lockdown;
- **export the session log** as CSV or JSON (time, rooms, deaths, hints, puzzles, endings);
- export the current save or import a save file.

### Assist mode and accessibility options

**Assist mode** (Settings, Gameplay) gives 50% more time, slower zombies, longer reaction windows,
a more forgiving rhythm check, five infections instead of three, and cheaper hints. Difficulty also
**adapts during a run**: deaths, near misses and time stuck ease the pressure; steady progress raises
it a little. Stuck players are offered a hint.

**Browser zoom:** Ctrl+Plus, Ctrl+Minus and Ctrl+0 (Cmd on a Mac) always reach the browser, also in
lockdown and full screen, so low-vision players can enlarge the on-screen map, HUD and captions.
Teachers can turn this off with *Allow browser zoom* in Settings, Visuals, or the teacher panel.

Other options: voice, speech rate (0.5–3×), pitch and volume; separate volume sliders for effects,
ambience and music, zombie alert cues and menu sounds; **mono downmix**; directions as words or
**clock positions**; spoken echolocation summaries; self-voicing off (for players who prefer their
own screen reader; prompts then go to an `aria-live` region).

---

## Adding recorded audio

The game makes every sound itself (`src/audio/recipes.js`), so it works before any audio files exist.
To use recorded sound:

1. Encode as **Opus** in `.ogg` or `.webm`: mono, 24–48 kbps for voice and ambience; stereo or higher
   only for music. For example:
   `ffmpeg -i groan.wav -ac 1 -c:a libopus -b:a 32k assets/audio/zombies/shambler.ogg`
2. Add it to `assets/audio/manifest.json` under the sound's id, with a loading **group**
   (`core`, `ward`, `labs`, `maint`, `lobby` or `forest`). Groups are loaded lazily when the player
   first enters that area, and cached by the service worker.

   ```json
   { "sounds": { "z_shambler": { "file": "zombies/shambler.ogg", "group": "core" } } }
   ```

3. **Voiced story logs:** add a file under a log's id (for example `log_hale_1`) and it will play
   instead of the synthesized voice. The clock still pauses while it plays.

`npm run gen-audio` renders every built-in sound to WAV (add `--opus` to encode with ffmpeg, and
`--manifest` to register them), which is a handy starting point for a sound designer.

**Size limits** (`tools/check-size.mjs`, run in CI): total audio must stay under **500 MB**
(hard cap 900 MB), no single file over 100 MB, and the whole site under 900 MB, because GitHub Pages
sites are limited to about 1 GB.

---

## Changing the content

All writing lives in JSON, so you can edit it without touching code:

- `data/rooms.json`: room templates by zone (descriptions, floor surface, ambience, fixtures,
  hiding spots, obstacles) and floor names;
- `data/items.json`: items and their descriptions and effects;
- `data/zombies.json`: zombie types (speed, hearing range, health, damage, sound signature);
- `data/story.json`: intro, intercom lines, audio logs, memos, clue wording, radio dialog, endings,
  the tutorial script and the controls help.

Keep sentences short: speech is delivered in chunks of one to three sentences. After editing, run
`npm test`; the generator tests catch most mistakes.

Session scaling (rooms, locks, zombies, logs, loot per length) is in `src/generator/profiles.js`.

---

## Project layout

```
index.html, styles.css, sw.js, manifest.webmanifest
src/
  core/        seeded RNG, seed codes, clock and time announcements, directions, events
  generator/   cost model, length profiles, interiors, route analysis (Dijkstra), generator
  audio/       DSP toolkit, sound recipes, Web Audio engine (HRTF, occlusion), speech queue
  input/       remappable keyboard input, hold-to-pause, teacher combo
  game/        world model, game rules, zombie AI, soundscape, echolocation, hints, overlays, tutorial
  puzzles/     lock puzzles, clue features, pure puzzle checks
  state/       settings, save slots, session log
  ui/          handler stack, spoken menus, lockdown, aria-live mirror, visual map
  data/        JSON loader
data/          rooms, items, zombies, story (JSON)
assets/audio/  manifest.json (and your recorded Opus files)
tools/         serve, check-size, gen-placeholder-audio, build-site
tests/         node:test suites and the autopilot player
docs/          ACCESSIBILITY.md (testing script), MILESTONES.md (what each milestone does)
```

The game logic (`src/game`, `src/generator`, `src/puzzles`) never touches the page, so it runs in
Node for testing with silent audio and recorded speech.

---

## Choices made while building

The brief asked for reasonable choices to be made and listed here instead of asking questions:

- **Movement** is on a grid inside each room (about one step per tile) with 90-degree turns, so
  positional audio, echolocation and step counts all mean something. Walking into a closed door
  opens it; walking into a locked one describes the lock.
- **The 25% rule** is checked on the stricter *complete* route (including fetching every key), not
  only the direct path, using walking speed and a 1.5-second "decide where to go" allowance per room.
- **Deaths are knockdowns:** Subject 23's antibodies fight off a bite, so you wake in the last safe
  room with lower health, a 20-second penalty and one more infection. Three infections (five in
  Assist) is the "infected" ending. This lets difficulty adapt to deaths without ending the run.
- **Endings:** *win* means escaping with the antibody sample; *partial* means escaping without it;
  *secret* means escaping with the sample, every audio log heard and at least 90% of rooms explored;
  *sterilized* and *infected* are the two fail endings.
- **Speech** uses the browser's Web Speech API. Character voices use other installed voices in the
  same language where available, otherwise different pitch and rate.
- **Sounds** are synthesized from code so the game is complete without asset files. The same code
  renders them for the generator script.
- **Tests** use Node's built-in test runner instead of Vitest, so there is nothing to install.
- **Teacher combo** is Ctrl+Shift+back quote because browsers reserve Ctrl+Shift+T.
- **Sneaking with Ctrl:** in a normal window, Ctrl+W closes the tab before a page can stop it. Use the
  arrow keys to sneak (Ctrl+Up), switch modes with **V**, or use lockdown mode, where the browser lets
  the game capture more keys. The game also asks before the tab closes.
- **Braille clues** speak the dot numbers (for example, "number sign, then dots 1 4 5") so braille
  readers can decode them; the braille reader card item confirms the digits for those still learning.
- **Self-advocacy:** the rescue radio operator gives sight-based directions until you ask for
  compass directions and room counts; asking clearly for what you need also earns extra time.

## Browser support

Best in current **Chrome** or **Edge** (Keyboard Lock, best HRTF and speech). Firefox and Safari work,
but cannot capture Esc in full screen; holding Esc leaves full screen there, which pauses the game.

## License

MIT. See `LICENSE`.
