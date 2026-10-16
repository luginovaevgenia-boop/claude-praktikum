import { createStore, generateFamilyCode, defaultState } from './storage.js';
import { DISHES, AISLES, UNITS } from './dishes.js';
import { MEALS, generateWeek, pickReplacement, buildShoppingList, normalizeName, frequentDishes, scaleItems } from './logic.js';
import { RECIPES } from './recipes.js';
import { FIREBASE_CONFIG } from './firebase-config.js';

const CODE_KEY = 'menu:familyCode';
const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const MEAL_LABEL = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин' };
const TITLES = { week: 'Меню на неделю', shopping: 'Что купить', today: 'Сегодня', pantry: 'Что есть дома', settings: 'Настройки' };

const root = document.getElementById('screen');
const nav = document.getElementById('nav');
let store = null;
let state = defaultState();
let screen = 'week';

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

const allDishes = () => [...DISHES, ...state.customDishes];
const todayIndex = () => (new Date().getDay() + 6) % 7;
const clone = (x) => JSON.parse(JSON.stringify(x));
const SAVE_ERROR = 'Не удалось сохранить изменения в облаке. Проверьте интернет и настройки Firebase.';
const save = (patch) => store.update(patch).catch(() => toast(SAVE_ERROR));

function toast(text) {
  const el = h('div', { class: 'toast', role: 'alert' }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 5000);
}

function formatQty(qty, unit) {
  if (unit === 'г') return qty >= 1000 ? `${+(qty / 1000).toFixed(1)} кг` : `${Math.ceil(qty)} г`;
  if (unit === 'мл') return qty >= 1000 ? `${+(qty / 1000).toFixed(1)} л` : `${Math.ceil(qty)} мл`;
  return `${Math.ceil(qty)} шт`;
}

// ---------- Вход ----------
function showLogin(message) {
  nav.hidden = true;
  document.getElementById('title').textContent = 'Меню на неделю';
  const input = h('input', { type: 'text', placeholder: 'Код семьи', autocapitalize: 'none', autocomplete: 'off' });
  let createdCode = null;
  const note = h('p', { class: message ? 'error' : 'hint' }, message || 'Введите код семьи, чтобы увидеть общее меню, или создайте новую семью.');
  root.replaceChildren(h('div', { class: 'card' },
    note, input,
    h('button', { class: 'primary big', onclick: () => login(input.value, { create: createdCode !== null && input.value.trim().toLowerCase() === createdCode }) }, 'Войти'),
    h('button', { class: 'big', onclick: () => {
      createdCode = generateFamilyCode();
      input.value = createdCode;
      note.className = 'hint';
      note.textContent = 'Новый код создан. Запишите его: по нему остальные члены семьи войдут на своих телефонах. Затем нажмите «Войти».';
    } }, 'Создать новую семью')));
}

async function login(code, { create = false } = {}) {
  try {
    store = await createStore(FIREBASE_CONFIG, code, undefined, { mustExist: !create, onError: () => toast(SAVE_ERROR) });
  } catch (e) {
    return showLogin(e.message);
  }
  localStorage.setItem(CODE_KEY, code.trim().toLowerCase());
  nav.hidden = false;
  store.subscribe((s) => { state = s; render(); });
}

function leave() {
  if (!confirm('Выйти из семьи на этом устройстве? Данные в облаке сохранятся.')) return;
  localStorage.removeItem(CODE_KEY);
  location.reload();
}

// ---------- Каркас ----------
function render() {
  document.getElementById('title').textContent = TITLES[screen];
  nav.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.screen === screen));
  const view = h('div');
  ({ week: renderWeek, shopping: renderShopping, today: renderToday, pantry: renderPantry, settings: renderSettings })[screen](view);
  root.replaceChildren(view);
}

function showScreen(name) { screen = name; render(); window.scrollTo(0, 0); }
nav.addEventListener('click', (e) => { if (e.target.dataset.screen) showScreen(e.target.dataset.screen); });

function sheet(title, ...content) {
  const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } },
    h('div', { class: 'sheet' }, h('h2', {}, title), content));
  document.body.append(overlay);
  return () => overlay.remove();
}

