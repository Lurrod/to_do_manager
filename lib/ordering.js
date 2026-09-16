/* ---------------------------------------------------------------------------
   Cahier — ordre manuel : indexation fractionnaire.

   Déposer entre deux voisines donne le rang moyen des deux : une seule
   écriture, au lieu d'en faire autant que la liste compte de tâches.
   --------------------------------------------------------------------------- */

/** Écart posé en bout de liste, et pas de la renumérotation complète. */
const STEP = 1024;

/**
 * Seuil en dessous duquel couper encore l'intervalle n'a plus de sens : les
 * flottants n'ont plus assez de précision, et deux tâches finiraient par
 * partager le même rang.
 */
const MIN_GAP = 1e-6;

/** Renvoyé quand la liste doit être renumérotée avant de pouvoir insérer. */
const NEEDS_RENUMBER = Symbol('renumber');

/**
 * Rang à donner à une tâche déposée entre deux voisines.
 * @param {number|null} avant rang de la voisine du dessus, null en tête de liste
 * @param {number|null} apres rang de la voisine du dessous, null en fin de liste
 * @returns {number|symbol} le rang, ou NEEDS_RENUMBER si l'intervalle est épuisé
 */
const rankBetween = (avant, apres) => {
  if (avant === null || avant === undefined) {
    return apres === null || apres === undefined ? 0 : apres - STEP;
  }
  if (apres === null || apres === undefined) return avant + STEP;

  // un encadrement incohérent n'est pas devinable : on renumérote plutôt que
  // de poser un rang au hasard
  if (apres - avant < MIN_GAP) return NEEDS_RENUMBER;

  return (avant + apres) / 2;
};

/**
 * Rangs réguliers pour une liste entière, dans l'ordre donné.
 * @param {string[]} ids
 * @returns {{_id: string, order: number}[]}
 */
const renumber = (ids) => ids.map((_id, index) => ({ _id, order: index * STEP }));

module.exports = { STEP, MIN_GAP, NEEDS_RENUMBER, rankBetween, renumber };
