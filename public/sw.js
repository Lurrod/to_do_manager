/* ---------------------------------------------------------------------------
   Cahier — service worker.

   Il garde une copie de la coquille (HTML, CSS, JS) pour que l'application
   s'ouvre même serveur éteint. Mais il la sert **après** avoir demandé au
   serveur, jamais avant.

   L'ordre compte, et il a coûté une version. Tant que la coquille était servie
   depuis le cache d'abord, une mise à jour posait bien le nouvel exécutable et
   laissait l'ancienne interface à l'écran : le Cahier annonçait « à jour » en
   affichant la version d'avant, indéfiniment. Le serveur tourne dans le même
   processus que la fenêtre, sur 127.0.0.1 : lui demander d'abord ne coûte rien
   de mesurable, et c'est la seule façon d'afficher ce qui est installé.

   Tout ce qui vient du dehors — le cache, le réseau, les réponses — est pris
   sur `self`, que le script reçoit. Les tests lui en donnent un faux et
   n'ouvrent donc aucune connexion.

   Aucune écriture différée. Sur une base locale mono-utilisateur, une file de
   modifications à rejouer ajouterait un modèle de conflit pour un gain nul :
   il n'y a personne d'autre pour écrire pendant l'absence.
   --------------------------------------------------------------------------- */

/**
 * Le nom du cache courant.
 *
 * Il n'a plus besoin de changer à chaque version — c'est le réseau qui tient
 * la coquille à jour. Le passage de `v1` à `v2` sert une fois : il fait jeter
 * à l'activation la coquille figée des postes déjà installés.
 */
const VERSION = 'cahier-v2';

/**
 * La coquille, et elle seule.
 *
 * `test/ui/sw.test.js` vérifie que tout `public/js` et tout `public/css` y
 * figure : la liste a déjà rouillé une fois, quatre modules de la 3.1.0 n'y
 * étant jamais entrés.
 *
 * Les polices viennent de Google Fonts et sont mises en cache par le
 * navigateur : les précacher ici demanderait des requêtes inter-origines que
 * le service worker ne contrôle pas.
 */
const COQUILLE = [
  '/',
  '/index.html',
  '/css/tokens.css',
  '/css/layout.css',
  '/css/components.css',
  '/js/api.js',
  '/js/app.js',
  '/js/apparence.js',
  '/js/backup.js',
  '/js/dragdrop.js',
  '/js/filters.js',
  '/js/keyboard.js',
  '/js/maj.js',
  '/js/modal.js',
  '/js/palette.js',
  '/js/parse.js',
  '/js/preferences.js',
  '/js/reglages.js',
  '/js/sketch.js',
  '/js/steps.js',
  '/js/trash.js',
  '/js/util.js',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/manifest.webmanifest',
  '/vendor/drawably/style.css',
  '/vendor/drawably/dist/index.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    self.caches
      .open(VERSION)
      // `addAll` échoue en bloc si une seule ressource manque : on tolère les
      // absences pour qu'un fichier renommé n'empêche pas l'installation
      .then((cache) => Promise.allSettled(COQUILLE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.caches
      .keys()
      .then((noms) =>
        Promise.all(noms.filter((n) => n !== VERSION).map((n) => self.caches.delete(n)))
      )
      .then(() => self.clients.claim())
  );
});

/** Les routes de données, dont l'absence se dit en JSON et non en page blanche. */
const estAppelAPI = (url) =>
  /^\/(tasks|categories|export|import|healthz)/.test(new URL(url).pathname);

/** Ce qu'on répond à une route de données quand le serveur ne répond plus. */
const horsLigne = () =>
  new self.Response(JSON.stringify({ error: 'Hors ligne : le serveur ne répond pas.' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * Réseau d'abord, cache en secours.
 *
 * @param {Request} requete
 * @param {() => Response} secours ce qu'on rend quand le réseau a échoué et
 *   que le cache est vide
 */
const reseauDAbord = (requete, secours) =>
  self
    .fetch(requete)
    .then((reponse) => {
      // une panne passagère ne doit pas se figer dans le cache et y devenir la
      // version « hors ligne » de la page
      if (reponse.ok) {
        const copie = reponse.clone();
        self.caches.open(VERSION).then((cache) => cache.put(requete, copie));
      }
      return reponse;
    })
    .catch(() => self.caches.match(requete).then((cachee) => cachee || secours()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    reseauDAbord(request, estAppelAPI(request.url) ? horsLigne : () => self.Response.error())
  );
});
