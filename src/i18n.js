const path = require('path');
const y18n = require('y18n');

const SUPPORTED = ['en', 'es', 'pt', 'fr'];
const FALLBACK = 'en';

// "es_ES.UTF-8" and "pt-BR" both mean the same thing to us: the language part.
const languageOf = (value) =>
  String(value || '').trim().toLowerCase().split(/[._-]/)[0];

// BMC_LANG wins so you can force one language without touching the system;
// after that the usual environment variables, most specific first.
const detectLocale = (env = process.env) => {
  const candidates = [env.BMC_LANG, env.LC_ALL, env.LC_MESSAGES, env.LANG];
  for (const candidate of candidates) {
    const lang = languageOf(candidate);
    if (SUPPORTED.includes(lang)) return lang;
  }
  return FALLBACK;
};

const locale = detectLocale();

// updateFiles stays off: the CLI runs from a global install, where writing back
// into its own folder would fail or need root. The harvest script turns it on.
const instance = y18n({
  locale,
  fallbackToLanguage: true,
  updateFiles: false,
  directory: path.join(__dirname, '..', 'locales'),
});

module.exports = {
  __: instance.__.bind(instance),
  __n: instance.__n.bind(instance),
  locale,
  detectLocale,
  languageOf,
  SUPPORTED,
  FALLBACK,
};
