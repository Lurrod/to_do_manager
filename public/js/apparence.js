/* ---------------------------------------------------------------------------
   Cahier — l'apparence, posée sur la racine du document.

   Chaque réglage devient un attribut `data-…` que le CSS lit. Une seule
   exception : les traits au crayon ne sont pas du CSS mais des SVG attachés
   par drawably — il faut le dire à `sketch.js`, d'où le rappel injecté.

   Un miroir dans le stockage local permet de reposer l'apparence AVANT la
   réponse du serveur. Sans lui, la page s'ouvrirait en « confort » puis
   sauterait en « compact » une fraction de seconde plus tard. Ce miroir n'est
   qu'un cache d'affichage : la vérité reste dans la base, et un stockage
   refusé (navigation privée) ne coûte que ce clignotement.
   --------------------------------------------------------------------------- */

/** Clé du miroir. Préfixée : le stockage est partagé avec toute l'origine. */
const CLE_MEMOIRE = 'cahier.apparence';

/** Ce qui se dit par un attribut, et comment. */
const ATTRIBUTS = {
  densite: (valeur) => valeur,
  taille: (valeur) => valeur,
  // « on » plutôt que rien : un attribut absent ne se distingue pas d'un oubli
  grain: (valeur) => (valeur ? 'on' : 'off'),
  crayon: (valeur) => (valeur ? 'on' : 'off'),
};

const poserAttributs = (apparence, racine) => {
  Object.entries(ATTRIBUTS).forEach(([nom, dire]) => {
    if (apparence[nom] === undefined) return;
    racine.dataset[nom] = dire(apparence[nom]);
  });
};

/**
 * Applique l'apparence et la retient pour le prochain lancement.
 *
 * @param {object|null} apparence la section « apparence » des réglages
 * @param {object} deps
 * @param {HTMLElement} [deps.racine]
 * @param {Storage} [deps.memoire]
 * @param {(actif: boolean) => void} deps.poserCrayon
 */
export const appliquerApparence = (
  apparence,
  { racine = document.documentElement, memoire = globalThis.localStorage, poserCrayon }
) => {
  if (!apparence) return;

  poserAttributs(apparence, racine);
  if (apparence.crayon !== undefined) poserCrayon(apparence.crayon);

  try {
    memoire?.setItem(CLE_MEMOIRE, JSON.stringify(apparence));
  } catch {
    // stockage refusé ou plein : l'apparence est posée, c'est l'essentiel.
    // Elle sera simplement redemandée au serveur au prochain lancement.
  }
};

/**
 * Repose l'apparence du dernier lancement, avant toute réponse du serveur.
 *
 * @returns {object|null} ce qui a été reposé, ou null au premier lancement
 */
export const restaurerApparence = ({
  racine = document.documentElement,
  memoire = globalThis.localStorage,
  poserCrayon,
}) => {
  let apparence = null;

  try {
    const brut = memoire?.getItem(CLE_MEMOIRE);
    apparence = brut ? JSON.parse(brut) : null;
  } catch {
    // stockage inaccessible, ou contenu qui n'est plus du JSON : on n'en sait
    // pas plus qu'au premier lancement, et ce n'est pas un incident
    return null;
  }

  if (!apparence || typeof apparence !== 'object') return null;

  poserAttributs(apparence, racine);
  if (apparence.crayon !== undefined) poserCrayon(apparence.crayon);

  return apparence;
};

export { CLE_MEMOIRE };
