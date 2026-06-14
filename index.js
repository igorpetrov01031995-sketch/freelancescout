console.log('=== СИСТЕМА: index.js начал исполнение кода! ===');

console.log('🔍 Отладка: Загружаем dotenv...');
import 'dotenv/config';

console.log('🔍 Отладка: Загружаем Telegraf...');
import { Telegraf } from 'telegraf';

console.log('🔍 Отладка: Загружаем undici...');


console.log('🔍 Отладка: Загружаем groq-sdk...');
import Groq from 'groq-sdk';

console.log('🔍 Отладка: Пытаемся импортировать модули парсеров из fl.js...');
import { fetchNewAds} from './src/parser/fl.js';

import { checkEmailKwork } from './src/parser/email.js';
import {
  incrementApproved,
  incrementRejected
} from './src/utils/stats.js';
import { analyzeWithGemini } from './src/analyzer/gemini.js';

console.log('🔍 Отладка: Все импорты успешны! Настраиваем v2rayN прокси...');

console.log('🔍 Отладка: Прокси успешно перехвачен глобальным диспетчером.');

console.log('🔍 Отладка: Проверяем ключи .env...');
if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.GROQ_API_KEY || !process.env.TELEGRAM_CHAT_ID) {
  console.error('❌ Критическая ошибка: Проверьте переменные окружения в .env (не забудьте TELEGRAM_CHAT_ID)');
  process.exit(1);
}

console.log('🔍 Отладка: Создаем экземпляры Bot и Groq...');
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
console.log('🔍 Отладка: Экземпляры созданы. Переходим к основному коду бота...');

