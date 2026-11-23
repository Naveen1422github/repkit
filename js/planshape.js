// planshape — a weekday's plan is a list of ENTRIES: an exercise PlanItem (no `type`, also every
// pre-circuit plan) or a circuit {id, type:'circuit', rounds, items: PlanItem[]}. pure helpers.
export const isCircuit = (entry) => entry?.type === 'circuit';

export const flatItems = (entries) => entries.flatMap((e) => (isCircuit(e) ? e.items : [e]));

export function findItem(entries, itemId) {
  for (const e of entries) {
    if (isCircuit(e)) {
      const item = e.items.find((i) => i.id === itemId);
      if (item) return { item, circuit: e };
    } else if (e.id === itemId) return { item: e, circuit: null };
  }
  return null;
}

// replace the item with id itemId (top level or inside a circuit) by fn(item); new arrays, input untouched
export const mapItems = (entries, itemId, fn) => entries.map((e) => {
  if (isCircuit(e)) return e.items.some((i) => i.id === itemId) ? { ...e, items: e.items.map((i) => (i.id === itemId ? fn(i) : i)) } : e;
  return e.id === itemId ? fn(e) : e;
});
