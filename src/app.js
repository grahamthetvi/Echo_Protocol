// Application shell: boot, menus, saving, lockdown, teacher panel, render loop.

import { Emitter } from './core/events.js';
import { codeFromIndex, indexFromCode, randomSeedIndex, spokenCode } from './core/seedcode.js';
import { formatDuration, plural } from './core/format.js';
import { loadData } from './data/load.js';
import { WebSpeech } from './audio/speech.js';
import { AudioEngine } from './audio/engine.js';
import { Input, keyName, comboFor } from './input/input.js';
import { UIStack } from './ui/stack.js';
import { Menu, TextEntry, confirmMenu } from './ui/menu.js';
import { Lockdown } from './ui/lockdown.js';
import { LiveMirror } from './ui/live.js';
import { Visuals } from './ui/visuals.js';
import { loadSettings, saveSettings, cloneDefaults, DEFAULT_KEYMAP, ACTION_LABELS } from './state/settings.js';
import { Saves, slotLabel, exportText, importText } from './state/saves.js';
import { SessionLog } from './state/sessionlog.js';
import { generateFacility } from './generator/generator.js';
import { LENGTHS, LENGTH_PROFILES } from './generator/profiles.js';
import { Game } from './game/game.js';
import { buildTutorialFacility, Tutorial } from './game/tutorial.js';

const AUTOSAVE_MS = 20000;
const LENGTH_TEXT = {
  5: 'A quick escape, about 6 rooms and one locked door.',
  15: 'About 12 rooms, two locked doors and a few zombies.',
  30: 'About 20 rooms, three locked doors and more to find.',
  60: 'The full facility, more than 30 rooms, every kind of lock and zombie.',
};

export class App {
  constructor() {
    this.settings = loadSettings();
    this.events = new Emitter();
    this.stack = new UIStack();
    this.speech = new WebSpeech();
    this.audio = new AudioEngine();
    this.saves = new Saves();
    this.log = new SessionLog();
    this.game = null;
    this.tutorial = null;
    this.started = false;
    this.manifest = null;
    this.el = {
      cover: document.getElementById('cover'),
      screen: document.getElementById('screen'),
      status: document.getElementById('status-line'),
      canvas: document.getElementById('map'),
      caption: document.getElementById('caption'),
      hud: document.getElementById('hud'),
      file: document.getElementById('file-input'),
    };
    this.live = new LiveMirror({
      polite: document.getElementById('live-polite'),
      assertive: document.getElementById('live-assertive'),
      caption: this.el.caption,
    });
    this.visuals = new Visuals(this.el.canvas);
    this.lockdown = new Lockdown({ element: this.el.cover, onLost: () => this.autoPause('Left fullscreen.') });
  }

  get ctx() {
    return { speech: this.speech, audio: this.audio, stack: this.stack };
  }

