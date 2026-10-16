export const MEALS = ['breakfast', 'lunch', 'dinner'];
export const UNITS = ['г', 'шт', 'мл'];
export const AISLES = [
  'Мясо и рыба',
  'Овощи и фрукты',
  'Крупы и макароны',
  'Молочное и яйца',
  'Хлеб и выпечка',
  'Бакалея',
];

export function emptyMenu() {
  return Array.from({ length: 7 }, () => ({
    breakfast: { off: false, dishId: null },
    lunch: { off: false, dishId: null },
    dinner: { off: false, dishId: null },
  }));
}

export function normalizeName(s) {
  return String(s).trim().toLowerCase();
}

function weightOf(dish, pantrySet) {
  return 1 + dish.items.filter((i) => pantrySet.has(normalizeName(i.name))).length;
}

function weightedPick(dishes, pantrySet, rng) {
  if (dishes.length === 0) return null;
  const weights = dishes.map((d) => weightOf(d, pantrySet));
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < dishes.length; i++) {
    r -= weights[i];
    if (r < 0) return dishes[i];
  }
  return dishes[dishes.length - 1];
}

export function generateWeek(dishes, pantry, currentMenu, rng = Math.random) {
  const pantrySet = new Set(pantry.map(normalizeName));
  const menu = emptyMenu();
  for (const meal of MEALS) {
    const pool = dishes.filter((d) => d.meals.includes(meal));
    const usedThisWeek = new Set();
    let prevId = null;
    for (let day = 0; day < 7; day++) {
      if (currentMenu[day][meal].off) {
        menu[day][meal] = { off: true, dishId: null };
        prevId = null;
        continue;
      }
      const sameDay = new Set(MEALS.map((m) => menu[day][m].dishId).filter(Boolean));
      // от строгого к мягкому: без повторов за неделю, потом только без соседних дней, потом любое
      const tiers = [
        pool.filter((d) => !usedThisWeek.has(d.id) && d.id !== prevId && !sameDay.has(d.id)),
        pool.filter((d) => d.id !== prevId && !sameDay.has(d.id)),
        pool.filter((d) => d.id !== prevId),
        pool,
      ];
      const dish = weightedPick(tiers.find((t) => t.length) || [], pantrySet, rng);
      menu[day][meal] = { off: false, dishId: dish ? dish.id : null };
      prevId = dish ? dish.id : null;
      if (dish) usedThisWeek.add(dish.id);
    }
  }
  return menu;
}

export function pickReplacement(dishes, menu, day, meal, pantry, rng = Math.random) {
  const pantrySet = new Set(pantry.map(normalizeName));
  const current = menu[day][meal].dishId;
  const pool = dishes.filter((d) => d.meals.includes(meal));
  const others = pool.filter((d) => d.id !== current);
  const dish = weightedPick(others.length ? others : pool, pantrySet, rng);
  return dish ? dish.id : null;
}

export function buildShoppingList(dishes, menu, pantry, people) {
  const n = Number.isFinite(people) && people >= 1 ? people : 1;
  const pantrySet = new Set(pantry.map(normalizeName));
  const byId = new Map(dishes.map((d) => [d.id, d]));
  const totals = new Map();
  for (const day of menu) for (const meal of MEALS) {
    const dish = byId.get(day[meal].dishId);
    if (day[meal].off || !dish) continue;
    for (const it of dish.items) {
      const name = normalizeName(it.name);
      if (pantrySet.has(name)) continue;
      const key = `${name}|${it.unit}`;
      const row = totals.get(key) || { key, name, qty: 0, unit: it.unit, aisle: it.aisle };
      row.qty += it.qty * n;
      totals.set(key, row);
    }
  }
  const groups = new Map();
  for (const { aisle, ...row } of totals.values()) {
    if (!groups.has(aisle)) groups.set(aisle, []);
    groups.get(aisle).push(row);
  }
  const rank = (a) => (AISLES.includes(a) ? AISLES.indexOf(a) : AISLES.length);
  return [...groups.keys()]
    .sort((a, b) => rank(a) - rank(b))
    .map((aisle) => ({ aisle, items: groups.get(aisle).sort((a, b) => a.name.localeCompare(b.name, 'ru')) }));
}

export function frequentDishes(dishes, picks, meal) {
  const counts = picks || {};
  return dishes
    .filter((d) => d.meals.includes(meal) && (counts[d.id] || 0) >= 2)
    .sort((a, b) => counts[b.id] - counts[a.id] || a.name.localeCompare(b.name, 'ru'));
}

export function scaleItems(dish, people) {
  const n = Number.isFinite(people) && people >= 1 ? people : 1;
  return dish.items.map((i) => ({ ...i, qty: i.qty * n }));
}