// ---------- Неделя ----------
function setSlot(day, meal, slot) {
  const menu = clone(state.menu);
  menu[day][meal] = slot;
  return save({ menu });
}

function generate() {
  const hasMenu = state.menu.some((d) => MEALS.some((m) => d[m].dishId));
  if (hasMenu && !confirm('Заменить текущее меню новым?')) return;
  save({ menu: generateWeek(allDishes(), state.pantry, state.menu), bought: [] });
}

function toggleOff(day, meal) {
  const off = !state.menu[day][meal].off;
  const dishId = off ? null : pickReplacement(allDishes(), state.menu, day, meal, state.pantry);
  setSlot(day, meal, { off, dishId });
}

function openRecipe(dish) {
  const recipe = RECIPES[dish.id];
  let how;
  if (recipe) how = h('ol', { class: 'steps' }, recipe.steps.map((step) => h('li', {}, step)));
  else if (dish.recipe) how = h('p', { class: 'own-recipe' }, dish.recipe);
  else how = h('p', { class: 'hint' }, 'Рецепт не записан. Его можно добавить: «Ещё» → «Изменить».');
  sheet(dish.name,
    h('p', { class: 'hint' }, `${recipe ? `${recipe.time} · ` : ''}продукты на ${state.people} чел.`),
    h('ul', { class: 'ingredients' }, scaleItems(dish, state.people).map((i) =>
      h('li', {}, h('span', {}, i.name), h('span', {}, formatQty(i.qty, i.unit))))),
    h('h3', {}, 'Как готовить'),
    how);
}

function openReplace(day, meal) {
  const search = h('input', { type: 'search', placeholder: 'Найти блюдо' });
  const list = h('div', { class: 'list' });
  const current = allDishes().find((d) => d.id === state.menu[day][meal].dishId);
  let close;
  // выбор вручную запоминается: блюда, выбранные два раза и больше, показываются первыми
  const pick = (id, counted) => {
    const menu = clone(state.menu);
    menu[day][meal] = { off: false, dishId: id };
    const picks = state.picks || {};
    save(counted ? { menu, picks: { ...picks, [id]: (picks[id] || 0) + 1 } } : { menu });
    close();
  };
  const fill = () => {
    const q = normalizeName(search.value);
    const match = (d) => normalizeName(d.name).includes(q);
    const frequent = frequentDishes(allDishes(), state.picks, meal).filter(match);
    const frequentIds = new Set(frequent.map((d) => d.id));
    const rest = allDishes().filter((d) => d.meals.includes(meal) && match(d) && !frequentIds.has(d.id));
    const btn = (d) => h('button', { onclick: () => pick(d.id, true) }, d.name);
    list.replaceChildren(
      ...(frequent.length ? [h('h3', { class: 'sub' }, 'Часто выбираете'), h('div', { class: 'frequent' }, frequent.map(btn))] : []),
      ...(frequent.length && rest.length ? [h('h3', { class: 'sub' }, 'Все блюда')] : []),
      ...rest.map(btn));
  };
  search.addEventListener('input', fill);
  close = sheet(`${MEAL_LABEL[meal]}, ${DAYS[day].toLowerCase()}`,
    current && h('button', { class: 'link', onclick: () => { close(); openRecipe(current); } }, 'Рецепт'),
    h('button', { class: 'primary big', onclick: () => pick(pickReplacement(allDishes(), state.menu, day, meal, state.pantry), false) }, 'Другое случайное блюдо'),
    search, list);
  fill();
}

function renderWeek(el) {
  const byId = new Map(allDishes().map((d) => [d.id, d]));
  el.append(h('button', { class: 'primary big', onclick: generate }, 'Составить неделю'));
  state.menu.forEach((day, di) => {
    el.append(h('section', { class: 'card' },
      h('h3', {}, DAYS[di] + (di === todayIndex() ? ' · сегодня' : '')),
      MEALS.map((meal) => {
        const slot = day[meal];
        const dish = byId.get(slot.dishId);
        return h('div', { class: 'slot' + (slot.off ? ' off' : '') },
          h('span', { class: 'meal' }, MEAL_LABEL[meal]),
          slot.off
            ? h('span', { class: 'dish muted' }, 'не готовим')
            : h('button', { class: 'dish', onclick: () => openReplace(di, meal) }, dish ? dish.name : '— выбрать'),
          h('button', { class: 'toggle', onclick: () => toggleOff(di, meal) }, slot.off ? 'вернуть' : 'не готовим'));
      })));
  });
}

