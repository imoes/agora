#ifndef AGORA_TRANSLATIONS_H
#define AGORA_TRANSLATIONS_H

/**
 * Translation system with automatic system language detection.
 * Uses user preference from backend if set, otherwise system language.
 * Falls back to English for unsupported languages.
 */

/* Initialize translation system - detects system language automatically */
void agora_translations_init(void);

/* Set language from user profile (called after login).
 * NULL or empty string means keep system language. */
void agora_translations_set_lang(const char *lang_code);

/* Get current language code */
const char *agora_translations_get_lang(void);

/* Translate a key. Falls back to English, then returns the key itself. */
const char *T(const char *key);

#endif /* AGORA_TRANSLATIONS_H */
