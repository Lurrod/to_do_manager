const { ETAPES, creerEtatMaj } = require('../../lib/maj-etat');

const horlogeFigee = (iso) => () => new Date(iso);

describe('creerEtatMaj', () => {
  test('part inactif : sans application empaquetée, il n’y a rien à chercher', () => {
    expect(creerEtatMaj().lire().etape).toBe(ETAPES.INACTIVE);
  });

  test('poser rend un instantané neuf, jamais l’état interne', () => {
    const etat = creerEtatMaj();

    const rendu = etat.poser({ etape: ETAPES.RECHERCHE });
    rendu.etape = 'bricolé';

    // un appelant qui griffonne sur ce qu'il a reçu ne doit pas corrompre l'état
    expect(etat.lire().etape).toBe(ETAPES.RECHERCHE);
  });

  test('poser garde ce que le patch ne dit pas', () => {
    const etat = creerEtatMaj();
    etat.poser({ etape: ETAPES.TELECHARGEMENT, version: '3.1.0' });

    etat.poser({ progression: 42 });

    expect(etat.lire()).toMatchObject({
      etape: ETAPES.TELECHARGEMENT,
      version: '3.1.0',
      progression: 42,
    });
  });

  test('sans actions branchées, chercher et installer ne font rien et le disent', async () => {
    const etat = creerEtatMaj();

    await expect(etat.chercher()).resolves.toBe(false);
    await expect(etat.installer()).resolves.toBe(false);
  });

  test('une fois branché, chercher et installer appellent le processus principal', async () => {
    const appels = [];
    const etat = creerEtatMaj();
    etat.brancher({
      chercher: () => {
        appels.push('chercher');
        return Promise.resolve();
      },
      installer: () => {
        appels.push('installer');
        return Promise.resolve();
      },
    });

    await expect(etat.chercher()).resolves.toBe(true);
    await expect(etat.installer()).resolves.toBe(true);
    expect(appels).toEqual(['chercher', 'installer']);
  });

  test('brancher sort d’inactive : des actions branchées, c’est une mise à jour qui existe', () => {
    const etat = creerEtatMaj();

    etat.brancher({ chercher: () => Promise.resolve(), installer: () => Promise.resolve() });

    // « inactive » annonce qu'il n'y aura jamais rien à chercher, et vaut
    // permission de cesser d'interroger. Des actions branchées le démentent :
    // l'état doit le refléter tout de suite, sans attendre le réseau.
    expect(etat.lire().etape).toBe(ETAPES.RECHERCHE);
  });

  test('chercher horodate la recherche', async () => {
    const etat = creerEtatMaj({ maintenant: horlogeFigee('2026-09-17T10:00:00Z') });
    etat.brancher({ chercher: () => Promise.resolve(), installer: () => Promise.resolve() });

    await etat.chercher();

    expect(etat.lire().derniereRecherche).toBe('2026-09-17T10:00:00.000Z');
  });

  test('une recherche qui échoue ne fait pas tomber l’appelant', async () => {
    const etat = creerEtatMaj();
    etat.brancher({
      chercher: () => Promise.reject(new Error('hors ligne')),
      installer: () => Promise.resolve(),
    });

    // hors ligne est un état normal pour une application locale
    await expect(etat.chercher()).resolves.toBe(true);
    expect(etat.lire().etape).not.toBe(ETAPES.ECHEC);
  });

  test('reporter ne vaut que depuis « prête »', () => {
    const etat = creerEtatMaj();

    etat.reporter();
    expect(etat.lire().etape).toBe(ETAPES.INACTIVE);

    etat.poser({ etape: ETAPES.PRETE, version: '3.1.0' });
    etat.reporter();
    expect(etat.lire().etape).toBe(ETAPES.REPORTEE);
    // la version reste : la page Réglages doit pouvoir la nommer
    expect(etat.lire().version).toBe('3.1.0');
  });
});
