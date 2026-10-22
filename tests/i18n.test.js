import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { catalog, messages } from '../src/locales.js';
import { backendCatalog } from '../src/message-locales.js';
import { languages, readLanguage, persistLanguage, translate, translateMessage } from '../src/i18n-core.js';

test('all three product catalogs have matching, nonempty translations and interpolation parameters', () => {
  const unique = new Set();
  for (const row of catalog) {
    assert.equal(row.length, 3);
    assert(!unique.has(row[0]), `Duplicate UI key: ${row[0]}`);
    unique.add(row[0]);
    const parameters = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    for (const text of row) {
      assert.equal(typeof text, 'string');
      assert(text.trim(), row[0]);
      assert.deepEqual(parameters(text), parameters(row[0]), row[0]);
    }
  }
  for (const language of languages) assert.deepEqual(Object.keys(messages[language]), [...unique]);
  for (const row of backendCatalog) {
    assert.equal(row.length, 3);
    assert(row.every(text => typeof text === 'string' && text.trim()));
  }
});

test('English is default; language choice survives new reads and invalid or blocked storage is safe', () => {
  const values = new Map();
  const storage = {getItem: key => values.get(key), setItem: (key, value) => values.set(key, value)};
  assert.equal(readLanguage(storage), 'en');
  for (const language of ['ja', 'es', 'en']) {
    persistLanguage(storage, language);
    assert.equal(readLanguage(storage), language);
  }
  persistLanguage(storage, 'fr');
  assert.equal(readLanguage(storage), 'en');
  const blocked = {getItem() {throw Error('blocked')}, setItem() {throw Error('blocked')}};
  assert.equal(readLanguage(blocked), 'en');
  assert.equal(persistLanguage(blocked, 'ja'), 'ja');
});

test('copy and structured interpolation switch languages without changing user-supplied content', () => {
  const userString = 'Example · Cabeza blue / 青い髪';
  assert.equal(translate('en', 'Create project'), 'Create project');
  assert.equal(translate('es', 'Create project'), 'Crear proyecto');
  assert.equal(translate('ja', 'Create project'), 'プロジェクトを作成');
  for (const language of languages) {
    assert(translate(language, 'Generate with Tripo · {group}', {group:userString}).includes(userString));
    assert.equal(translateMessage(language, userString), userString);
    assert.equal(translateMessage(language, 'my-reference-Cabeza.png'), 'my-reference-Cabeza.png');
  }
  assert.equal(translate('ja', 'A future English key'), 'A future English key');
});

test('legacy validation, billing, approval and bridge errors are understandable in every language', () => {
  const examples = [
    'Archivo de imagen inválido. Usa PNG, JPG o WebP.',
    'Confirma y valida la referencia antes de generar.',
    'Necesitas frente, perfil derecho y espalda para aprobar el grupo.',
    'La revisión cambió o la confirmación venció. Revisa la operación otra vez.',
    'El código venció. Genera otro en el taller.',
    'Referencia confirmada y validada: 1024 × 768 px, PNG. Sin evaluación artística por IA.',
    'Cabeza · Perfil derecho importada.',
    'Se reabrió la revisión de cuerpo.',
    'Cuerpo: vistas aprobadas por el usuario.',
    'Crear una imagen de cabeza · Frente. Se enviará el concepto y las vistas de apoyo disponibles a OpenAI.',
    'Crear un modelo de cuerpo con las tres vistas aprobadas. Se subirán esas imágenes a Tripo.',
    'Proveedor HTTP 401 · invalid_api_key. Clave inválida o revocada.',
    'Subiendo cabeza · Espalda a Tripo…',
    'Modelo guardado. Créditos facturados: 30.',
  ];
  for (const value of examples) {
    assert.equal(translateMessage('es', value), value);
    for (const language of ['en', 'ja']) assert.notEqual(translateMessage(language,value),value, `${language}: ${value}`);
  }
  assert.match(translateMessage('en','Proveedor HTTP 401 · invalid_api_key. Clave inválida o revocada.'), /401.*invalid_api_key.*Invalid or revoked key/);
  assert.match(translateMessage('ja','Modelo guardado. Créditos facturados: 30.'), /30/);
  assert.equal(translateMessage('en','Provider XYZ-801 new diagnostic'), 'Provider XYZ-801 new diagnostic');
});

test('every explicit UI translation key in the main workflow and viewer has a complete catalog entry', async () => {
  for (const filename of ['main.jsx', 'Viewer.jsx']) {
    const source = await fs.readFile(new URL('../src/'+filename, import.meta.url), 'utf8');
    for (const match of source.matchAll(/\bt\("([^"]+)"/g)) {
      for (const language of languages) assert(messages[language][match[1]], `${filename}: ${language}: ${match[1]}`);
    }
  }
});
