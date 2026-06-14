import Imap from 'imap';
import { simpleParser } from 'mailparser';

// ==========================================
// 1. ФУНКЦИЯ ДЛЯ СБОРА ЗАКАЗОВ С KWORK
// ==========================================
export function checkEmailKwork(bot, groq, SYSTEM_ORCHESTRATION_PROMPT) {
  return new Promise((resolve, reject) => {
    console.log('[EmailParser] 📬 Проверка почтового ящика на новые заказы Kwork...');

    const imap = new Imap({
      user: process.env.EMAIL_USER,
      password: process.env.EMAIL_PASSWORD,
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || '993'),
      tls: true,
      connTimeout: 10000,
      authTimeout: 10000,
      tlsOptions: { rejectUnauthorized: false }
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          console.error('❌ [EmailParser] Ошибка открытия INBOX (Kwork):', err.message);
          imap.end();
          return resolve();
        }

        imap.search(['UNSEEN'], async (err, results) => {
          if (err) {
            console.error('❌ [EmailParser] Ошибка поиска писем (Kwork):', err.message);
            imap.end();
            return resolve();
          }

          if (!results || results.length === 0) {
            console.log('[EmailParser] 💤 Новых писем Kwork не обнаружено.');
            imap.end();
            return resolve();
          }

          try {
            const f = imap.fetch(results, { bodies: '' });
            const promises = [];

            f.on('message', (msg, seqno) => {
              let buffer = '';
              let uid = null;

              msg.on('attributes', (attrs) => { uid = attrs.uid; });
              msg.on('body', (stream) => {
                stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
              });

              const msgPromise = new Promise((msgResolve) => {
                msg.on('end', async () => {
                  try {
                    const parsed = await simpleParser(buffer);
                    const fromAddress = parsed.from?.value?.[0]?.address || '';
                    const subject = parsed.subject || '';

                    if (fromAddress.toLowerCase().includes('kwork') || subject.toLowerCase().includes('kwork')) {
                      const emailText = parsed.text || parsed.html || '';
                      const kworkLinkMatch = emailText.match(/https:\/\/kwork\.ru\/projects\/\d+/);

                      if (kworkLinkMatch) {
                        const jobLink = kworkLinkMatch[0];
                        console.log(`[EmailParser] 🚀 Вытащили заказ из письма! Ссылка: ${jobLink}`);

                        const fullPrompt = `${SYSTEM_ORCHESTRATION_PROMPT}\n\nТЕКСТ ЗАКАЗА ИЗ ПИСЬМА:\n"Тема: ${subject}\n\n${emailText}"`;
                        
                        const completion = await groq.chat.completions.create({
                          messages: [{ role: 'user', content: fullPrompt }],
                          model: 'llama-3.3-70b-versatile'
                        });

                        const result = completion.choices[0]?.message?.content || '';

                        if (result.includes('НЕ НАША НИША')) {
                          console.log(`[EmailParser] ⛔ Заказ из почты отклонен ИИ: ${subject}`);
                        } else {
                          const header = `📧📧📧 ПЕРЕХВАТ ИЗ EMAIL (KWORK)\n\nСсылка на проект: ${jobLink}\n\n`;
                          await bot.telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, header + result);
                        }
                      }

                      if (uid) {
                        await new Promise((r) => imap.addFlags(uid, '\\Seen', r));
                      }
                    }
                  } catch (pErr) {
                    console.error('[EmailParser] Ошибка парсинга письма Kwork:', pErr.message);
                  } finally {
                    msgResolve();
                  }
                });
              });
              promises.push(msgPromise);
            });

            f.once('end', async () => {
              await Promise.all(promises);
              imap.end();
            });

          } catch (fetchErr) {
            console.error('[EmailParser] Ошибка выборки писем Kwork:', fetchErr.message);
            imap.end();
          }
        });
      });
    });

    imap.once('error', (err) => { resolve(); });
    imap.once('end', () => { resolve(); });
    imap.connect();
  });
}

