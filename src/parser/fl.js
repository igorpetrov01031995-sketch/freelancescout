// src/parser/fl.js
// Модуль парсинга RSS-ленты FL.ru
// Забирает новые заказы, фильтрует по нашей специализации

import { XMLParser } from 'fast-xml-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEEN_ADS_PATH = path.join(__dirname, '../../data/seen_ads.json');
const FL_RSS_URL = 'https://www.fl.ru/rss/all.xml';

// Ключевые слова нашей специализации
const RELEVANT_KEYWORDS = [
  'программирование', 'автоматизация', 'бот', 'парсинг', 'парсер',
  'скрипт', 'api', 'интеграция', 'python', 'node.js', 'javascript',
  'telegram', 'искусственный интеллект', 'нейросеть', 'gpt',
  'webhook', 'selenium', 'playwright', 'разработка сайта',
  'разработка приложения', 'базы данных', 'sql'
];

// Категории которые точно не наши — пропускаем сразу
const EXCLUDED_CATEGORIES = [
  'дизайн', 'перевод', 'фото', 'видео', 'аудио', 'копирайт',
  'бухгалтер', '3d', 'полиграф', 'монтаж', 'логотип', 'иллюстрац',
  'чертеж', 'autocad', 'solidworks', 'аниматор', 'художник'
];

// Загружаем список уже обработанных ID
function loadSeenAds() {
  try {
    const data = fs.readFileSync(SEEN_ADS_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    console.log('[FL Parser] seen_ads.json не найден, создаём новый...');
    return { ids: [] };
  }
}

// Сохраняем обновлённый список ID
function saveSeenAds(seenAds) {
  fs.mkdirSync(path.dirname(SEEN_ADS_PATH), { recursive: true });
  fs.writeFileSync(SEEN_ADS_PATH, JSON.stringify(seenAds, null, 2));
  console.log(`[FL Parser] seen_ads.json обновлён. Всего в базе: ${seenAds.ids.length}`);
}

// Проверяем релевантность заказа нашей специализации
function isRelevant(item) {
  const text =
    `${item.title} ${item.description} ${item.category}`.toLowerCase();

  const isExcluded = EXCLUDED_CATEGORIES.some(
    kw => text.includes(kw)
  );

  if (isExcluded) return false;

  const matchedKeyword = RELEVANT_KEYWORDS.find(
    kw => text.includes(kw)
  );

  if (matchedKeyword) {
    console.log(
      `[FL Parser] Ключевое слово "${matchedKeyword}" → ${item.title}`
    );
    return true;
  }

  return false;
}

// Главная функция — возвращает массив новых релевантных заказов
export async function fetchNewAds() {
  console.log('[FL Parser] ========================================');
  console.log('[FL Parser] Запуск проверки FL.ru RSS...');
  console.log(`[FL Parser] Время: ${new Date().toLocaleString('ru-RU')}`);

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

  const parser = new XMLParser({ ignoreAttributes: false, cdataPropName: '__cdata' });
  const result = parser.parse(xml);

  const rawItems = result?.rss?.channel?.item || [];
  const itemsArray = Array.isArray(rawItems) ? rawItems : [rawItems];
  console.log(`[FL Parser] Всего объявлений в ленте: ${itemsArray.length}`);

  const seenAds = loadSeenAds();
  const newAds = [];

  for (const item of itemsArray) {
    // Достаём ID — guid или link
    const id = (item.guid?.__cdata || item.guid || item.link || '').toString().trim();
    if (!id) continue;

    // Пропускаем уже виденные
    if (seenAds.ids.includes(id)) continue;

    // Собираем объект заказа (CDATA-поля требуют особого извлечения)
    const ad = {
      id,
      title: item.title?.__cdata || item.title || 'Без названия',
      description: (item.description?.__cdata || item.description || '').slice(0, 800),
      link: item.link?.__cdata || item.link || '',
      category: item.category?.__cdata || item.category || '',
      pubDate: item.pubDate || ''
    };

    // Сразу запоминаем ID — независимо от релевантности
    seenAds.ids.push(id);

    // Фильтруем по специализации
    if (!isRelevant(ad)) {
      console.log(`[FL Parser] ⏭ Пропускаем (не наша ниша): ${ad.title}`);
      continue;
    }

    console.log(`[FL Parser] ✅ Новый релевантный заказ: ${ad.title}`);
    newAds.push(ad);
  }

  // Ограничиваем размер базы — храним последние 1000 ID
  if (seenAds.ids.length > 1000) {
    seenAds.ids = seenAds.ids.slice(-1000);
  }

  saveSeenAds(seenAds);
  console.log(`[FL Parser] Итого новых релевантных заказов: ${newAds.length}`);
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
