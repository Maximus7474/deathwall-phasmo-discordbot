import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import { getItem, Locale } from './localeLoader';
import { ItemType } from '@types';
import { join } from 'node:path';

export interface GameSettings {
    modifiers: {
        evidence: number;       // 3 to 0
        tier: number;           // 3 to 1
        entitySpeed: number;    // 100 to 200 - 25 increments
        playerSpeed: number;    // 100 to 50  - 25 increments
        breaker: boolean;       // true functional - false broken
        sanity: number;         // 100 to 0   - 25 increments
        sprint: boolean;        // true can sprint, false can't sprint
    },
    removedItems: string[];
}

GlobalFonts.registerFromPath(join(import.meta.dir, '..', '..', 'assets', 'fonts', 'October Crow.ttf'), 'OctoberCrow');

const imageLocales = Locale.imagerecap;

export async function drawRestrictionRecap(settings: GameSettings): Promise<Buffer> {
    const width = 600;
    const height = 400;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const defaultFont = '18px sans-serif';
    const octcrowFont = '18px OctoberCrow';

    // Background
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(0, 0, width, height);

    // Header
    ctx.fillStyle = '#e61414';
    ctx.fillRect(0, 0, width, 60);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px OctoberCrow';
    ctx.fillText(imageLocales.titles.main, 20, 40);

    // Grid Constants
    const startX = 30;
    const startY = 100;
    const colWidth = 270;
    const rowHeight = 40;

    const mods = settings.modifiers;
    const data = [
        { label: imageLocales.data.evidence,    value: `${mods.evidence}` },
        { label: imageLocales.data.maxitemtier, value: imageLocales.values.tiericon.repeat(mods.tier) },
        { label: imageLocales.data.entityspeed, value: `${mods.entitySpeed} %` },
        { label: imageLocales.data.playerspeed, value: `${mods.playerSpeed} %` },
        { label: imageLocales.data.startsanity, value: `${mods.sanity} %` },
        { 
            label: imageLocales.data.breaker, 
            value: mods.breaker
                ? imageLocales.values.breaker.functional
                : imageLocales.values.breaker.broken, 
            color: mods.breaker
                ? '#a6e3a1'
                : '#f38ba8' 
        },
        { 
            label: imageLocales.data.sprint,  
            value: mods.sprint
                ? imageLocales.values.sprint.enabled
                : imageLocales.values.sprint.disabled, 
            color: mods.sprint
                ? '#a6e3a1'
                : '#f38ba8' 
        },
    ];

    // Modifiers Grid
    data.forEach((item, i) => {
        const x = startX + (i % 2 === 1 ? colWidth : 0);
        const y = startY + Math.floor(i / 2) * rowHeight;

        ctx.font = defaultFont;
        ctx.fillStyle = '#bac2de';
        ctx.fillText(`${item.label}:`, x, y);

        ctx.font = octcrowFont;
        ctx.fillStyle = item.color || '#89b4fa';
        ctx.fillText(item.value, x + 130, y);
    });

    // Removed Items
    const listY = 265;
    ctx.strokeStyle = '#313244';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, listY - 30);
    ctx.lineTo(width - 20, listY - 30);
    ctx.stroke();

    ctx.fillStyle = '#ec376a';
    ctx.font = 'bold 20px OctoberCrow';
    ctx.fillText('REMOVED ITEMS', startX, listY);

    ctx.fillStyle = '#bac2de';
    ctx.font = '16px sans-serif';
    const itemsText = settings.removedItems.length > 0
        ? settings.removedItems.map(i => getItem(i as ItemType)).join(', ')
        : 'None';

    // Basic text wrapping for removed items
    const maxWidth = 540;
    let line = '';
    let currentY = listY + 30;
    const words = itemsText.split(' ');

    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const metrics = ctx.measureText(testLine);

        if (metrics.width > maxWidth && n > 0) {
            ctx.fillText(line, startX, currentY);
            line = words[n] + ' ';
            currentY += 25;
        } else {
            line = testLine;
        }
    }
    ctx.fillText(line, startX, currentY);

    return canvas.toBuffer('image/png');
}