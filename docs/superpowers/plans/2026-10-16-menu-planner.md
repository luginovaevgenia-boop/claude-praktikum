# Семейный планировщик меню — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Веб-приложение, где мама одной кнопкой собирает меню на неделю (завтрак/обед/ужин), правит его, а приложение строит список покупок; вся семья видит общее меню.

**Architecture:** Статический сайт в `menu/` без сборки (ES-модули). Чистая логика (`logic.js`) и база блюд (`dishes.js`) отделены от интерфейса (`app.js`) и слоя хранения (`storage.js`). Хранение: Firebase Firestore (документ на семью) или локальный режим в `localStorage`, если Firebase не настроен.

**Tech Stack:** Vanilla JS (ES modules), Node 18+ со встроенным `node:test` для тестов логики, Firebase Web SDK 10.12.2 с `https://www.gstatic.com/firebasejs/10.12.2/` (подключается динамическим `import()` только в облачном режиме).

**Spec:** `docs/superpowers/specs/2026-10-16-menu-planner-design.md`

## Global Constraints

- Всё приложение в папке `menu/`; существующие страницы репозитория не менять.
- Сборки нет: только `index.html`, `styles.css`, `app.js`, `logic.js`, `dishes.js`, `storage.js`, `firebase-config.js`.
- Интерфейс и данные — на русском языке.
- Приёмы пищи: ключи `breakfast`, `lunch`, `dinner`; дни: индексы 0–6 (0 = понедельник).
- Количества в базе блюд — на одного человека; единицы только `г`, `шт`, `мл`.
- Отделы магазина только из: `Мясо и рыба`, `Овощи и фрукты`, `Крупы и макароны`, `Молочное и яйца`, `Хлеб и выпечка`, `Бакалея`.
- Без Firebase-ключей приложение обязано работать в локальном режиме.
- Работать с телефона: вёрстка mobile-first, минимум кликов на основной сценарий.

## Review Focus

1. Для приёма пищи в базе нет подходящих блюд → ячейка остаётся пустой, без ошибки (Task 1).
2. Все ячейки отключены → меню пустое, список покупок пустой (Task 1).
3. Один продукт в разных единицах (`г` и `шт`) → строки не складываются (Task 1).
4. Продукт дома записан иначе (`" Гречка "` против `гречка`) → всё равно вычитается (Task 1).
5. В меню блюдо, которого уже нет в базе (удалено свое) → ячейка пустая, покупки не падают (Task 1).

## Структура данных (общая для всех задач)

```js
// Dish
{ id: string, name: string, meals: ('breakfast'|'lunch'|'dinner')[],
  items: { name: string, qty: number, unit: 'г'|'шт'|'мл', aisle: string }[] }
// Slot = { off: boolean, dishId: string|null };  Menu = Array<7> of { breakfast: Slot, lunch: Slot, dinner: Slot }
// State = { people: number, pantry: string[], menu: Menu, bought: string[], customDishes: Dish[] }
```

---

### Task 1: Логика меню и покупок

**Files:**
- Create: `package.json` (`{"type":"module","scripts":{"test":"node --test menu/tests/"}}`), `menu/logic.js`, `menu/tests/logic.test.js`
- Modify: `docs/superpowers/specs/2026-10-16-menu-planner-design.md` (в `generateWeek` убрать параметр `people` — генерация от него не зависит)

**Interfaces:**
- Produces (`menu/logic.js`):
  - `MEALS: ['breakfast','lunch','dinner']`
  - `emptyMenu(): Menu` — 7 дней, все слоты `{off:false, dishId:null}`
  - `normalizeName(s: string): string` — trim + lowercase
  - `generateWeek(dishes: Dish[], pantry: string[], currentMenu: Menu, rng?: () => number): Menu` — заполняет все слоты с `off:false`; `off` берётся из `currentMenu`
  - `pickReplacement(dishes: Dish[], menu: Menu, day: number, meal: string, pantry: string[], rng?: () => number): string|null` — id другого блюда для слота (не совпадает с текущим, если есть альтернатива)
  - `buildShoppingList(dishes: Dish[], menu: Menu, pantry: string[], people: number): {aisle: string, items: {key: string, name: string, qty: number, unit: string}[]}[]` — `key = normalizeName(name)+'|'+unit`; отделы в порядке перечисления в Global Constraints; пустые отделы опущены; `people` меньше 1 или не число считается как 1

