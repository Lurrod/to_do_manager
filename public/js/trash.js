/* ---------------------------------------------------------------------------
   Cahier — corbeille : liste des tâches supprimées, restauration et purge
   confirmée en deux temps. Ne touche qu'à sa modale ; ne lit jamais `state`.
   --------------------------------------------------------------------------- */

import * as api from './api.js';
import { closeModal, openModal } from './modal.js';
import { setText, sketchAll, unsketchAll } from './sketch.js';
import { $, escapeHtml, formatDate, toast } from './util.js';

const trashModal = $('trash-modal');
const trashList = $('trash-list');
const trashEmpty = $('trash-empty');
const openTrashBtn = $('open-trash');
const closeTrashBtn = $('close-trash');

/**
 * Câble la corbeille : bouton d'ouverture, fermeture, restauration et purge.
 * @param {{restoreTask: (id: string) => Promise<void>}} deps `restoreTask` est
 * partagée avec la liste des tâches (le lien « Annuler » du toast de
 * suppression) : elle reste définie dans app.js et arrive ici en argument.
 * @returns {{openTrash: () => Promise<void>}} `openTrash` est repris par la
 * palette de commandes, qui n'a pas d'autre moyen d'atteindre la corbeille.
 */
export const initTrash = ({ restoreTask }) => {
  /**
   * Contenu de la corbeille. Le deuxième clic sur « Supprimer » confirme :
   * une suppression définitive ne doit jamais tenir en un seul geste.
   */
  const renderTrash = (tasks) => {
    unsketchAll(trashList);
    trashList.innerHTML = '';
    trashEmpty.hidden = tasks.length > 0;

    tasks.forEach((task) => {
      const li = document.createElement('li');
      li.className = 'trash-row';
      li.innerHTML = `
        <span class="trash-title">${escapeHtml(task.title)}</span>
        <span class="trash-date">${escapeHtml(formatDate(task.deletedAt) || '')}</span>
        <button class="btn trash-restore" type="button" data-sketch="button" data-tone="neutral">Restaurer</button>
        <button class="btn trash-purge" type="button" data-sketch="button" data-tone="danger">Supprimer</button>
      `;

      li.querySelector('.trash-restore').addEventListener('click', async () => {
        await restoreTask(task._id);
        await openTrash();
      });

      const purgeBtn = li.querySelector('.trash-purge');
      purgeBtn.addEventListener('click', async () => {
        if (purgeBtn.dataset.confirm !== 'true') {
          purgeBtn.dataset.confirm = 'true';
          setText(purgeBtn, 'Confirmer ?');
          return;
        }
        try {
          await api.purgeTask(task._id);
          await openTrash();
          toast('Tâche supprimée définitivement.', 'info');
        } catch (error) {
          toast(error.message, 'error');
        }
      });

      trashList.appendChild(li);
    });

    sketchAll(trashList);
  };

  const openTrash = async () => {
    try {
      const { tasks } = await api.listTrash({ page: 1, limit: 50 });
      renderTrash(tasks || []);
      openModal(trashModal);

      // openModal place lui-même le focus à la première ouverture. Ce rattrapage
      // ne sert qu'au cas où la modale était déjà ouverte et où renderTrash vient
      // de détruire la ligne qui portait le focus : il retomberait sur <body>,
      // hors du piège.
      if (!trashModal.contains(document.activeElement)) {
        (trashList.querySelector('.trash-restore') || closeTrashBtn).focus();
      }
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  openTrashBtn.addEventListener('click', () => openTrash());
  closeTrashBtn.addEventListener('click', () => closeModal(trashModal));

  return { openTrash };
};