// ==========================================
// 🔥 2. СВЕЖАЯ ФУНКЦИЯ ДЛЯ ПЕРЕХВАТА ОТВЕТОВ С FL.RU
// ==========================================
export function checkFlDirectMessages(bot) {
  return new Promise((resolve, reject) => {
    console.log('[EmailParser] 🔔 Проверка ящика на личные сообщения и ответы от клиентов с FL.ru...');

    const imap = new Imap({
      user: process.env.EMAIL_USER,
      password: process.env.EMAIL_PASSWORD,
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || '993'),
      tls: true,
      connTimeout: 10000,
      authTimeout: 10000,
      tlsOptions: { rejectUnauthorized: false }
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          console.error('❌ [EmailParser] Ошибка открытия INBOX (FL Сообщения):', err.message);
          imap.end();
          return resolve();
        }

        // Ищем только непрочитанные
        imap.search(['UNSEEN'], async (err, results) => {
          if (err) {
            console.error('❌ [EmailParser] Ошибка поиска писем (FL Сообщения):', err.message);
            imap.end();
            return resolve();
          }

          if (!results || results.length === 0) {
            console.log('[EmailParser] 💤 Новых уведомлений от FL.ru нет.');
            imap.end();
            return resolve();
          }

          try {
            const f = imap.fetch(results, { bodies: '' });
            const promises = [];

            f.on('message', (msg, seqno) => {
              let buffer = '';
              let uid = null;

              msg.on('attributes', (attrs) => { uid = attrs.uid; });
              msg.on('body', (stream) => {
                stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
              });

              const msgPromise = new Promise((msgResolve) => {
                msg.on('end', async () => {
                  try {
                    const parsed = await simpleParser(buffer);
                    const fromAddress = (parsed.from?.value?.[0]?.address || '').toLowerCase();
                    const subject = parsed.subject || '';
                    const emailText = parsed.text || parsed.html || '';

                    // Официальные адреса FL, которые ты скинул
                    const flSenders = ['no_reply@fl.ru', 'no_reply@free-lance.ru', 'news@email.fl.ru'];
                    const isFromFl = flSenders.some(sender => fromAddress.includes(sender));

                    if (isFromFl) {
                      const lowerSubject = subject.toLowerCase();
                      
                      // Проверяем, что это личное сообщение или реакция на отклик, а не просто реклама
                      const isUrgentNotification = 
                        lowerSubject.includes('сообщение') || 
                        lowerSubject.includes('отклик') || 
                        lowerSubject.includes('ответ') || 
                        lowerSubject.includes('прокомментировал') ||
                        lowerSubject.includes('выбран') ||
                        lowerSubject.includes('кандидат');

                      if (isUrgentNotification) {
                        console.log(`[EmailParser] ⚡ Найдено важное уведомление: "${subject}"! Пересылаем в ТГ...`);

                        // Пытаемся выудить ссылку на диалог, чтобы сразу кликнуть из Телеграма
                        const urlMatch = emailText.match(/https?:\/\/(?:www\.)?fl\.ru\/[^\s>]+/i);
                        const flLink = urlMatch ? `\n\n🔗 <b>Ссылка из письма:</b>\n${urlMatch[0]}` : '';

                        // Формируем аккуратный текст для тебя
                        const telegramText = `
🔔 <b>ИЛЬЯ, ВНИМАНИЕ! ОТВЕТ НА FL.RU!</b>
━━━━━━━━━━━━━━━━━━
📥 <b>Тема:</b> ${subject}

💬 <b>Текст сообщения:</b>
<i>${emailText.substring(0, 700).trim()}...</i>
${flLink}

👉 <i>Срочно зайди на биржу, клиент ждет!</i>
                        `;

                        // Отправляем в Telegram с поддержкой жирного шрифта (HTML)
                        await bot.telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, telegramText, { parse_mode: 'HTML' });
                      }

                      // Помечаем прочитанным, чтобы не спамить при следующем цикле
                      if (uid) {
                        await new Promise((r) => imap.addFlags(uid, '\\Seen', r));
                      }
                    }
                  } catch (pErr) {
                    console.error('[EmailParser] Ошибка разбора письма FL:', pErr.message);
                  } finally {
                    msgResolve();
                  }
                });
              });
              promises.push(msgPromise);
            });

            f.once('end', async () => {
              await Promise.all(promises);
              imap.end();
            });

          } catch (fetchErr) {
            console.error('[EmailParser] Ошибка выборки писем FL:', fetchErr.message);
            imap.end();
          }
        });
      });
    });

    imap.once('error', (err) => { resolve(); });
    imap.once('end', () => { resolve(); });
    imap.connect();
  });
}