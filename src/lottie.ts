import * as fs from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';

/**
 * Extracts the first frame from a TGS (Lottie) animation as a PNG image.
 * @param tgsData - Buffer containing the TGS file data
 * @returns Buffer with the PNG image of the first frame
 */
export async function getLottieFrameFromTGS(tgsData: Buffer): Promise<Buffer> {
    let browser;
    try {
        // Читаем TGS файл
        const tgsJson = JSON.parse(tgsData.toString('utf8'));

        // Создаем директорию для результатов
        const outputDir = path.join(__dirname, '..', 'test-output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Выводим метаданные
        console.log('TGS метаданные:', {
            version: tgsJson.tgs,
            lottieVersion: tgsJson.v,
            frameRate: tgsJson.fr,
            inPoint: tgsJson.ip,
            outPoint: tgsJson.op,
            width: tgsJson.w,
            height: tgsJson.h
        });

        const width = tgsJson.w || 512;
        const height = tgsJson.h || 512;

        // Запускаем браузер
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--allow-file-access-from-files', '--disable-web-security']
        });

        const page = await browser.newPage();
        // Включаем логи консоли для отладки
        page.on('console', msg => console.log('PAGE LOG:', msg.text()));
        page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
        await page.setViewport({ width, height });

        // Получаем абсолютный путь к скрипту
        const scriptPath = path.resolve(__dirname, '..', 'node_modules', '@dotlottie', 'player-component', 'dist', 'dotlottie-player.mjs');
        console.log('Путь к скрипту:', scriptPath);

        // HTML с использованием dotlottie-player
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <script type="module" src="https://unpkg.com/@dotlottie/player-component@latest/dist/dotlottie-player.mjs"></script>
                <style>
                    body { 
                        margin: 0; 
                        padding: 0; 
                        background: transparent;
                        width: ${width}px;
                        height: ${height}px;
                    }
                    dotlottie-player {
                        width: ${width}px;
                        height: ${height}px;
                    }
                </style>
            </head>
            <body>
                <dotlottie-player id="player"></dotlottie-player>
            </body>
            </html>
        `;

        await page.setContent(html);

        // Ждем загрузки компонента
        await page.waitForFunction(() => {
            return customElements.get('dotlottie-player') !== undefined;
        }, { timeout: 10000 });

        // Вставляем Lottie анимацию и останавливаем на первом кадре
        await page.evaluate((tgsJson) => {
            const player = document.getElementById('player') as any;
            return player.load(tgsJson).then(() => {
                player.stop();
            });
        }, tgsJson);

        // Делаем скриншот
        const screenshot = await page.screenshot({
            type: 'png',
            omitBackground: true,
            clip: { x: 0, y: 0, width, height }
        }) as Buffer;

        return screenshot;

    } catch (error) {
        console.error(`Ошибка при обработке TGS файла: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}
