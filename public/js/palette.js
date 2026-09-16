/* ---------------------------------------------------------------------------
   Cahier — palette de commandes : recherche rapide au clavier (Ctrl+K) vers
   les actions et vues courantes. Ne lit jamais `state` ; tout ce qu'elle ne
   peut pas faire elle-même (focus, ouverture de la corbeille) lui est injecté.
   --------------------------------------------------------------------------- */

import { selectDue } from './filters.js';
import { closeModal, openModal } from './modal.js';
import { unsketchAll } from './sketch.js';
import { $ } from './util.js';

const paletteModal = $('palette-modal');
const paletteInput = $('palette-input');
const paletteList = $('palette-list');

/**
 * Câble la palette de commandes.
 * @param {{
 *   focusTitle: () => void,
 *   focusSearch: () => void,
 *   openTrash: () => Promise<void>,
 * }} deps Ce que la palette ne peut pas atteindre par elle-même : le focus sur
 * le composeur et la recherche vivent dans app.js, et la corbeille dans sa
 * propre closure (trash.js).
 * @returns {{openPalette: () => void, closePalette: () => void}} le gestionnaire
 * clavier de app.js reste seul à écouter Ctrl+K : il ouvre ou referme la
 * palette sans jamais toucher directement à sa modale.
 */
export const initPalette = ({ focusTitle, focusSearch, openTrash }) => {
  /** Commandes de la palette : libellé + action. Aucune ne dépend du DOM courant. */
  const PALETTE_COMMANDS = [
    { label: 'Nouvelle tâche', run: focusTitle },
    { label: 'Chercher', run: focusSearch },
    { label: 'Voir : tout', run: () => selectDue('all') },
    { label: 'Voir : en retard', run: () => selectDue('overdue') },
    { label: "Voir : aujourd'hui", run: () => selectDue('today') },
    { label: 'Voir : cette semaine', run: () => selectDue('week') },
    { label: 'Voir : sans date', run: () => selectDue('none') },
    { label: 'Ouvrir la corbeille', run: openTrash },
  ];

  const renderPalette = () => {
    const needle = paletteInput.value.trim().toLowerCase();
    const matches = PALETTE_COMMANDS.filter(({ label }) =>
      label.toLowerCase().includes(needle)
    );

    unsketchAll(paletteList);
    paletteList.innerHTML = '';

    matches.forEach((command) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'palette-item';
      button.textContent = command.label;
      button.addEventListener('click', () => {
        closeModal(paletteModal);
        command.run();
      });
      li.appendChild(button);
      paletteList.appendChild(li);
    });
  };

  const openPalette = () => {
    paletteInput.value = '';
    renderPalette();
    openModal(paletteModal);
    paletteInput.focus();
  };

  const closePalette = () => closeModal(paletteModal);

  paletteInput.addEventListener('input', renderPalette);

  return { openPalette, closePalette };
};
