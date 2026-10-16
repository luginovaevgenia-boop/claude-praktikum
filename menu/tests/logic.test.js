import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEALS, AISLES, emptyMenu, generateWeek, pickReplacement, buildShoppingList,
} from '../logic.js';

const item = (name, qty, unit = 'г', aisle = 'Бакалея') => ({ name, qty, unit, aisle });
const DISHES = [
  { id: 'b1', name: 'Овсянка', meals: ['breakfast'], items: [item('овсянка', 50, 'г', 'Крупы и макароны'), item('молоко', 150, 'мл', 'Молочное и яйца')] },
  { id: 'b2', name: 'Омлет', meals: ['breakfast'], items: [item('яйцо', 2, 'шт', 'Молочное и яйца')] },
  { id: 'b3', name: 'Гречневая каша', meals: ['breakfast'], items: [item('гречка', 60, 'г', 'Крупы и макароны')] },
  { id: 'l1', name: 'Суп куриный', meals: ['lunch'], items: [item('курица филе', 80, 'г', 'Мясо и рыба')] },
  { id: 'l2', name: 'Борщ', meals: ['lunch'], items: [item('свёкла', 1, 'шт', 'Овощи и фрукты')] },
  { id: 'l3', name: 'Плов', meals: ['lunch', 'dinner'], items: [item('рис', 70, 'г', 'Крупы и макароны'), item('курица филе', 100, 'г', 'Мясо и рыба')] },
  { id: 'd1', name: 'Гречка с котлетой', meals: ['dinner'], items: [item('гречка', 80, 'г', 'Крупы и макароны'), item('фарш', 100, 'г', 'Мясо и рыба')] },
  { id: 'd2', name: 'Макароны', meals: ['dinner'], items: [item('макароны', 90, 'г', 'Крупы и макароны')] },
];

// детерминированный генератор случайных чисел
function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}
function menuWith(slots) {
  const m = emptyMenu();
  for (const [day, meal, dishId] of slots) m[day][meal] = { off: false, dishId };
  return m;
}

test('emptyMenu has 7 days with three empty active slots', () => {
  const m = emptyMenu();
  assert.equal(m.length, 7);
  for (const day of m) for (const meal of MEALS) assert.deepEqual(day[meal], { off: false, dishId: null });
});

test('generateWeek fills every active slot with a dish suitable for that meal', () => {
  const m = generateWeek(DISHES, [], emptyMenu(), seeded(1));
  for (const day of m) for (const meal of MEALS) {
    const dish = DISHES.find((d) => d.id === day[meal].dishId);
    assert.ok(dish, `слот ${meal} пустой`);
    assert.ok(dish.meals.includes(meal));
  }
});

test('generateWeek keeps off slots empty', () => {
  const cur = emptyMenu();
  cur[1].lunch = { off: true, dishId: null };
  const m = generateWeek(DISHES, [], cur, seeded(2));
  assert.deepEqual(m[1].lunch, { off: true, dishId: null });
  assert.ok(m[0].lunch.dishId);
});

test('generateWeek never repeats a dish on consecutive days for the same meal', () => {
  for (let i = 0; i < 200; i++) {
    const m = generateWeek(DISHES, [], emptyMenu(), seeded(i + 10));
    for (const meal of MEALS) for (let d = 1; d < 7; d++) {
      assert.notEqual(m[d][meal].dishId, m[d - 1][meal].dishId);
    }
  }
});

test('generateWeek prefers dishes using pantry products', () => {
  const count = (pantry) => {
    let n = 0;
    for (let i = 0; i < 200; i++) {
      const m = generateWeek(DISHES, pantry, emptyMenu(), seeded(i + 500));
      n += m.filter((day) => day.breakfast.dishId === 'b3').length;
    }
    return n;
  };
  assert.ok(count(['гречка']) > count([]));
});

test('generateWeek leaves a slot empty when no dish matches the meal', () => {
  const onlyLunch = DISHES.filter((d) => d.id === 'l1');
  const m = generateWeek(onlyLunch, [], emptyMenu(), seeded(3));
  assert.equal(m[0].breakfast.dishId, null);
  assert.equal(m[0].breakfast.off, false);
  assert.equal(m[0].lunch.dishId, 'l1');
});

test('pickReplacement returns a different dish than the current one', () => {
  const menu = menuWith([[0, 'breakfast', 'b1']]);
  for (let i = 0; i < 50; i++) {
    const id = pickReplacement(DISHES, menu, 0, 'breakfast', [], seeded(i));
    assert.ok(['b2', 'b3'].includes(id));
  }
});

test('buildShoppingList sums items and scales by people', () => {
  const menu = menuWith([[0, 'breakfast', 'b1'], [1, 'breakfast', 'b1']]);
  const list = buildShoppingList(DISHES, menu, [], 3);
  const all = list.flatMap((g) => g.items);
  assert.equal(all.find((i) => i.name === 'овсянка').qty, 300);
  assert.equal(all.find((i) => i.name === 'молоко').qty, 900);
});

test('buildShoppingList subtracts pantry and normalizes names', () => {
  const menu = menuWith([[0, 'dinner', 'd1']]);
  const all = buildShoppingList(DISHES, menu, [' Гречка '], 2).flatMap((g) => g.items);
  assert.equal(all.some((i) => i.name === 'гречка'), false);
  assert.equal(all.some((i) => i.name === 'фарш'), true);
});

test('buildShoppingList does not merge different units', () => {
  const dishes = [
    { id: 'x', name: 'X', meals: ['breakfast'], items: [item('яйцо', 2, 'шт', 'Молочное и яйца')] },
    { id: 'y', name: 'Y', meals: ['lunch'], items: [item('яйцо', 100, 'г', 'Молочное и яйца')] },
  ];
  const menu = menuWith([[0, 'breakfast', 'x'], [0, 'lunch', 'y']]);
  const items = buildShoppingList(dishes, menu, [], 1).flatMap((g) => g.items);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.unit).sort(), ['г', 'шт']);
});

test('buildShoppingList returns [] when all slots are off', () => {
  const menu = emptyMenu();
  for (const day of menu) for (const meal of MEALS) day[meal] = { off: true, dishId: null };
  assert.deepEqual(buildShoppingList(DISHES, menu, [], 4), []);
});

test('buildShoppingList skips unknown dishId', () => {
  const menu = menuWith([[0, 'breakfast', 'deleted-dish'], [0, 'lunch', 'l1']]);
  const items = buildShoppingList(DISHES, menu, [], 1).flatMap((g) => g.items);
  assert.deepEqual(items.map((i) => i.name), ['курица филе']);
});

test('buildShoppingList treats invalid people as 1', () => {
  const menu = menuWith([[0, 'breakfast', 'b1']]);
  for (const bad of [0, NaN, -2, undefined]) {
    const items = buildShoppingList(DISHES, menu, [], bad).flatMap((g) => g.items);
    assert.equal(items.find((i) => i.name === 'овсянка').qty, 50);
  }
});

test('buildShoppingList groups by aisle in the fixed aisle order', () => {
  const menu = menuWith([[0, 'dinner', 'd1'], [0, 'breakfast', 'b1'], [0, 'lunch', 'l2']]);
  const aisles = buildShoppingList(DISHES, menu, [], 1).map((g) => g.aisle);
  assert.deepEqual(aisles, AISLES.filter((a) => aisles.includes(a)));
  assert.deepEqual(aisles, ['Мясо и рыба', 'Овощи и фрукты', 'Крупы и макароны', 'Молочное и яйца']);
});
