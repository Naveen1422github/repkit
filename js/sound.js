// sound — generated tones (no audio files). low = stop (exercise timer), high = go (break).
// browsers only allow audio after a user gesture: call unlock() from the Start / resume tap.
// sound must never break the workout, so every failure is swallowed.
const FREQ = { low: 440, high: 880 };

export function createSound() {
  let ctx = null;
  let enabled = true;

  function unlock() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!ctx) ctx = new AC();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch { /* no audio */ }
  }

  const unlocked = () => !!ctx && ctx.state === 'running';

  function beep(freq, ms, gain = 0.25, delayMs = 0) {
    const t0 = ctx.currentTime + delayMs / 1000;
    const t1 = t0 + ms / 1000;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // 5ms attack / 40ms release so tones don't click
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    g.gain.setValueAtTime(gain, Math.max(t0 + 0.005, t1 - 0.04));
    g.gain.linearRampToValueAtTime(0, t1);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t1 + 0.01);
  }

  function play(cue, tone) {
    if (!enabled) return;
    try {
      if (cue === 'end') navigator.vibrate?.(300);
      if (!ctx) return;
      if (ctx.state !== 'running') ctx.resume().catch(() => {}); // e.g. after an iOS screen lock
      const f = FREQ[tone] ?? FREQ.low;
      if (cue === 'tick') beep(f, 70);
      else if (cue === 'end') beep(f, 600);
      else if (cue === 'over') { beep(f, 90, 0.12); beep(f, 90, 0.12, 150); }
    } catch { /* ignore */ }
  }

  return { unlock, unlocked, play, setEnabled: (on) => { enabled = !!on; } };
}
