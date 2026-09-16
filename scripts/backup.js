/* ---------------------------------------------------------------------------
   Cahier — sauvegarde horodatée.

   Le script n'ouvre pas la base : quand le serveur tourne, il détient le
   verrou WiredTiger sur data/db et un second processus échouerait. On passe
   donc par l'API, et on le dit clairement si le serveur est éteint.
   --------------------------------------------------------------------------- */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const port = parseInt(process.env.PORT, 10) || 3000;
const host = process.env.HOST || '127.0.0.1';
const dossier = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');

const stamp = () => new Date().toISOString().replace(/:/g, '-').slice(0, 19);

(async () => {
  const url = `http://${host}:${port}/export`;
  let payload;

  try {
    const reponse = await fetch(url);
    if (!reponse.ok) throw new Error(`réponse ${reponse.status}`);
    payload = await reponse.json();
  } catch (error) {
    console.error(`Sauvegarde impossible : ${url} est injoignable (${error.message}).`);
    console.error('Lance le serveur (« npm start ») dans un autre terminal, puis réessaie.');
    process.exit(1);
  }

  fs.mkdirSync(dossier, { recursive: true });
  const fichier = path.join(dossier, `cahier-${stamp()}.json`);
  fs.writeFileSync(fichier, JSON.stringify(payload, null, 2), 'utf8');

  const poids = (fs.statSync(fichier).size / 1024).toFixed(1);
  console.log(`Sauvegarde écrite : ${fichier}`);
  console.log(
    `${payload.tasks.length} tâche(s), ${payload.categories.length} catégorie(s), ${poids} ko`
  );
})();
