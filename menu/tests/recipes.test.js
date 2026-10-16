import test from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES } from '../recipes.js';
import { DISHES } from '../dishes.js';

test('every dish has a recipe', () => {
  for (const d of DISHES) assert.ok(RECIPES[d.id], `нет рецепта: ${d.id}`);
});

test('there are no recipes for unknown dishes', () => {
  const ids = new Set(DISHES.map((d) => d.id));
  for (const id of Object.keys(RECIPES)) assert.ok(ids.has(id), `лишний рецепт: ${id}`);
});

test('each recipe has a time like "20 мин" and 4 to 6 non-empty steps', () => {
  for (const [id, r] of Object.entries(RECIPES)) {
    assert.match(r.time, /^\d+ мин$/, id);
    assert.ok(r.steps.length >= 4 && r.steps.length <= 6, `${id}: шагов ${r.steps.length}`);
    for (const step of r.steps) assert.ok(typeof step === 'string' && step.trim().length > 5, id);
  }
});
