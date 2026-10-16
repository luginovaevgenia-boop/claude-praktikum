import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFamilyCode, defaultState, createStore } from '../storage.js';

function fakeBackend() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

test('generateFamilyCode returns 12 chars from the alphabet and differs between calls', () => {
  const a = generateFamilyCode();
  const b = generateFamilyCode();
  assert.match(a, /^[abcdefghjkmnpqrstuvwxyz23456789]{12}$/);
  assert.notEqual(a, b);
});

test('local store returns defaultState for a new code', async () => {
  const store = await createStore(null, 'abcdef123456', fakeBackend());
  assert.deepEqual(store.get(), defaultState());
  assert.equal(store.mode, 'local');
});

test('update merges the patch and persists to the backend', async () => {
  const backend = fakeBackend();
  const store = await createStore(null, 'abcdef123456', backend);
  await store.update({ people: 5 });
  await store.update({ pantry: ['гречка'] });
  assert.equal(store.get().people, 5);
  assert.deepEqual(store.get().pantry, ['гречка']);
  const again = await createStore(null, 'abcdef123456', backend);
  assert.equal(again.get().people, 5);
  assert.deepEqual(again.get().pantry, ['гречка']);
});

test('subscribe calls back immediately and after update, and stops after unsubscribe', async () => {
  const store = await createStore(null, 'abcdef123456', fakeBackend());
  const seen = [];
  const off = store.subscribe((s) => seen.push(s.people));
  await store.update({ people: 3 });
  off();
  await store.update({ people: 6 });
  assert.deepEqual(seen, [4, 3]);
});

test('two stores with different codes do not share state', async () => {
  const backend = fakeBackend();
  const a = await createStore(null, 'aaaaaa111111', backend);
  const b = await createStore(null, 'bbbbbb222222', backend);
  await a.update({ people: 9 });
  assert.equal(b.get().people, 4);
});

test('createStore rejects an empty or malformed family code with a Russian message', async () => {
  for (const bad of ['', '  ', 'a b', '12']) {
    await assert.rejects(() => createStore(null, bad, fakeBackend()), /код семьи/i);
  }
});

test('a corrupted backend value falls back to defaultState', async () => {
  const backend = fakeBackend();
  backend.setItem('menu:abcdef123456', '{not json');
  const store = await createStore(null, 'abcdef123456', backend);
  assert.deepEqual(store.get(), defaultState());
});
