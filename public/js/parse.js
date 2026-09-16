/* ---------------------------------------------------------------------------
   Saisie rapide : « Dentiste demain 14h #Santé !haute ».
   Module pur — aucun DOM, aucun réseau, horloge injectable. Tout ce qui est
   reconnu sort du titre et revient dans `tokens` pour être montré à l'écran :
   un parseur qui devine en silence est un parseur qu'on n'ose plus utiliser.
   --------------------------------------------------------------------------- */

const MAX_TITLE = 120;
// un jour sans heure vaut « dans la matinée »
const DEFAULT_HOUR = 9;

const PRIORITIES = {
  haute: 'high',
  urgent: 'high',
  urgente: 'high',
  1: 'high',
  moyenne: 'medium',
  normale: 'medium',
  2: 'medium',
  basse: 'low',
  3: 'low',
};

const WEEKDAYS = {
  dimanche: 0,
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
};

/* Chaque motif commence par (^|\s) : un motif ne se déclenche qu'en début de
   mot, sinon « #Santé » livrerait un jour dans « ...di ». Le groupe 1 est cette
   frontière, et n'est jamais consommé. */
const RE_PRIORITY = /(^|\s)!(haute|urgente?|moyenne|normale|basse|[123])\b/iu;
const RE_CATEGORY = /(^|\s)#([\p{L}\p{N}_-]{1,32})/u;
const RE_IN = /(^|\s)dans\s+(\d{1,3})\s*(jours?|j|semaines?|sem)\b/iu;
const RE_RELATIVE = /(^|\s)(apr[èe]s-demain|demain|aujourd['’]?hui|auj)\b/iu;
const RE_WEEKDAY = /(^|\s)(?:(?:ce|cette)\s+)?(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/iu;
const RE_DATE = /(^|\s)(?:le\s+)?(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/u;
const RE_TIME = /(^|\s)(?:[àa]\s*)?(\d{1,2})\s*h\s*([0-5]\d)?\b/iu;

/** Minuscules sans accents : « Après-demain » et « apres-demain » se valent. */
const plain = (value) =>
  String(value)
    .normalize('NFD')
    // U+0300 a U+036F : les diacritiques que NFD vient de détacher
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const atMidnight = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

/**
 * Lit une saisie libre et en extrait échéance, catégorie et priorité.
 * @param {string} input texte saisi
 * @param {{now?: Date, categories?: string[]}} options horloge et catégories connues
 * @returns {{title: string, dueDate: string|null, category: string, priority: string,
 *            tokens: Array<{type: string, text: string}>}}
 */
export function parseQuickEntry(input, { now = new Date(), categories = [] } = {}) {
  const text = String(input ?? '');
  const cuts = [];
  const tokens = [];
  let day = null;
  let time = null;
  let category = '';
  let priority = '';

  const overlaps = (start, end) => cuts.some(([s, e]) => start < e && s < end);

  /**
   * Retire le segment du titre et le montre dans l'aperçu.
   * @returns {boolean} false si le segment chevauche un segment déjà pris
   */
  const take = (match, type) => {
    const start = match.index + match[1].length;
    const end = match.index + match[0].length;
    if (overlaps(start, end)) return false;
    cuts.push([start, end]);
    tokens.push({ type, text: text.slice(start, end).trim() });
    return true;
  };

  const mPriority = RE_PRIORITY.exec(text);
  if (mPriority && take(mPriority, 'priority')) {
    priority = PRIORITIES[plain(mPriority[2])] || '';
  }

  const mCategory = RE_CATEGORY.exec(text);
  if (mCategory && take(mCategory, 'category')) {
    const raw = mCategory[2];
    // la casse saisie est recalée sur la catégorie existante, si elle existe
    category = categories.find((name) => plain(name) === plain(raw)) || raw;
  }

  // une seule source de jour : le premier motif qui matche l'emporte
  const mIn = RE_IN.exec(text);
  const mRelative = RE_RELATIVE.exec(text);
  const mWeekday = RE_WEEKDAY.exec(text);
  const mDate = RE_DATE.exec(text);

  if (mIn && take(mIn, 'date')) {
    const step = plain(mIn[3]).startsWith('sem') ? 7 : 1;
    day = addDays(atMidnight(now), parseInt(mIn[2], 10) * step);
  } else if (mRelative && take(mRelative, 'date')) {
    const word = plain(mRelative[2]);
    if (word.startsWith('apres-demain')) day = addDays(atMidnight(now), 2);
    else if (word === 'demain') day = addDays(atMidnight(now), 1);
    else day = atMidnight(now);
  } else if (mWeekday) {
    const today = atMidnight(now);
    // « mercredi » un mercredi désigne le mercredi suivant, jamais aujourd'hui
    const delta = (WEEKDAYS[plain(mWeekday[2])] - today.getDay() + 7) % 7 || 7;
    if (take(mWeekday, 'date')) day = addDays(today, delta);
  } else if (mDate) {
    const dayNum = parseInt(mDate[2], 10);
    const monthNum = parseInt(mDate[3], 10);
    if (dayNum >= 1 && dayNum <= 31 && monthNum >= 1 && monthNum <= 12) {
      let year = mDate[4] ? parseInt(mDate[4], 10) : now.getFullYear();
      if (year < 100) year += 2000;
      let candidate = new Date(year, monthNum - 1, dayNum);
      // année omise et date déjà passée : l'utilisateur vise l'année suivante
      if (!mDate[4] && candidate < atMidnight(now)) {
        candidate = new Date(year + 1, monthNum - 1, dayNum);
      }
      // le 31 février déborde sur mars : ce n'était pas une date
      if (candidate.getMonth() === monthNum - 1 && take(mDate, 'date')) day = candidate;
    }
  }

  const mTime = RE_TIME.exec(text);
  if (mTime) {
    const hours = parseInt(mTime[2], 10);
    if (hours <= 23 && take(mTime, 'date')) {
      time = { hours, minutes: mTime[3] ? parseInt(mTime[3], 10) : 0 };
    }
  }

  let dueDate = null;
  if (day || time) {
    const resolved = new Date(day || atMidnight(now));
    resolved.setHours(time ? time.hours : DEFAULT_HOUR, time ? time.minutes : 0, 0, 0);
    // une heure seule déjà passée désigne le lendemain
    const shift = !day && resolved.getTime() <= now.getTime();
    dueDate = (shift ? addDays(resolved, 1) : resolved).toISOString();
  }

  // découpe par la fin : les indices des coupes restantes restent valides
  const title = cuts
    .slice()
    .sort((a, b) => a[0] - b[0])
    .reduceRight((acc, [start, end]) => acc.slice(0, start) + acc.slice(end), text)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE);

  return { title, dueDate, category, priority, tokens };
}
