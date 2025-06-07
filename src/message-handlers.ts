import { Context } from "telegraf";
import { getLottieFrameFromTGS } from "./lottie";
import { gunzipSync } from "zlib";
import { detect_objects_on_image, DetectedBox } from "./object_detector";
import { logger } from "./logging";

async function getObjectDetectionDataAsString(imageBuffer: Buffer): Promise<string> {
    const detectedObjects = await detect_objects_on_image(imageBuffer);

    return detectedObjects.length > 0 ? detectedObjects.map(([x1, y1, x2, y2, label, prob]: DetectedBox) =>
        `${label} (${Math.round(prob * 100)}%): [${Math.round(x1)}, ${Math.round(y1)}, ${Math.round(x2)}, ${Math.round(y2)}]`
    ).join('\n') : 'Объекты не обнаружены';
}

/**
 * Handles text messages from Telegram.
 * @param ctx - Message context
 */
export async function handleTextMessage(ctx: Context) {
    if (!ctx.message || !('text' in ctx.message)) return;
    await ctx.reply('Hello');
}

/**
 * Handles sticker messages from Telegram.
 * @param ctx - Message context
 */
export async function handleStickerMessage(ctx: Context) {
    if (!ctx.message || !('sticker' in ctx.message)) return;
    try {
        const sticker = ctx.message.sticker;

        // Получаем информацию о стикере
        const fileInfo = await ctx.telegram.getFile(sticker.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;

        logger.info('Получен стикер:', {
            fileId: sticker.file_id,
            emoji: sticker.emoji,
            setName: sticker.set_name,
            isAnimated: sticker.is_animated,
            isVideo: sticker.is_video,
            fileUrl
        });

        // Скачиваем файл
        const response = await fetch(fileUrl);
        if (!response.ok) {
            throw new Error(`Ошибка при скачивании файла: ${response.statusText}`);
        }
        let fileBuffer = Buffer.from(await response.arrayBuffer());

        // Если это анимированный стикер, извлекаем первый кадр
        if (sticker.is_animated) {
            const decompressedData = gunzipSync(fileBuffer);
            fileBuffer = await getLottieFrameFromTGS(decompressedData);
        }

        const result = await getObjectDetectionDataAsString(fileBuffer);
        await ctx.reply(result);

    } catch (error) {
        logger.error('Ошибка при обработке стикера:', error);
        await ctx.reply('An error occurred while processing the sticker');
    }
}

/**
 * Handles photo messages from Telegram.
 * @param ctx - Message context
 */
export async function handlePhotoMessage(ctx: Context) {
    if (!ctx.message || !('photo' in ctx.message)) return;
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.telegram.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const buffer = await response.arrayBuffer();

    try {
        const result = await getObjectDetectionDataAsString(Buffer.from(buffer));
        await ctx.reply(result);
    } catch (error) {
        logger.error(`Error during recognition: ${error instanceof Error ? error.message : String(error)}`);
        await ctx.reply('An error occurred while recognizing the image');
    }
}