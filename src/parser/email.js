import Imap from 'imap';
import { simpleParser } from 'mailparser';

export function checkEmailKwork(bot, groq, SYSTEM_ORCHESTRATION_PROMPT) {
  return new Promise((resolve, reject) => {
    console.log('[EmailParser] 📬 Проверка почтового ящика на новые заказы Kwork...');

    // Конфигурируем прямое TLS подключение к почте
    const imap = new Imap({
      user: process.env.EMAIL_USER,
      password: process.env.EMAIL_PASSWORD,
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || '993'),
      tls: true,
      connTimeout: 10000,
  authTimeout: 10000,

  debug: (msg) => console.log('[IMAP DEBUG]', msg),
      tlsOptions: { rejectUnauthorized: false } // Игнорируем конфликты сертификатов прокси
    });

    imap.once('ready', () => {
      // Открываем папку "Входящие" в режиме чтения и записи (false = read-write)
      imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          console.error('❌ [EmailParser] Ошибка открытия INBOX:', err.message);
          imap.end();
          return resolve();
        }

        // Ищем ТОЛЬКО непрочитанные письма
        imap.search(['UNSEEN'], async (err, results) => {
          if (err) {
            console.error('❌ [EmailParser] Ошибка поиска писем:', err.message);
            imap.end();
            return resolve();
          }

          if (!results || results.length === 0) {
            console.log('[EmailParser] 💤 Новых писем в ящике не обнаружено.');
            imap.end();
            return resolve();
          }

          console.log(`[EmailParser] 📥 В ящике найдено непрочитанных писем: ${results.length}. Фильтруем Kwork...`);
          
          try {
            // Забираем сырые тела писем и их заголовки
            // Забираем сырые тела писем и их заголовки
        const f = imap.fetch(results, { bodies: '' });
        const promises = []; // Массив для контроля всех асинхронных разборов писем

        f.on('message', (msg, seqno) => {
          let buffer = '';
          let uid = null;

          msg.on('attributes', (attrs) => {
            uid = attrs.uid;
          });

          msg.on('body', (stream, info) => {
            stream.on('data', (chunk) => {
              buffer += chunk.toString('utf8');
            });
          });

          // Создаем промис для каждого отдельного сообщения
          const msgPromise = new Promise((msgResolve) => {
            msg.on('end', async () => {
              try {
                const parsed = await simpleParser(buffer);
                const fromAddress = parsed.from?.value?.[0]?.address || '';
                const subject = parsed.subject || '';

                // Фильтруем отправителя (проверяем email или тему на вхождение kwork)
                if (fromAddress.toLowerCase().includes('kwork') || subject.toLowerCase().includes('kwork')) {
                  const emailText = parsed.text || parsed.html || '';
                  const kworkLinkMatch = emailText.match(/https:\/\/kwork\.ru\/projects\/\d+/);

                  if (kworkLinkMatch) {
                    const jobLink = kworkLinkMatch[0];
                    console.log(`[EmailParser] 🚀 Вытащили заказ из письма! Ссылка: ${jobLink}`);

                    const fullPrompt = `${SYSTEM_ORCHESTRATION_PROMPT}\n\nТЕКСТ ЗАКАЗА ИЗ ПИСЬМА:\n"Тема: ${subject}\n\n${emailText}"`;
                    console.log('[EmailParser] Передаем лид на ИИ-консилиум Грока...');

                    const completion = await groq.chat.completions.create({
                      messages: [{ role: 'user', content: fullPrompt }],
                      model: 'llama-3.3-70b-versatile'
                    });

                    const result = completion.choices[0]?.message?.content || '';

                    if (result.includes('НЕ НАША НИША')) {
                      console.log(`[EmailParser] ⛔ Заказ из почты отклонен ИИ: ${subject}`);
                    } else {
                      console.log('[EmailParser] 🔥 Заказ одобрен! Отправляем b2b-анализ в Telegram...');
                      const header = `📧📧📧 ПЕРЕХВАТ ИЗ EMAIL (KWORK)\n\nСсылка на проект: ${jobLink}\n\n`;
                      await bot.telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, header + result);
                    }
                  }

                  // Помечаем как прочитанное только если это действительно письмо от Kwork
                  if (uid) {
                    await new Promise((r) => imap.addFlags(uid, '\\Seen', r));
                  }
                }
              } catch (pErr) {
                console.error('[EmailParser] Ошибка парсинга конкретного письма:', pErr.message);
              } finally {
                msgResolve(); // Промис этого письма успешно завершен
              }
            });
          });

          promises.push(msgPromise);
        });

        f.once('end', async () => {
          // Ждем, пока Абсолютно ВСЕ письма пройдут через парсинг и ИИ-сито
          await Promise.all(promises);
          imap.end(); // Только теперь безопасно закрываем ящик
        });

          } catch (fetchErr) {
            console.error('[EmailParser] Ошибка выборки писем:', fetchErr.message);
            imap.end();
          }
        });
      });
    });

    imap.once('error', (err) => {
      console.error('❌ [EmailParser] Критическая ошибка IMAP соединения:', err.message);
      resolve();
    });

    imap.once('end', () => {
      resolve();
    });

    // Запускаем подключение
   console.log('========================');
console.log('[EmailParser] HOST =', process.env.EMAIL_HOST);
console.log('[EmailParser] PORT =', process.env.EMAIL_PORT);
console.log('[EmailParser] USER =', process.env.EMAIL_USER);
console.log('========================');
    imap.connect();
  });
}