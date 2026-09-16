const { configurerMisesAJour } = require('../../lib/updates');

/** Un faux electron-updater : on déclenche ses événements à la main. */
const fauxUpdater = () => {
  const ecouteurs = {};
  return {
    autoDownload: null,
    autoInstallOnAppQuit: null,
    installe: 0,
    recherches: 0,
    on(evenement, rappel) {
      ecouteurs[evenement] = rappel;
      return this;
    },
    async emettre(evenement, ...args) {
      return ecouteurs[evenement] ? ecouteurs[evenement](...args) : undefined;
    },
    checkForUpdates() {
      this.recherches += 1;
      return Promise.resolve(null);
    },
    quitAndInstall() {
      this.installe += 1;
    },
  };
};

const fauxDialog = (reponse) => ({
  appels: [],
  showMessageBox(options) {
    this.appels.push(options);
    return Promise.resolve({ response: reponse });
  },
});

const journalMuet = { warn: () => {}, log: () => {} };

describe('configurerMisesAJour', () => {
  test('ne cherche rien hors application empaquetée', () => {
    const updater = fauxUpdater();

    const arme = configurerMisesAJour({
      updater,
      dialog: fauxDialog(0),
      enPaquet: false,
      journal: journalMuet,
    });

    // en développement il n'y a pas de version publiée à comparer : chercher
    // ne produirait qu'une erreur à chaque `npm run desktop`
    expect(arme).toBe(false);
    expect(updater.recherches).toBe(0);
  });

  test('télécharge en fond sans rien demander à l’utilisateur', async () => {
    const updater = fauxUpdater();
    const dialog = fauxDialog(0);

    configurerMisesAJour({ updater, dialog, enPaquet: true, journal: journalMuet });
    await updater.emettre('update-available', { version: '2.1.0' });

    expect(updater.autoDownload).toBe(true);
    expect(updater.recherches).toBe(1);
    // trouver une version n'est pas un événement pour qui écrit sa liste
    expect(dialog.appels).toHaveLength(0);
  });

  test('une panne de réseau ne dérange jamais l’utilisateur', async () => {
    const updater = fauxUpdater();
    const dialog = fauxDialog(0);
    const avertissements = [];

    configurerMisesAJour({
      updater,
      dialog,
      enPaquet: true,
      journal: { warn: (m) => avertissements.push(m) },
    });
    await updater.emettre('error', new Error('getaddrinfo ENOTFOUND github.com'));

    // le Cahier fonctionne hors ligne : ne pas savoir s'il existe une mise à
    // jour est un état normal, pas un incident
    expect(dialog.appels).toHaveLength(0);
    expect(avertissements).toHaveLength(1);
  });

  test('une recherche qui échoue ne laisse pas de rejet non capturé', async () => {
    const updater = fauxUpdater();
    updater.checkForUpdates = () => Promise.reject(new Error('hors ligne'));

    expect(() =>
      configurerMisesAJour({
        updater,
        dialog: fauxDialog(0),
        enPaquet: true,
        journal: journalMuet,
      })
    ).not.toThrow();

    await new Promise((resolve) => setImmediate(resolve));
  });

  test('« Redémarrer maintenant » relâche la base avant d’installer', async () => {
    const updater = fauxUpdater();
    const ordre = [];

    configurerMisesAJour({
      updater,
      dialog: fauxDialog(0),
      enPaquet: true,
      journal: journalMuet,
      arreterServices: async () => ordre.push('arret'),
    });
    await updater.emettre('update-downloaded', { version: '2.1.0' });

    // installer sans relâcher le verrou WiredTiger laisserait la base
    // inutilisable au redémarrage
    expect(ordre).toEqual(['arret']);
    expect(updater.installe).toBe(1);
  });

  test('un arrêt des services qui échoue n’installe rien, et le dit', async () => {
    const updater = fauxUpdater();
    const dialog = fauxDialog(0);
    const avertissements = [];

    configurerMisesAJour({
      updater,
      dialog,
      enPaquet: true,
      journal: { warn: (m) => avertissements.push(m) },
      arreterServices: async () => {
        throw new Error('mongod ne répond pas');
      },
    });
    await updater.emettre('update-downloaded', { version: '2.1.0' });

    // installer pendant que Mongo tient encore son verrou laisserait la base
    // inaccessible à la version suivante
    expect(updater.installe).toBe(0);
    expect(avertissements).toHaveLength(1);
    // et surtout : ne pas laisser l'utilisateur devant un bouton sans effet
    expect(dialog.appels).toHaveLength(2);
    expect(dialog.appels[1].detail).toContain('fermeture');
  });

  test('une erreur qui n’est pas une Error reste lisible dans le journal', async () => {
    const updater = fauxUpdater();
    const avertissements = [];

    configurerMisesAJour({
      updater,
      dialog: fauxDialog(0),
      enPaquet: true,
      journal: { warn: (m) => avertissements.push(m) },
    });
    await updater.emettre('error', 'ECONNRESET');

    expect(avertissements[0]).toContain('ECONNRESET');
  });

  test('« Plus tard » n’installe rien tout de suite', async () => {
    const updater = fauxUpdater();

    configurerMisesAJour({
      updater,
      dialog: fauxDialog(1),
      enPaquet: true,
      journal: journalMuet,
    });
    await updater.emettre('update-downloaded', { version: '2.1.0' });

    expect(updater.installe).toBe(0);
    // le report ne perd pas la mise à jour : elle se pose à la fermeture
    expect(updater.autoInstallOnAppQuit).toBe(true);
  });

  test('une version manquante ne casse pas la boîte', async () => {
    const updater = fauxUpdater();
    const dialog = fauxDialog(1);

    configurerMisesAJour({ updater, dialog, enPaquet: true, journal: journalMuet });
    // electron-updater ne garantit pas la forme de l'objet transmis
    await updater.emettre('update-downloaded', undefined);

    expect(dialog.appels).toHaveLength(1);
    expect(dialog.appels[0].message).toContain('nouvelle');
  });

  test('sans fonction d’arrêt fournie, l’installation se fait quand même', async () => {
    const updater = fauxUpdater();

    // le défaut existe pour que l'appelant puisse s'en passer : il doit marcher
    configurerMisesAJour({ updater, dialog: fauxDialog(0), enPaquet: true, journal: journalMuet });
    await updater.emettre('update-downloaded', { version: '2.1.0' });

    expect(updater.installe).toBe(1);
  });

  test('la boîte nomme la version proposée', async () => {
    const updater = fauxUpdater();
    const dialog = fauxDialog(1);

    configurerMisesAJour({ updater, dialog, enPaquet: true, journal: journalMuet });
    await updater.emettre('update-downloaded', { version: '2.1.0' });

    expect(JSON.stringify(dialog.appels[0])).toContain('2.1.0');
  });
});
