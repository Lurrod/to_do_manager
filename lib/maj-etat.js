/* ---------------------------------------------------------------------------
   Cahier — l'état de la mise à jour, partagé entre le processus principal et
   la page.

   Le problème que ce module résout : c'est Electron qui sait où en est la mise
   à jour, et c'est la page qui doit le dire à l'utilisateur. Or la fenêtre est
   bridée (`nodeIntegration: false`, aucun préchargement privilégié) et ne peut
   rien recevoir du processus principal.

   Mais le serveur Express tourne DANS ce processus. Il suffit donc d'un état
   posé ici, écrit par l'updater et lu par une route. Aucun pont Node n'est
   ouvert vers la page : elle ne voit qu'une réponse JSON de plus.
   --------------------------------------------------------------------------- */

/** Les étapes de la vie d'une mise à jour, telles que la page les lit. */
const ETAPES = {
  /** Pas d'application empaquetée : il n'existe aucune version à comparer. */
  INACTIVE: 'inactive',
  /** Rien en cours, rien de prêt. */
  REPOS: 'repos',
  RECHERCHE: 'recherche',
  TELECHARGEMENT: 'telechargement',
  /** Sur le disque, en attente d'un redémarrage. */
  PRETE: 'prete',
  /** Prête, mais l'utilisateur a demandé à finir d'abord. */
  REPORTEE: 'reportee',
  ECHEC: 'echec',
};

const DEPART = {
  etape: ETAPES.INACTIVE,
  /** Version prête ou en cours de téléchargement, jamais la version courante. */
  version: null,
  progression: 0,
  message: null,
  derniereRecherche: null,
};

/**
 * @param {{maintenant?: () => Date}} [options] horloge injectée, pour que les
 *   tests n'aient pas à composer avec l'heure réelle
 */
const creerEtatMaj = ({ maintenant = () => new Date() } = {}) => {
  let etat = { ...DEPART };
  /** Ce que seul le processus principal sait faire. Absent hors Electron. */
  let actions = null;

  const lire = () => ({ ...etat });

  const poser = (patch) => {
    etat = { ...etat, ...patch };
    return lire();
  };

  /**
   * Branche ce que seul le processus principal sait faire.
   *
   * Brancher, c'est devenir actif : l'étape quitte `INACTIVE` sur-le-champ,
   * sans attendre la première réponse du réseau. `INACTIVE` est le seul état
   * qu'une page lit comme définitif — « il n'y aura jamais rien à chercher
   * ici » — et sur lequel elle range le bandeau et cesse d'interroger. Une
   * application installée met une à deux secondes à recevoir le premier
   * événement de l'updater ; l'annoncer inactive pendant ce temps, c'est
   * exactement le temps que met la page à se charger et à le lire.
   */
  const brancher = (nouvelles) => {
    actions = nouvelles;
    poser({ etape: ETAPES.RECHERCHE });
  };

  /**
   * Relance une recherche.
   * @returns {Promise<boolean>} false si la mise à jour n'est pas active ici
   */
  const chercher = async () => {
    if (!actions) return false;
    poser({ derniereRecherche: maintenant().toISOString() });
    // hors ligne, `checkForUpdates` rejette — c'est un état normal pour une
    // application locale, et l'événement `error` de l'updater l'a déjà dit
    await Promise.resolve(actions.chercher()).catch(() => {});
    return true;
  };

  /**
   * Redémarre et pose la version téléchargée.
   * @returns {Promise<boolean>} false si la mise à jour n'est pas active ici
   */
  const installer = async () => {
    if (!actions) return false;
    await actions.installer();
    return true;
  };

  /**
   * « Plus tard ». L'état s'en souvient pour que le bandeau ne revienne pas à
   * chaque interrogation — la version se posera à la fermeture.
   */
  const reporter = () => {
    if (etat.etape !== ETAPES.PRETE) return lire();
    return poser({ etape: ETAPES.REPORTEE });
  };

  return { lire, poser, brancher, chercher, installer, reporter };
};

module.exports = { ETAPES, creerEtatMaj };
