import { Context } from "telegraf";
import { getLottieFrameFromTGS } from "./lottie";
import { gunzipSync } from "zlib";
import { detect_objects_on_image, DetectedBox } from "./object-detector";
import { logger } from "./logging";
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PassThrough } from 'stream';

async function getObjectDetectionDataAsString(imageBuffer: Buffer): Promise<string> {
    const detectedObjects = await detect_objects_on_image(imageBuffer);

    return detectedObjects.length > 0 ? detectedObjects.map(([x1, y1, x2, y2, label, prob]: DetectedBox) =>
        `${label} (${Math.round(prob * 100)}%): [${Math.round(x1)}, ${Math.round(y1)}, ${Math.round(x2)}, ${Math.round(y2)}]`
    ).join('\n') : 'Объекты не обнаружены';
}

/**
 * Извлекает первый кадр из видео и возвращает его как Buffer
 * @param {Buffer} videoBuffer - буфер с видео данными
 * @returns {Promise<Buffer>} - промис, который разрешается в буфер с PNG изображением
 */
async function extractFirstFrameFromBuffer(videoBuffer: Buffer): Promise<Buffer> {
    const tempDir = os.tmpdir();
    const timestamp = Date.now();
    const inputPath = path.join(tempDir, `input_${timestamp}.webm`);

    // Записываем видео во временный файл
    fs.writeFileSync(inputPath, videoBuffer);

    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        const outputStream = new PassThrough();

        ffmpeg(inputPath)
            .seekInput(0)
            .frames(1)
            .outputOptions([
                '-f', 'image2',  // Формат для одиночного изображения
                '-vcodec', 'png' // Кодек PNG
            ])
            .pipe(outputStream)
            .on('end', () => {
                try {
                    const frameBuffer = Buffer.concat(chunks);
                    // Удаляем временный файл
                    fs.unlinkSync(inputPath);
                    resolve(frameBuffer);
                } catch (error) {
                    reject(error);
                }
            })
            .on('error', (err: Error) => {
                // Удаляем временный файл в случае ошибки
                try {
                    fs.unlinkSync(inputPath);
                } catch { }
                reject(err);
            });

        outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
        outputStream.on('end', () => { });
        outputStream.on('error', (err: Error) => reject(err));
    });
}

/**
 * Handles text messages from Telegram.
 * @param ctx - Message context
 */
export async function handleTextMessage(ctx: Context) {
    if (!ctx.message || !('text' in ctx.message)) return;
    await ctx.reply('Привет');
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

        // Проверяем, является ли стикер видео и включена ли обработка видео
        if (sticker.is_video && fileInfo.file_path?.endsWith('.webm')) {
            if (process.env.USE_FFMPEG !== 'true') {
                await ctx.reply('Стикеры в формате видео не поддерживаются');
                return;
            }
        }

        // Скачиваем файл
        const response = await fetch(fileUrl);
        if (!response.ok) {
            throw new Error(`Ошибка при скачивании файла: ${response.statusText}`);
        }
        let fileBuffer = Buffer.from(await response.arrayBuffer());

        // Обрабатываем разные типы стикеров
        if (sticker.is_animated) {
            const decompressedData = gunzipSync(fileBuffer);
            fileBuffer = await getLottieFrameFromTGS(decompressedData);
        } else if (sticker.is_video && fileInfo.file_path?.endsWith('.webm')) {
            fileBuffer = await extractFirstFrameFromBuffer(fileBuffer);
        }

        const result = await getObjectDetectionDataAsString(fileBuffer);
        await ctx.reply(result);

    } catch (error) {
        logger.error('Ошибка при обработке стикера:', error);
        await ctx.reply('Произошла ошибка при обработке стикера');
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
        logger.error(`Ошибка при распознавании: ${error instanceof Error ? error.message : String(error)}`);
        await ctx.reply('Произошла ошибка при распознавании изображения');
    }
}