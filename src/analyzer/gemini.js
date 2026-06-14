// src/analyzer/gemini.js
// Модуль глубокого анализа заказов через Gemini API
// Возвращает структурированный JSON вместо сырого текста

import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
].filter(Boolean);

let currentKeyIndex = 0;

const ANALYSIS_PROMPT = `
Ты — эксперт по оценке фриланс-заказов в сфере IT.
Проанализируй текст заказа и верни ТОЛЬКО валидный JSON без markdown, без пояснений.

Структура ответа:
{
  "budget": "сумма в рублях или 'не указан'",
  "deadline": "срок или 'не указан'",
  "stack": ["технология1", "технология2"],
  "main_risk": "главный риск одним предложением",
  "client_quality": "хороший / средний / токсичный",
  "score": 7,
  "score_reason": "почему такой балл одним предложением",
  "first_reply": "готовый ответ клиенту 2-3 предложения в B2B стиле"
}
`;

async function callGemini(key, text) {
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const result = await model.generateContent(ANALYSIS_PROMPT + '\n\nТЕКСТ ЗАКАЗА:\n' + text);
  return result.response.text();
}

export async function analyzeWithGemini(text) {
  const totalKeys = GEMINI_KEYS.length;

  for (let attempt = 0; attempt < totalKeys * 2; attempt++) {
    const keyNum = currentKeyIndex + 1;
    console.log(`[Gemini] Попытка ${attempt + 1}, ключ ${keyNum}/${totalKeys}...`);

    try {
      const raw = await callGemini(GEMINI_KEYS[currentKeyIndex], text);

      // Убираем markdown-обёртку если Gemini добавил ```json
      const clean = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);

      console.log(`[Gemini] ✅ Анализ получен. Скор: ${parsed.score}/10`);
      return parsed;

    } catch (err) {
      const status = err?.status || 0;

      if (status === 429) {
        console.log(`[Gemini] ⚠️  Ключ ${keyNum} исчерпан (429). Переключаем...`);
        currentKeyIndex = (currentKeyIndex + 1) % totalKeys;

      } else if (status === 503) {
        console.log(`[Gemini] ⏳ Сервер перегружен (503). Ждём 5 сек...`);
        await new Promise(r => setTimeout(r, 5000));

      } else if (err instanceof SyntaxError) {
        console.log(`[Gemini] ⚠️  Ответ не JSON. Пробуем ещё раз...`);

      } else {
        console.error(`[Gemini] ❌ Неизвестная ошибка ${status}:`, err.message);
        throw err;
      }
    }
  }

  throw new Error('[Gemini] Все ключи исчерпаны или сервер недоступен');
}