- [ ] **Step 1: Write the failing tests** в `menu/tests/logic.test.js` на фикстуре из 3–4 блюд на каждый приём. Имена и проверки:
  - `generateWeek fills every active slot` — все слоты с `off:false` получают `dishId` из блюд, подходящих по `meals`.
  - `generateWeek keeps off slots empty` — слот с `off:true` остаётся `{off:true, dishId:null}`.
  - `generateWeek never repeats a dish in consecutive days for the same meal` — при `rng` = `Math.random`, 200 прогонов.
  - `generateWeek prefers dishes using pantry products` — с `pantry:['гречка']` и фиксированным `rng` блюдо с гречкой встречается чаще, чем без пантри.
  - `generateWeek leaves slot empty when no dish matches the meal` (Review Focus 1) — `dishId:null`, без исключения.
  - `pickReplacement returns a different dish than the current one`.
  - `buildShoppingList sums items and scales by people` — одно блюдо дважды, `people:3` → `qty = 2 × 3 × qty_на_человека`.
  - `buildShoppingList subtracts pantry and normalizes names` (Review Focus 4) — пантри `[' Гречка ']` убирает `гречка`.
  - `buildShoppingList does not merge different units` (Review Focus 3).
  - `buildShoppingList returns [] when all slots are off` (Review Focus 2).
  - `buildShoppingList skips unknown dishId` (Review Focus 5).
  - `buildShoppingList treats invalid people as 1` (`0`, `NaN`, `-2`).
  - `buildShoppingList groups by aisle in the fixed aisle order`.
- [ ] **Step 2: Run** `npm test` → Expected: FAIL (`logic.js` не существует).
- [ ] **Step 3: Implement** функции из Interfaces в `menu/logic.js`. Подход к `generateWeek`: для каждого приёма идти по дням, брать кандидатов по `meals`, исключать блюдо предыдущего дня, ставить вес `1 + число продуктов блюда, найденных в пантри` и выбирать взвешенным случайным.
- [ ] **Step 4: Run** `npm test` → Expected: все тесты PASS.
- [ ] **Step 5: Commit** `git add package.json menu/logic.js menu/tests docs && git commit -m "Логика генерации меню и списка покупок"`

---

### Task 2: База блюд

**Files:**
- Create: `menu/dishes.js`, `menu/tests/dishes.test.js`

**Interfaces:**
- Consumes: структура `Dish` из раздела «Структура данных».
- Produces: `export const AISLES: string[]` (шесть отделов в порядке из Global Constraints), `export const UNITS: ['г','шт','мл']`, `export const DISHES: Dish[]` (≥ 80 блюд; id вида `kasha-grechnevaya`).

- [ ] **Step 1: Write the failing tests** (`dishes.test.js`): `dish ids are unique`; `every dish has name, ≥1 meal and ≥1 item`; `items use only known units and aisles, qty > 0`; `each meal has at least 20 dishes` (breakfast, lunch, dinner); `dishes.length >= 80`.
- [ ] **Step 2: Run** `npm test` → Expected: FAIL (нет `dishes.js`).
- [ ] **Step 3: Implement** `menu/dishes.js`: простые семейные блюда (каши, омлеты, сырники, супы, котлеты, запеканки, плов, макароны, рыба, овощные гарниры и т. д.), количества на одного человека реалистичные, продукты называть одинаково во всех блюдах (`гречка`, `курица филе`, `морковь`), чтобы суммирование и вычитание работали.
- [ ] **Step 4: Run** `npm test` → Expected: PASS.
- [ ] **Step 5: Commit** `git add menu/dishes.js menu/tests && git commit -m "База простых семейных блюд"`

---

### Task 3: Слой хранения и конфигурация Firebase

**Files:**
- Create: `menu/storage.js`, `menu/firebase-config.js` (экспорт `FIREBASE_CONFIG = null` с комментарием, куда вставить ключи), `menu/firestore.rules`, `menu/README.md` (пошагово: создать проект Firebase, включить Firestore, вставить ключи, опубликовать правила), `menu/tests/storage.test.js`

