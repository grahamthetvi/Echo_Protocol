// Mirrors spoken text into aria-live regions (screen-reader fallback, used when
// lockdown/self-voicing is off) and into an optional large caption bar.

export class LiveMirror {
  constructor({ polite, assertive, caption }) {
    this.polite = polite;
    this.assertive = assertive;
    this.caption = caption;
    this.enabled = false;
    this.captions = false;
  }
  show({ text, priority }) {
    if (this.captions && this.caption) this.caption.textContent = text;
    if (!this.enabled) return;
    const el = priority === 'urgent' ? this.assertive : this.polite;
    // Clear then set so repeated identical messages are still announced.
    el.textContent = '';
    setTimeout(() => {
      el.textContent = text;
    }, 30);
  }
}
