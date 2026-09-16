const { parseServerUrl, pickBrowser, NAVIGATEURS } = require('../../lib/launcher');

describe('parseServerUrl', () => {
  test('lit l’adresse annoncée par le serveur', () => {
    expect(parseServerUrl('Serveur démarré sur http://127.0.0.1:3000')).toBe(
      'http://127.0.0.1:3000'
    );
  });

  test('lit le port de repli quand le port habituel était pris', () => {
    expect(parseServerUrl('Serveur démarré sur http://127.0.0.1:3007')).toBe(
      'http://127.0.0.1:3007'
    );
  });

  test('ignore les autres lignes du serveur', () => {
    expect(parseServerUrl('MongoDB connecté')).toBeNull();
    expect(parseServerUrl('Migration : 5 tâche(s) mise(s) à jour')).toBeNull();
    expect(parseServerUrl('')).toBeNull();
  });

  test('ne se laisse pas prendre par une adresse citée dans un autre message', () => {
    // le contrat est la ligne de démarrage, pas « une URL quelque part »
    expect(parseServerUrl('Erreur : http://127.0.0.1:3000 est injoignable')).toBeNull();
  });
});

describe('pickBrowser', () => {
  test('prend le premier navigateur installé de la liste', () => {
    const present = (chemin) => chemin === NAVIGATEURS[1];

    expect(pickBrowser(present)).toBe(NAVIGATEURS[1]);
  });

  test('renvoie null quand aucun n’est installé', () => {
    // pas un échec : on retombera sur le navigateur par défaut du système
    expect(pickBrowser(() => false)).toBeNull();
  });

  test('respecte l’ordre de préférence', () => {
    expect(pickBrowser(() => true)).toBe(NAVIGATEURS[0]);
  });
});
