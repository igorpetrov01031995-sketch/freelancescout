console.log('=== СИСТЕМА: index.js начал исполнение кода! ===');

console.log('🔍 Отладка: Загружаем dotenv...');
import 'dotenv/config';

console.log('🔍 Отладка: Загружаем Telegraf...');
import { Telegraf } from 'telegraf';

console.log('🔍 Отладка: Загружаем groq-sdk...');
import Groq from 'groq-sdk';

console.log('🔍 Отладка: Пытаемся импортировать модули парсеров из fl.js...');
import { fetchNewAds } from './src/parser/fl.js';

import { checkEmailKwork, checkFlDirectMessages } from './src/parser/email.js';
import {
  incrementApproved,
  incrementRejected
} from './src/utils/stats.js';

console.log('🔍 Отладка: Все импорты успешны!');

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

// Живучая функция запросов к Groq: обрабатывает перегрузки 503 и лимиты 429
async function generateWithRetry(prompt, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.1-8b-instant',
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

// Глобальный указатель на текущий рабочий ключ Gemini (сохраняет состояние между вызовами функции)
let currentGeminiKeyIndex = 0;

// Резервная функция-бэкап с умной ротацией ключей при ошибках 429
async function generateWithGeminiFallback(prompt) {
  // Собираем все ключи в один массив и убираем пустые, если они не заданы в .env
  const apiKeys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4
  ].filter(Boolean);

  if (apiKeys.length === 0) {
    throw new Error('Нет доступных ключей GEMINI_API_KEY в переменной окружения .env');
  }

  // Делаем максимум попыток по количеству доступных ключей
  for (let attempts = 0; attempts < apiKeys.length; attempts++) {
    // Начинаем опрос с ключа, на котором остановились в прошлый раз
    const idx = currentGeminiKeyIndex % apiKeys.length;
    const apiKey = apiKeys[idx];
    
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        
        // Если этот конкретный ключ поймал лимит 429 — сдвигаем глобальный указатель и ротируем
        if (response.status === 429) {
          console.log(`⚠️ [Gemini] Ключ №${idx + 1} исчерпал лимит (429). Автопереключение указателя на следующий ключ...`);
          currentGeminiKeyIndex++;
          continue; 
        }
        throw new Error(`Gemini API Error: ${response.status} - ${errText}`);
      }

      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    } catch (error) {
      // Ловим сетевые ошибки или ошибки таймаута для глубокого дебага
      console.log('[Gemini КРИТИЧЕСКИЙ ДЕБАГ ОШИБКИ]:', error);
      if (error.message?.includes('429') || error.status === 429) {
        console.log(`⚠️ [Gemini] Ошибка сети (429) на ключе №${idx + 1}. Переключаем указатель...`);
        currentGeminiKeyIndex++;
        continue;
      }
      throw error;
    }
  }
  
  throw new Error('❌ Все доступные ключи Gemini одновременно лежат в 429 лимите.');
}

// Наш системный промпт с жестким лимитом под Telegram (адаптирован под Llama и Gemini)
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
— Бюджет: Оценка адекватности цены относительно объема работы.
— Сроки: Реалистичность дедлайна. Выдели красные флаги.
— Профиль клиента и скрытые угрозы: Разбор текста на токсичность, размытые требования.
— Экспертный Скоринг: X/10

**💻 ТЕХНИЧЕСКИЙ ЭКСПЕРТ (Архитектура и стек)**
— Предлагаемый стек: Конкретные инструменты, библиотеки, базы данных.
— Уровень сложности: X/10 для Middle-разработчика.
— Главный технический риск: Развернутое объяснение уязвимого места проекта.

**📋 ПРОЕКТ-МЕНЕДЖЕР (Бизнес-логика и декомпозиция)**
— Пошаговый план реализации: Подробный план из 3-5 этапов.
— Оценка трудозатрат: Итого часов (X-Y часов).
— Снайперские вопросы клиенту: Максимум 3 критически важных вопроса.

