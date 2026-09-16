/* ---------------------------------------------------------------------------
   Cahier — étiquettes : normalisation. Fonction pure, appliquée à l'écriture.

   Normaliser à la lecture obligerait chaque filtre et chaque compteur à
   refaire le travail, et « Maison » ne retrouverait jamais « maison ».
   --------------------------------------------------------------------------- */

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 24;

/**
 * Ramène une liste d'étiquettes à sa forme canonique : minuscules, rognées,
 * dédoublonnées, bornées.
 *
 * Ce qui est vide ou mal typé est **écarté en silence** plutôt que refusé :
 * une virgule en trop dans une saisie n'est pas une intention mal formée, et
 * faire échouer toute la tâche pour ça serait disproportionné.
 *
 * @param {unknown} valeur
 * @returns {string[]}
 */
const normalizeTags = (valeur) => {
  if (!Array.isArray(valeur)) return [];

  const vues = new Set();
  const gardees = [];

  for (const brute of valeur) {
    if (typeof brute !== 'string') continue;
    const propre = brute.trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (propre === '' || vues.has(propre)) continue;
    vues.add(propre);
    gardees.push(propre);
    if (gardees.length === MAX_TAGS) break;
  }

  return gardees;
};

module.exports = { MAX_TAGS, MAX_TAG_LENGTH, normalizeTags };
