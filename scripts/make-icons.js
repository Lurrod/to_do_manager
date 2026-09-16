/* ---------------------------------------------------------------------------
   Cahier — fabrique les icônes à partir de `public/favicon.svg`.

   Les icônes livrées jusqu'ici étaient des canevas blancs portant un marqueur
   d'image cassée : le générateur d'origine chargeait le SVG par `<img src=…>`
   et n'obtenait rien. Le dessin est donc **inséré dans la page**, jamais
   référencé — il n'y a plus de chargement qui puisse échouer.

   Le rendu passe par Electron, déjà présent dans le projet : c'est le moteur
   qui affichera l'application, donc celui dont on veut le rendu.

   Usage : npm run icons
   --------------------------------------------------------------------------- */

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const { SEUIL_ENCRE, proportionEncree } = require('../lib/icon-ink');

const RACINE = path.join(__dirname, '..');
const SOURCE = path.join(RACINE, 'public', 'favicon.svg');

/** Rendu large puis réduit : les traits fins restent nets à 180 px. */
const RENDU = 1024;

const SORTIES = [
  { chemin: path.join(RACINE, 'electron', 'icon.png'), taille: 512 },
  { chemin: path.join(RACINE, 'public', 'icon-512.png'), taille: 512 },
  { chemin: path.join(RACINE, 'public', 'icon-192.png'), taille: 192 },
  { chemin: path.join(RACINE, 'public', 'apple-touch-icon.png'), taille: 180 },
];

const fabriquer = async () => {
  const svg = fs.readFileSync(SOURCE, 'utf8');

  const page = `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  svg { display: block; width: ${RENDU}px; height: ${RENDU}px; }
</style>
${svg}`;

  const fenetre = new BrowserWindow({
    width: RENDU,
    height: RENDU,
    useContentSize: true,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true },
  });

  await fenetre.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  const capture = await fenetre.webContents.capturePage();

  const { width, height } = capture.getSize();
  const encre = proportionEncree(capture.toBitmap(), width, height);
  if (encre < SEUIL_ENCRE) {
    throw new Error(
      `Le rendu est vide (${(encre * 100).toFixed(2)} % d'encre). ` +
        `C'est exactement le défaut qu'on répare — rien n'est écrit.`
    );
  }

  for (const { chemin, taille } of SORTIES) {
    const reduite = capture.resize({ width: taille, height: taille, quality: 'best' });
    fs.writeFileSync(chemin, reduite.toPNG());
    console.log(`${path.relative(RACINE, chemin)} — ${taille}×${taille}`);
  }

  console.log(`Encre mesurée sur le rendu : ${(encre * 100).toFixed(1)} %`);
  fenetre.destroy();
};

app.whenReady().then(() =>
  fabriquer()
    .then(() => app.exit(0))
    .catch((erreur) => {
      console.error(erreur.message);
      app.exit(1);
    })
);
