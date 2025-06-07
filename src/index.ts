import { Telegraf } from 'telegraf';
import { config } from 'dotenv';
import { message } from 'telegraf/filters'
import { handlePhotoMessage, handleStickerMessage, handleTextMessage } from './message-handlers';
import { logger, loggerMiddleware } from './logging';

config();

// Инициализируем бота
const bot = new Telegraf(process.env.BOT_TOKEN || '');

bot.use(loggerMiddleware);

bot.on(message('text'), handleTextMessage);

bot.on(message('sticker'), handleStickerMessage);

bot.on(message('photo'), handlePhotoMessage);

// Запускаем бота
bot.launch(() => logger.info('Бот запущен'))
  .catch((error) => {
    logger.error('Ошибка при запуске бота:', error);
  });

// Включаем graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM')); 