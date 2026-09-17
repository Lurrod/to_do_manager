import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

/* ---------------------------------------------------------------------------
   Le service worker.

   Il n'est ni un module ni une page : c'est un script qui reçoit `self` et
   s'accroche dessus. On le monte donc ici avec un faux `self` — faux cache,
   faux réseau. Ces tests n'ouvrent aucune connexion et n'écrivent rien.

   Ce qu'ils protègent tient en une phrase : une version installée doit
   s'afficher. Le Cahier a livré une 3.1.0 que personne n'a vue — l'exécutable
   était le bon, la coquille servie venait du cache de la version d'avant.
   --------------------------------------------------------------------------- */

const SOURCE = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');

/** Le cache courant, tel que le service worker le nomme. */
const COURANT = 'cahier-v2';

/** Une réponse de serveur, réduite à ce que le service worker en regarde. */
const reponse = (corps, { ok = true, status = 200 } = {}) => ({
  corps,
  ok,
  status,
  clone() {
    return { ...this, clone: this.clone };
  },
});

/** Une requête, réduite de même. */
const requete = (url, methode = 'GET') => ({ url: `http://127.0.0.1:3000${url}`, method: methode });

/**
 * Un faux `self` : tout ce que le service worker touche du monde extérieur.
 *
 * @param {object} options
 * @param {Record<string, object>} [options.serveur] ce que le réseau renvoie,
 *   par chemin ; un chemin absent fait échouer la requête — c'est ainsi qu'on
 *   éteint le serveur dans un test
 * @param {Record<string, Record<string, object>>} [options.caches] l'état du
 *   cache au départ, par nom de cache puis par chemin
 */
const monter = ({ serveur = {}, caches = {} } = {}) => {
  const magasins = new Map(
    Object.entries(caches).map(([nom, entrees]) => [
      nom,
      new Map(Object.entries(entrees).map(([url, valeur]) => [requete(url).url, valeur])),
    ])
  );

  const appels = { reseau: [], skipWaiting: 0, claim: 0 };
  const ecouteurs = new Map();

  const ouvrir = (nom) => {
    if (!magasins.has(nom)) magasins.set(nom, new Map());
    const magasin = magasins.get(nom);
    return Promise.resolve({
      put: (req, res) => {
        magasin.set(req.url, res);
        return Promise.resolve();
      },
      add: (chemin) => {
        if (!(chemin in serveur)) return Promise.reject(new Error(`404 ${chemin}`));
        magasin.set(requete(chemin).url, serveur[chemin]);
        return Promise.resolve();
      },
    });
  };

  const self = {
    addEventListener: (nom, gestionnaire) => ecouteurs.set(nom, gestionnaire),
    skipWaiting: () => {
      appels.skipWaiting += 1;
      return Promise.resolve();
    },
    clients: {
      claim: () => {
        appels.claim += 1;
        return Promise.resolve();
      },
    },
    caches: {
      open: ouvrir,
      keys: () => Promise.resolve([...magasins.keys()]),
      delete: (nom) => Promise.resolve(magasins.delete(nom)),
      match: (req) => {
        for (const magasin of magasins.values()) {
          if (magasin.has(req.url)) return Promise.resolve(magasin.get(req.url));
        }
        return Promise.resolve(undefined);
      },
    },
    fetch: (req) => {
      appels.reseau.push(req.url);
      const chemin = new URL(req.url).pathname;
      if (!(chemin in serveur)) return Promise.reject(new Error('serveur éteint'));
      return Promise.resolve(serveur[chemin]);
    },
    Response: class {
      constructor(corps, init = {}) {
        this.corps = corps;
        this.status = init.status || 200;
        this.ok = this.status < 400;
      }
      static error() {
        return new self.Response(null, { status: 0 });
      }
    },
  };

  new Function('self', SOURCE)(self);

  /** Déclenche un `fetch` et rend la réponse choisie — null si rien n'a été pris en charge. */
  const demander = (url, methode = 'GET') => {
    let promesse = null;
    ecouteurs.get('fetch')({
      request: requete(url, methode),
      respondWith: (p) => {
        promesse = p;
      },
    });
    return promesse;
  };

  const evenement = async (nom) => {
    const attentes = [];
    ecouteurs.get(nom)({ waitUntil: (p) => attentes.push(p) });
    await Promise.all(attentes);
  };

  /** Ce que le cache courant retient d'un chemin. */
  const enCache = (chemin) => magasins.get(COURANT)?.get(requete(chemin).url);

  return { demander, evenement, enCache, magasins, appels };
};

