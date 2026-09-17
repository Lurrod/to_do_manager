/* ---------------------------------------------------------------------------
   Cahier — les deux routes des préférences.

   Le dépôt est reçu en argument : ces routes ne savent pas où les réglages
   sont rangés, et les tests n'ouvrent aucune connexion.
   --------------------------------------------------------------------------- */

const express = require('express');

const { SCHEMA, SECTIONS } = require('./preferences');

const estObjet = (valeur) =>
  typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur);

/**
 * @param {object} options
 * @param {{lire: () => Promise<object>, ecrire: (patch: object) => Promise<object>}} options.depot
 * @param {{warn: Function}} [options.journal]
 * @returns {import('express').Router}
 */
const creerRoutesPreferences = ({ depot, journal = console }) => {
  const routeur = express.Router();

  /**
   * Une panne de base ne doit pas renvoyer son message au client : il nomme
   * l'hôte, le port, parfois le chemin du dossier de données.
   */
  const echec = (res, erreur, quoi) => {
    journal.warn(`Préférences — ${quoi} : ${erreur?.message || erreur}`);
    res.status(500).json({ error: 'Les réglages n’ont pas pu être atteints.' });
  };

  /**
   * La description des réglages, pour que la page Réglages se construise à
   * partir d'elle plutôt que de redupliquer la liste côté client. Un réglage
   * ajouté dans `lib/preferences.js` paraît dans la page sans autre geste.
   */
  routeur.get('/schema', (req, res) => {
    res.json({ sections: SECTIONS, schema: SCHEMA });
  });

  routeur.get('/', async (req, res) => {
    try {
      res.json(await depot.lire());
    } catch (erreur) {
      echec(res, erreur, 'lecture');
    }
  });

  routeur.put('/', async (req, res) => {
    // un tableau ou une chaîne passerait la normalisation en silence, en
    // rendant simplement les défauts : mieux vaut le dire que le subir
    if (!estObjet(req.body)) {
      return res.status(400).json({ error: 'Le corps doit être un objet de réglages.' });
    }

    try {
      res.json(await depot.ecrire(req.body));
    } catch (erreur) {
      echec(res, erreur, 'écriture');
    }
  });

  return routeur;
};

module.exports = { creerRoutesPreferences };
