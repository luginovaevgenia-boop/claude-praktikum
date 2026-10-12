"""Бот записи на практикум «Claude: ваш личный ИИ-помощник».

Воронка: /start -> программа -> инструкция (Claude на телефон + подписка)
-> выбор даты -> оплата -> ссылка на WhatsApp-группу.
"""
import asyncio
import json
import logging
import os
import sqlite3

from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    LabeledPrice,
    Message,
    PreCheckoutQuery,
)
from dotenv import load_dotenv

load_dotenv()
BOT_TOKEN = os.environ["BOT_TOKEN"]
PROVIDER_TOKEN = os.environ["PROVIDER_TOKEN"]
WHATSAPP_GROUP_LINK = os.environ["WHATSAPP_GROUP_LINK"]
ADMIN_ID = int(os.getenv("ADMIN_ID") or 0)
PRICE_RUB = int(os.getenv("PRICE_RUB", "5000"))
SEND_RECEIPT = os.getenv("SEND_RECEIPT") == "1"
DB_PATH = os.path.join(os.path.dirname(__file__), "payments.db")

DATES = {
    "d14": "Среда, 14 октября, 16:30",
    "d17": "Суббота, 17 октября, 10:00",
}

# ---------------------------------------------------------------- тексты ---
TEXT_PROGRAM = """\
<b>Практикум «Claude: ваш личный ИИ-помощник в бизнесе и жизни»</b>
Ведущая — Евгения Лугинова

Установите Claude, подключите к своим сервисам и сделайте вживую то, на что обычно уходит неделя работы.

<b>Формат</b>
• около 3,5 часов практики + неделя поддержки в чате
• группа — всего 4 человека
• даты: 14 октября (ср, 16:30) или 17 октября (сб, 10:00)

<b>Программа</b>
1️⃣ <b>Установка</b> — Claude на компьютер и телефон, вход, подписка
2️⃣ <b>Настройки и подключения</b> — Claude «помнит» вас; Google Диск, Календарь, Notion
3️⃣ <b>Claude для жизни и работы</b> — формула запроса, учёба в 10 раз быстрее, планы, проекты, маркетолог за 2 минуты, голосовое → КП, скиллы и свой ИИ-агент
4️⃣ <b>Claude Code</b> — сайт, интерактивная презентация, видео, квиз или калькулятор без знания кода
5️⃣ <b>Claude в Chrome</b> — аудит Инстаграма, сбор данных с сайтов в таблицу
🏁 <b>Финал</b> — ваш личный план, что передать ИИ уже завтра

<b>С чем уйдёте</b>
✔️ Claude настроенный на компьютере и телефоне
✔️ Подключённые Google Диск, Календарь и Notion
✔️ Портрет клиента и контент-план
✔️ Свои проекты, скиллы и собственный ИИ-агент
✔️ Сайт, презентация или видео
✔️ Расширение Claude для Chrome
✔️ Личный план + чат поддержки на неделю

Технические знания не нужны: если вы пользуетесь телефоном и почтой, вы справитесь.
Возьмите с собой: ноутбук с зарядкой, телефон, почту Google и браузер Google Chrome.

<b>Предоплата — {price} ₽</b>
"""

TEXT_INSTRUCTION_1 = """\
📱 <b>Шаг 1. Скачайте Claude на телефон</b>

1. Откройте App Store (iPhone) или Google Play (Android).
2. В поиске введите <b>Claude</b> — нужное приложение от <b>Anthropic</b>.
3. Нажмите «Установить».
4. Откройте приложение и войдите через аккаунт Google (удобнее всего — той же почтой, которой вы будете пользоваться на практикуме).

Если что-то не получается — не страшно, на практикуме разберём вместе.
"""

TEXT_INSTRUCTION_2 = """\
💳 <b>Шаг 2. Оформите подписку Claude</b>

Для практикума нужен платный тариф — на бесплатном недоступны все возможности, в том числе Claude Code.

1. В приложении откройте меню (профиль) → <b>Upgrade / Подписка</b>.
2. Выберите тариф <b>Pro</b>.
3. Оплатите картой, подходящей для международных платежей.

Подписку можно оформить и позже, до начала практикума, — я подскажу на месте, если возникнут вопросы.
"""

TEXT_CHOOSE_DATE = "📅 <b>Выберите дату практикума:</b>"

TEXT_PAID = """\
🎉 <b>Оплата прошла, вы в списке участников!</b>
Выбранная дата: <b>{date}</b>

Вот ссылка на WhatsApp-группу практикума — вступайте, там будет вся информация и адрес:
{link}

До встречи! 🤍
"""
# ----------------------------------------------------------------------------


