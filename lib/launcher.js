/* ---------------------------------------------------------------------------
   Cahier — ce que le lanceur a besoin de décider, isolé pour être testé.

   Le reste (démarrer le serveur, attendre, ouvrir la fenêtre) vit dans
   scripts/app.js : c'est de l'orchestration, pas de la logique.
   --------------------------------------------------------------------------- */

const path = require('path');

/**
 * Contrat avec `server.js` : c'est **cette ligne-là** qui annonce l'adresse.
 * Chercher « une URL quelque part » attraperait aussi les messages d'erreur
 * qui en citent une.
 */
const LIGNE_DEMARRAGE = /^Serveur démarré sur (https?:\/\/[^\s]+)$/m;

/**
 * Navigateurs capables d'ouvrir une fenêtre sans barre d'adresse (`--app=`),
 * par ordre de préférence. Edge est présent sur toute machine Windows récente,
 * ce qui en fait le repli le plus sûr.
 */
const NAVIGATEURS = [
  path.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Google\\Chrome\\Application\\chrome.exe'
  ),
  path.join(
    process.env.ProgramFiles || 'C:\\Program Files',
    'Google\\Chrome\\Application\\chrome.exe'
  ),
  path.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft\\Edge\\Application\\msedge.exe'
  ),
];

/**
 * Extrait l'adresse d'écoute d'une ligne de sortie du serveur.
 * @param {string} ligne
 * @returns {string|null} l'adresse, ou null si ce n'est pas la ligne attendue
 */
const parseServerUrl = (ligne) => {
  const trouve = LIGNE_DEMARRAGE.exec(String(ligne || ''));
  return trouve ? trouve[1] : null;
};

/**
 * Premier navigateur installé parmi ceux qui savent ouvrir une fenêtre nue.
 * @param {(chemin: string) => boolean} existe injecté pour les tests
 * @returns {string|null} null si aucun : on retombera sur le navigateur par
 *   défaut du système, avec sa barre d'adresse
 */
const pickBrowser = (existe) => NAVIGATEURS.find((chemin) => existe(chemin)) || null;

module.exports = { LIGNE_DEMARRAGE, NAVIGATEURS, parseServerUrl, pickBrowser };
