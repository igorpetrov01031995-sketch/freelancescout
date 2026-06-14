import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_1);

async function run() {
  try {
    // Используем самую стабильную версию на сегодня
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    console.log('Запрос к модели...');
    const result = await model.generateContent('Привет! Ты работаешь? Ответь одним словом.');
    console.log('✅ ОТВЕТ:', result.response.text());
  } catch (err) {
    console.error('❌ ОШИБКА:', err.message);
  }
}

run();