// ---------- Сегодня ----------
function renderToday(el) {
  const byId = new Map(allDishes().map((d) => [d.id, d]));
  const day = state.menu[todayIndex()];
  el.append(h('p', { class: 'hint' }, DAYS[todayIndex()]));
  if (!state.menu.some((d) => MEALS.some((m) => d[m].dishId))) {
    el.append(h('p', {}, 'Меню ещё не составлено. Откройте «Неделя» и нажмите «Составить неделю».'));
    return;
  }
  el.append(h('div', { class: 'today' }, MEALS.map((meal) => {
    const slot = day[meal];
    const dish = byId.get(slot.dishId);
    return h('div', { class: 'item' }, h('small', {}, MEAL_LABEL[meal]),
      h('div', { class: 'row-flex' },
        h('span', { style: 'flex:1' }, slot.off ? 'не готовим' : (dish ? dish.name : '—')),
        !slot.off && dish && h('button', { class: 'link', onclick: () => openRecipe(dish) }, 'Рецепт')));
  })));
}

// ---------- Дома ----------
function renderPantry(el) {
  const names = [...new Set(allDishes().flatMap((d) => d.items.map((i) => normalizeName(i.name))))]
    .sort((a, b) => a.localeCompare(b, 'ru'));
  const search = h('input', { type: 'search', placeholder: 'Найти продукт' });
  const chips = h('div', { class: 'chips' });
  const fill = () => {
    const q = normalizeName(search.value);
    chips.replaceChildren(...names.filter((n) => n.includes(q)).map((n) => {
      const on = state.pantry.map(normalizeName).includes(n);
      return h('button', { class: 'chip' + (on ? ' on' : ''), onclick: () => {
        save({ pantry: on ? state.pantry.filter((p) => normalizeName(p) !== n) : [...state.pantry, n] });
      } }, n);
    }));
  };
  search.addEventListener('input', fill);
  el.append(
    h('p', { class: 'hint' }, 'Отметьте, что уже есть. Такие продукты не попадут в список покупок и будут чаще встречаться в меню.'),
    h('div', { class: 'row-flex' }, h('span', {}, `Отмечено: ${state.pantry.length}`),
      h('button', { class: 'link', onclick: () => save({ pantry: [] }) }, 'Очистить')),
    search, chips);
  fill();
}

// ---------- Покупки ----------
function renderShopping(el) {
  const groups = buildShoppingList(allDishes(), state.menu, state.pantry, state.people);
  if (!groups.length) {
    el.append(h('p', {}, 'Список пуст: составьте меню на вкладке «Неделя».'));
    return;
  }
  el.append(h('p', { class: 'hint' }, `На ${state.people} чел. Нажмите на продукт, чтобы вычеркнуть.`));
  for (const g of groups) {
    el.append(h('section', { class: 'card group' }, h('h3', {}, g.aisle),
      g.items.map((it) => {
        const done = state.bought.includes(it.key);
        return h('button', { class: 'buy' + (done ? ' done' : ''), onclick: () => {
          save({ bought: done ? state.bought.filter((k) => k !== it.key) : [...state.bought, it.key] });
        } }, h('span', {}, it.name), h('span', {}, formatQty(it.qty, it.unit)));
      })));
  }
  el.append(h('button', { class: 'link', onclick: () => save({ bought: [] }) }, 'Сбросить отметки'));
}

