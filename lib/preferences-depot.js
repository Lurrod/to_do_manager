/* ---------------------------------------------------------------------------
   Cahier — où vivent les préférences.

   Un seul document, sous une clé fixe. Le schéma Mongo est volontairement
   muet : c'est `lib/preferences.js` qui sait ce qu'un réglage peut valoir, et
   lui seul. Ajouter un réglage ne demande donc aucune migration — un document
   écrit par une version antérieure se relit en retombant sur les défauts.
   --------------------------------------------------------------------------- */

const { normaliserPreferences } = require('./preferences');

/** Clé du document unique. Le cahier est mono-utilisateur : il n'y en a qu'un. */
const CLE = 'reglages';

/**
 * @param {import('mongoose')} mongoose injecté : ce module ne se connecte à rien
 * @returns {{lire: () => Promise<object>, ecrire: (patch: object) => Promise<object>}}
 */
const creerDepotPreferences = (mongoose) => {
  const schema = new mongoose.Schema(
    {
      cle: { type: String, required: true, unique: true },
      valeurs: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    },
    // sans `minimize`, Mongoose efface les sous-objets vides avant d'écrire
    { minimize: false }
  );

  // le module est rechargé d'un test à l'autre ; redéclarer un modèle déjà
  // enregistré lève une OverwriteModelError
  const Modele = mongoose.models.Preference || mongoose.model('Preference', schema);

  const lire = async () => {
    const doc = await Modele.findOne({ cle: CLE }).lean();
    return normaliserPreferences(doc?.valeurs);
  };

  /**
   * Lit, applique le patch, réécrit le document entier.
   *
   * Deux écritures simultanées se marcheraient dessus — acceptable ici : le
   * Cahier est mono-utilisateur, et une instance unique est garantie par le
   * verrou d'Electron.
   */
  const ecrire = async (patch) => {
    const suivantes = normaliserPreferences(patch, await lire());
    await Modele.updateOne({ cle: CLE }, { $set: { valeurs: suivantes } }, { upsert: true });
    return suivantes;
  };

  return { lire, ecrire, Modele };
};

module.exports = { CLE, creerDepotPreferences };