def db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.execute(
        """CREATE TABLE IF NOT EXISTS payments (
            user_id INTEGER, username TEXT, full_name TEXT,
            date_key TEXT, amount INTEGER, charge_id TEXT UNIQUE,
            paid_at TEXT DEFAULT CURRENT_TIMESTAMP)"""
    )
    return con


def paid_user(user_id: int) -> str | None:
    with db() as con:
        row = con.execute(
            "SELECT date_key FROM payments WHERE user_id=?", (user_id,)
        ).fetchone()
    return row[0] if row else None


def kb(*rows: list[tuple[str, str]]) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=t, callback_data=d) for t, d in row]
            for row in rows
        ]
    )


dp = Dispatcher()


@dp.message(CommandStart())
async def start(m: Message):
    date_key = paid_user(m.from_user.id)
    if date_key:
        await m.answer(
            TEXT_PAID.format(date=DATES[date_key], link=WHATSAPP_GROUP_LINK),
            parse_mode="HTML",
        )
        return
    await m.answer(
        TEXT_PROGRAM.format(price=PRICE_RUB),
        parse_mode="HTML",
        reply_markup=kb([("📖 Дальше: инструкция по Claude", "instr")]),
    )


@dp.callback_query(F.data == "instr")
async def instruction(c: CallbackQuery):
    await c.answer()
    await c.message.answer(TEXT_INSTRUCTION_1, parse_mode="HTML")
    await c.message.answer(
        TEXT_INSTRUCTION_2,
        parse_mode="HTML",
        reply_markup=kb([("✅ Прочитано, перейти к оплате", "dates")]),
    )


@dp.callback_query(F.data == "dates")
async def choose_date(c: CallbackQuery):
    await c.answer()
    await c.message.answer(
        TEXT_CHOOSE_DATE,
        parse_mode="HTML",
        reply_markup=kb(*[[(label, f"pay:{key}")] for key, label in DATES.items()]),
    )


@dp.callback_query(F.data.startswith("pay:"))
async def send_invoice(c: CallbackQuery, bot: Bot):
    await c.answer()
    date_key = c.data.split(":", 1)[1]
    if date_key not in DATES:
        return
    if paid_user(c.from_user.id):
        await c.message.answer("Вы уже оплатили участие. Нажмите /start, чтобы получить ссылку.")
        return

    kwargs = {}
    if SEND_RECEIPT:
        kwargs = dict(
            need_email=True,
            send_email_to_provider=True,
            provider_data=json.dumps(
                {
                    "receipt": {
                        "items": [
                            {
                                "description": "Предоплата за практикум по Claude",
                                "quantity": "1.00",
                                "amount": {"value": f"{PRICE_RUB}.00", "currency": "RUB"},
                                "vat_code": 1,
                                "payment_mode": "full_prepayment",
                                "payment_subject": "service",
                            }
                        ]
                    }
                }
            ),
        )
    await bot.send_invoice(
        chat_id=c.from_user.id,
        title="Практикум по Claude",
        description=f"Предоплата. {DATES[date_key]}",
        payload=date_key,
        provider_token=PROVIDER_TOKEN,
        currency="RUB",
        prices=[LabeledPrice(label="Предоплата", amount=PRICE_RUB * 100)],
        **kwargs,
    )


@dp.pre_checkout_query()
async def pre_checkout(q: PreCheckoutQuery):
    await q.answer(ok=True)


@dp.message(F.successful_payment)
async def paid(m: Message, bot: Bot):
    p = m.successful_payment
    date_key = p.invoice_payload
    u = m.from_user
    with db() as con:
        con.execute(
            "INSERT OR IGNORE INTO payments (user_id, username, full_name, date_key, amount, charge_id)"
            " VALUES (?,?,?,?,?,?)",
            (u.id, u.username, u.full_name, date_key, p.total_amount // 100,
             p.telegram_payment_charge_id),
        )
    await m.answer(
        TEXT_PAID.format(date=DATES[date_key], link=WHATSAPP_GROUP_LINK),
        parse_mode="HTML",
    )
    if ADMIN_ID:
        await bot.send_message(
            ADMIN_ID,
            f"💰 Оплата {p.total_amount // 100} ₽\n"
            f"{u.full_name} (@{u.username or '—'}, id {u.id})\n"
            f"Дата: {DATES[date_key]}",
        )


async def main():
    logging.basicConfig(level=logging.INFO)
    await dp.start_polling(Bot(BOT_TOKEN))


if __name__ == "__main__":
    asyncio.run(main())