**Interfaces:**
- Produces (`menu/storage.js`):
  - `generateFamilyCode(): string` — 12 символов из `abcdefghjkmnpqrstuvwxyz23456789` через `crypto.getRandomValues`
  - `defaultState(): State` — `people:4`, `pantry:[]`, `menu:emptyMenu()`, `bought:[]`, `customDishes:[]`
  - `createStore(config: object|null, familyCode: string, localBackend?: Storage): Promise<Store>` — при `config === null` локальный режим (ключ `menu:<code>` в `localBackend`, по умолчанию `localStorage`), иначе Firestore (документ `families/<code>`, динамический `import()` SDK)
  - `Store`: `get(): State`; `update(patch: Partial<State>): Promise<void>` (поверхностное слияние); `subscribe(cb: (state: State) => void): () => void` (вызывает `cb` сразу и при каждом изменении, возвращает отписку); `mode: 'local'|'cloud'`
- `firestore.rules`: разрешить `get`, `create`, `update` для `families/{code}`, запретить `list` и `delete`.

- [ ] **Step 1: Write the failing tests** (`storage.test.js`, фейк `localBackend` — объект с `getItem/setItem`): `generateFamilyCode returns 12 chars from the alphabet and differs between calls`; `local store returns defaultState for a new code`; `update merges the patch and persists to the backend`; `subscribe calls back immediately and after update, and stops after unsubscribe`; `two stores with different codes do not share state`.
- [ ] **Step 2: Run** `npm test` → Expected: FAIL.
- [ ] **Step 3: Implement** `storage.js`. Облачный режим: `onSnapshot` для синхронизации и `setDoc(..., {merge:true})` для записи; включить `enableIndexedDbPersistence`-эквивалент (`persistentLocalCache`) для офлайна; при ошибке доступа вернуть понятный `Error` с русским сообщением. Облачная часть вручную проверяется в Task 7.
- [ ] **Step 4: Run** `npm test` → Expected: PASS.
- [ ] **Step 5: Commit** `git add menu && git commit -m "Слой хранения: локальный режим и Firebase"`

---

### Task 4: Оболочка приложения, вход по коду, настройки

**Files:**
- Create: `menu/index.html`, `menu/styles.css`, `menu/app.js`, `menu/manifest.webmanifest`

**Interfaces:**
- Consumes: `createStore`, `generateFamilyCode`, `defaultState` (Task 3); `DISHES` (Task 2); `FIREBASE_CONFIG`.
- Produces (`menu/app.js`): `state` (текущее `State` из `store`), `allDishes(): Dish[]` (`DISHES` + `state.customDishes`), `renderers: {pantry, week, shopping, today, settings}` — по функции `(root: HTMLElement) => void` на экран; `showScreen(name)`; перерисовка активного экрана на каждое `subscribe`-событие.

- [ ] **Step 1: Implement** `index.html` (нижняя навигация на 5 вкладок: «Неделя», «Покупки», «Сегодня», «Дома», «Настройки»; viewport для телефона; ссылка на manifest) и `styles.css` (mobile-first, крупные тапаемые элементы, светлая тема).
- [ ] **Step 2: Implement** вход: если в `localStorage` нет `menu:familyCode`, показать экран «Введите код семьи или создайте новый» (кнопка «Создать» вызывает `generateFamilyCode`, показывает код крупно с подсказкой записать его); после входа открыть `createStore`.
- [ ] **Step 3: Implement** экран «Настройки»: число человек (1–12, кнопки −/+, пишет в `store.update({people})`), показ и копирование семейного кода, пометка режима («облако»/«только на этом устройстве»), кнопка «Выйти из семьи».
- [ ] **Step 4: Verify** Run: `cd menu && python3 -m http.server 8080`, открыть через Playwright/Chromium: вход, создание кода, смена числа человек, перезагрузка страницы сохраняет значение. Expected: без ошибок в консоли, значение сохранилось.
- [ ] **Step 5: Commit** `git add menu && git commit -m "Оболочка приложения, вход по коду, настройки"`

---

### Task 5: Экраны «Неделя» и «Сегодня»

**Files:**
- Modify: `menu/app.js` (рендереры `week` и `today`), `menu/styles.css`

