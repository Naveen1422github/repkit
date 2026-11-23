// timepick — min:sec wheel picker sheet + the +/- stepper used for weight and reps.
import { el, openModal } from './ui.js';
import { toParts, fromParts, formatSec } from './timefmt.js';

export const BREAK_CHIPS = [30, 45, 60, 90, 120];
export const DURATION_CHIPS = [30, 45, 60, 90, 120];
const SEC_STEP = 5;          // gym timings don't need 1-second precision; halves the wheel
const ROW_PX = 40;           // keep in sync with .rk-wheel-item height in style.css

// one scroll-snap column. returns { node, get(), set(v) }
function wheel(values, initial, fmt) {
  const col = el('div', { class: 'rk-wheel' },
    el('div', { class: 'rk-wheel-pad' }),
    ...values.map((v) => el('div', { class: 'rk-wheel-item' }, fmt(v))),
    el('div', { class: 'rk-wheel-pad' }));
  let index = Math.max(0, values.indexOf(initial));
  const mark = () => [...col.querySelectorAll('.rk-wheel-item')].forEach((n, i) => n.classList.toggle('on', i === index));
  const read = () => {
    index = Math.min(values.length - 1, Math.max(0, Math.round(col.scrollTop / ROW_PX)));
    mark();
  };
  let t = null;
  col.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(read, 80); }, { passive: true });
  if ('onscrollend' in col) col.addEventListener('scrollend', read);
  const set = (v) => {
    index = Math.max(0, values.indexOf(v));
    col.scrollTop = index * ROW_PX;
    mark();
  };
  // initial position must be set once the column is in the DOM and has a height
  requestAnimationFrame(() => set(values[index]));
  mark();
  return { node: col, get: () => values[index], set };
}

// value: seconds or null. onPick(seconds|null)
export function openTimePicker({ title, value, chips = BREAK_CHIPS, onPick }) {
  openModal(title, (body, close) => {
    const start = value ?? 0;
    const { m, s } = toParts(start);
    const minutes = Array.from({ length: 60 }, (_, i) => i);
    const seconds = Array.from({ length: 60 / SEC_STEP }, (_, i) => i * SEC_STEP);
    const mw = wheel(minutes, m, (v) => `${v}m`);
    const sw = wheel(seconds, s - (s % SEC_STEP), (v) => `${String(v).padStart(2, '0')}s`);
    const pick = (sec) => { close(); onPick(sec); };
    body.append(
      el('div', { class: 'chips rk-time-chips' },
        ...chips.map((c) => el('button', {
          type: 'button', class: 'chip' + (value === c ? ' active' : ''), onClick: () => pick(c),
        }, formatSec(c)))),
      el('div', { class: 'rk-wheels' }, mw.node, el('span', { class: 'rk-wheel-colon' }, ':'), sw.node,
        el('div', { class: 'rk-wheel-band' })),
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn-ghost', onClick: () => pick(null) }, 'clear'),
        el('button', {
          class: 'btn-primary',
          onClick: () => {
            const sec = fromParts(mw.get(), sw.get());
            pick(sec > 0 ? sec : null);
          },
        }, 'done')),
    );
  });
}

// [−] value [+]. tap the value to type. empty = null. onChange(number|null)
export function stepper({ value, step, min = 0, unit = '', onChange }) {
  let v = value;
  const show = () => `${v == null ? '–' : +v.toFixed(2)}${unit ? ' ' + unit : ''}`;
  const label = el('button', { type: 'button', class: 'rk-step-val' }, show());
  const node = el('div', { class: 'rk-stepper' });
  const commit = (next) => {
    v = next == null ? null : Math.max(min, Math.round(next * 100) / 100);
    label.textContent = show();
    onChange(v);
  };
  const minus = el('button', { type: 'button', class: 'qty-step', 'aria-label': 'Less', onClick: () => commit(v == null ? null : v - step) }, '−');
  const plus = el('button', { type: 'button', class: 'qty-step', 'aria-label': 'More', onClick: () => commit((v ?? 0) + step) }, '+');
  label.addEventListener('click', () => {
    const input = el('input', { class: 'input rk-step-input', type: 'number', inputmode: 'decimal', step: 'any', value: v ?? '' });
    const done = () => {
      const raw = input.value.trim();
      const n = raw === '' ? null : Number(raw);
      input.replaceWith(label);
      if (n === null || Number.isFinite(n)) commit(n);
    };
    input.addEventListener('blur', done);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    label.replaceWith(input);
    input.focus();
    input.select();
  });
  node.append(minus, label, plus);
  return node;
}
