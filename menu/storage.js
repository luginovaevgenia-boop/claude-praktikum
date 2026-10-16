import { emptyMenu } from './logic.js';

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const FIREBASE_BASE = 'https://www.gstatic.com/firebasejs/10.12.2/';

export function generateFamilyCode() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function defaultState() {
  return { people: 4, pantry: [], menu: emptyMenu(), bought: [], customDishes: [] };
}

function normalizeCode(code) {
  const c = String(code || '').trim().toLowerCase();
  if (!/^[a-z0-9]{6,32}$/.test(c)) throw new Error('Введите код семьи: от 6 до 32 латинских букв и цифр.');
  return c;
}

function createEmitter(getState) {
  const listeners = new Set();
  return {
    notify: () => listeners.forEach((cb) => cb(getState())),
    subscribe(cb) {
      listeners.add(cb);
      cb(getState());
      return () => listeners.delete(cb);
    },
  };
}

function createLocalStore(code, backend) {
  const key = `menu:${code}`;
  let state = defaultState();
  try {
    const raw = backend.getItem(key);
    if (raw) state = { ...defaultState(), ...JSON.parse(raw) };
  } catch { /* повреждённые данные — начинаем с чистого состояния */ }
  const emitter = createEmitter(() => state);
  return {
    mode: 'local',
    get: () => state,
    async update(patch) {
      state = { ...state, ...patch };
      backend.setItem(key, JSON.stringify(state));
      emitter.notify();
    },
    subscribe: emitter.subscribe,
  };
}

async function createCloudStore(config, code) {
  const { initializeApp } = await import(`${FIREBASE_BASE}firebase-app.js`);
  const fs = await import(`${FIREBASE_BASE}firebase-firestore.js`);
  const db = fs.initializeFirestore(initializeApp(config), { localCache: fs.persistentLocalCache() });
  const ref = fs.doc(db, 'families', code);
  let state = defaultState();
  const emitter = createEmitter(() => state);

  await new Promise((resolve, reject) => {
    let first = true;
    const timer = setTimeout(() => reject(new Error('Не удалось подключиться к облаку. Проверьте интернет.')), 8000);
    fs.onSnapshot(ref, (snap) => {
      state = { ...defaultState(), ...(snap.exists() ? snap.data() : {}) };
      emitter.notify();
      if (first) { first = false; clearTimeout(timer); resolve(); }
    }, () => {
      clearTimeout(timer);
      if (first) reject(new Error('Нет доступа к облаку. Проверьте настройки Firebase.'));
    });
  });

  return {
    mode: 'cloud',
    get: () => state,
    async update(patch) {
      state = { ...state, ...patch };
      emitter.notify();
      await fs.setDoc(ref, patch, { merge: true });
    },
    subscribe: emitter.subscribe,
  };
}

export async function createStore(config, familyCode, localBackend = globalThis.localStorage) {
  const code = normalizeCode(familyCode);
  return config ? createCloudStore(config, code) : createLocalStore(code, localBackend);
}