**Interfaces:**
- Consumes: `generateWeek`, `pickReplacement`, `allDishes`, `state`, `store.update`.

- [ ] **Step 1: Implement** «Неделя»: сетка 7 дней × 3 приёма с названиями блюд; кнопка «Составить неделю» (вызов `generateWeek(allDishes(), state.pantry, state.menu)`, запись в `menu`); клик по блюду открывает панель «Другое блюдо» (кнопка «Случайное другое» через `pickReplacement` и список блюд для этого приёма с поиском); переключатель «не готовим» на ячейке (серая ячейка, `dishId:null`); пустая ячейка показывает «—».
- [ ] **Step 2: Implement** «Сегодня»: завтрак, обед, ужин текущего дня (день недели из `new Date()`, понедельник = 0); отключённые — «не готовим»; если меню пусто — подсказка «Составьте неделю».
- [ ] **Step 3: Verify** (Playwright, локальный режим): нажать «Составить неделю» → 21 заполненная ячейка; отключить обед во вторник → ячейка серая, при повторной генерации остаётся отключённой; заменить блюдо → название изменилось; открыть «Сегодня» → показывает блюда текущего дня. Expected: всё выполняется без ошибок в консоли.
- [ ] **Step 4: Commit** `git add menu && git commit -m "Экраны Неделя и Сегодня"`

---

### Task 6: Экраны «Дома» и «Покупки», свои блюда

**Files:**
- Modify: `menu/app.js` (рендереры `pantry`, `shopping` и редактор блюд в `settings`), `menu/styles.css`

**Interfaces:**
- Consumes: `buildShoppingList`, `allDishes`, `UNITS`, `AISLES`, `state`, `store.update`.

- [ ] **Step 1: Implement** «Дома»: чипы/чекбоксы со всеми продуктами из `allDishes()` (уникальные по `normalizeName`), поиск, выбор пишет `state.pantry`; кнопка «Очистить» для новой недели.
- [ ] **Step 2: Implement** «Покупки»: список из `buildShoppingList(allDishes(), state.menu, state.pantry, state.people)` по отделам; тап по пункту переключает ключ в `state.bought` (вычеркнуто); количества в удобных единицах (≥ 1000 г → кг, ≥ 1000 мл → л); при пустом меню — подсказка; кнопка «Сбросить отметки».
- [ ] **Step 3: Implement** редактор своих блюд в «Настройках»: форма (название, приёмы пищи, продукты с количеством на человека, единицей и отделом), список своих блюд с удалением; запись в `state.customDishes` с id `custom-<timestamp>`.
- [ ] **Step 4: Verify** (Playwright): добавить своё блюдо → оно появляется в выборе замены; отметить `гречка` дома → пропадает из покупок; `people` 2 → 4 удваивает количества; вычеркнуть пункт, перезагрузить → отметка сохранилась; удалить своё блюдо, стоявшее в меню → ячейка «—», «Покупки» открываются без ошибки. Expected: всё выполняется без ошибок в консоли.
- [ ] **Step 5: Commit** `git add menu && git commit -m "Экраны Дома и Покупки, свои блюда"`

---

### Task 7: Облачный режим и итоговая проверка

**Files:**
- Modify: `menu/README.md` (раздел «Как поделиться с семьёй»: открыть ссылку, ввести код, добавить на главный экран)

- [ ] **Step 1: Verify локальный режим целиком** (Playwright, мобильный viewport 390×844): сценарий воскресенья — «Дома» → «Неделя» → «Составить неделю» → отключить один приём → заменить одно блюдо → «Покупки». Expected: без ошибок в консоли, список покупок соответствует меню.
- [ ] **Step 2: Прогнать** `npm test` → Expected: все тесты PASS.
- [ ] **Step 3: Облако (по готовности ключей)**: попросить пользователя завести проект Firebase по `menu/README.md` и прислать конфиг; вставить в `firebase-config.js`; проверить с двух вкладок с одним кодом, что изменения приходят сразу, а с другим кодом данные не видны. Если ключей нет — оставить `FIREBASE_CONFIG = null` и сообщить, что облако ждёт настройки.
- [ ] **Step 4: Commit и push** `git add menu && git commit -m "Документация и итоговая проверка" && git push -u origin claude/menu-shopping-planner-app-bvb1vt`
