/* ---------------------------------------------------------------------------
   Cahier — restauration d'une sauvegarde depuis l'interface.

   Le bouton fusionne, il ne remplace pas : il ajoute ce qui manque et ne
   touche à rien d'existant. Mettre un bouton qui efface la base dans la barre
   latérale serait poser un piège à un clic de distance ; le remplacement exact
   reste accessible en ligne de commande, où il se demande explicitement.
   --------------------------------------------------------------------------- */

import { $, toast } from './util.js';

const restoreInput = $('import-file');
const restoreBtn = $('open-restore');

/**
 * Câble la restauration.
 * @param {{refresh: () => Promise<void>}} deps
 */
export const initBackup = ({ refresh }) => {
  if (!restoreBtn || !restoreInput) return;

  restoreBtn.addEventListener('click', () => restoreInput.click());

  restoreInput.addEventListener('change', async () => {
    const fichier = restoreInput.files?.[0];
    // le champ est remis à zéro tout de suite : sans ça, rechoisir le même
    // fichier après un échec ne déclencherait aucun événement
    restoreInput.value = '';
    if (!fichier) return;

    try {
      const contenu = JSON.parse(await fichier.text());

      const reponse = await fetch('/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...contenu, mode: 'merge' }),
      });
      const corps = await reponse.json();
      if (!reponse.ok) throw new Error(corps.error || `Erreur ${reponse.status}`);

      toast(`Sauvegarde fusionnée : ${corps.tasks} tâche(s) lue(s).`, 'info');
      await refresh();
    } catch (error) {
      const message =
        error instanceof SyntaxError
          ? "Ce fichier n'est pas une sauvegarde du Cahier."
          : error.message;
      toast(message, 'error');
    }
  });
};
