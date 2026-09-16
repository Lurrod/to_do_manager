/* ---------------------------------------------------------------------------
   Cahier — mise à l'écoute tolérante.

   Une application de bureau ne doit pas refuser de démarrer parce qu'un autre
   programme occupe son port habituel : on essaie les suivants, et on dit
   lequel a été retenu.
   --------------------------------------------------------------------------- */

/** Au-delà, ce n'est plus un conflit ponctuel mais un problème de machine. */
const DEFAULT_TRIES = 10;

/**
 * Met un serveur à l'écoute, en glissant vers le port suivant s'il est occupé.
 *
 * Seule l'erreur « port déjà pris » déclenche un nouvel essai : toute autre
 * (hôte inconnu, droits insuffisants) remonte telle quelle, parce que changer
 * de port n'y changerait rien.
 *
 * @param {import('http').Server} server
 * @param {{port: number, host: string, tries?: number}} options
 * @returns {Promise<number>} le port réellement obtenu
 */
const listenWithFallback = (server, { port, host, tries = DEFAULT_TRIES }) =>
  new Promise((resolve, reject) => {
    let restants = tries;
    let courant = port;

    const surErreur = (error) => {
      if (error.code !== 'EADDRINUSE') {
        server.removeListener('error', surErreur);
        return reject(error);
      }
      if (restants <= 0) {
        server.removeListener('error', surErreur);
        return reject(
          new Error(`Aucun port libre entre ${port} et ${courant} : démarrage impossible.`)
        );
      }
      restants -= 1;
      courant += 1;
      server.listen(courant, host);
    };

    server.on('error', surErreur);
    server.once('listening', () => {
      server.removeListener('error', surErreur);
      resolve(server.address().port);
    });

    server.listen(courant, host);
  });

module.exports = { DEFAULT_TRIES, listenWithFallback };
