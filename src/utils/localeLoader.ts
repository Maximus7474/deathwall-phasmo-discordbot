import Logger from "./logger";

const logger = new Logger('LOCALE');

type LocaleStructure = typeof import('../../locales/en.json');

const localeKey = process.env.LOCALE_KEY ?? 'en';

async function loadLocale<T>(fileName: string): Promise<T> {
  const path = `./locales/${fileName}.json`;
  const file = Bun.file(path);

  if (!(await file.exists())) {
    throw new Error(`File ${path} not found`);
  }
  return await file.json();
}

function mergeDeep(target: any, source: any) { // eslint-disable-line
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      mergeDeep(target[key], source[key]);
    } else if (target[key] === undefined) {
      target[key] = source[key];
    }
  }
  return target;
}

let Locale: LocaleStructure;

const primary = await loadLocale<LocaleStructure>(localeKey).catch(() => null);
const fallback = await loadLocale<LocaleStructure>('en');

if (!primary || localeKey === 'en') {
  Locale = fallback;
} else {
  Locale = mergeDeep(primary, fallback);
  logger.info(`Loaded ${localeKey} with English fallbacks for missing keys.`);
}

export { Locale };

console.log(Locale);

export function getCommandLocalizations(command: keyof LocaleStructure['commands']) {
  return Locale.commands[command];
}