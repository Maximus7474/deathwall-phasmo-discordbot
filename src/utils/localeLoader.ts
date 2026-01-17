import { Locale as LocaleEnum } from "discord.js";
import Logger from "./logger";

const logger = new Logger('LOCALE');

export type LocaleStructure = typeof import('../../locales/en.json');

const localeCfg = process.env.LOCALE_KEY ?? 'en';

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

const primary = await loadLocale<LocaleStructure>(localeCfg).catch(() => null);
const fallback = await loadLocale<LocaleStructure>('en');

if (!primary || localeCfg === 'en') {
  Locale = fallback;
} else {
  Locale = mergeDeep(primary, fallback);
  logger.info(`Loaded ${localeCfg} with English fallbacks for missing keys.`);
}

const sanitizeLocale = (input: string): LocaleEnum => {
  const values = Object.values(LocaleEnum) as string[];

  if (values.includes(input)) return input as LocaleEnum;
  return LocaleEnum.EnglishGB;
};

const localeKey = sanitizeLocale(localeCfg);

export { Locale, localeKey };

export function getCommandLocalization<K extends keyof LocaleStructure['commands']>(
  command: K
): LocaleStructure['commands'][K] {
  return Locale.commands[command];
}

export function getGhost(): LocaleStructure['ghosts'];
export function getGhost<K extends keyof LocaleStructure['ghosts']>(id: K): string;
export function getGhost(id?: string): string | Record<string, string> {
  if (!id) {
    return Locale.ghosts;
  }
  return Locale.ghosts[id as keyof LocaleStructure['ghosts']] ?? id;
}

export function getRestriction<K extends keyof LocaleStructure['restrictions']>(id: K): { name: string; description?: string } {
  return Locale.restrictions[id] ?? { name: id };
}
