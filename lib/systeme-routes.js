/* ---------------------------------------------------------------------------
   Cahier — ce que la page a le droit de savoir de la machine, et les trois
   gestes qu'elle peut demander au processus principal.

   L'état de la mise à jour est reçu en argument : ces routes ne connaissent ni
   Electron ni electron-updater, et les tests n'ouvrent aucune fenêtre.
   --------------------------------------------------------------------------- */

const express = require('express');

/**
 * L'API n'a aucune authentification : n'importe quelle page ouverte dans un
 * navigateur du poste peut lui poster une requête. Elle ne pourra pas en lire
 * la réponse (pas d'en-tête CORS), mais elle n'a pas besoin de la lire pour
 * déclencher un redémarrage. D'où ce garde-fou sur les seules actions.
 *
 * Une requête sans `Origin` n'est pas une requête de navigateur inter-origine :
 * on la laisse passer, sans quoi curl et les tests seraient bloqués pour rien.
 */
const origineEtrangere = (req, origineAutorisee) => {
  const origine = req.get('Origin');
  if (!origine) return false;
  if (origineAutorisee && origine === origineAutorisee) return false;
  return origine !== `${req.protocol}://${req.get('Host')}`;
};

/**
 * @param {object} options
 * @param {ReturnType<import('./maj-etat').creerEtatMaj>} options.etat
 * @param {string} options.version version courante du Cahier
 * @param {string} options.dossierDonnees où vivent les données de l'utilisateur
 * @param {string} [options.origineAutorisee] `CORS_ORIGIN`, quand un client
 *   externe a été ouvert explicitement
 * @param {{warn: Function}} [options.journal]
 * @returns {import('express').Router}
 */
const creerRoutesSysteme = ({
  etat,
  version,
  dossierDonnees,
  origineAutorisee = null,
  journal = console,
}) => {
  const routeur = express.Router();

  const etatComplet = () => ({ version, dossierDonnees, maj: etat.lire() });

  routeur.get('/', (req, res) => {
    res.json(etatComplet());
  });

  /**
   * Enveloppe commune aux trois actions : garde d'origine, refus propre quand
   * la mise à jour n'est pas active ici, et journalisation de l'imprévu.
   */
  const action = (nom, faire) => async (req, res) => {
    if (origineEtrangere(req, origineAutorisee)) {
      return res.status(403).json({ error: 'Origine non autorisée.' });
    }

    try {
      const fait = await faire();
      if (!fait) {
        return res.status(409).json({
          error: 'La mise à jour automatique ne s’applique pas à cette installation.',
        });
      }
      res.json(etatComplet());
    } catch (erreur) {
      journal.warn(`Mise à jour — ${nom} : ${erreur?.message || erreur}`);
      res.status(500).json({ error: 'L’opération n’a pas abouti.' });
    }
  };

  routeur.post(
    '/maj/chercher',
    action('recherche', () => etat.chercher())
  );

  routeur.post(
    '/maj/installer',
    action('installation', () => etat.installer())
  );

  routeur.post(
    '/maj/reporter',
    action('report', () => {
      // « plus tard » ne demande rien au processus principal : c'est une note
      // prise dans l'état. Sans rien de prêt, c'est sans effet — et sans
      // erreur : rien ne justifie de refuser un geste devenu inutile.
      etat.reporter();
      return true;
    })
  );

  return routeur;
};

module.exports = { creerRoutesSysteme };
