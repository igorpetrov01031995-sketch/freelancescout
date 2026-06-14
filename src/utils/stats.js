import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATS_PATH = path.join(__dirname, '../../data/lead_stats.json');

function loadStats() {
  try {
    return JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
  } catch {
    return {
      total: 0,
      approved: 0,
      rejected: 0
    };
  }
}

function saveStats(stats) {
  fs.mkdirSync(path.dirname(STATS_PATH), { recursive: true }); // ← добавить эту строку
  fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
}

export function incrementApproved() {
  const stats = loadStats();

  stats.total++;
  stats.approved++;

  saveStats(stats);

  console.log(
    `[STATS] Всего: ${stats.total} | Одобрено: ${stats.approved} | Отклонено: ${stats.rejected}`
  );
}

export function incrementRejected() {
  const stats = loadStats();

  stats.total++;
  stats.rejected++;

  saveStats(stats);

  console.log(
    `[STATS] Всего: ${stats.total} | Одобрено: ${stats.approved} | Отклонено: ${stats.rejected}`
  );
}

export function getStats() {
  return loadStats();
}