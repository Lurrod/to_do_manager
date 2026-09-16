/* ---------------------------------------------------------------------------
   Cahier — récurrence : à quelle date revient une tâche qu'on vient de cocher.
   Fonction pure, sans base ni horloge : la date de départ est toujours donnée.
   --------------------------------------------------------------------------- */

const FREQUENCES = ['daily', 'weekly', 'monthly'];

/** Nombre de jours du mois visé, pour ne pas déborder sur le suivant. */
const dernierJourDuMois = (annee, mois) => new Date(annee, mois + 1, 0).getDate();

/**
 * Échéance suivante d'une tâche récurrente.
 *
 * Le calcul part de l'échéance **précédente**, jamais de la date de
 * complétion : sinon une hebdomadaire cochée avec trois jours de retard
 * replanifierait sur le vendredi, et « tous les mardis » dériverait à chaque
 * retard.
 *
 * @param {Date|string|null} depart échéance de l'occurrence qu'on vient de cocher
 * @param {{freq: string, interval: number, until: Date|string|null}} recurrence
 * @returns {Date|null} la date suivante, ou null s'il n'y a pas de suite
 *   (pas de récurrence, pas d'échéance de départ, fréquence inconnue, ou
 *   série arrivée au bout de `until`)
 */
const nextDueDate = (depart, recurrence) => {
  if (!depart || !recurrence || !FREQUENCES.includes(recurrence.freq)) return null;

  const pas = Math.max(1, Math.min(99, Number(recurrence.interval) || 1));
  const suite = new Date(depart);

  if (recurrence.freq === 'daily') {
    suite.setDate(suite.getDate() + pas);
  } else if (recurrence.freq === 'weekly') {
    suite.setDate(suite.getDate() + 7 * pas);
  } else {
    // `setMonth` déborde en silence : le 31 janvier + 1 mois donnerait le
    // 3 mars. On vise le mois, puis on rabat le quantième sur sa fin.
    const quantieme = suite.getDate();
    suite.setDate(1);
    suite.setMonth(suite.getMonth() + pas);
    suite.setDate(Math.min(quantieme, dernierJourDuMois(suite.getFullYear(), suite.getMonth())));
  }

  if (recurrence.until && suite > new Date(recurrence.until)) return null;

  return suite;
};

module.exports = { FREQUENCES, nextDueDate };