// ---------- Настройки ----------
function openDishEditor(existing) {
  const name = h('input', { type: 'text', placeholder: 'Название блюда' });
  const meals = MEALS.map((m) => h('input', { type: 'checkbox', value: m }));
  const recipe = h('textarea', { rows: '4', placeholder: 'Как готовить (необязательно)' });
  const rows = h('div');
  const error = h('p', { class: 'error' });
  const addRow = (item) => {
    const row = h('div', { class: 'ing' },
      h('input', { type: 'text', placeholder: 'Продукт', 'data-f': 'name' }),
      h('input', { type: 'number', min: '0', step: 'any', placeholder: 'Кол-во', 'data-f': 'qty' }),
      h('select', { 'data-f': 'unit' }, UNITS.map((u) => h('option', {}, u))),
      h('select', { class: 'aisle', 'data-f': 'aisle' }, AISLES.map((a) => h('option', {}, a))));
    if (item && item.name) {
      for (const f of ['name', 'qty', 'unit', 'aisle']) row.querySelector(`[data-f=${f}]`).value = item[f];
    }
    rows.append(row);
  };
  if (existing) {
    name.value = existing.name;
    recipe.value = existing.recipe || '';
    meals.forEach((c) => { c.checked = existing.meals.includes(c.value); });
    existing.items.forEach(addRow);
  } else {
    addRow();
  }
  let close;
  const submit = () => {
    const items = [...rows.children].map((r) => {
      const f = (k) => r.querySelector(`[data-f=${k}]`).value;
      return { name: normalizeName(f('name')), qty: Number(f('qty')), unit: f('unit'), aisle: f('aisle') };
    }).filter((i) => i.name);
    const chosen = meals.filter((c) => c.checked).map((c) => c.value);
    if (!name.value.trim()) return (error.textContent = 'Введите название блюда.');
    if (!chosen.length) return (error.textContent = 'Выберите хотя бы один приём пищи.');
    if (!items.length || items.some((i) => !(i.qty > 0))) return (error.textContent = 'Добавьте продукты и укажите количество на одного человека.');
    const dish = { id: existing ? existing.id : `custom-${Date.now()}`, name: name.value.trim(), meals: chosen, items };
    if (recipe.value.trim()) dish.recipe = recipe.value.trim();
    save({ customDishes: existing ? state.customDishes.map((d) => (d.id === dish.id ? dish : d)) : [...state.customDishes, dish] });
    close();
  };
  close = sheet(existing ? 'Изменить блюдо' : 'Своё блюдо', name,
    h('p', {}, MEALS.map((m, i) => h('label', { class: 'check' }, meals[i], MEAL_LABEL[m]))),
    h('p', { class: 'hint' }, 'Продукты — количество на одного человека:'),
    rows, h('button', { class: 'link', onclick: () => addRow() }, '+ ещё продукт'), recipe, error,
    h('button', { class: 'primary big', onclick: submit }, 'Сохранить блюдо'));
}

function renderSettings(el) {
  const setPeople = (n) => save({ people: Math.min(12, Math.max(1, n)) });
  const code = localStorage.getItem(CODE_KEY) || '';
  el.append(
    h('section', { class: 'card' }, h('h3', {}, 'Сколько человек в семье'),
      h('div', { class: 'row-flex' },
        h('button', { onclick: () => setPeople(state.people - 1), 'aria-label': 'Меньше' }, '−'),
        h('strong', {}, state.people),
        h('button', { onclick: () => setPeople(state.people + 1), 'aria-label': 'Больше' }, '+'))),
    h('section', { class: 'card' }, h('h3', {}, 'Код семьи'),
      h('div', { class: 'big-code' }, code),
      h('p', { class: 'hint' }, store.mode === 'cloud'
        ? 'Меню общее: введите этот код на других телефонах.'
        : 'Облако не настроено: данные хранятся только на этом устройстве (см. README).'),
      h('button', { class: 'danger', onclick: leave }, 'Выйти из семьи')),
    h('section', { class: 'card' }, h('h3', {}, 'Свои блюда'),
      state.customDishes.length ? state.customDishes.map((d) => h('div', { class: 'row-flex' },
        h('span', { style: 'flex:1' }, d.name),
        h('button', { onclick: () => openDishEditor(d) }, 'Изменить'),
        h('button', { class: 'danger', onclick: () => {
          if (confirm(`Удалить «${d.name}»?`)) save({ customDishes: state.customDishes.filter((x) => x.id !== d.id) });
        } }, 'Удалить'))) : h('p', { class: 'hint' }, 'Пока нет своих блюд.'),
      h('button', { class: 'primary', onclick: () => openDishEditor() }, 'Добавить блюдо')));
}

// ---------- Старт ----------
const savedCode = localStorage.getItem(CODE_KEY);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (savedCode) login(savedCode, { create: true }); else showLogin();
