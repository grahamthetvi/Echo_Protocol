// Positional soundscape: room ambience loops, the exit beacon, ringing phones,
// zombie voices and footsteps, heartbeat and breathing. Sounds behind walls and
// closed doors are muffled with a low-pass filter (occlusion).

const STEP_SOUND = { tile: 'step_tile', carpet: 'step_carpet', grating: 'step_grating', grass: 'step_grass', gravel: 'step_gravel', wood: 'step_wood' };

export class Soundscape {
  constructor(game) {
    this.game = game;
    this.loops = new Map(); // roomId -> handle
    this.beaconTimer = 0;
    this.phoneTimer = 0;
    this.heartTimer = 0;
    this.breathTimer = 0;
    this.drone = null;
    this.lures = []; // { x, y, room, until, timer }
  }
  get audio() {
    return this.game.audio;
  }

  /** Occlusion for a sound in `roomId` heard from the player's room. */
  occlusion(roomId) {
    const hop = this.game.world.roomDistances(this.game.player.room).get(roomId);
    if (!hop) return { cutoff: 300, gain: 0, hops: 99 };
    if (hop.hops === 0) return { cutoff: 20000, gain: 1, hops: 0 };
    const cutoff = Math.max(250, 4000 / (1 + hop.hops * 0.8 + hop.closed * 2.2));
    const gain = Math.max(0.05, 0.75 / (1 + hop.hops * 0.6 + hop.closed * 0.8));
    return { cutoff, gain, hops: hop.hops };
  }

  footstep(surface, mode, pos, gain = 1) {
    const id = STEP_SOUND[surface] || 'step_tile';
    const g = (mode === 'sneak' ? 0.3 : mode === 'run' ? 1 : 0.6) * gain;
    this.audio.play(id, { gain: g, rate: 0.92 + Math.random() * 0.16, pos: { x: pos.x, y: pos.y + 0.3 } });
  }

  playAt(id, roomId, x, y, opts = {}) {
    const w = this.game.world;
    const pos = w.worldPos(roomId, x, y);
    const occ = this.occlusion(roomId);
    if (occ.hops > (opts.maxHops ?? 3)) return null;
    return this.audio.play(id, { ...opts, pos, gain: (opts.gain ?? 1) * occ.gain, lowpass: occ.cutoff });
  }

  zombieVoice(z, scream = false) {
    const g = (z.state === 'chase' ? 1 : 0.75) * (scream ? 1.3 : 1);
    this.playAt(z.def.sound, z.room, z.x, z.y, { gain: g, rate: 0.9 + Math.random() * 0.2, bus: 'alerts', maxHops: 3 });
  }

  zombieStep(z) {
    if (z.type === 'crawler') return;
    this.playAt(z.type === 'armored' ? 'step_grating' : 'z_step', z.room, z.x, z.y, { gain: z.state === 'chase' ? 0.6 : 0.35, maxHops: 1, rate: 0.8 + Math.random() * 0.2 });
  }

  doorSound(door, id, fromRoom) {
    const w = this.game.world;
    const side = w.sideOf(door, fromRoom);
    const t = w.doorTile(fromRoom, side);
    this.playAt(id, fromRoom, t.x, t.y, { maxHops: 3 });
  }

  throwLure(room, x, y) {
    this.lures.push({ room, x, y, until: 7, timer: 0 });
    this.playAt('lure_ring', room, x, y);
  }

  /** Extra positional sources for the L (listen) key. */
  listenSources() {
    const g = this.game;
    const w = g.world;
    const out = [];
    const ex = w.exitPos();
    out.push({ name: 'the rescue beacon', x: ex.x, y: ex.y });
    for (const ph of this.phones()) {
      const p = w.worldPos(ph.room.id, ph.fixture.x, ph.fixture.y);
      out.push({ name: 'a telephone ringing', x: p.x, y: p.y });
    }
    for (const l of this.lures) {
      const p = w.worldPos(l.room, l.x, l.y);
      out.push({ name: 'your noise-maker ringing', x: p.x, y: p.y });
    }
    return out;
  }

