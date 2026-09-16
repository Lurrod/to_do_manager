const { ETAPES, creerEtatMaj } = require('../../lib/maj-etat');
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

const journalMuet = { warn: () => {}, log: () => {} };

/** Arme la mise à jour sur un état neuf et rend les deux. */
const armer = (options = {}) => {
  const updater = options.updater || fauxUpdater();
  const etat = options.etat || creerEtatMaj();
  const arme = configurerMisesAJour({
    updater,
    etat,
    enPaquet: true,
    journal: journalMuet,
    ...options,
  });
  return { updater, etat, arme };
};

describe('configurerMisesAJour', () => {
  test('ne cherche rien hors application empaquetée', () => {
    const updater = fauxUpdater();
    const etat = creerEtatMaj();

    const arme = configurerMisesAJour({ updater, etat, enPaquet: false, journal: journalMuet });

    // en développement il n'y a pas de version publiée à comparer : chercher
    // ne produirait qu'une erreur à chaque `npm run desktop`
    expect(arme).toBe(false);
    expect(updater.recherches).toBe(0);
    // la page doit pouvoir dire « la mise à jour ne s'applique pas ici »
    expect(etat.lire().etape).toBe(ETAPES.INACTIVE);
  });

  test('télécharge en fond sans rien demander à l’utilisateur', async () => {
    const { updater, etat } = armer();

    await updater.emettre('update-available', { version: '2.1.0' });

    expect(updater.autoDownload).toBe(true);
    expect(updater.recherches).toBe(1);
    // trouver une version n'est pas un événement pour qui écrit sa liste :
    // rien ne s'ouvre, l'état note simplement que ça descend
    expect(etat.lire()).toMatchObject({ etape: ETAPES.TELECHARGEMENT, version: '2.1.0' });
  });

  test('l’état suit la recherche et son issue', async () => {
    const { updater, etat } = armer();

    await updater.emettre('checking-for-update');
    expect(etat.lire().etape).toBe(ETAPES.RECHERCHE);

    await updater.emettre('update-not-available');
    expect(etat.lire().etape).toBe(ETAPES.REPOS);
  });

  test('la progression du téléchargement est publiée, arrondie', async () => {
    const { updater, etat } = armer();

    await updater.emettre('download-progress', { percent: 42.7 });

    expect(etat.lire().progression).toBe(43);
  });

  test('une version téléchargée attend l’utilisateur au lieu de s’installer', async () => {
    const { updater, etat } = armer();

    await updater.emettre('update-downloaded', { version: '2.1.0' });

    // rien ne redémarre tant que personne ne l'a demandé : le Cahier ne coupe
    // jamais la parole à quelqu'un qui écrit
    expect(updater.installe).toBe(0);
    expect(etat.lire()).toMatchObject({
      etape: ETAPES.PRETE,
      version: '2.1.0',
      progression: 100,
    });
  });

  test('installer relâche la base avant de redémarrer', async () => {
    const ordre = [];
    const { updater, etat } = armer({ arreterServices: async () => ordre.push('arret') });
    await updater.emettre('update-downloaded', { version: '2.1.0' });

    await etat.installer();

    // installer sans relâcher le verrou WiredTiger laisserait la base
    // inutilisable au redémarrage
    expect(ordre).toEqual(['arret']);
    expect(updater.installe).toBe(1);
  });

  test('un arrêt des services qui échoue n’installe rien, et le dit dans l’état', async () => {
    const avertissements = [];
    const { updater, etat } = armer({
      journal: { warn: (m) => avertissements.push(m) },
      arreterServices: async () => {
        throw new Error('mongod ne répond pas');
      },
    });
    await updater.emettre('update-downloaded', { version: '2.1.0' });

    await etat.installer();

    // installer pendant que Mongo tient encore son verrou laisserait la base
    // inaccessible à la version suivante
    expect(updater.installe).toBe(0);
    expect(avertissements).toHaveLength(1);
    // et surtout : ne pas laisser l'utilisateur devant un bouton sans effet
    expect(etat.lire().etape).toBe(ETAPES.ECHEC);
    expect(etat.lire().message).toContain('fermeture');
  });

  test('sans fonction d’arrêt fournie, l’installation se fait quand même', async () => {
    // le défaut existe pour que l'appelant puisse s'en passer : il doit marcher
    const { updater, etat } = armer();
    await updater.emettre('update-downloaded', { version: '2.1.0' });

    await etat.installer();

    expect(updater.installe).toBe(1);
  });

  test('une panne de réseau ne dérange jamais l’utilisateur', async () => {
    const avertissements = [];
    const { updater, etat } = armer({ journal: { warn: (m) => avertissements.push(m) } });

    await updater.emettre('error', new Error('getaddrinfo ENOTFOUND github.com'));

    // le Cahier fonctionne hors ligne : ne pas savoir s'il existe une mise à
    // jour est un état normal, pas un incident. Rien ne s'affiche.
    expect(avertissements).toHaveLength(1);
    expect(etat.lire().etape).toBe(ETAPES.REPOS);
    expect(etat.lire().message).toBeNull();
  });

  test('une erreur survenue après le téléchargement n’efface pas la version prête', async () => {
    const { updater, etat } = armer();
    await updater.emettre('update-downloaded', { version: '2.1.0' });

    await updater.emettre('error', new Error('ECONNRESET'));

    // la version est sur le disque : une panne de réseau ultérieure ne la
    // rend pas moins installable
    expect(etat.lire().etape).toBe(ETAPES.PRETE);
  });

  test('une recherche qui échoue ne laisse pas de rejet non capturé', async () => {
    const updater = fauxUpdater();
    updater.checkForUpdates = () => Promise.reject(new Error('hors ligne'));

    expect(() => armer({ updater })).not.toThrow();

    await new Promise((resolve) => setImmediate(resolve));
  });

  test('une erreur qui n’est pas une Error reste lisible dans le journal', async () => {
    const avertissements = [];
    const { updater } = armer({ journal: { warn: (m) => avertissements.push(m) } });

    await updater.emettre('error', 'ECONNRESET');

    expect(avertissements[0]).toContain('ECONNRESET');
  });

  test('une version manquante ne laisse pas l’état sans mot', async () => {
    const { updater, etat } = armer();

    // electron-updater ne garantit pas la forme de l'objet transmis
    await updater.emettre('update-downloaded', undefined);

    expect(etat.lire().etape).toBe(ETAPES.PRETE);
    expect(etat.lire().version).toBe(null);
  });

  test('le report ne perd pas la mise à jour', async () => {
    const { updater, etat } = armer();
    await updater.emettre('update-downloaded', { version: '2.1.0' });

    etat.reporter();

    expect(updater.installe).toBe(0);
    // elle se posera à la fermeture, sans rien redemander
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(etat.lire().etape).toBe(ETAPES.REPORTEE);
  });
});
