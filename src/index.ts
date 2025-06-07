import { config } from 'dotenv';
import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters'
import sharp from 'sharp';
import winston from 'winston';
import { detect_objects_on_image, DetectedBox } from './object_detector';

config();

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
  ),
  transports: [new winston.transports.Console()]
});

const bot: Telegraf<Context> = new Telegraf(process.env.BOT_TOKEN as string);

bot.use(async (ctx, next) => {
  const messageText = ctx.message && 'text' in ctx.message ? ctx.message.text : 'фото';
  logger.info(`Получен запрос: ${messageText}`);
  try {
    await next();
    const responseText = ctx.message && 'text' in ctx.message ? 'Hello' : 'Распознавание объектов';
    logger.info(`Ответ отправлен: ${responseText}`);
  } catch (error) {
    logger.error(`Ошибка: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
});

bot.on(message('text'), (ctx) => ctx.reply('Hello'));

bot.on(message('photo'), async (ctx) => {
  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  const file = await ctx.telegram.getFile(photo.file_id);
  const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
  const response = await fetch(fileUrl);
  const buffer = await response.arrayBuffer();
  
  try {
    const detectedObjects = await detect_objects_on_image(Buffer.from(buffer));
    const result = detectedObjects.map(([x1, y1, x2, y2, label, prob]: DetectedBox) => 
      `${label} (${Math.round(prob * 100)}%): [${Math.round(x1)}, ${Math.round(y1)}, ${Math.round(x2)}, ${Math.round(y2)}]`
    ).join('\n');
    
    await ctx.reply(result || 'Объекты не обнаружены');
  } catch (error) {
    logger.error(`Ошибка при распознавании: ${error instanceof Error ? error.message : String(error)}`);
    await ctx.reply('Произошла ошибка при распознавании изображения');
  }
});

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM')); 