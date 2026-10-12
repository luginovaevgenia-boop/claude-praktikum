"""Бот записи на практикум «Claude: ваш личный ИИ-помощник».

Воронка: /start -> программа -> инструкция (Claude на телефон + подписка)
-> выбор даты -> оплата -> ссылка на WhatsApp-группу.
"""
import asyncio
import hashlib
import logging
import os
import re
import sqlite3
from urllib.parse import urlencode

import aiohttp
from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)
from dotenv import load_dotenv

load_dotenv()
BOT_TOKEN = os.environ["BOT_TOKEN"]
ROBOKASSA_LOGIN = os.environ["ROBOKASSA_LOGIN"]
ROBOKASSA_PASS1 = os.environ["ROBOKASSA_PASS1"]  # для ссылки на оплату
ROBOKASSA_PASS2 = os.environ["ROBOKASSA_PASS2"]  # для проверки ResultURL
ROBOKASSA_TEST = os.getenv("ROBOKASSA_TEST", "1") == "1"
HASH = getattr(hashlib, os.getenv("ROBOKASSA_HASH", "md5").lower())
WHATSAPP_GROUP_LINK = os.environ["WHATSAPP_GROUP_LINK"]
ADMIN_ID = int(os.getenv("ADMIN_ID") or 0)
PRICE_RUB = int(os.getenv("PRICE_RUB", "5000"))
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
        """CREATE TABLE IF NOT EXISTS orders (
            inv_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, username TEXT, full_name TEXT,
            date_key TEXT, amount INTEGER, paid INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, paid_at TEXT)"""
    )
    return con


def paid_user(user_id: int) -> str | None:
    with db() as con:
        row = con.execute(
            "SELECT date_key FROM orders WHERE user_id=? AND paid=1", (user_id,)
        ).fetchone()
    return row[0] if row else None


def payment_url(inv_id: int) -> str:
    sig = HASH(f"{ROBOKASSA_LOGIN}:{PRICE_RUB}:{inv_id}:{ROBOKASSA_PASS1}".encode()).hexdigest()
    params = {
        "MerchantLogin": ROBOKASSA_LOGIN,
        "OutSum": PRICE_RUB,
        "InvId": inv_id,
        "Description": "Предоплата за практикум по Claude",
        "SignatureValue": sig,
    }
    if ROBOKASSA_TEST:
        params["IsTest"] = 1
    return "https://auth.robokassa.ru/Merchant/Index.aspx?" + urlencode(params)


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
async def send_payment_link(c: CallbackQuery):
    await c.answer()
    date_key = c.data.split(":", 1)[1]
    if date_key not in DATES:
        return
    if paid_user(c.from_user.id):
        await c.message.answer("Вы уже оплатили участие. Нажмите /start, чтобы получить ссылку.")
        return
    u = c.from_user
    with db() as con:
        inv_id = con.execute(
            "INSERT INTO orders (user_id, username, full_name, date_key, amount) VALUES (?,?,?,?,?)",
            (u.id, u.username, u.full_name, date_key, PRICE_RUB),
        ).lastrowid
    await c.message.answer(
        f"Дата: <b>{DATES[date_key]}</b>\nСумма: <b>{PRICE_RUB} ₽</b>\n\n"
        "Нажмите кнопку, оплатите на странице Робокассы — и ссылка на WhatsApp-группу "
        "придёт сюда автоматически в течение минуты (или нажмите «Я оплатил(а)»).",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(
            inline_keyboard=[
                [InlineKeyboardButton(text=f"💳 Оплатить {PRICE_RUB} ₽", url=payment_url(inv_id))],
                [InlineKeyboardButton(text="✅ Я оплатил(а)", callback_data=f"chk:{inv_id}")],
            ]
        ),
    )


STATE_URL = "https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt"


async def is_paid(session: aiohttp.ClientSession, inv_id: int) -> bool:
    """Спрашиваем у Робокассы статус счёта (код 100 = оплачен)."""
    sig = HASH(f"{ROBOKASSA_LOGIN}:{inv_id}:{ROBOKASSA_PASS2}".encode()).hexdigest()
    async with session.get(
        STATE_URL,
        params={"MerchantLogin": ROBOKASSA_LOGIN, "InvoiceID": inv_id, "Signature": sig},
    ) as r:
        xml = await r.text()
    m = re.search(r"<State>\s*<Code>(\d+)</Code>", xml)
    return bool(m and m.group(1) == "100")


async def confirm_order(bot: Bot, inv_id: int) -> bool:
    """Помечает заказ оплаченным и отправляет ссылку. True, если подтвердили сейчас."""
    with db() as con:
        row = con.execute(
            "SELECT user_id, username, full_name, date_key, amount FROM orders WHERE inv_id=? AND paid=0",
            (inv_id,),
        ).fetchone()
        if not row:
            return False
        con.execute("UPDATE orders SET paid=1, paid_at=CURRENT_TIMESTAMP WHERE inv_id=?", (inv_id,))
    user_id, username, full_name, date_key, amount = row
    await bot.send_message(
        user_id, TEXT_PAID.format(date=DATES[date_key], link=WHATSAPP_GROUP_LINK), parse_mode="HTML"
    )
    if ADMIN_ID:
        await bot.send_message(
            ADMIN_ID,
            f"💰 Оплата {amount} ₽\n{full_name} (@{username or '—'}, id {user_id})\nДата: {DATES[date_key]}",
        )
    return True


async def poll_payments(bot: Bot):
    """Каждые 15 секунд проверяет неоплаченные заказы за последние сутки."""
    async with aiohttp.ClientSession() as session:
        while True:
            try:
                with db() as con:
                    pending = [r[0] for r in con.execute(
                        "SELECT inv_id FROM orders WHERE paid=0 AND created_at > datetime('now','-1 day')"
                    )]
                for inv_id in pending:
                    if await is_paid(session, inv_id):
                        await confirm_order(bot, inv_id)
            except Exception:
                logging.exception("poll_payments")
            await asyncio.sleep(15)


@dp.callback_query(F.data.startswith("chk:"))
async def check_now(c: CallbackQuery, bot: Bot):
    inv_id = int(c.data.split(":", 1)[1])
    async with aiohttp.ClientSession() as session:
        paid = await is_paid(session, inv_id)
    if paid:
        await c.answer()
        await confirm_order(bot, inv_id)
    else:
        await c.answer("Оплата пока не поступила. Подождите минуту и нажмите ещё раз.", show_alert=True)


async def main():
    logging.basicConfig(level=logging.INFO)
    bot = Bot(BOT_TOKEN)
    db().close()
    asyncio.create_task(poll_payments(bot))
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
