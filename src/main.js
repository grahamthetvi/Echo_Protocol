// Entry point.
import { App } from './app.js';

const app = new App();
window.echoProtocol = app; // handy for teachers debugging in the console

app.boot().catch((err) => {
  console.error(err);
  const s = document.getElementById('status-line');
  if (s) s.textContent = `Echo Protocol could not start: ${err.message}. Make sure it is served over http, not opened as a file.`;
  try {
    const u = new SpeechSynthesisUtterance('Echo Protocol could not start. Please ask a teacher for help.');
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
});

// Offline support after the first visit.
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !/localhost|127\.0\.0\.1/.test(location.hostname) || new URLSearchParams(location.search).has('sw')) {
  navigator.serviceWorker?.register('sw.js').catch(() => {});
}
