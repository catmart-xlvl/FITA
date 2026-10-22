import { catalog, messages } from './locales.js';
import { backendCatalog, backendPatterns } from './message-locales.js';
import { workflowMessages } from './studio-workflow-locales.js';

export const languages = ['en', 'es', 'ja'];
export const languageStorageKey = 'fitaLanguage';
export const normalizeLanguage = value => languages.includes(value) ? value : 'en';
export function readLanguage(storage) {
  try { return normalizeLanguage(storage?.getItem(languageStorageKey)??storage?.getItem('workbenchLanguage')); }
  catch { return 'en'; }
}
export function persistLanguage(storage, value) {
  const language = normalizeLanguage(value);
  try { storage?.setItem(languageStorageKey, language); } catch { /* Session preference still works. */ }
  return language;
}
export function translate(language, key, values = {}) {
  const template = messages[normalizeLanguage(language)][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));
}
const allCatalog = [...catalog, ...backendCatalog];
const knownMessages = new Map(allCatalog.flatMap(row => row.map(value => [value, row])));
// Exact system messages and anchored provider patterns only. Never apply this to
// project names, user notes, filenames or the contents of generated images.
export function translateMessage(language, text) {
  if (text == null) return '';
  const value = String(text), index = languages.indexOf(normalizeLanguage(language));
  if (/^(?:STUDIO|WORKFLOW|FITA)_/.test(value) && workflowMessages[normalizeLanguage(language)][value]) return workflowMessages[normalizeLanguage(language)][value];
  const row = knownMessages.get(value);
  if (row) return row[index];
  if (value === 'demo procedural') return translate(language, 'Procedural demo');
  for (const pattern of backendPatterns) {
    const match = value.match(pattern.match);
    if (match) return pattern.format(index, match, piece => translateMessage(language, piece));
  }
  return value; // Provider diagnostics remain intact when a new code is unknown.
}
