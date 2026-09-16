/* ---------------------------------------------------------------------------
   Cahier — la mise à jour automatique, isolée pour être testée.

   Tout ce qui vient d'Electron (l'updater, l'arrêt des services) est reçu en
   argument : ce fichier ne charge rien et les tests n'ouvrent ni fenêtre ni
   connexion.

   Ce module ne montre rien. Il écrit dans l'état partagé (`lib/maj-etat.js`),
   que la page lit par une route ordinaire et rend à sa façon — sur du papier
   crème, avec les mots du Cahier. Une boîte de dialogue Windows au milieu
   d'un cahier tenu à la main était une couture visible ; c'était aussi la
   seule chose de l'application qu'on ne pouvait pas traduire.

   Deux principes gouvernent ce module :
     — une mise à jour ne doit jamais interrompre quelqu'un qui écrit ;
     — ne pas savoir s'il en existe une est un état normal, pas une erreur : le
       Cahier est une application locale, souvent lancée hors ligne.
   --------------------------------------------------------------------------- */

const { ETAPES } = require('./maj-etat');

/**
 * Arme la recherche et la pose des mises à jour.
 *
 * Le téléchargement se fait en fond, sans rien demander. Une fois la version
 * sur le disque, l'état passe à « prête » et plus rien ne bouge : c'est
 * l'utilisateur qui décide, depuis le bandeau de la page. S'il reporte,
 * `autoInstallOnAppQuit` la posera à la prochaine fermeture — le report ne
 * perd pas la mise à jour.
 *
 * @param {object} options
 * @param {object} options.updater l'`autoUpdater` d'electron-updater
 * @param {ReturnType<import('./maj-etat').creerEtatMaj>} options.etat
 * @param {boolean} options.enPaquet `app.isPackaged` — seule une application
 *   installée a une version publiée à laquelle se comparer
 * @param {() => Promise<any>} [options.arreterServices] relâche Mongo avant la sortie
 * @param {{warn: Function}} [options.journal]
 * @returns {boolean} true si la recherche a été lancée
 */
const configurerMisesAJour = ({
  updater,
  etat,
  enPaquet,
  arreterServices = () => Promise.resolve(),
  journal = console,
}) => {
  // en développement, `app.isPackaged` est faux et il n'existe aucune release
  // à comparer : chercher ne produirait qu'une erreur à chaque lancement.
  // L'état reste INACTIVE, ce qui dit à la page de ne rien interroger.
  if (!enPaquet) return false;

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;

  /**
   * Redémarre et pose la version téléchargée.
   *
   * Mongo verrouille son dossier de données ; l'installeur ne doit pas trouver
   * un verrou encore tenu, ni la base rester inutilisable ensuite.
   */
  const installer = async () => {
    try {
      await arreterServices();
    } catch (erreur) {
      // Deux raisons de ne pas installer quand même : mongod tient peut-être
      // encore son verrou, et la version suivante ouvrirait une base bloquée.
      // Rien n'est perdu — `autoInstallOnAppQuit` la posera à la fermeture.
      //
      // Et surtout : ne pas laisser l'utilisateur devant un bouton sans effet.
      journal.warn(`Arrêt des services impossible : ${erreur?.message || erreur}`);
      etat.poser({
        etape: ETAPES.ECHEC,
        message:
          'Le redémarrage n’a pas pu se faire maintenant. La nouvelle version s’installera à la fermeture du Cahier — rien n’est perdu.',
      });
      return;
    }

    updater.quitAndInstall();
  };

  etat.brancher({ chercher: () => updater.checkForUpdates(), installer });

  updater.on('checking-for-update', () => {
    etat.poser({ etape: ETAPES.RECHERCHE });
  });

  updater.on('update-not-available', () => {
    etat.poser({ etape: ETAPES.REPOS, version: null, progression: 0 });
  });

  updater.on('update-available', (info) => {
    etat.poser({ etape: ETAPES.TELECHARGEMENT, version: info?.version || null, progression: 0 });
  });

  updater.on('download-progress', (avancement) => {
    etat.poser({ progression: Math.round(avancement?.percent || 0) });
  });

  updater.on('update-downloaded', (info) => {
    etat.poser({
      etape: ETAPES.PRETE,
      version: info?.version || null,
      progression: 100,
      message: null,
    });
  });

  updater.on('error', (erreur) => {
    journal.warn(`Mise à jour indisponible : ${erreur?.message || erreur}`);

    // une version déjà sur le disque reste installable : une panne survenue
    // après coup ne doit pas retirer le bandeau de sous les doigts de
    // quelqu'un qui allait cliquer
    const { etape } = etat.lire();
    if (etape === ETAPES.PRETE || etape === ETAPES.REPORTEE || etape === ETAPES.ECHEC) return;

    // hors ligne, rien à dire : le Cahier s'utilise sans réseau, et annoncer
    // un échec ferait passer la normale pour un incident
    etat.poser({ etape: ETAPES.REPOS, progression: 0 });
  });

  // la recherche rejette aussi hors ligne, en plus d'émettre `error` : sans ce
  // filet, le rejet remonterait en `unhandledRejection`
  Promise.resolve(updater.checkForUpdates()).catch(() => {});

  return true;
};

module.exports = { configurerMisesAJour };
