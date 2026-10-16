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

test('mustExist rejects when no family was saved under that code', async () => {
  await assert.rejects(() => createStore(null, 'abcdef123456', fakeBackend(), { mustExist: true }), /не найдена/);
});

test('a created family can be entered later with mustExist', async () => {
  const backend = fakeBackend();
  await createStore(null, 'abcdef123456', backend);
  const again = await createStore(null, 'abcdef123456', backend, { mustExist: true });
  assert.equal(again.get().people, 4);
});

// ---- облако с поддельным SDK ----
function fakeSdk({ exists = true, data = {}, failFirst = false, setDocError = null } = {}) {
  const calls = { app: 0, fs: 0, unsub: 0, setDoc: [] };
  let listener = null;
  const sdk = {
    initializeApp: () => { calls.app++; return {}; },
    persistentLocalCache: () => ({}),
    initializeFirestore: () => { calls.fs++; return {}; },
    doc: () => ({}),
    onSnapshot: (_ref, next, error) => {
      listener = { next, error };
      if (failFirst) error(new Error('permission-denied'));
      else next({ exists: () => exists, data: () => data });
      return () => { calls.unsub++; };
    },
    setDoc: async (_ref, value) => { calls.setDoc.push(value); if (setDocError) throw setDocError; },
  };
  return { sdk, calls, emit: () => listener };
}

test('cloud: after a failed connection the retry reuses the initialized Firestore and the failed listener is removed', async () => {
  const cfg = { id: 'retry' };
  const bad = fakeSdk({ failFirst: true });
  await assert.rejects(() => createStore(cfg, 'abcdef123456', null, { loadSdk: async () => bad.sdk }), /Нет доступа/);
  assert.equal(bad.calls.unsub, 1);
  const good = fakeSdk();
  const store = await createStore(cfg, 'abcdef123456', null, { loadSdk: async () => good.sdk });
  assert.equal(store.mode, 'cloud');
  assert.equal(bad.calls.fs + good.calls.fs, 1);
});

test('cloud: mustExist rejects for a missing family and removes the listener', async () => {
  const f = fakeSdk({ exists: false });
  await assert.rejects(() => createStore({ id: 'must' }, 'abcdef123456', null, { mustExist: true, loadSdk: async () => f.sdk }), /не найдена/);
  assert.equal(f.calls.unsub, 1);
  assert.equal(f.calls.setDoc.length, 0);
});

test('cloud: a new family document is created with the default state', async () => {
  const f = fakeSdk({ exists: false });
  await createStore({ id: 'create' }, 'abcdef123456', null, { loadSdk: async () => f.sdk });
  assert.deepEqual(f.calls.setDoc, [defaultState()]);
});

test('cloud: update rejects when the write fails', async () => {
  const f = fakeSdk({ setDocError: new Error('permission-denied') });
  const store = await createStore({ id: 'write' }, 'abcdef123456', null, { loadSdk: async () => f.sdk });
  await assert.rejects(() => store.update({ people: 7 }), /permission-denied/);
});

test('cloud: errors after the first snapshot go to onError', async () => {
  const f = fakeSdk();
  const errors = [];
  await createStore({ id: 'late' }, 'abcdef123456', null, { loadSdk: async () => f.sdk, onError: (e) => errors.push(e.message) });
  f.emit().error(new Error('boom'));
  assert.equal(errors.length, 1);
});
