// timer — pure maths from timestamps. the truth is always (startedAt, now), never a running interval,
// so screen-lock / app-kill can't drift a clock.
export const elapsedSec = (startMs, nowMs) => Math.max(0, Math.floor((nowMs - startMs) / 1000));

// may go negative = overtime
export const remainingSec = (targetSec, startMs, nowMs, extraSec = 0) =>
  targetSec + extraSec - elapsedSec(startMs, nowMs);

const OVER_EVERY = 30;
const MAX_CATCHUP = 2; // a bigger jump means we were asleep: don't replay missed beeps

// cues for every whole second crossed going from prevRem down to rem (oldest first)
export function cuesBetween(prevRem, rem, countdownSec) {
  if (prevRem - rem > MAX_CATCHUP) return [];
  const cues = [];
  for (let k = prevRem - 1; k >= rem; k--) {
    if (k >= 1 && k <= countdownSec) cues.push('tick');
    else if (k === 0) cues.push('end');
    else if (k < 0 && k % OVER_EVERY === 0) cues.push('over');
  }
  return cues;
}
