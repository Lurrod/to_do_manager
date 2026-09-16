/* ---------------------------------------------------------------------------
   Cahier — service worker.

   Précache la coquille (HTML, CSS, JS) pour que l'application s'ouvre même
   serveur éteint. L'API, elle, passe en réseau d'abord : les données affichées
   doivent être les vraies quand le serveur répond.

   Aucune écriture différée. Sur une base locale mono-utilisateur, une file de
   modifications à rejouer ajouterait un modèle de conflit pour un gain nul :
   il n'y a personne d'autre pour écrire pendant l'absence.
   --------------------------------------------------------------------------- */

const VERSION = 'cahier-v1';

/**
 * La coquille, et elle seule. Les polices viennent de Google Fonts et sont
 * mises en cache par le navigateur : les précacher ici demanderait des requêtes
 * inter-origines que le service worker ne contrôle pas.
 */
const COQUILLE = [
  '/',
  '/index.html',
  '/css/tokens.css',
  '/css/layout.css',
  '/css/components.css',
  '/js/app.js',
  '/js/api.js',
  '/js/parse.js',
  '/js/filters.js',
  '/js/trash.js',
  '/js/palette.js',
  '/js/steps.js',
  '/js/keyboard.js',
  '/js/dragdrop.js',
  '/js/backup.js',
  '/js/modal.js',
  '/js/sketch.js',
  '/js/util.js',
  '/favicon.svg',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // `addAll` échoue en bloc si une seule ressource manque : on tolère les
      // absences pour qu'un fichier renommé n'empêche pas l'installation
      .then((cache) => Promise.allSettled(COQUILLE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

/** Les routes de données : jamais servies depuis le cache sans avoir essayé le réseau. */
const estAppelAPI = (url) =>
  /^\/(tasks|categories|export|import|healthz)/.test(new URL(url).pathname);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  if (estAppelAPI(request.url)) {
    // réseau d'abord : une donnée périmée affichée comme fraîche serait pire
    // que pas de donnée du tout
    event.respondWith(
      fetch(request)
        .then((reponse) => {
          const copie = reponse.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copie));
          return reponse;
        })
        .catch(() =>
          caches.match(request).then(
            (cachee) =>
              cachee ||
              new Response(JSON.stringify({ error: 'Hors ligne : le serveur ne répond pas.' }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
              })
          )
        )
    );
    return;
  }

  // la coquille : cache d'abord, c'est elle qui doit s'ouvrir instantanément
  event.respondWith(caches.match(request).then((cachee) => cachee || fetch(request)));
});
