#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   Cahier — lancement en application.

   Démarre le serveur, attend qu'il réponde, puis ouvre une fenêtre sans barre
   d'adresse. Ctrl+C arrête les deux.

   Ce n'est pas encore une application empaquetée : c'est le chemin le plus
   court vers la sensation d'en être une, sans ajouter Electron (~150 Mo) au
   dépôt. Voir docs/passage-en-app.md pour la suite.
   --------------------------------------------------------------------------- */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseServerUrl, pickBrowser } = require('../lib/launcher');

const RACINE = path.join(__dirname, '..');
/** Le premier démarrage télécharge MongoDB : il faut lui laisser le temps. */
const ATTENTE_MAX_MS = 180 * 1000;
const PAS_MS = 300;

const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Interroge /healthz jusqu'à ce que la base réponde, ou abandonne. */
async function attendreLeServeur(url) {
  const limite = Date.now() + ATTENTE_MAX_MS;

  while (Date.now() < limite) {
    try {
      const reponse = await fetch(`${url}/healthz`);
      if (reponse.ok) {
        const sante = await reponse.json();
        if (sante.db === 'connected') return true;
      }
    } catch (_) {
      // pas encore debout : c'est attendu, on repasse
    }
    await attendre(PAS_MS);
  }

  return false;
}

/**
 * Ouvre la fenêtre. Un navigateur en mode `--app` donne une fenêtre nue, sans
 * onglets ni barre d'adresse ; à défaut, le navigateur par défaut du système
 * fait l'affaire, avec sa décoration.
 */
function ouvrirLaFenetre(url) {
  const navigateur = pickBrowser((chemin) => fs.existsSync(chemin));

  if (navigateur) {
    spawn(navigateur, [`--app=${url}`], { detached: true, stdio: 'ignore' }).unref();
    return path.basename(navigateur);
  }

  // `start` a besoin d'un premier argument vide : il le prend sinon pour le
  // titre de la fenêtre et n'ouvre rien
  spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  return 'navigateur par défaut';
}

(async () => {
  const serveur = spawn(process.execPath, [path.join(RACINE, 'server.js')], {
    cwd: RACINE,
    env: process.env,
  });

  let url = null;
  let fenetreOuverte = false;

  serveur.stdout.on('data', async (donnees) => {
    const texte = donnees.toString();
    process.stdout.write(texte);

    if (fenetreOuverte) return;
    const trouvee = parseServerUrl(texte);
    if (!trouvee) return;

    url = trouvee;
    fenetreOuverte = true;

    if (await attendreLeServeur(url)) {
      console.log(`Cahier ouvert dans ${ouvrirLaFenetre(url)} — ${url}`);
      console.log('Ctrl+C pour fermer le Cahier.');
    } else {
      console.error(`Le serveur n'a pas répondu sur ${url}. Le Cahier reste fermé.`);
      serveur.kill();
      process.exit(1);
    }
  });

  serveur.stderr.on('data', (donnees) => process.stderr.write(donnees.toString()));

  serveur.on('exit', (code) => process.exit(code ?? 0));

  // Ctrl+C doit emporter le serveur : sinon il continuerait à tourner en
  // arrière-plan, et à tenir le verrou sur data/db
  const arreter = () => {
    serveur.kill('SIGTERM');
  };
  process.on('SIGINT', arreter);
  process.on('SIGTERM', arreter);
})();
