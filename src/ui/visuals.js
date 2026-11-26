// Optional top-down tile map for teachers, peers and low-vision/CVI players.
// Decorative only: it reads game state and never changes gameplay. No flashing,
// no animation; it simply redraws when things move.

const PALETTES = {
  gb: { bg: '#0f380f', wall: '#306230', floor: '#9bbc0f', floor2: '#8bac0f', detail: '#306230', player: '#0f380f', zombie: '#0f380f', item: '#306230', exit: '#0f380f', text: '#9bbc0f', door: '#8bac0f', locked: '#0f380f' },
  hc: { bg: '#000000', wall: '#ffffff', floor: '#000000', floor2: '#1a1a1a', detail: '#ffffff', player: '#ffff00', zombie: '#ffffff', item: '#ffff00', exit: '#ffff00', text: '#ffff00', door: '#000000', locked: '#ffff00' },
};

export class Visuals {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.enabled = false;
    this.opts = { highContrast: false, largeSprites: false, revealMap: false };
    this.lastKey = '';
  }
  configure(v) {
    this.enabled = !!v.enabled;
    this.opts = { ...this.opts, ...v };
    this.canvas.hidden = !this.enabled;
    this.lastKey = '';
  }
  resize() {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || 640;
    const h = this.canvas.clientHeight || 480;
    if (this.canvas.width !== Math.round(w * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.dpr = dpr;
  }
  render(game) {
    if (!this.enabled || !game) return;
    const p = game.player;
    const key = JSON.stringify([p.room, p.x, p.y, p.facing, !!p.hidden, game.zombies.alive.map((z) => [z.room, z.x, z.y]),
      game.world.f.doors.map((d) => d.state + d.unlocked), game.visited.size, this.opts, this.canvas.clientWidth, this.canvas.clientHeight]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.resize();
    const c = this.ctx;
    const pal = this.opts.highContrast ? PALETTES.hc : PALETTES.gb;
    const T = (this.opts.largeSprites ? 32 : 16) * this.dpr;
    const W = this.canvas.width;
    const H = this.canvas.height;
    c.imageSmoothingEnabled = false;
    c.fillStyle = pal.bg;
    c.fillRect(0, 0, W, H);
    const w = game.world;
    const pp = w.worldPos(p.room, p.x, p.y);
    const ox = W / 2 - pp.x * T;
    const oy = H / 2 - pp.y * T;
    const tile = (wx, wy, color, inset = 0) => {
      c.fillStyle = color;
      c.fillRect(Math.floor(ox + wx * T + inset), Math.floor(oy + wy * T + inset), Math.ceil(T - inset * 2), Math.ceil(T - inset * 2));
    };
    const known = (r) => this.opts.revealMap || p.mapRead || game.visited.has(r.id);

    for (const r of w.f.rooms) {
      if (!known(r)) continue;
      // Walls
      for (let x = -1; x <= r.w; x++) for (let y = -1; y <= r.h; y++) {
        const inside = x >= 0 && y >= 0 && x < r.w && y < r.h;
        if (inside) {
          const checker = ((x + y) & 1) === 0;
          tile(r.ox + x, r.oy + y, r.surface === 'carpet' || r.surface === 'grass' ? pal.floor2 : checker ? pal.floor : pal.floor2);
        } else tile(r.ox + x, r.oy + y, pal.wall);
      }
      // Doors and the exit gap
      for (const s of ['N', 'E', 'S', 'W']) {
        if (!r.doors[s] && r.exitSide !== s) continue;
        const t = w.doorTile(r.id, s);
        const dx = { N: 0, E: 1, S: 0, W: -1 }[s];
        const dy = { N: -1, E: 0, S: 1, W: 0 }[s];
        const door = r.doors[s] ? w.door(r.doors[s]) : null;
        const open = !door || door.kind === 'passage' || door.state === 'open';
        const locked = door && w.isLocked(door);
        // Doorway plus a short corridor stub toward the next cell.
        for (let k = 1; k <= 2; k++) tile(r.ox + t.x + dx * k, r.oy + t.y + dy * k, pal.floor);
        if (locked) tile(r.ox + t.x + dx, r.oy + t.y + dy, pal.locked, T * 0.1);
        else if (!open) {
          // A closed door is a solid bar across the doorway.
          c.fillStyle = pal.wall;
          const bx = ox + (r.ox + t.x + dx) * T;
          const by = oy + (r.oy + t.y + dy) * T;
          if (dx) c.fillRect(bx + T * 0.35, by, T * 0.3, T);
          else c.fillRect(bx, by + T * 0.35, T, T * 0.3);
        }
        if (r.exitSide === s) {
          tile(r.ox + t.x + dx, r.oy + t.y + dy, pal.exit, T * 0.15);
          tile(r.ox + t.x + dx, r.oy + t.y + dy, pal.floor, T * 0.32);
        }
      }
      for (const f of r.fixtures) {
        tile(r.ox + f.x, r.oy + f.y, pal.detail, T * 0.12);
        if (f.type === 'container' && !f.searched && f.items?.length) tile(r.ox + f.x, r.oy + f.y, pal.item, T * 0.35);
        if (f.type === 'hide') tile(r.ox + f.x, r.oy + f.y, pal.floor, T * 0.3);
        if (['clue', 'log', 'memo', 'map'].includes(f.type)) tile(r.ox + f.x, r.oy + f.y, pal.item, T * 0.38);
      }
      for (const o of r.obstacles) {
        tile(r.ox + o.x, r.oy + o.y, pal.wall, T * 0.2);
      }
    }
    // Zombies in known rooms near the player
    const d = w.roomDistances(p.room);
    for (const z of game.zombies.alive) {
      const r = w.room(z.room);
      if (!known(r) && !this.opts.revealMap) continue;
      if ((d.get(z.room)?.hops ?? 99) > 2 && !this.opts.revealMap) continue;
      const zp = w.worldPos(z.room, z.x, z.y);
      this.blob(ox + zp.x * T, oy + zp.y * T, T * 0.38, pal.zombie, pal.floor, null);
    }
    // Player with a notch showing facing
    this.blob(ox + pp.x * T, oy + pp.y * T, T * 0.4, pal.player, pal.floor, p.facing, !!p.hidden);
  }
  blob(cx, cy, r, color, eye, facing, hollow = false) {
    const c = this.ctx;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fillStyle = color;
    c.fill();
    if (hollow) {
      c.beginPath();
      c.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
      c.fillStyle = eye;
      c.fill();
    }
    if (facing) {
      const v = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[facing];
      c.beginPath();
      c.arc(cx + v[0] * r * 0.55, cy + v[1] * r * 0.55, r * 0.25, 0, Math.PI * 2);
      c.fillStyle = eye;
      c.fill();
    }
  }
}