  async boot() {
    this.data = await loadData();
    try {
      const res = await fetch('assets/audio/manifest.json', { cache: 'no-cache' });
      if (res.ok) this.manifest = await res.json();
    } catch { /* no manifest: synth only */ }
    this.applySettings();
    this.speech.onSpoken((m) => this.live.show(m));
    this.input = new Input({
      target: window,
      keymap: this.settings.keymap,
      onInput: (inp) => this.onInput(inp),
      onRelease: (inp) => this.stack.release(inp),
      allowZoom: () => this.settings.allowZoom !== false,
    });
    window.addEventListener('blur', () => this.autoPause('Window lost focus.'));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.autoPause('Tab hidden.');
    });
    window.addEventListener('beforeunload', (e) => {
      this.autosave();
      if (this.game && !this.game.ended && this.game.mode === 'normal') {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    setInterval(() => this.autosave(), AUTOSAVE_MS);
    this.el.cover.focus();
    this.setStatus('Press Enter to begin. Headphones recommended.');
    this.params = new URLSearchParams(location.search);
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.stack.update(dt);
      this.visuals.render(this.game);
      this.updateHud();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  applySettings() {
    const s = this.settings;
    this.speech.configure({ ...s.speech, enabled: s.selfVoicing });
    this.audio.setMix(s.mix);
    this.audio.setMono(s.mono);
    this.visuals.configure(s.visuals);
    this.live.captions = !!(s.visuals.enabled && s.visuals.captions);
    this.el.caption.hidden = !this.live.captions;
    this.live.enabled = !s.selfVoicing || !s.lockdown || !this.lockdown.active;
    document.body.classList.toggle('visuals-on', !!s.visuals.enabled);
    document.body.classList.toggle('high-contrast', !!s.visuals.highContrast);
    this.input?.setKeymap(s.keymap);
  }
  saveSettings() {
    saveSettings(this.settings);
    this.applySettings();
  }

  setStatus(text) {
    if (this.el.status) this.el.status.textContent = text;
  }
  updateHud() {
    if (!this.settings.visuals.enabled || !this.game || !this.el.hud) {
      if (this.el.hud) this.el.hud.hidden = true;
      return;
    }
    const g = this.game;
    this.el.hud.hidden = false;
    const t = Math.ceil(g.clock.remaining);
    const text = `${g.world.room(g.player.room).name} · ${g.mode === 'tutorial' ? 'practice' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`} · health ${Math.round(g.player.health)}`;
    if (this.el.hud.textContent !== text) this.el.hud.textContent = text;
  }

  // ------------------------------------------------------------------ input

  async onInput(inp) {
    if (!this.started) {
      if (inp.action === 'interact') await this.begin();
      else this.setStatus('Press Enter to begin.');
      return;
    }
    this.audio.resume();
    if (inp.action === 'teacherHold') {
      this.openTeacher();
      return;
    }
    if (!this.stack.top) {
      this.mainMenu();
      return;
    }
    this.stack.dispatch({ ...inp, game: this.game });
  }

  async begin() {
    this.started = true;
    await this.audio.init();
    this.audio.loadGroup(this.manifest, 'core');
    if (this.settings.lockdown) await this.lockdown.enter();
    this.applySettings();
    this.setStatus('Echo Protocol is running. All play is by sound.');
    this.el.screen.classList.add('running');
    this.speech.say(this.data.story.headphones, { priority: 'urgent' });
    const seed = this.params.get('seed');
    const len = Number(this.params.get('length'));
    if (seed && indexFromCode(seed) !== null && LENGTHS.includes(len)) {
      this.startNewGame(len, indexFromCode(seed));
      return;
    }
    if (!this.settings.tutorialDone) {
      const m = new Menu(this.ctx, {
        title: 'This looks like your first time',
        items: [
          { label: 'Start the tutorial', onSelect: () => this.startTutorial() },
          { label: 'Skip to the main menu', onSelect: () => this.mainMenu() },
        ],
        onBack: () => this.mainMenu(),
      });
      this.stack.clear();
      this.stack.push(m);
      return;
    }
    this.mainMenu();
  }

  // ------------------------------------------------------------------ menus

  mainMenu() {
    this.endGame();
    const auto = this.saves.load('auto');
    const m = new Menu(this.ctx, {
      title: 'Echo Protocol. Main menu',
      items: [
        { label: 'Continue', hidden: () => !this.saves.load('auto'), hint: auto ? slotLabel('auto', auto) : '', onSelect: () => this.loadGame(this.saves.load('auto')) },
        { label: 'New game', onSelect: () => this.stack.push(this.lengthMenu()) },
        { label: 'Tutorial and practice room', onSelect: () => this.startTutorial() },
        { label: 'Load game', onSelect: () => this.stack.push(this.loadMenu()) },
        { label: 'Settings', onSelect: () => this.stack.push(this.settingsMenu()) },
        { label: 'Hear the controls', onSelect: () => this.speech.say(this.data.story.controlsHelp.join(' '), { priority: 'urgent' }) },
        { label: 'About', onSelect: () => this.speech.say('Echo Protocol. A free, open source audio game made to be played by ear. Every sound has a place. Listen closely, move quietly, and get Subject 23 out.', { priority: 'urgent' }) },
      ],
      onBack: () => this.speech.say('This is the main menu. Choose New game to play.', { priority: 'urgent' }),
    });
    this.stack.clear();
    this.stack.push(m);
  }

  lengthMenu() {
    const items = LENGTHS.map((len) => ({
      label: `${len} minutes`,
      hint: LENGTH_TEXT[len],
      onSelect: () => this.startNewGame(len),
    }));
    const start = Math.max(0, LENGTHS.indexOf(this.settings.defaultLength));
    return new Menu(this.ctx, { title: `Choose a session length. Assist mode is ${this.settings.assist ? 'on' : 'off'}`, items, startIndex: start });
  }

  loadMenu() {
    const items = this.saves.list().map(({ slot, data }) => ({
      label: slotLabel(slot, data, data ? this.roomNameFor(data) : null),
      onSelect: () => {
        if (!data) {
          this.audio.play('ui_error', { bus: 'ui' });
          this.speech.say('That slot is empty.', { priority: 'urgent' });
          return;
        }
        this.loadGame(data);
      },
    }));
    return new Menu(this.ctx, { title: 'Load game', items });
  }

  saveMenu() {
    const items = ['1', '2', '3'].map((slot) => ({
      label: () => slotLabel(slot, this.saves.load(slot), this.saves.load(slot) ? this.roomNameFor(this.saves.load(slot)) : null),
      onSelect: (menu) => {
        const ok = this.saves.save(slot, this.game.serialize());
        this.log.add('save', { slot }, this.game);
        this.audio.play(ok ? 'ui_success' : 'ui_error', { bus: 'ui' });
        this.speech.say(ok ? `Saved to slot ${slot}.` : 'Could not save. Storage may be full or blocked.', { priority: 'urgent' });
        this.stack.pop(menu);
      },
    }));
    items.push({ label: 'Export save to a file', onSelect: () => this.exportSave() });
    return new Menu(this.ctx, { title: 'Save game', items });
  }

  roomNameFor(saved) {
    try {
      const f = generateFacility({ seedIndex: saved.seedIndex, lengthMin: saved.lengthMin, data: this.data });
      return f.rooms.find((r) => r.id === saved.player.room)?.name;
    } catch {
      return null;
    }
  }

  settingsMenu() {
    const s = this.settings;
    const save = () => this.saveSettings();
    const slider = (label, obj, key, min, max, step, fmt) => ({
      label, type: 'slider', min, max, step,
      get: () => obj()[key],
      set: (v) => {
        obj()[key] = v;
        save();
      },
      format: fmt || ((v) => `${Math.round(v * 100)} percent`),
    });
    const toggle = (label, get, set, hint) => ({ label, type: 'toggle', get, set: (v) => { set(v); save(); }, hint });
    const speechMenu = () => new Menu(this.ctx, {
      title: 'Speech',
      items: [
        {
          label: 'Voice', type: 'choice',
          options: [{ value: null, label: 'System default' }, ...this.speech.voices.map((v) => ({ value: v.voiceURI, label: `${v.name}, ${v.lang}` }))],
          get: () => s.speech.voiceURI,
          set: (v) => { s.speech.voiceURI = v; save(); },
        },
        slider('Speech rate', () => s.speech, 'rate', 0.5, 3, 0.1, (v) => `${v.toFixed(1)} times`),
        slider('Pitch', () => s.speech, 'pitch', 0.5, 2, 0.1, (v) => v.toFixed(1)),
        slider('Speech volume', () => s.speech, 'volume', 0.1, 1, 0.1),
        { label: 'Test the voice', onSelect: () => this.speech.say('This is how the game voice sounds. Subject 23, find the exit.', { priority: 'urgent' }) },
      ],
    });
    const mixerMenu = () => new Menu(this.ctx, {
      title: 'Sound mixer',
      items: [
        slider('Master volume', () => s.mix, 'master', 0, 1, 0.05),
        slider('Sound effects', () => s.mix, 'effects', 0, 1, 0.05),
        slider('Music and ambience', () => s.mix, 'ambience', 0, 1, 0.05),
        slider('Zombie alert cues', () => s.mix, 'alerts', 0, 1, 0.05),
        slider('Menu sounds', () => s.mix, 'ui', 0, 1, 0.05),
        toggle('Mono downmix', () => s.mono, (v) => { s.mono = v; }, 'Sends all sound to both ears, for one earbud or single-sided hearing'),
      ],
    });
    const gameplayMenu = () => new Menu(this.ctx, {
      title: 'Gameplay',
      items: [
        toggle('Assist mode', () => s.assist, (v) => { s.assist = v; }, 'Extra time, slower zombies, cheaper hints. Applies to new games'),
        {
          label: 'Directions', type: 'choice',
          options: [{ value: 'words', label: 'Words, like ahead and to your left' }, { value: 'clock', label: "Clock positions, like 2 o'clock" }],
          get: () => s.directionStyle,
          set: (v) => { s.directionStyle = v; save(); },
        },
        toggle('Speak echolocation summary', () => s.pingSpeech, (v) => { s.pingSpeech = v; }),
        toggle('Announce loud noise', () => s.announceNoise, (v) => { s.announceNoise = v; }),
        toggle('Pause clock while descriptions play', () => s.pauseClockForDescriptions, (v) => { s.pauseClockForDescriptions = v; }, 'Room descriptions, Q, L and Shift R stop the countdown while they are spoken. Story logs always pause it'),
      ],
    });
    const visualsMenu = () => new Menu(this.ctx, {
      title: 'Visuals, optional',
      items: [
        toggle('Show map on screen', () => s.visuals.enabled, (v) => { s.visuals.enabled = v; }, 'For teachers, friends and low vision. The game never needs it'),
        toggle('High contrast', () => s.visuals.highContrast, (v) => { s.visuals.highContrast = v; }),
        toggle('Large sprites', () => s.visuals.largeSprites, (v) => { s.visuals.largeSprites = v; }),
        toggle('Allow browser zoom', () => s.allowZoom, (v) => { s.allowZoom = v; }, 'Control plus, Control minus and Control zero zoom the page, also in full screen'),
        toggle('Captions', () => s.visuals.captions, (v) => { s.visuals.captions = v; }),
      ],
    });
    return new Menu(this.ctx, {
      title: 'Settings',
      items: [
        { label: 'Speech', onSelect: () => this.stack.push(speechMenu()) },
        { label: 'Sound mixer', onSelect: () => this.stack.push(mixerMenu()) },
        { label: 'Gameplay', onSelect: () => this.stack.push(gameplayMenu()) },
        { label: 'Controls', onSelect: () => this.stack.push(this.controlsMenu()) },
        { label: 'Visuals', onSelect: () => this.stack.push(visualsMenu()) },
        toggle('Fullscreen lockdown', () => s.lockdown, (v) => {
          s.lockdown = v;
          if (v) this.lockdown.enter();
          else this.lockdown.exit();
        }, 'Keeps stray clicks and keys out of the game'),
        toggle('Self-voicing', () => s.selfVoicing, (v) => { s.selfVoicing = v; }, 'Turn off only if you use your own screen reader'),
        {
          label: 'Reset all settings',
          onSelect: () => this.stack.push(confirmMenu(this.ctx, 'Reset all settings to defaults?', () => {
            const done = s.tutorialDone;
            this.settings = cloneDefaults();
            this.settings.tutorialDone = done;
            this.saveSettings();
            this.speech.say('Settings reset.', { priority: 'urgent' });
          })),
        },
      ],
    });
  }

  controlsMenu() {
    const s = this.settings;
    const items = Object.keys(DEFAULT_KEYMAP).map((action) => ({
      label: () => `${ACTION_LABELS[action]}: ${(s.keymap[action] || []).map(keyName).join(' or ') || 'no key'}`,
      hint: 'Enter to change',
      onSelect: (menu) => {
        this.speech.say(`Press the new key for ${ACTION_LABELS[action]}. Escape cancels.`, { priority: 'urgent' });
        this.input.captureNext((e) => {
          if (e.code === 'Escape') {
            this.speech.say('Cancelled.', { priority: 'urgent' });
            return;
          }
          // Same naming as live input (Ctrl+Alt+Shift+Key), or the new key would never match.
          const combo = comboFor(e);
          const lost = [];
          for (const [a, keys] of Object.entries(s.keymap)) {
            if (a === action) continue;
            if (keys.includes(combo)) {
              s.keymap[a] = keys.filter((k) => k !== combo);
              if (!s.keymap[a].length) lost.push(ACTION_LABELS[a]);
            }
          }
          s.keymap[action] = [combo, ...(s.keymap[action] || []).filter((k) => k !== combo)].slice(0, 2);
          this.saveSettings();
          this.audio.play('ui_success', { bus: 'ui' });
          this.speech.say(`${ACTION_LABELS[action]} is now ${keyName(combo)}.${lost.length ? ` Warning: ${lost.join(', ')} now has no key.` : ''}`, { priority: 'urgent' });
          menu.onResume();
        }, action === 'runHold' || action === 'sneakHold');
      },
    }));
    items.push({
      label: 'Reset controls to defaults',
      onSelect: () => {
        s.keymap = JSON.parse(JSON.stringify(DEFAULT_KEYMAP));
        this.saveSettings();
        this.speech.say('Controls reset.', { priority: 'urgent' });
      },
    });
    return new Menu(this.ctx, { title: 'Controls. Escape always pauses when held', items });
  }

  // ------------------------------------------------------------------ game flow

  makeGame(facility, opts = {}) {
    const game = new Game({
      facility, data: this.data, settings: this.settings, speech: this.speech, audio: this.audio,
      stack: this.stack, events: new Emitter(), input: this.input, mode: opts.mode, saved: opts.saved,
    });
    this.wireGame(game);
    return game;
  }

  wireGame(game) {
    const ev = game.events;
    ev.on('requestPause', () => this.pause());
    ev.on('enterRoom', (e) => {
      if (e.first) this.log.add('room', { room: game.world.room(e.room).name, zone: e.zone }, game);
      this.audio.loadGroup(this.manifest, e.zone);
    });
    ev.on('death', (e) => this.log.add('death', e, game));
    ev.on('hint', (e) => this.log.add('hint', e, game));
    ev.on('puzzleSolved', (e) => this.log.add('puzzle_solved', e, game));
    ev.on('puzzleFailed', (e) => this.log.add('puzzle_failed', e, game));
    ev.on('unlocked', (e) => this.log.add('unlocked', e, game));
    ev.on('logHeard', (e) => this.log.add('log_heard', e, game));
    ev.on('encounter', (e) => this.log.add('encounter', e, game));
    ev.on('zombieKilled', (e) => this.log.add('zombie_killed', e, game));
    ev.on('item', (e) => this.log.add('item', e, game));
    ev.on('advocated', (e) => this.log.add('advocated', e, game));
    ev.on('stuckOffer', () => this.log.add('stuck', {}, game));
    ev.on('ending', (s) => {
      this.log.add('ending', s, game);
      if (game.mode === 'normal') this.saves.remove('auto');
    });
    ev.on('endingDone', (s) => this.endingMenu(s, game));
  }

  startNewGame(lengthMin, seedIndex = null) {
    let seed = seedIndex;
    if (seed === null && this.settings.teacherSeed) {
      seed = indexFromCode(this.settings.teacherSeed);
      this.settings.teacherSeed = null; // one-shot
      this.saveSettings();
    }
    if (seed === null || seed === undefined) seed = randomSeedIndex();
    this.settings.defaultLength = lengthMin;
    this.saveSettings();
    const facility = generateFacility({ seedIndex: seed, lengthMin, data: this.data });
    this.endGame();
    this.game = this.makeGame(facility);
    this.log.startSession({ seed: facility.code, lengthMin, assist: this.settings.assist, fastestRouteSec: facility.stats.fastestCompleteSec });
    this.stack.clear();
    this.stack.push(this.game);
    this.speech.say(`Seed code: ${spokenCode(facility.code)}. ${lengthMin}-minute game.${this.settings.assist ? ' Assist mode on.' : ''}`, { priority: 'urgent' });
    this.game.start();
    this.autosave();
  }

  loadGame(saved) {
    if (!saved) return;
    const facility = generateFacility({ seedIndex: saved.seedIndex, lengthMin: saved.lengthMin, data: this.data });
    this.endGame();
    this.game = this.makeGame(facility, { saved });
    this.log.startSession({ seed: facility.code, lengthMin: saved.lengthMin, loaded: true });
    this.stack.clear();
    this.stack.push(this.game);
    this.game.start({ resumed: true });
  }

  startTutorial() {
    this.endGame();
    this.game = this.makeGame(buildTutorialFacility(), { mode: 'tutorial' });
    this.stack.clear();
    this.stack.push(this.game);
    this.tutorial = new Tutorial(this.game, this.data, () => {
      this.settings.tutorialDone = true;
      this.saveSettings();
      this.log.add('tutorial_done', {});
      setTimeout(() => this.mainMenu(), 2500);
    });
    this.game.start();
    this.tutorial.start();
  }

  endGame() {
    if (this.game) {
      this.game.soundscape.stopAll();
      this.game.ended = true;
    }
    this.tutorial?.destroy();
    this.tutorial = null;
    this.game = null;
  }

  autosave() {
    const g = this.game;
    if (!g || g.ended || g.mode !== 'normal' || g.narrating) return;
    this.saves.save('auto', g.serialize());
  }

  pause() {
    const g = this.game;
    if (!g || g.paused) return;
    g.paused = true;
    g.events.emit('paused', {});
    this.autosave();
    this.audio.play('ui_select', { bus: 'ui' });
    this.stack.push(this.pauseMenu());
  }

  resume() {
    const g = this.game;
    if (!g) return;
    g.paused = false;
    g.events.emit('resumed', {});
    if (this.settings.lockdown && !this.lockdown.active) this.lockdown.enter();
    this.speech.say('Resumed.', { priority: 'urgent', record: false });
  }

  pauseMenu() {
    const g = this.game;
    const m = new Menu(this.ctx, {
      title: g.mode === 'tutorial' ? 'Paused' : `Paused. ${formatDuration(g.clock.remaining)} remaining`,
      items: [
        { label: 'Resume', onSelect: () => { this.stack.pop(m); this.resume(); } },
        { label: 'Save game', hidden: () => g.mode !== 'normal', onSelect: () => this.stack.push(this.saveMenu()) },
        { label: 'Load game', onSelect: () => this.stack.push(this.loadMenu()) },
        { label: 'Settings', onSelect: () => this.stack.push(this.settingsMenu()) },
        { label: 'Repeat tutorial', hint: 'Hear how to play again, without leaving the game', onSelect: () => this.speech.say(`${this.data.story.tutorial.intro} ${this.data.story.controlsHelp.join(' ')}`, { priority: 'urgent' }) },
        {
          label: 'Quit to main menu',
          onSelect: () => this.stack.push(confirmMenu(this.ctx, g.mode === 'normal' ? 'Quit to the main menu? Your game is autosaved, so you can continue later.' : 'Leave the tutorial?', () => {
            this.autosave();
            this.mainMenu();
          })),
        },
      ],
      onBack: () => { this.stack.pop(m); this.resume(); },
    });
    return m;
  }

  /** Focus lost, tab hidden or fullscreen exited: autosave and pause. */
  autoPause(reason) {
    this.autosave();
    const g = this.game;
    this.applySettings();
    if (!g || g.ended || g.paused) return;
    g.paused = true;
    g.events.emit('paused', { auto: true });
    this.log.add('auto_pause', { reason }, g);
    const overlay = {
      onEnter: () => this.speech.say('Game paused. Press Enter to resume.', { priority: 'urgent' }),
      onInput: (inp) => {
        if (inp.action === 'interact') {
          this.stack.pop(overlay);
          this.resume();
        } else if (inp.action === 'pauseHold') {
          this.stack.pop(overlay);
          this.stack.push(this.pauseMenu());
        } else this.speech.say('Game paused. Press Enter to resume.', { priority: 'urgent' });
      },
    };
    this.stack.push(overlay);
  }

  endingMenu(s, game) {
    const title = { win: 'You escaped with the cure', partial: 'You escaped', secret: 'Secret ending', sterilized: 'Sterilized', infected: 'Infected' }[s.kind] || 'The end';
    const facility = game.facility;
    const summary = `${title}. ${s.won ? `${formatDuration(s.remaining)} to spare. ` : ''}You explored ${s.roomsVisited} of ${s.totalRooms} rooms and found ${s.logsHeard} of ${s.totalLogs} audio logs. ${plural(s.deaths, 'knockdown')}, ${plural(s.hints, 'hint')}.`;
    const m = new Menu(this.ctx, {
      title: summary,
      items: [
        { label: 'Play the same layout again', onSelect: () => this.startNewGame(facility.lengthMin, facility.seedIndex) },
        { label: 'New game', onSelect: () => { this.mainMenu(); this.stack.push(this.lengthMenu()); } },
        { label: 'Main menu', onSelect: () => this.mainMenu() },
      ],
      onBack: () => this.mainMenu(),
    });
    this.stack.push(m);
  }

  // ------------------------------------------------------------------ teacher panel

  openTeacher() {
    if (this.stack.contains((h) => h.isTeacher)) return;
    const g = this.game;
    if (g && !g.paused) {
      g.paused = true;
      g.events.emit('paused', { teacher: true });
    }
    const s = this.settings;
    const save = () => this.saveSettings();
    const m = new Menu(this.ctx, {
      title: 'Teacher panel',
      items: [
        {
          label: 'Default session length', type: 'choice',
          options: LENGTHS.map((l) => ({ value: l, label: `${l} minutes` })),
          get: () => s.defaultLength,
          set: (v) => { s.defaultLength = v; save(); },
        },
        {
          label: 'View seed',
          onSelect: () => {
            const code = g ? g.facility.code : s.teacherSeed;
            const text = code && code !== 'practice' ? `Current seed: ${spokenCode(code)}, ${g ? `${g.facility.lengthMin} minutes` : 'next game'}. Fastest possible route: ${g ? formatDuration(g.facility.stats?.fastestCompleteSec || 0) : 'unknown'}.` : 'No game running.';
            this.setStatus(text);
            this.speech.say(text, { priority: 'urgent' });
          },
        },
        {
          label: 'Set seed for the next game',
          onSelect: () => this.stack.push(new TextEntry(this.ctx, {
            prompt: 'Type a seed code, like amber fox 42',
            onDone: (v) => {
              if (indexFromCode(v) === null) {
                this.audio.play('ui_error', { bus: 'ui' });
                this.speech.say('That is not a valid seed code.', { priority: 'urgent' });
                return;
              }
              s.teacherSeed = codeFromIndex(indexFromCode(v));
              save();
              this.speech.say(`The next new game will use ${spokenCode(s.teacherSeed)}.`, { priority: 'urgent' });
            },
          })),
        },
        { label: 'Speech rate', type: 'slider', min: 0.5, max: 3, step: 0.1, get: () => s.speech.rate, set: (v) => { s.speech.rate = v; save(); }, format: (v) => `${v.toFixed(1)} times` },
        { label: 'Show visuals', type: 'toggle', get: () => s.visuals.enabled, set: (v) => { s.visuals.enabled = v; save(); } },
        { label: 'Reveal whole map on screen', type: 'toggle', get: () => s.visuals.revealMap, set: (v) => { s.visuals.revealMap = v; save(); } },
        { label: 'High contrast visuals', type: 'toggle', get: () => s.visuals.highContrast, set: (v) => { s.visuals.highContrast = v; save(); } },
        { label: 'Assist mode for new games', type: 'toggle', get: () => s.assist, set: (v) => { s.assist = v; save(); } },
        { label: 'Pause clock while descriptions play', type: 'toggle', get: () => s.pauseClockForDescriptions, set: (v) => { s.pauseClockForDescriptions = v; save(); } },
        { label: 'Allow browser zoom', type: 'toggle', get: () => s.allowZoom, set: (v) => { s.allowZoom = v; save(); } },
        { label: 'Fullscreen lockdown', type: 'toggle', get: () => s.lockdown, set: (v) => { s.lockdown = v; save(); if (v) this.lockdown.enter(); else this.lockdown.exit(); } },
        { label: 'Export session log as CSV', onSelect: () => this.download(`echo-session-log-${dateStamp()}.csv`, this.log.toCSV(), 'text/csv') },
        { label: 'Export session log as JSON', onSelect: () => this.download(`echo-session-log-${dateStamp()}.json`, JSON.stringify(this.log.toJSON(), null, 2), 'application/json') },
        { label: 'Export current save', onSelect: () => this.exportSave() },
        { label: 'Import a save file', onSelect: () => this.importSave() },
        { label: 'Clear session log', onSelect: () => this.stack.push(confirmMenu(this.ctx, 'Clear the whole session log?', () => { this.log.clear(); this.speech.say('Session log cleared.', { priority: 'urgent' }); })) },
        { label: 'Close teacher panel', onSelect: () => close() },
      ],
      onBack: () => close(),
    });
    m.isTeacher = true;
    const close = () => {
      this.stack.pop(m);
      if (g && !this.stack.contains((h) => h.title?.startsWith?.('Paused'))) {
        g.paused = false;
        g.events.emit('resumed', {});
      }
      this.speech.say('Teacher panel closed.', { priority: 'urgent' });
    };
    this.log.add('teacher_panel', {}, g);
    this.stack.push(m);
  }

  download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
    this.speech.say(`Downloaded ${name}.`, { priority: 'urgent' });
  }

  exportSave() {
    const data = this.game?.mode === 'normal' ? this.game.serialize() : this.saves.load('auto');
    if (!data) {
      this.speech.say('There is no game to export.', { priority: 'urgent' });
      return;
    }
    this.download(`echo-save-${data.code || 'game'}-${dateStamp()}.json`, exportText(data), 'application/json');
  }

  importSave() {
    const input = this.el.file;
    input.value = '';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const data = importText(await file.text());
      if (!data) {
        this.speech.say('That file is not an Echo Protocol save.', { priority: 'urgent' });
        return;
      }
      this.saves.save('1', data);
      this.speech.say('Save imported into slot 1. Loading it now.', { priority: 'urgent' });
      this.loadGame(data);
    };
    input.click();
  }
}

function dateStamp() {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
}

export { LENGTH_PROFILES };
