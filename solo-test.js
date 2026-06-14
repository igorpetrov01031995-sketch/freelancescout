import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

// Передаем объект с ключом явно, чтобы обойти ошибку в коде Google
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_1 });

async function run() {
    try {
        console.log('--- ЗАПУСК ОДИНОЧНОГО ТЕСТА (Фикс конструктора) ---');
        console.log('Стучимся к gemini-1.5-flash...');
        
        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: 'Привет! Если ты меня слышишь, ответь словом "ПРИВЕТ" и больше ничего не пиши.',
        });

        console.log('\n🎉 [ОТВЕТ ОТ ИИ]:', response.text);
        console.log('---------------------------------------------------\n');

    } catch (error) {
        console.error('\n❌ ОШИБКА:', error.message);
        console.log('Если видишь статус 429 — просто переключи локацию в VPN.\n');
    }
}

run();