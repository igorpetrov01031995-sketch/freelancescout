// src/parser/fl.js
// Модуль парсинга RSS-ленты FL.ru
// Забирает новые заказы, надежно кэширует ID в MongoDB Atlas и фильтрует мусор

import { XMLParser } from 'fast-xml-parser';
import { MongoClient } from 'mongodb';

const FL_RSS_URL = 'https://www.fl.ru/rss/all.xml';

// Инициализируем клиент MongoDB (переменная MONGODB_URI берется из Railway Variables)
const mongoClient = new MongoClient(process.env.MONGODB_URI);
let db, seenAdsCollection;

// Функция гарантированного подключения к БД
async function connectToDatabase() {
  if (!db) {
    await mongoClient.connect();
    db = mongoClient.db('freelance_scout');
    seenAdsCollection = db.collection('seen_ads');
    
    // Создаем уникальный индекс по orderId, чтобы поиск летал мгновенно
    await seenAdsCollection.createIndex({ orderId: 1 }, { unique: true }).catch(() => {});
  }
}

// 1. Очищенный черный список — убираем "магазин", "лендинг" и "продвижение"
// Оставляем только то, что ТОЧНО не относится к коду и автоматизации
const HARD_EXCLUDE = [
  'отзывы', 'дизайн', 'перевод', 'суд', 'юрист', 'адвокат', 
  '3d', 'иллюстрац', 'figma', 'настройка компьютера',
  'прослушать звонки', 'восстановить аккаунт', 'чертеж', 'схема',
  'видеомонтаж', 'ролики', 'подача в суд', 'логотип', 'копирайт'
];

// 2. Расширенный белый список (с учетом Whisper, RAG, Laravel и Т-Банка)
const RELEVANT_REGEX = [
  /(?<![а-яёА-ЯЁ])бот(?![а-яёА-ЯЁ])/i, // Только чистый "бот"
  /интегр/i,      // Поймает: интеграция, интегрировать, интеграционный
  /автоматизац/i,
  /скрипт/i,
  /api/i,
  /webhooks/i,
  /node/i,
  /laravel/i,    // Ловим сочный бэкенд
  /pwa/i,
  /telegram/i,   // Ловим ТГ-аппки и магазины в телеге
  /tg/i,
  /whisper/i,    // Ловим нейросетевые интеграции
  /rag/i,
  /эквайринг/i,  // Ловим платежки
  /т-банк/i,
  /тинькофф/i
];

// Функция проверки релевантности заказа (фильтруем строго по заголовку)
export function isOrderRelevant(ad) {
  const title = (ad.title || '').toLowerCase();
  
  // Шаг А: Проверка по черному списку
  const hasTrashWord = HARD_EXCLUDE.some(word => title.includes(word));
  if (hasTrashWord) {
    return false;
  }

  // Шаг Б: Проверка по белому списку с умными границами слов
  const isTarget = RELEVANT_REGEX.some(regex => regex.test(title));
  
  return isTarget;
}

// Главная функция — возвращает массив новых релевантных заказов
export async function fetchNewAds() {
  console.log('[FL Parser] ========================================');
  console.log('[FL Parser] Запуск проверки FL.ru RSS...');
  console.log(`[FL Parser] Время: ${new Date().toLocaleString('ru-RU')}`);

  // Шаг 1. Подключаемся к внешней базе данных
  try {
    await connectToDatabase();
  } catch (dbErr) {
    console.error('❌ [FL Parser] Ошибка подключения к MongoDB Atlas:', dbErr.message);
    return []; // Если база недоступна, пропускаем круг во избежание спама дублями
  }

  // Шаг 2. Запрос RSS-ленты
  let response;
  try {
    response = await fetch(FL_RSS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
  } catch (err) {
    console.error('[FL Parser] Ошибка сети при запросе RSS:', err.message);
    return [];
  }

  if (!response.ok) {
    console.error(`[FL Parser] Сервер вернул ошибку: ${response.status}`);
    return [];
  }

  const xml = await response.text();
  console.log('[FL Parser] RSS получен, парсим XML...');

  // Шаг 3. Парсинг XML структуры
  const parser = new XMLParser({ ignoreAttributes: false, cdataPropName: '__cdata' });
  const result = parser.parse(xml);

  const rawItems = result?.rss?.channel?.item || [];
  const itemsArray = Array.isArray(rawItems) ? rawItems : [rawItems];
  console.log(`[FL Parser] Всего объявлений в ленте: ${itemsArray.length}`);

  const newAds = [];

  // Шаг 4. Цикл обработки объявлений
  for (const item of itemsArray) {
    // Извлекаем уникальный ID объявления
    const id = (item.guid?.__cdata || item.guid || item.link || '').toString().trim();
    if (!id) continue;

    // Проверяем в MongoDB, видели ли мы этот заказ ранее
    const alreadySeen = await seenAdsCollection.findOne({ orderId: id });
    if (alreadySeen) {
      continue; // Если видели — молча пропускаем
    }

    // Собираем чистый объект заказа
    const ad = {
      id,
      title: item.title?.__cdata || item.title || 'Без названия',
      description: (item.description?.__cdata || item.description || '').slice(0, 800),
      link: item.link?.__cdata || item.link || '',
      category: item.category?.__cdata || item.category || '',
      pubDate: item.pubDate || ''
    };

    // Заказ абсолютно новый! Сразу же сохраняем его в MongoDB, чтобы больше не обрабатывать
    try {
      await seenAdsCollection.insertOne({
        orderId: id,
        title: ad.title,
        createdAt: new Date()
      });
    } catch (e) {
      // Защита от параллельных запросов
      continue;
    }

    // Проверяем заказ через сито регулярных выражений по заголовку
    if (!isOrderRelevant(ad)) {
      console.log(`[FL Parser] ⏭ Пропускаем (не наша ниша): "${ad.title}"`);
      continue;
    }

    // Если заказ прошел все фильтры — отправляем его в массив для ИИ
    console.log(`[FL Parser] ✅ Новый релевантный заказ: "${ad.title}"`);
    newAds.push(ad);
  }

  console.log(`[FL Parser] Итого новых релевантных заказов для отправки ИИ: ${newAds.length}`);
  console.log('[FL Parser] ========================================');

  return newAds;
}

// ==========================================
// ФУНКЦИЯ: ПОЛУЧЕНИЕ СВЕЖИХ ЗАКАЗОВ С KWORK.RU
// ==========================================
// ==========================================
// ФУНКЦИЯ: ПОЛУЧЕНИЕ СВЕЖИХ ЗАКАЗОВ С KWORK.RU (БРОНИРОВАННАЯ)
// ==========================================
// ==========================================
// ФУНКЦИЯ: ПОЛУЧЕНИЕ СВЕЖИХ ЗАКАЗОВ С KWORK.RU (НЕУБИВАЕМАЯ)
// ==========================================
// ==========================================
// ФУНКЦИЯ: ПОЛУЧЕНИЕ СВЕЖИХ ЗАКАЗОВ С KWORK.RU (ЧЕРЕЗ JSON-API)
// ==========================================