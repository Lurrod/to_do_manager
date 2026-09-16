/* ---------------------------------------------------------------------------
   Cahier — la mise à jour automatique, isolée pour être testée.

   Tout ce qui vient d'Electron (l'updater, les boîtes de dialogue, l'arrêt des
   services) est reçu en argument : ce fichier ne charge rien et les tests
   n'ouvrent ni fenêtre ni connexion.

   Deux principes gouvernent ce module :
     — une mise à jour ne doit jamais interrompre quelqu'un qui écrit ;
     — ne pas savoir s'il en existe une est un état normal, pas une erreur : le
       Cahier est une application locale, souvent lancée hors ligne.
   --------------------------------------------------------------------------- */

/** Rang du bouton « Redémarrer maintenant » dans la boîte ci-dessous. */
const REDEMARRER = 0;

/**
 * Arme la recherche et la pose des mises à jour.
 *
 * Le téléchargement se fait en fond, sans rien demander ; l'utilisateur n'est
 * sollicité qu'une fois, quand la version est déjà sur le disque et que le
 * redémarrage ne coûte que quelques secondes. S'il décline, `autoInstallOnAppQuit`
 * la posera à la prochaine fermeture : le report ne perd pas la mise à jour.
 *
 * @param {object} options
 * @param {object} options.updater l'`autoUpdater` d'electron-updater
 * @param {{showMessageBox: Function}} options.dialog
 * @param {boolean} options.enPaquet `app.isPackaged` — seule une application
 *   installée a une version publiée à laquelle se comparer
 * @param {() => Promise<any>} [options.arreterServices] relâche Mongo avant la sortie
 * @param {{warn: Function}} [options.journal]
 * @returns {boolean} true si la recherche a été lancée
 */
const configurerMisesAJour = ({
  updater,
  dialog,
  enPaquet,
  arreterServices = () => Promise.resolve(),
  journal = console,
}) => {
  // en développement, `app.isPackaged` est faux et il n'existe aucune release
  // à comparer : chercher ne produirait qu'une erreur à chaque lancement
  if (!enPaquet) return false;

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;

  updater.on('error', (erreur) => {
    journal.warn(`Mise à jour indisponible : ${erreur?.message || erreur}`);
  });

  updater.on('update-downloaded', async (info) => {
    const version = info?.version || 'nouvelle';
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Redémarrer maintenant', 'Plus tard'],
      defaultId: REDEMARRER,
      cancelId: 1,
      title: 'Cahier',
      message: `La version ${version} est prête.`,
      detail: 'Elle se posera au prochain lancement si vous préférez finir d’abord.',
    });

    if (response !== REDEMARRER) return;

    // Mongo verrouille son dossier de données ; l'installeur ne doit pas
    // trouver un verrou encore tenu, ni la base rester inutilisable ensuite
    try {
      await arreterServices();
    } catch (erreur) {
      // Deux raisons de ne pas installer quand même : mongod tient peut-être
      // encore son verrou, et la version suivante ouvrirait une base bloquée.
      // Rien n'est perdu — `autoInstallOnAppQuit` la posera à la fermeture.
      //
      // Ce rejet doit être attrapé ici : un gestionnaire d'événement ignore la
      // promesse qu'il renvoie. Sans ce filet, le bouton « Redémarrer » ne
      // ferait rien du tout, sans un mot.
      journal.warn(`Arrêt des services impossible : ${erreur?.message || erreur}`);
      await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Entendu'],
        title: 'Cahier',
        message: 'Le redémarrage n’a pas pu se faire maintenant.',
        detail: 'La nouvelle version s’installera à la fermeture du Cahier. Rien n’est perdu.',
      });
      return;
    }

    updater.quitAndInstall();
  });

  // la recherche rejette aussi hors ligne, en plus d'émettre `error` : sans ce
  // filet, le rejet remonterait en `unhandledRejection`
  Promise.resolve(updater.checkForUpdates()).catch(() => {});

  return true;
};

module.exports = { REDEMARRER, configurerMisesAJour };
