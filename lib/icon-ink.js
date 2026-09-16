/* ---------------------------------------------------------------------------
   Cahier — mesure ce qu'une icône contient réellement.

   Les icônes livrées avec la 2.0.0 étaient des canevas blancs : le générateur
   n'avait pas réussi à charger le dessin, et personne ne l'a vu avant que
   l'installeur ne soit distribué. Une icône vide a une signature mesurable —
   c'est ce module qui la reconnaît, et `scripts/make-icons.js` refuse d'écrire
   quand elle apparaît.

   Ici, pas d'Electron : une fonction sur des octets, testable seule.
   --------------------------------------------------------------------------- */

/**
 * En dessous, on considère qu'il n'y a pas de dessin.
 *
 * Les deux mesures qui encadrent ce seuil ont été relevées sur les icônes
 * réelles : 0,86 % pour le rendu cassé, 82,5 % pour le rendu réparé. À 2 %, il
 * y a de la marge des deux côtés, y compris pour un logo volontairement fin.
 */
const SEUIL_ENCRE = 0.02;

/**
 * Proportion de pixels visibles et non blancs.
 *
 * @param {Buffer} bitmap pixels en BGRA, 8 bits par canal (format `toBitmap()`)
 * @param {number} largeur
 * @param {number} hauteur
 * @returns {number} entre 0 (vide) et 1 (entièrement encré)
 */
const proportionEncree = (bitmap, largeur, hauteur) => {
  let encres = 0;
  for (let i = 0; i < bitmap.length; i += 4) {
    const alpha = bitmap[i + 3];
    // un pixel presque blanc ne dessine rien : c'est le fond, pas le trait
    const clair = bitmap[i] > 245 && bitmap[i + 1] > 245 && bitmap[i + 2] > 245;
    if (alpha > 8 && !clair) encres += 1;
  }
  return encres / (largeur * hauteur);
};

module.exports = { SEUIL_ENCRE, proportionEncree };