describe('le service worker', () => {
  test('sert la coquille du serveur, jamais celle d’hier', async () => {
    // le cœur du défaut : une coquille déjà en cache masquait la version
    // fraîchement installée, et n'expirait jamais
    const sw = monter({
      serveur: { '/index.html': reponse('la 3.2.0') },
      caches: { [COURANT]: { '/index.html': reponse('la 3.0.1') } },
    });

    expect((await sw.demander('/index.html')).corps).toBe('la 3.2.0');
  });

  test('range la réponse fraîche à la place de l’ancienne', async () => {
    const sw = monter({
      serveur: { '/js/app.js': reponse('nouveau') },
      caches: { [COURANT]: { '/js/app.js': reponse('ancien') } },
    });

    await sw.demander('/js/app.js');

    expect(sw.enCache('/js/app.js').corps).toBe('nouveau');
  });

  test('ouvre la coquille depuis le cache quand le serveur est éteint', async () => {
    const sw = monter({
      caches: { [COURANT]: { '/index.html': reponse('la dernière vue') } },
    });

    expect((await sw.demander('/index.html')).corps).toBe('la dernière vue');
  });

  test('ne fige pas une erreur du serveur dans le cache', async () => {
    // sans ce garde-fou, un 500 passager deviendrait la version « hors ligne »
    // de la page, et y resterait
    const sw = monter({
      serveur: { '/index.html': reponse('erreur', { ok: false, status: 500 }) },
      caches: { [COURANT]: { '/index.html': reponse('la bonne page') } },
    });

    await sw.demander('/index.html');

    expect(sw.enCache('/index.html').corps).toBe('la bonne page');
  });

  test('répond en JSON, pas en page, quand une route de données est hors ligne', async () => {
    const sw = monter();

    const res = await sw.demander('/tasks?page=1');

    expect(res.status).toBe(503);
    expect(JSON.parse(res.corps)).toHaveProperty('error');
  });

  test('laisse passer une écriture sans jamais la mettre en cache', async () => {
    const sw = monter({ serveur: { '/tasks': reponse('créée') } });

    expect(sw.demander('/tasks', 'POST')).toBeNull();
    expect(sw.appels.reseau).toHaveLength(0);
  });

  test('jette les caches des versions précédentes en s’activant', async () => {
    // c'est ce qui débarrasse les postes déjà installés de la coquille figée
    const sw = monter({
      caches: { 'cahier-v1': { '/index.html': reponse('vieux') }, [COURANT]: {} },
    });

    await sw.evenement('activate');

    expect([...sw.magasins.keys()]).toEqual([COURANT]);
    expect(sw.appels.claim).toBe(1);
  });

  test('précache la coquille à l’installation, sans se laisser arrêter par un absent', async () => {
    const sw = monter({ serveur: { '/index.html': reponse('page') } });

    await sw.evenement('install');

    expect(sw.enCache('/index.html').corps).toBe('page');
    expect(sw.appels.skipWaiting).toBe(1);
  });

  test('précache tous les modules et toutes les feuilles que la page charge', async () => {
    // une liste tenue à la main rouille : la 3.1.0 a livré quatre modules que
    // la coquille ne connaissait pas. Ce test la tient à jour à notre place.
    const attendus = [
      ...readdirSync(resolve(process.cwd(), 'public/js')).map((f) => `/js/${f}`),
      ...readdirSync(resolve(process.cwd(), 'public/css')).map((f) => `/css/${f}`),
    ];

    const manquants = attendus.filter((chemin) => !SOURCE.includes(`'${chemin}'`));

    expect(manquants).toEqual([]);
  });
});
