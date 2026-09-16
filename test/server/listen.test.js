const http = require('http');
const { EventEmitter } = require('events');
const { listenWithFallback } = require('../../lib/listen');

/** Serveur nu, juste bon à occuper un port. */
const serveurNu = () => http.createServer((_, res) => res.end('ok'));

const fermer = (serveur) => new Promise((resolve) => serveur.close(resolve));

/**
 * Faux serveur qui échoue à la demande.
 * Un vrai serveur ne permet pas de provoquer une erreur autre que EADDRINUSE
 * de façon fiable et rapide : se lier à une adresse étrangère peut pendre
 * plusieurs minutes au lieu d'échouer.
 */
const serveurQuiEchoue = (code) => {
  const faux = new EventEmitter();
  faux.listen = () => setImmediate(() => faux.emit('error', Object.assign(new Error(code), { code })));
  faux.address = () => ({ port: 0 });
  return faux;
};

describe('listenWithFallback', () => {
  test('écoute sur le port demandé quand il est libre', async () => {
    const serveur = serveurNu();

    const port = await listenWithFallback(serveur, { port: 0, host: '127.0.0.1' });

    expect(port).toBeGreaterThan(0);
    await fermer(serveur);
  });

  test('prend le port suivant quand le premier est occupé', async () => {
    const occupant = serveurNu();
    const pris = await listenWithFallback(occupant, { port: 0, host: '127.0.0.1' });

    const second = serveurNu();
    const obtenu = await listenWithFallback(second, { port: pris, host: '127.0.0.1' });

    // une application de bureau ne doit pas refuser de démarrer parce qu'un
    // autre programme occupe son port habituel
    expect(obtenu).toBe(pris + 1);

    await fermer(second);
    await fermer(occupant);
  });

  test('abandonne après le nombre d’essais donné', async () => {
    const faux = serveurQuiEchoue('EADDRINUSE');

    await expect(listenWithFallback(faux, { port: 3000, host: '127.0.0.1', tries: 2 })).rejects.toThrow(
      /Aucun port libre/
    );
  });

  test('une erreur qui n’est pas « port occupé » remonte telle quelle', async () => {
    // changer de port n'y changerait rien : réessayer serait masquer le vrai
    // problème derrière neuf tentatives inutiles
    const faux = serveurQuiEchoue('EACCES');

    await expect(listenWithFallback(faux, { port: 3000, host: '127.0.0.1' })).rejects.toThrow(
      'EACCES'
    );
  });
});
