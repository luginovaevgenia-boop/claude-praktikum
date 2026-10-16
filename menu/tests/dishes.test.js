import test from 'node:test';
import assert from 'node:assert/strict';
import { DISHES, AISLES, UNITS } from '../dishes.js';
import { MEALS } from '../logic.js';

test('there are at least 80 dishes', () => {
  assert.ok(DISHES.length >= 80, `блюд: ${DISHES.length}`);
});

test('dish ids are unique', () => {
  const ids = DISHES.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every dish has a name, at least one valid meal and at least one item', () => {
  for (const d of DISHES) {
    assert.ok(d.name && d.name.trim(), d.id);
    assert.ok(d.meals.length >= 1 && d.meals.every((m) => MEALS.includes(m)), d.id);
    assert.ok(d.items.length >= 1, d.id);
  }
});

test('items use only known units and aisles with positive quantity', () => {
  for (const d of DISHES) for (const it of d.items) {
    assert.ok(it.name && it.name === it.name.trim().toLowerCase(), `${d.id}: ${it.name}`);
    assert.ok(UNITS.includes(it.unit), `${d.id}: ${it.unit}`);
    assert.ok(AISLES.includes(it.aisle), `${d.id}: ${it.aisle}`);
    assert.ok(it.qty > 0, `${d.id}: ${it.name}`);
  }
});

test('each meal has at least 20 dishes', () => {
  for (const meal of MEALS) {
    const n = DISHES.filter((d) => d.meals.includes(meal)).length;
    assert.ok(n >= 20, `${meal}: ${n}`);
  }
});