  phones() {
    const w = this.game.world;
    const d = w.roomDistances(this.game.player.room);
    const out = [];
    for (const r of w.f.rooms) {
      if ((d.get(r.id)?.hops ?? 99) > 3) continue;
      for (const f of r.fixtures) if (f.type === 'clue' && f.clue?.type === 'phone' && !f.answered) out.push({ room: r, fixture: f });
    }
    return out;
  }

  stopAll() {
    for (const h of this.loops.values()) h.stop(0.3);
    this.loops.clear();
    this.drone?.stop(0.5);
    this.drone = null;
  }

  update(dt) {
    const g = this.game;
    const w = g.world;
    const p = g.player;
    const pos = w.worldPos(p.room, p.x, p.y);
    this.audio.setListener(pos.x, pos.y, p.facing);

    // Ambience loops for rooms within two hops.
    const dists = w.roomDistances(p.room);
    const want = new Set();
    for (const [rid, hop] of dists) {
      if (hop.hops > 2) continue;
      const room = w.room(rid);
      if (!room.ambient) continue;
      want.add(rid);
      const occ = this.occlusion(rid);
      const c = w.roomCenter(rid);
      let h = this.loops.get(rid);
      if (!h || h.stopped) {
        h = this.audio.play(room.ambient, { loop: true, bus: 'ambience', pos: c, gain: 0, offset: Math.random() * 3, refDistance: 3 });
        this.loops.set(rid, h);
      }
      h.setOcclusion(occ.cutoff, occ.gain * 0.8);
    }
    for (const [rid, h] of this.loops) {
      if (!want.has(rid)) {
        h.stop(0.4);
        this.loops.delete(rid);
      }
    }

    // Tension drone rises while zombies chase.
    if (!this.drone || this.drone.stopped) this.drone = this.audio.play('music_drone', { loop: true, bus: 'ambience', gain: 0.1 });
    const chasing = g.zombies.alive.some((z) => z.state === 'chase');
    this.drone.setGain(chasing ? 0.45 : 0.12, 0.8);

    // Exit beacon.
    this.beaconTimer -= dt;
    if (this.beaconTimer <= 0) {
      this.beaconTimer = 1.6;
      const ex = w.exitPos();
      const occ = this.occlusion(w.f.exit.room);
      const far = Math.max(0.12, occ.gain);
      this.audio.play('beacon', { pos: ex, gain: far, lowpass: occ.hops === 0 ? 20000 : Math.max(500, occ.cutoff), bus: 'alerts', refDistance: 4, rolloff: 0.6 });
    }

    // Ringing phones (directional-source tracking).
    this.phoneTimer -= dt;
    if (this.phoneTimer <= 0) {
      this.phoneTimer = 3.5;
      for (const ph of this.phones()) this.playAt('phone_ring', ph.room.id, ph.fixture.x, ph.fixture.y, { gain: 0.8 });
    }

    // Thrown noise-makers ring for a few seconds and keep attracting zombies.
    for (const l of this.lures) {
      l.until -= dt;
      l.timer -= dt;
      if (l.timer <= 0) {
        l.timer = 1.5;
        this.playAt('lure_ring', l.room, l.x, l.y);
        g.noise(12, { room: l.room, x: l.x, y: l.y }, 'lure');
      }
    }
    this.lures = this.lures.filter((l) => l.until > 0);

    // Body sounds.
    this.heartTimer -= dt;
    if (p.health < 35 && this.heartTimer <= 0) {
      this.heartTimer = p.health < 20 ? 0.6 : 0.9;
      this.audio.play('heartbeat', { gain: 0.6, bus: 'alerts' });
    }
    this.breathTimer -= dt;
    if (p.exhaustion > 70 && this.breathTimer <= 0) {
      this.breathTimer = 2.2;
      this.audio.play('breath', { gain: 0.5, pos: { x: pos.x, y: pos.y } });
      g.noise(2, p, 'player');
    }
  }
}
