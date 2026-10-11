/**
 * Сбор результатов теста «Средиземье» в Google Таблицу.
 * Вставьте этот код в Расширения → Apps Script своей таблицы
 * и опубликуйте как веб-приложение (см. lotr/README.md).
 */
const SHEET_NAME = 'Результаты';

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['Дата', 'Имя', 'Баллы', 'Из', 'Звание']);
    sh.setFrozenRows(1);
  }
  return sh;
}

// Тест присылает сюда результат каждого прохождения.
function doPost(e) {
  const d = JSON.parse(e.postData.contents);
  const score = Math.max(0, Math.min(100, Number(d.score) || 0));
  const total = Math.max(1, Math.min(100, Number(d.total) || 12));
  sheet_().appendRow([
    new Date(),
    String(d.name || 'Безымянный').slice(0, 30),
    score,
    total,
    String(d.rank || '').slice(0, 40),
  ]);
  return ContentService.createTextOutput('ok');
}

// Таблица результатов на сайте читает отсюда список.
function doGet() {
  const rows = sheet_().getDataRange().getValues().slice(1);
  const list = rows.map(r => ({
    date: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
    name: r[1], score: r[2], total: r[3], rank: r[4],
  }));
  return ContentService.createTextOutput(JSON.stringify(list))
    .setMimeType(ContentService.MimeType.JSON);
}
