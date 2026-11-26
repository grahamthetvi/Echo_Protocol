# Accessibility test script

Use this script to test Echo Protocol with a blind player, a blindfolded sighted tester, or an
assistive-technology user. It takes about 30 to 40 minutes. A second person (the observer) takes
notes and does **not** give hints unless the player asks.

## Before you start

- [ ] Headphones on. Check left and right are the right way round.
- [ ] Screen reader **off** (NVDA: Insert+Q; JAWS: Insert+F4; Narrator: Ctrl+Win+Enter;
      VoiceOver: Cmd+F5).
- [ ] Use Chrome or Edge. Open the game URL. The observer clears saved data first if this should be a
      first run (Teacher panel, or browser site settings).
- [ ] Blindfolded testers: put the blindfold on **before** the page loads. Monitor off is fine too.
- [ ] Observer: open a notes sheet with the columns *time, task, success (yes/partly/no), what the
      player said, what went wrong*.

## Part 1: Start without help (5 minutes)

| # | Task | Pass when |
| - | ---- | --------- |
| 1 | Find the start key. | The player presses Enter within 30 seconds, without help. |
| 2 | Hear the headphones notice. | The player can repeat back what it said. |
| 3 | Choose the tutorial from the first-run menu. | Up/Down and Enter work and every item is announced with "x of y". |
| 4 | Press a random letter during a menu. | A low buzz plays and nothing breaks. |

## Part 2: Tutorial (10 minutes)

The tutorial teaches by doing. Note any step where the player needs more than one try.

| # | Task | Pass when |
| - | ---- | --------- |
| 5 | Step, turn, step back. | Each press gives a footstep or a spoken facing. |
| 6 | Press C, then Q. | The player can say which way they face and what is in reach. |
| 7 | Press P (ping). | The player can say roughly how far the nearest wall is. |
| 8 | Find and search the cabinet. | Done using "within reach" announcements, not luck. |
| 9 | Open and close the inventory. | Item names and counts are clear. |
| 10 | Go through the door. | The player understands that walking into a closed door opens it. |
| 11 | Fight the dummy. | The player can tell where the dummy is from its sound before it arrives. |
| 12 | Hide and come out. | |
| 13 | Hold Escape to pause; then resume. | A quick tap of Esc gives only the soft cue. |
| 14 | Find the beacon and exit. | The player turns toward the beacon by ear. |

## Part 3: A 5-minute game (10 minutes)

Start a new 5-minute game. Write down the spoken **seed code** so the run can be repeated.

| # | Task | Pass when |
| - | ---- | --------- |
| 15 | Listen to the intro, or press Enter to skip it. | The clock does not run during it (check with T afterwards: close to 5:00). |
| 16 | Find the locked door. | The player can name the kind of lock. |
| 17 | Find the key or clue in a side room. | |
| 18 | Use H once. | The hint is understandable and the time cost is announced. |
| 19 | React to a zombie. | The player can say the zombie's direction before it reaches them. |
| 20 | Escape, or reach an ending. | The ending is spoken, then a summary menu appears. |

## Part 4: Settings and recovery (5 minutes)

| # | Task | Pass when |
| - | ---- | --------- |
| 21 | Change the speech rate to 2.0 in Settings, Speech. | Left/Right arrows change it and the value is spoken. |
| 22 | Turn on mono downmix. | All sound comes from both ears. |
| 23 | Switch directions to clock positions. | "Q" now says things like "at 2 o'clock". |
| 24 | Observer presses Alt+Tab, then returns. | The game says "Game paused. Press Enter to resume." and Enter resumes. |
| 25 | Observer reloads the page. | "Continue" appears in the main menu and resumes the same place. |
| 26 | Remap "Interact" to the J key, then reset controls. | Both changes are confirmed out loud. |

## Part 5: Screen reader fallback (optional, 5 minutes)

- [ ] Turn your screen reader on. In Settings, turn **Self-voicing** off and **Fullscreen lockdown** off.
- [ ] Menus and game messages are read by the screen reader from the live region.
- [ ] Turn self-voicing back on before the next player.

## Things to watch for

- Any time the player is lost for more than 30 seconds: what did they try? Did "Q" help?
- Anything said too fast, too long, or that cut off something important.
- Sounds that were hard to tell apart (zombie types, doors, walls, doorways in the ping).
- Any moment of sound-only danger without warning. There should be none: zombie alerts are spoken.
- Visual layer (if a sighted observer turns it on): nothing ever flashes.

## After the session

Export the **session log** (Teacher panel, Export session log as CSV) and attach it to your notes.
It records the time, rooms entered, hints, knockdowns, puzzle attempts and the ending for each run.
