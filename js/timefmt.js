// timefmt — seconds <-> m:ss. pure, no DOM.
export const toParts = (sec) => ({ m: Math.floor(sec / 60), s: sec % 60 });
export const fromParts = (m, s) => m * 60 + s;

export function formatSec(sec) {
  if (sec == null) return '';
  const a = Math.abs(Math.trunc(sec));
  const { m, s } = toParts(a);
  return `${sec < 0 ? '−' : ''}${m}:${String(s).padStart(2, '0')}`;
}
