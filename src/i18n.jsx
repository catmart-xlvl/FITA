import React, { createContext, useContext, useEffect, useState } from 'react';
import { normalizeLanguage, readLanguage, persistLanguage, translate, translateMessage } from './i18n-core.js';
import {PRODUCT_NAME} from '../shared/product.js';

const I18nContext = createContext(null);
export function I18nProvider({ children }) {
  const [language, updateLanguage] = useState(() => readLanguage(globalThis.localStorage));
  function setLanguage(value) {
    const next = normalizeLanguage(value);
    persistLanguage(globalThis.localStorage, next);
    updateLanguage(next);
  }
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = PRODUCT_NAME + ' · ' + translate(language, 'Local');
  }, [language]);
  const value = {
    language, setLanguage,
    t: (key, values) => translate(language, key, values),
    message: (text) => translateMessage(language, text),
  };
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n requires I18nProvider');
  return context;
}
export { translateMessage } from './i18n-core.js';
