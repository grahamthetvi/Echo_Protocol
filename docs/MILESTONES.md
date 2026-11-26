# Milestones: what works and how to test it by ear

Each section says what the milestone delivers and how to check it **with your eyes closed**.
Automated checks: `npm test` (all milestones), `npm run check-size`.

## 1. Skeleton: start menu, keyboard input, speech queue, settings, pause

**Works:** press-Enter start screen, spoken menus (Up/Down, Enter, Left/Right for sliders, Esc tap
to go back), remappable keymap, speech queue with urgent interrupts, settings saved between visits,
hold-Esc pause menu.

**By ear:** press Enter. You hear the headphones notice and a menu. Arrow through the main menu: each
item is spoken with its position ("2 of 6"). Open Settings, Speech, and move the rate slider; the
new value is spoken. Press a random letter: a low buzz. In a game, tap Esc: a soft tone and "Hold
Escape to pause". Hold Esc: the pause menu opens.

## 2. Generator, time-cost model, 25% rule and test suite

**Works:** seeded layouts from spoken codes, rooms from templates, locks with keys or clues in side
rooms, Dijkstra checks of both the direct and the complete route, 200 seeds per length in CI.

**By ear:** start two games with the same seed (Teacher panel, set seed; or `?seed=...&length=5`).
The first room description and the doors are identical both times. A 5-minute game has a handful
of rooms; a 60-minute one keeps going.

## 3. Movement, facing, 3D audio, footsteps, ping

**Works:** grid movement, 90-degree turns with facing spoken, HRTF positional sound that turns with
you, footsteps that change on tile, carpet, metal grating, grass, gravel and wood, cane taps, and
echolocation (P) with delayed, filtered echoes.

**By ear:** turn in place next to a humming machine; the hum moves around your head. Walk from a
corridor onto metal stairs; the footsteps ring. Press P in a small room, then in the lobby; the
echoes come back faster and brighter from close walls, and doorways sound like a puff of air.

## 4. Noise and zombies

**Works:** every action makes noise (quiet, moderate, loud; Z tells you). Zombies hear noise within
their range, investigate, chase and open doors. Five types with different sounds: Shambler (slow wet
groan), Crawler (low scraping, cannot open doors), Runner (fast raspy breathing), Screamer (wail
that calls the others) and Armored Guard (metal clanks). Walls and closed doors muffle them.

**By ear:** press L to hear what's around you and where. Run (hold Shift) near a zombie; you hear
"Loud" and then "...heard you!" with a direction. Close a door between you and a groan; it goes
muffled and duller.

## 5. Items, doors, locks, inventory, hints

**Works:** containers to search, keycards, batteries, juice and food, bandages, crowbar for jammed
doors, noise-maker lure, door wedge barricade, monocular for exit signs, braille reader card, rescue
radio. Inventory with use and descriptions. Hints in three levels that cost time.

**By ear:** search a cabinet: rustling, then "You find...". Walk into a locked door: the lock is
named. Press H twice: the second hint is more specific, and the time cost is announced.

## 6. Audio puzzles and story logs

**Works:** keypad (codes from memos, a ringing phone, beep-count recorders, braille labels and
large-print signs), chime lock (sound-sequence memory), pitch lock (match a tuning fork; listen for
the wobble to stop), knock lock (rhythm tapping), breaker panel (route power by hum). Audio logs that
pause the clock while you choose to listen, memos, intercom announcements, tactile wall map and the
M map explorer.

**By ear:** find a ringing phone by following the ring. At a pitch lock, press Space for the fork and
Up/Down until the beating disappears. Play an audio log with Enter, then press T: the clock did not
move while it played.

## 7. Encounters, endings, adaptive difficulty

**Works:** grabbed by a zombie, you get a warning and a reaction window: F to fight (crowbar helps),
E to hide, walk away, or throw a lure. Knockdowns send you to the last safe room. Endings: escape
with the cure, escape without it, secret ending, sterilized, infected. Difficulty eases after
knockdowns and near misses, and offers hints when you are stuck.

**By ear:** let a Shambler grab you, then walk away: "You pull free!" Let the timer run out on a
5-minute game: thunder and the sterilized ending. Get knocked down twice: zombies feel slower.

## 8. Lockdown, autosave, teacher panel, session log

**Works:** full screen with Keyboard Lock and Pointer Lock, mouse and zoom blocked, autosave every 20
seconds and on losing focus, auto-pause with "Game paused. Press Enter to resume.", teacher panel on
Ctrl+Shift+back quote (hold 3 s), session log export as CSV or JSON.

**By ear:** Alt+Tab away and back: the pause message plays. Reload: "Continue" is the first main
menu item. Hold the teacher combo: the teacher panel is spoken.

## 9. Visual layer

**Works:** optional top-down map in a 4-shade palette, high-contrast (black, white, yellow) and
large-sprite modes, captions, a HUD line with room, time and health. Off by default; never flashes;
reads the same game state.

**Check (sighted helper):** Settings, Visuals, Show map on screen. The map follows the player; closed
doors are bars, locked doors are solid; the player's dot shows which way they face.

## 10. Offline cache, asset manifest, size check, CI deploy, docs

**Works:** service worker precaches the app (and audio as it is used) for offline play; audio
manifest with lazy loading by area; `tools/check-size.mjs`; GitHub Actions runs the tests, checks
sizes, builds `_site/` and deploys to Pages; README and this file; ACCESSIBILITY.md test script.

**By ear:** play once online, then turn off Wi-Fi and reload: the game still starts and speaks.
