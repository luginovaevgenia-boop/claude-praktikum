import { emptyMenu } from './logic.js';

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const FIREBASE_BASE = 'https://www.gstatic.com/firebasejs/10.12.2/';
const NOT_FOUND = 'Семья с таким кодом не найдена. Проверьте код и подключение к интернету.';

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

function createLocalStore(code, backend, mustExist) {
  const key = `menu:${code}`;
  const raw = backend.getItem(key);
  if (raw == null && mustExist) throw new Error(NOT_FOUND);
  let state = defaultState();
  try {
    if (raw) state = { ...defaultState(), ...JSON.parse(raw) };
  } catch { /* повреждённые данные — начинаем с чистого состояния */ }
  if (raw == null) backend.setItem(key, JSON.stringify(state));
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

async function defaultLoadSdk() {
  const [app, firestore] = await Promise.all([
    import(`${FIREBASE_BASE}firebase-app.js`),
    import(`${FIREBASE_BASE}firebase-firestore.js`),
  ]);
  return { ...app, ...firestore };
}

// Firestore можно инициализировать только один раз на конфиг, поэтому при повторном входе берём ту же базу.
const databases = new Map();
async function getDatabase(config, loadSdk) {
  const sdk = await loadSdk();
  const key = JSON.stringify(config);
  if (!databases.has(key)) {
    databases.set(key, sdk.initializeFirestore(sdk.initializeApp(config), { localCache: sdk.persistentLocalCache() }));
  }
  return { sdk, db: databases.get(key) };
}

async function createCloudStore(config, code, { mustExist, loadSdk, onError }) {
  const { sdk, db } = await getDatabase(config, loadSdk);
  const ref = sdk.doc(db, 'families', code);
  let state = defaultState();
  const emitter = createEmitter(() => state);
  let unsubscribe;

  try {
    await new Promise((resolve, reject) => {
      let first = true;
      const timer = setTimeout(() => reject(new Error('Не удалось подключиться к облаку. Проверьте интернет.')), 8000);
      unsubscribe = sdk.onSnapshot(ref, (snap) => {
        if (first) {
          clearTimeout(timer);
          if (!snap.exists() && mustExist) return reject(new Error(NOT_FOUND));
          if (!snap.exists()) sdk.setDoc(ref, defaultState()).catch((e) => onError?.(e));
        }
        state = { ...defaultState(), ...(snap.exists() ? snap.data() : {}) };
        emitter.notify();
        if (first) { first = false; resolve(); }
      }, (e) => {
        if (first) {
          clearTimeout(timer);
          reject(new Error('Нет доступа к облаку. Проверьте настройки Firebase.'));
        } else {
          onError?.(e);
        }
      });
    });
  } catch (e) {
    unsubscribe?.();
    throw e;
  }

  return {
    mode: 'cloud',
    get: () => state,
    async update(patch) {
      state = { ...state, ...patch };
      emitter.notify();
      await sdk.setDoc(ref, patch, { merge: true });
    },
    subscribe: emitter.subscribe,
  };
}

export async function createStore(config, familyCode, localBackend = globalThis.localStorage, options = {}) {
  const code = normalizeCode(familyCode);
  const { mustExist = false, loadSdk = defaultLoadSdk, onError } = options;
  return config
    ? createCloudStore(config, code, { mustExist, loadSdk, onError })
    : createLocalStore(code, localBackend, mustExist);
}