// Живучая функция запросов: обрабатывает перегрузки 503 и лимиты 429
async function generateWithRetry(prompt, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.3-70b-versatile',
      });
    } catch (error) {
      if (attempt < maxRetries) {
        console.log(`[Groq] Ошибка API. Попытка ${attempt}/${maxRetries}. Пауза 5 секунд...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }
      throw error;
    }
  }
}

// Наш системный промпт с жестким лимитом под Telegram (адаптирован под Llama)
const SYSTEM_ORCHESTRATION_PROMPT = `
Ты — высококвалифицированный консилиум экспертов "FreelanceScout" по оценке фриланс-заказов в сфере IT и B2B.
Наша специализация включает:

- Telegram-боты
- CRM-интеграции
- Bitrix24
- AmoCRM
- Unisender
- Albato
- Make
- n8n
- API-интеграции
- автоматизацию бизнес-процессов
- обработку данных
- парсинг
- AI-сервисы
- email-автоматизацию
- вебхуки
- ETL-процессы

Все задачи по интеграции сервисов между собой считаются нашей нишей.

ШАГ 0 — ЖЕСТКИЙ ФИЛЬТР НИШИ (выполни первым):
Если задача относится к дизайну, переводам, видеомонтажу, SEO-текстам, 3D-графике, бухгалтерии, ручному наполнению сайтов или любой другой нише вне нашей специализации — немедленно выдай только это:
⛔ НЕ НАША НИША
Категория: [название категории]
Причина пропуска: [Развернутое логическое объяснение, почему это не наш стек]
Вердикт: ПРОПУСТИТЬ
И больше ничего не пиши.

Если задача относится к:

- дизайну
- переводам
- видеомонтажу
- SEO
- контент-менеджменту
- 3D-графике
- бухгалтерии
- системному администрированию
- DevOps
- сетевой инфраструктуре
- настройке VPN
- настройке серверов
- администрированию Linux
- поддержке хостинга
- мониторингу серверов
- эксплуатации существующих сервисов
- информационной безопасности
- ручному наполнению сайтов

то немедленно выдай:

⛔ НЕ НАША НИША
Вердикт: ПРОПУСТИТЬ

**🔍 СКАУТ-ОЦЕНЩИК (Анализ лида и клиента)**
— Бюджет: Оценка адекватности цены относительно объема работы. (Пример: "Бюджет занижен в 3 раза, так как интеграция двух тяжелых API не может стоить 5 000 руб...").
— Сроки: Реалистичность дедлайна. Выдели красные флаги (например, "Срок 'вчера' указывает на плохой менеджмент заказчика...").
— Профиль клиента и скрытые угрозы: Разбор текста на токсичность, размытые требования ("сделайте красиво", "там работы на час"). Опиши, чем грозит общение с таким клиентом.
— Экспертный Скоринг: X/10 (Подробно распиши, из чего сложилась эта оценка: сколько баллов снято за бюджет, сколько за ТЗ).

**💻 ТЕХНИЧЕСКИЙ ЭКСПЕРТ (Архитектура и стек)**
— Предлагаемый стек: Конкретные инструменты, библиотеки, базы данных. Объясни выбор (например: "Используем библиотеку node-imap, так как она работает на чистых сокетах и обходит HTTP-прокси...").
— Уровень сложности: X/10 для Middle-разработчика. Обоснуй сложность (кол-во сущностей, ветвление логики).
— Главный технический риск: Развернутое объяснение уязвимого места проекта (капризные лимиты сторонних API, защита сайтов от парсинга, жесткая капча) и как мы будем его обходить.

**📋 ПРОЕКТ-МЕНЕДЖЕР (Бизнес-логика и декомпозиция)**
— Пошаговый план реализации: Подробный план из 3-5 этапов. Для каждого этапа детально распиши, какие подзадачи туда входят и почему на них заложено именно столько времени.
— Оценка трудозатрат: Итого часов (X-Y часов). Поясни формулу расчета.
— Снайперские вопросы клиенту: Максимум 3 критически важных вопроса, которые снимут неопределенность по ТЗ и покажут нашу глубокую экспертизу.

**⚖️ АРБИТР (Финальный вердикт)**
— Итоговое решение: БРАТЬ или ПРОПУСТИТЬ. Дай развернутое резюме-обоснование (взвесь плюсы и минусы, описанные предыдущими экспертами).
— Профессиональный черновик ответа: Бизнес-отклик (4-6 предложений), готовый к отправке клиенту. Пиши в уважительном, экспертном B2B-стиле, без банальных "сделаю быстро и дешево". Подчеркни понимание его технической боли.
— Первые 3 шага в случае старта: Что конкретно делаем в первые часы после получения предоплаты.

ПРАВИЛА ОФОРМЛЕНИЯ:
- Избегай общих фраз вроде "заказ хороший" или "надо делать". Давай глубокую техническую и аналитическую аргументацию.
- Текст должен быть понятным, структурированным, написанным на русском языке в строгом деловом стиле.
- Если в тексте есть исходная ссылка на проект — обязательно выведи её отдельной строкой в самом конце: 🔗 [ссылка]
`;

// ── РУЧНОЙ РЕЖИМ ЧЕРЕЗ ЧАТ БОТА ───────────────────────────
// 🔥 АВТОМАТИЧЕСКИЙ ПЕРЕХВАТ ЗАКАЗОВ ИЗ КВОРКА
bot.on('text', async (ctx) => {
  const incomingText = ctx.message.text;

  // Проверяем: если в тексте сообщения есть ссылка на kwork.ru/projects/
  if (incomingText.includes('kwork.ru/projects/')) {
    console.log('[KworkInterceptor] 🚀 Пойман автоматический заказ с Kwork!');
    
    // Мгновенно отправляем его на наше ИИ-сито (Шаг 0, Шаг 1 и т.д.)
    try {
      const fullPrompt = `${SYSTEM_ORCHESTRATION_PROMPT}\n\nТЕКСТ ПРОЕКТА:\n"${incomingText}"`;
      
      // Показываем в консоли, что Грок начал думать
      console.log('[KworkInterceptor] Передаем проект на ИИ-консилиум...');
      const completion = await generateWithRetry(fullPrompt);
      const result = completion.choices[0]?.message?.content || '';

      // Усиленный b2b-фильтр ниши
      if (result.includes('НЕ НАША НИША')) {

  incrementRejected();

  console.log(
    `[KworkInterceptor] ⛔ Заказ отклонен ИИ (не наша специализация)`
  );

  return;
}

      console.log(`[AutoParser] 🔥 Релевантный заказ одобрен! Отправляем в Telegram...`);
      incrementApproved();

      await ctx.reply(header + result);
      
    } catch (err) {
      console.error('[KworkInterceptor] Ошибка обработки перехваченного заказа:', err.message);
    }
    return; // Выходим, чтобы обычный ручной режим не дублировал логику
  }

  // --- Твой старый код ручной обработки ТЗ (если текст без ссылок) остается ниже ---
  console.log('🤖 Ручной режим: получен текст ТЗ от пользователя...');
  // ... старый код обработки ...
})

// ── АВТОМАТИЧЕСКИЙ ПЛАНОВЫЙ ПАРСЕР (FL.ru + ПОЧТА KWORK) ──
async function runAutoParser() {
  console.log('[AutoParser] ⏰ Запуск планового мониторинга фриланс-бирж...');

  // --- ЭТАП 1: ПРОВЕРКА ПОЧТЫ KWORK ---
  try {
    await checkEmailKwork(bot, groq, SYSTEM_ORCHESTRATION_PROMPT);
  } catch (err) {
    console.error('[AutoParser] Ошибка сбора данных с почты Kwork:', err.message);
  }

  // --- ЭТАП 2: СБОР СВЕЖИХ ЗАКАЗОВ С FL.RU ---
  let flAds = [];
  try {
    flAds = await fetchNewAds();
  } catch (err) {
    console.error('[AutoParser] Ошибка сбора данных с FL.ru:', err.message);
  }

  if (flAds.length === 0) {
    console.log('[AutoParser] 💤 Новых заказов на FL.ru не обнаружено.');
    console.log('[AutoParser] ✅ Все доступные площадки проверены. Спим 15 минут.');
    return;
  }

  console.log(`[AutoParser] 🚀 Найдено новых заказов на FL.ru: ${flAds.length}. Отправляем на ИИ-сито...`);

  // --- ЭТАП 3: ПРОГОНЯЕМ КАЖДЫЙ ЗАКАЗ FL.RU ЧЕРЕЗ ИИ ---
  for (const ad of flAds) {
    console.log(`[AutoParser] Передаем на консилиум: "${ad.title}"`);

    const inputText = `Заголовок: ${ad.title}\nКатегория: ${ad.category}\nОписание: ${ad.description}\nСсылка: ${ad.link}`;

    try {
      const fullPrompt = `${SYSTEM_ORCHESTRATION_PROMPT}\n\nТЕКСТ ПРОЕКТА:\n"${inputText}"`;
      const completion = await generateWithRetry(fullPrompt);
      const result = completion.choices[0]?.message?.content || '';

      // Усиленный b2b-фильтр ниши: блокирует отправку при любом маркере пропуска
      if (result.includes('НЕ НАША НИША') || result.includes('ПРОПУСТИТЬ') || result.includes('НЕ НАШ СТЕК')) {
        console.log(`[AutoParser] ⛔ Заказ отклонен ИИ (не наша специализация): ${ad.title}`);
        continue; // Жесткий пропуск, в Telegram ничего не шлем
      }

      console.log(`[AutoParser] 🔥 Заказ одобрен Groq! Запускаем глубокий анализ Gemini...`);
incrementApproved();

let geminiCard = '';
try {
  const analysis = await analyzeWithGemini(inputText);
  geminiCard = `
💰 Бюджет: ${analysis.budget}
⏰ Срок: ${analysis.deadline}
🛠 Стек: ${analysis.stack.join(', ')}
⚠️ Риск: ${analysis.main_risk}
👤 Клиент: ${analysis.client_quality}
⭐ Скор: ${analysis.score}/10 — ${analysis.score_reason}

💬 Ответ клиенту:
${analysis.first_reply}
  `.trim();
} catch (err) {
  console.error('[AutoParser] Gemini недоступен, fallback на Groq:', err.message);
  geminiCard = result;
}

const header = `🆕 НОВЫЙ ЗАКАЗ С FL.RU\n📌 ${ad.title}\n🔗 ${ad.link}\n\n`;
const fullMessage = header + geminiCard;

if (fullMessage.length <= 4096) {
  await bot.telegram.sendMessage(TELEGRAM_CHAT_ID, fullMessage);
} else {
  await bot.telegram.sendMessage(TELEGRAM_CHAT_ID, fullMessage.slice(0, 4000) + '\n\n...[Текст обрезан]');
}

      // Anti-flood пауза под лимиты Groq
      await new Promise(resolve => setTimeout(resolve, 5000));

    } catch (err) {
      console.error(`[AutoParser] Ошибка при обработке заказа "${ad.title}":`, err.message);
    }
  }

  console.log('[AutoParser] ✅ Все новые заказы проверены. Спим 15 минут.');
}

// ── ЗАПУСК СИСТЕМЫ И ПЛАНИРОВЩИКА ─────────────────────────
const PARSER_INTERVAL_MS = 15 * 60 * 1000; // Ровно 15 минут

console.log('🤖 Планировщик: Инициализация конвейера бирж...');
console.log(`🤖 Планировщик: Первая автопроверка запустится через 5 секунд, далее каждые 15 мин.`);

setTimeout(() => {
  console.log('🚀 Планировщик: Таймер подошел, запускаем runAutoParser()...');
  runAutoParser();
  
  setInterval(runAutoParser, PARSER_INTERVAL_MS);
}, 5000);


// Изолированный запуск самого Telegram-бота
console.log('📡 Telegram: Попытка установить соединение с серверами...');
bot.launch()
  .then(() => {
    console.log('>>> ========================================== <<<');
    console.log('>>> FreelanceScout УСПЕШНО СВЯЗАЛСЯ С TELEGRAM <<<');
    console.log('>>> Бот готов принимать ручные ТЗ в чате       <<<');
    console.log('>>> ========================================== <<<');
  })
  .catch((err) => {
    console.error('❌ Telegram: Ошибка соединения при bot.launch():', err.message);
  });

// Корректный перехват остановки процесса
process.once('SIGINT', () => {
  console.log('🛑 Получен сигнал SIGINT. Останавливаем бота...');
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  console.log('🛑 Получен сигнал SIGTERM. Останавливаем бота...');
  bot.stop('SIGTERM');
});