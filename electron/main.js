/* ---------------------------------------------------------------------------
   Cahier — processus principal Electron.

   Le serveur Express tourne DANS ce processus : le charger ici plutôt que de
   l'engendrer évite d'embarquer un second exécutable Node et de gérer sa mort.

   Deux choses doivent être posées avant de le charger, et c'est tout l'enjeu
   de ce fichier :
     — où écrire les données (l'archive de l'application est en lecture seule) ;
     — où trouver mongod (rien ne doit se télécharger au premier lancement).
   --------------------------------------------------------------------------- */

const { app, BrowserWindow, shell, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

/** Une seule instance : deux processus ouvriraient la même base, et WiredTiger la verrouille. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const EN_PAQUET = app.isPackaged;

// posé avant tout appel à getPath : sans lui, les données atterrissent dans
// %APPDATA%\Electron en développement et dans %APPDATA%\Cahier une fois
// empaqueté — deux bases différentes pour la même application
app.setName('Cahier');

/**
 * Données de l'utilisateur, hors de l'application.
 * `%APPDATA%\Cahier\db` — conservé lors d'une mise à jour, contrairement à
 * tout ce qui vit à côté de l'exécutable.
 */
const DOSSIER_DONNEES = path.join(app.getPath('userData'), 'db');

/**
 * Le binaire Mongo, empaqueté à côté de l'application.
 *
 * Sans cette variable, mongodb-memory-server irait le télécharger au premier
 * lancement : cent mégaoctets par le réseau, sur une application censée
 * fonctionner hors ligne.
 */
const MONGOD = EN_PAQUET
  ? path.join(process.resourcesPath, 'mongod.exe')
  : path.join(__dirname, '..', 'node_modules', '.cache', 'mongodb-memory-server', 'mongod-x64-win32-8.2.6.exe');

process.env.CAHIER_DATA_DIR = DOSSIER_DONNEES;
process.env.NODE_ENV = 'production';
if (fs.existsSync(MONGOD)) {
  process.env.MONGOMS_SYSTEM_BINARY = MONGOD;
} else {
  console.warn(`mongod introuvable à ${MONGOD} — il sera téléchargé.`);
}

let fenetre = null;
let serveur = null;
let arretEnCours = false;

const creerFenetre = (url) => {
  fenetre = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 520,
    // la couleur du papier, pour que l'ouverture ne clignote pas en blanc
    backgroundColor: '#f6f1e4',
    title: 'Cahier',
    icon: path.join(__dirname, 'icon.png'),
    show: false,
    webPreferences: {
      // la page n'a aucun besoin de Node : ne pas le lui donner
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  fenetre.once('ready-to-show', () => fenetre.show());
  fenetre.on('closed', () => {
    fenetre = null;
  });

  // un lien externe s'ouvre dans le navigateur, pas dans la fenêtre de l'app
  fenetre.webContents.setWindowOpenHandler(({ url: cible }) => {
    shell.openExternal(cible);
    return { action: 'deny' };
  });

  fenetre.loadURL(url);
};

app.whenReady().then(async () => {
  // pas de barre de menus : ce n'est pas un navigateur
  Menu.setApplicationMenu(null);

  try {
    serveur = require(path.join(__dirname, '..', 'server.js'));
    const url = await serveur.ready;
    creerFenetre(url);
  } catch (error) {
    dialog.showErrorBox(
      'Le Cahier n’a pas pu démarrer',
      `${error.message}\n\nDonnées : ${DOSSIER_DONNEES}`
    );
    app.quit();
  }
});

app.on('second-instance', () => {
  if (fenetre) {
    if (fenetre.isMinimized()) fenetre.restore();
    fenetre.focus();
  }
});

app.on('window-all-closed', () => {
  // fermer la fenêtre ferme le Cahier : il n'a rien à faire en arrière-plan
  // une fois qu'on l'a rangé
  app.quit();
});

/**
 * Mongo tient un verrou sur le dossier de données. Le laisser derrière soi
 * empêcherait le prochain lancement de s'ouvrir. On retarde donc la sortie le
 * temps de le relâcher — une seule fois, sans quoi `app.quit()` rappellerait
 * ce gestionnaire en boucle.
 */
app.on('before-quit', (event) => {
  if (arretEnCours || !serveur?.stopServices) return;
  arretEnCours = true;
  event.preventDefault();
  serveur.stopServices().finally(() => app.quit());
});
