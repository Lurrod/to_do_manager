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

/* `#` et `!` exigent aussi une frontière APRÈS le motif, et ce doit être une
   anticipation sur l'espace ou la fin : un simple \b ne suffirait pas, puisqu'il
   y a justement une frontière de mot entre le « 2 » et le « / » de « !1/2 ».
   Sans elle, « #12/03 » consommerait « #12 » et laisserait « /03 » dans le
   titre — un titre mutilé sous les yeux de l'utilisateur, ce que l'aperçu ne
   rattrape pas. Mieux vaut ne rien reconnaître et lui laisser le fragment.
   La ponctuation de fin de phrase est admise comme frontière : « #Santé. »
   doit être reconnu, et le « / » n'en fait pas partie, donc « #12/03 » reste
   écarté. Et surtout pas \b ici : il est ASCII-only en JS, et une étiquette
   accentuée comme « #Santé » n'y satisferait jamais. */
const RE_PRIORITY = /(^|\s)!(haute|urgente?|moyenne|normale|basse|[123])(?=[\s.,!?;:]|$)/iu;
const RE_CATEGORY = /(^|\s)#([\p{L}\p{N}_-]{1,32})(?=[\s.,!?;:]|$)/u;
const RE_IN = /(^|\s)dans\s+(\d{1,3})\s*(jours?|j|semaines?|sem)\b/iu;
const RE_RELATIVE = /(^|\s)(apr[èe]s-demain|demain|aujourd['’]?hui|auj)\b/iu;
const RE_WEEKDAY = /(^|\s)(?:(?:ce|cette)\s+)?(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/iu;
const RE_DATE = /(^|\s)(?:le\s+)?(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/iu;
// seul « à » introduit une heure : accepter « a » nu ferait de « il y a 3h »
// une échéance, alors que c'est la tournure la plus banale du français
const RE_TIME = /(^|\s)(?:à\s*)?(\d{1,2})\s*h\s*([0-5]\d)?\b/iu;

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
    tokens.push({ type, text: text.slice(start, end).trim(), start });
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
    // même forme que ses trois branches sœurs : un `take` refusé doit laisser
    // sa chance au motif suivant, pas abandonner la date en silence
  } else if (mWeekday && take(mWeekday, 'date')) {
    const today = atMidnight(now);
    // « mercredi » un mercredi désigne le mercredi suivant, jamais aujourd'hui
    const delta = (WEEKDAYS[plain(mWeekday[2])] - today.getDay() + 7) % 7 || 7;
    day = addDays(today, delta);
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
    // une étiquette retirée devant un point laisse « Truc . » : on recolle.
    // Uniquement le point et la virgule : « Bravo ! » prend une espace avant
    // le point d'exclamation en français, et il ne faut pas y toucher
    .replace(/\s+([.,])/g, '$1')
    .trim()
    .slice(0, MAX_TITLE);

  // les pastilles se lisent dans l'ordre où l'utilisateur a tapé, pas dans
  // celui où le parseur a reconnu : `start` sert au tri, puis disparaît
  const ordered = tokens
    .sort((a, b) => a.start - b.start)
    .map(({ type, text: label }) => ({ type, text: label }));

  return { title, dueDate, category, priority, tokens: ordered };
}
