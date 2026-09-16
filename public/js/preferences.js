/* ---------------------------------------------------------------------------
   Cahier — les réglages, côté page.

   Un seul endroit détient les valeurs courantes ; tout ce qui doit réagir à un
   changement s'y abonne. La page Réglages écrit, l'apparence et l'ouverture
   lisent, et personne ne demande deux fois la même chose au serveur.

   Le transport est injecté : ce module ne connaît pas `fetch`.
   --------------------------------------------------------------------------- */

/**
 * @param {object} deps
 * @param {() => Promise<object>} deps.lire `GET /preferences`
 * @param {(patch: object) => Promise<object>} deps.ecrire `PUT /preferences`
 */
export const initPreferences = ({ lire, ecrire }) => {
  /** null tant que rien n'a été chargé : ne pas inventer ce qu'on ne sait pas. */
  let valeurs = null;
  const abonnes = [];

  const prevenir = () => abonnes.forEach((abonne) => abonne(valeurs));

  const poser = (suivantes) => {
    valeurs = suivantes;
    prevenir();
  };

  /** Fusion section par section : un patch ne parle jamais de tout. */
  const fusionner = (base, patch) =>
    Object.fromEntries(
      Object.entries(base).map(([section, reglages]) => [
        section,
        { ...reglages, ...(patch[section] || {}) },
      ])
    );

  /**
   * @returns {Promise<object|null>} null si le serveur n'a pas répondu — la
   *   page s'ouvre quand même, avec l'apparence par défaut du CSS
   */
  const charger = async () => {
    try {
      poser(await lire());
      return valeurs;
    } catch {
      return null;
    }
  };

  /**
   * Applique le patch tout de suite, puis l'enregistre.
   *
   * L'écran ne doit pas attendre l'aller-retour pour changer. Mais si
   * l'enregistrement échoue, il revient à l'état d'avant : laisser l'affichage
   * en avance sur ce qui est écrit serait mentir à l'utilisateur.
   *
   * @throws {Error} l'erreur du serveur, pour que l'appelant l'annonce
   */
  const regler = async (patch) => {
    const avant = valeurs;
    poser(fusionner(valeurs, patch));

    try {
      // le serveur a le dernier mot : il retombe sur le défaut pour une valeur
      // qu'il ne reconnaît pas, et c'est ce document-là qui fait foi
      poser(await ecrire(patch));
      return valeurs;
    } catch (erreur) {
      poser(avant);
      throw erreur;
    }
  };

  const surChangement = (abonne) => {
    abonnes.push(abonne);
    return () => abonnes.splice(abonnes.indexOf(abonne), 1);
  };

  return { charger, valeurs: () => valeurs, regler, surChangement };
};
