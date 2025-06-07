import { Context, MiddlewareFn } from 'telegraf';
import winston from 'winston';

/**\n * Логгер для записи информации и ошибок.\n */
export const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
    ),
    transports: [new winston.transports.Console()]
});

/**\n * Middleware для логирования входящих и исходящих сообщений Telegram.\n * @param ctx - Контекст сообщения\n * @param next - Следующий middleware\n */
export const loggerMiddleware: MiddlewareFn<Context> = async function (ctx, next) {
    const messageText = ctx.message && 'text' in ctx.message ? ctx.message.text :
        ctx.message && 'sticker' in ctx.message ? 'стикер' : 'фото';
    logger.info(`Получен запрос: ${messageText}`);
    try {
        await next();
        const responseText = ctx.message && 'text' in ctx.message ? 'Hello' :
            ctx.message && 'sticker' in ctx.message ? 'Информация о стикере' : 'Распознавание объектов';
        logger.info(`Ответ отправлен: ${responseText}`);
    } catch (error) {
        logger.error(`Ошибка: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}