**⚖️ АРБИТР (Финальный вердикт)**
— Итоговое решение: БРАТЬ или ПРОПУСТИТЬ.
— Профессиональный черновик ответа: Бизнес-отклик (4-6 предложений), готовый к отправке клиенту.
— Первые 3 шага в случае старта: Что конкретно делаем в первые часы после получения предоплаты.

ПРАВИЛА ОФОРМЛЕНИЯ:
- Текст должен быть понятным, структурированным, написанным на русском языке в строгом деловом стиле.
- Если в тексте есть исходная ссылка на проект — обязательно выведи её отдельной строкой в самом конце: 🔗 [ссылка]
`;

// ── РУЧНОЙ РЕЖИМ ЧЕРЕЗ ЧАТ БОТА ───────────────────────────
bot.on('text', async (ctx) => {
  const incomingText = ctx.message.text;

  if (incomingText.includes('kwork.ru/projects/')) {
    console.log('[KworkInterceptor] 🚀 Пойман автоматический заказ с Kwork!');
    
    try {
      const fullPrompt = `${SYSTEM_ORCHESTRATION_PROMPT}\n\nТЕКСТ ПРОЕКТА:\n"${incomingText}"`;
      console.log('[KworkInterceptor] Передаем проект на ИИ-консилиум...');
      
      let result = '';
      try {
        const completion = await generateWithRetry(fullPrompt);
        result = completion.choices[0]?.message?.content || '';
      } catch (err) {
        if (err.message?.includes('429') || err.status === 429) {
          console.log('⚠️ [Groq] Лимит исчерпан в ручном режиме. Fallback на Gemini...');
          result = await generateWithGeminiFallback(fullPrompt);
        } else {
          throw err;
        }
      }

      if (result.includes('НЕ НАША НИША')) {
        incrementRejected();
        console.log(`[KworkInterceptor] ⛔ Заказ отклонен ИИ (не наша специализация)`);
        return;
      }

      console.log(`[AutoParser] 🔥 Релевантный заказ одобрен! Отправляем в Telegram...`);
      incrementApproved();

      const kworkHeader = `🆕 ПЕРЕХВАТ АВТО-ЗАКАЗА KWORK\n\n`;
      await ctx.reply(kworkHeader + result);
      
    } catch (err) {
      console.error('[KworkInterceptor] Ошибка обработки перехваченного заказа:', err.message);
    }
    return;
  }

  console.log('🤖 Ручной режим: получен текст ТЗ от пользователя...');
});

// ── АВТОМАТИЧЕСКИЙ ПЛАНОВЫЙ ПАРСЕР (FL.ru + ПОЧТА KWORK) ──
async function runAutoParser() {
  console.log('[AutoParser] ⏰ Запуск планового мониторинга фриланс-бирж...');

  // --- ЭТАП 1: ПРОВЕРКА ПОЧТЫ KWORK ---
  try {
    await checkEmailKwork(bot, groq, SYSTEM_ORCHESTRATION_PROMPT);
  } catch (err) {
    console.error('[AutoParser] Ошибка сбора данных с почты Kwork:', err.message);
  }

  // --- ЭТАП 1.5: ПРОВЕРКА ЛИЧНЫХ СООБЩЕНИЙ С FL.RU ---
  try {
    await checkFlDirectMessages(bot);
  } catch (err) {
    console.error('[AutoParser] Ошибка проверки сообщений FL.ru:', err.message);
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
    // ПУЛЬС-ФИЛЬТР: Искусственная пауза в 2.5 секунды перед КАЖДЫМ заказом. 
    // Защищает API от залпового огня по RPM, даже если предыдущие заказы пролетели по continue!
    await new Promise(resolve => setTimeout(resolve, 2500));

    console.log(`[AutoParser] Передаем на консилиум: "${ad.title}"`);

    const inputText = `Заголовок: ${ad.title}\nКатегория: ${ad.category}\nОписание: ${ad.description}\nСсылка: ${ad.link}`;
    const fullPrompt = `${SYSTEM_ORCHESTRATION_PROMPT}\n\nТЕКСТ ПРОЕКТА:\n"${inputText}"`;
    
    let result = '';
    let isFallbackUsed = false;

    try {
      // Пытаемся получить вердикт от основного ИИ Groq
      const completion = await generateWithRetry(fullPrompt);
      result = completion.choices[0]?.message?.content || '';
    } catch (err) {
      // Если поймали суточный лимит 429 — плавно переключаем сито на резервный Gemini
      if (err.message?.includes('429') || err.status === 429 || err.message?.toLowerCase().includes('limit')) {
        console.log(`⚠️ [Groq] Превышен суточный лимит токенов (429). Автопереключение на резервный фильтр Gemini...`);
        try {
          result = await generateWithGeminiFallback(fullPrompt);
          isFallbackUsed = true;
        } catch (geminiErr) {
          console.error(`❌ [AutoParser] Резервный Gemini тоже дал сбой для "${ad.title}":`, geminiErr.message);
          continue; // Оба ИИ перегружены, идем к следующему объявлению
        }
      } else {
        console.error(`❌ [AutoParser] Критическая ошибка Groq при фильтрации "${ad.title}":`, err.message);
        continue;
      }
    }

    // Фильтр ниши
    if (result.includes('НЕ НАША НИША') || result.includes('ПРОПУСТИТЬ') || result.includes('НЕ НАШ СТЕК')) {
      console.log(`[AutoParser] ⛔ Заказ отклонен ИИ (не наша специализация): ${ad.title}`);
      incrementRejected();
      continue;
    }

    console.log(`[AutoParser] 🔥 Заказ одобрен ${isFallbackUsed ? 'Gemini (Резерв)' : 'Groq'}! Отправляем вердикт консилиума в Telegram...`);
    incrementApproved();

    // ОПТИМИЗАЦИЯ: Вместо тяжелого повторного структурного анализа Gemini, мы используем 
    // готовый детальный разбор (result) от Groq, который уже содержит полные данные экспертов.
    // Это экономит суточные лимиты "PerProject" на 95%!
    const geminiCard = result; 

    const header = `🆕 НОВЫЙ ЗАКАЗ С FL.RU\n📌 ${ad.title}\n🔗 ${ad.link}\n\n`;
    const fullMessage = header + geminiCard;

    if (fullMessage.length <= 4096) {
      await bot.telegram.sendMessage(TELEGRAM_CHAT_ID, fullMessage);
    } else {
      await bot.telegram.sendMessage(TELEGRAM_CHAT_ID, fullMessage.slice(0, 4000) + '\n\n...[Текст обрезан]');
    }

    // Дополнительный тайм-аут для успешной отправки в ТГ
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  console.log('[AutoParser] ✅ Все новые заказы проверены. Спим 15 минут.');
}

// ── ЗАПУСК СИСТЕМЫ И ПЛАНИРОВЩИКА ─────────────────────────
const PARSER_INTERVAL_MS = 15 * 60 * 1000;

console.log('🤖 Планировщик: Инициализация конвейера бирж...');
console.log(`🤖 Планировщик: Первая автопроверка запустится через 5 секунд, далее каждые 15 мин.`);

setTimeout(() => {
  console.log('🚀 Планировщик: Таймер подошел, запускаем runAutoParser()...');
  runAutoParser();
  setInterval(runAutoParser, PARSER_INTERVAL_MS);
}, 5000);

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

process.once('SIGINT', () => {
  console.log('🛑 Получен сигнал SIGINT. Останавливаем бота...');
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  console.log('🛑 Получен сигнал SIGTERM. Останавливаем бота...');
  bot.stop('SIGTERM');
});