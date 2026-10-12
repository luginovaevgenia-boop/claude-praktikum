# Телеграм-бот практикума

Воронка: `/start` → программа → инструкция (Claude на телефон, подписка) → выбор даты → оплата → ссылка на WhatsApp-группу.

## Запуск
1. Создайте бота в @BotFather, получите `BOT_TOKEN`.
2. Там же: Bot Settings → Payments → подключите ЮKassa (или другого провайдера), получите `PROVIDER_TOKEN` (сначала тестовый).
3. `cp .env.example .env` и заполните значения.
4. `pip install -r requirements.txt && python bot.py`

Оплаты сохраняются в `payments.db`, вам в Telegram приходит уведомление о каждой оплате (`ADMIN_ID`).
Тексты — в начале `bot.py`.
