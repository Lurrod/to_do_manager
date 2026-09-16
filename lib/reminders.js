/* ---------------------------------------------------------------------------
   Cahier — rappels : quand prévenir, et avec quel texte.
   Fonctions pures : ni base, ni horloge, ni système.
   --------------------------------------------------------------------------- */

/** Écarts proposés, et ce qu'ils retirent à l'échéance. */
const OFFSETS = {
  atDue: 0,
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

/**
 * Au-delà, un rappel ne rappelle plus rien : il est marqué envoyé sans rien
 * afficher, plutôt que d'encombrer le rattrapage du démarrage.
 */
const RETARD_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/** Nombre de titres cités dans une notification groupée avant de compter le reste. */
const MAX_TITRES = 5;

/**
 * Heure à laquelle le rappel doit partir.
 * @param {Date|string|null} dueDate
 * @param {string} offset `atDue`, `1h`, `1d`, ou vide
 * @returns {Date|null} null s'il n'y a pas d'ancrage ou pas de réglage
 */
const remindAtFor = (dueDate, offset) => {
  if (!dueDate || !offset || !Object.hasOwn(OFFSETS, offset)) return null;
  return new Date(new Date(dueDate).getTime() - OFFSETS[offset]);
};

/**
 * Texte d'une notification qui porte sur plusieurs tâches.
 * Citer tous les titres produirait un pavé qu'on ferme sans lire.
 * @param {{title: string}[]} tasks
 * @returns {string}
 */
const messageGroupe = (tasks) => {
  const titres = tasks.map((t) => t.title);
  if (titres.length <= MAX_TITRES) return titres.join(' · ');

  const reste = titres.length - MAX_TITRES;
  return `${titres.slice(0, MAX_TITRES).join(' · ')} · et ${reste} autre${reste > 1 ? 's' : ''}`;
};

module.exports = { OFFSETS, RETARD_MAX_MS, MAX_TITRES, remindAtFor, messageGroupe };
