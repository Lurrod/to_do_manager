/* ---------------------------------------------------------------------------
   Cahier — glisser-déposer : réordonne les tâches par indexation fractionnaire.
   Le serveur reçoit les voisines du point de dépôt, pas un rang : c'est lui
   qui calcule, ce qui évite qu'un client en retard d'un rafraîchissement pose
   un rang déjà pris. Le calcul des voisines se lit dans le DOM affiché — ce
   que l'utilisateur a sous les yeux au moment où il lâche la ligne.
   --------------------------------------------------------------------------- */

/**
 * Câble le glisser-déposer sur la liste des tâches, en délégation sur
 * `taskList`. app.js décide seul, à l'affichage, quelles lignes sont
 * saisissables (`draggable`) : ce module ne lit jamais `state` lui-même.
 * @param {{
 *   taskList: HTMLElement,
 *   moveTask: (id: string, voisines: {before: string|null, after: string|null}) => Promise<unknown>,
 *   refresh: () => Promise<void>,
 *   toast: (message: string, kind?: string) => void,
 * }} deps
 */
export const initDragDrop = ({ taskList, moveTask, refresh, toast }) => {
  // identifiant de la ligne en cours de saisie ; nul hors glisser-déposer
  let tireeId = null;

  taskList.addEventListener('dragstart', (e) => {
    const ligne = e.target.closest('.task');
    // une ligne non saisissable (tri autre que manuel) ne porte pas
    // `draggable` : `dragstart` n'y est même pas déclenché par le navigateur,
    // mais rien n'empêche un test de simuler l'événement directement
    if (!ligne || !ligne.draggable) return;
    tireeId = ligne.dataset.id;
    ligne.classList.add('is-dragging');
  });

  taskList.addEventListener('dragover', (e) => {
    if (!tireeId) return;
    e.preventDefault();
    const ligne = e.target.closest('.task');
    taskList
      .querySelectorAll('.is-drop-target')
      .forEach((l) => l.classList.remove('is-drop-target'));
    if (ligne) ligne.classList.add('is-drop-target');
  });

  taskList.addEventListener('drop', async (e) => {
    e.preventDefault();
    const cible = e.target.closest('.task');
    // déposer une ligne sur elle-même ne change rien à l'ordre : ne rien
    // demander au serveur pour ça
    if (!cible || !tireeId || cible.dataset.id === tireeId) return;

    const lignes = [...taskList.querySelectorAll('.task')].filter((l) => l.dataset.id !== tireeId);
    const index = lignes.indexOf(cible);

    try {
      await moveTask(tireeId, {
        before: index > 0 ? lignes[index - 1].dataset.id : null,
        after: cible.dataset.id,
      });
      await refresh();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  taskList.addEventListener('dragend', () => {
    tireeId = null;
    taskList.querySelectorAll('.is-dragging, .is-drop-target').forEach((l) => {
      l.classList.remove('is-dragging', 'is-drop-target');
    });
  });
};
