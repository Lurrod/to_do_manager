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

  // Liste courante (après filtre) et ligne mise en avant : le focus réel
  // reste dans le champ, cette sélection n'existe que sur ces deux variables
  // et ce qu'elles reflètent dans le DOM (motif ARIA combobox + listbox).
  let matches = [];
  let selectedIndex = 0;

  /** Reporte `selectedIndex` sur le DOM : classe visible, aria-selected, aria-activedescendant. */
  const updateSelection = () => {
    const rows = [...paletteList.children];
    rows.forEach((row, index) => {
      const selected = index === selectedIndex;
      row.setAttribute('aria-selected', String(selected));
      row.classList.toggle('is-selected', selected);
    });

    const current = rows[selectedIndex];
    if (current) paletteInput.setAttribute('aria-activedescendant', current.id);
    else paletteInput.removeAttribute('aria-activedescendant');
  };

  const renderPalette = () => {
    const needle = paletteInput.value.trim().toLowerCase();
    matches = PALETTE_COMMANDS.filter(({ label }) => label.toLowerCase().includes(needle));
    selectedIndex = 0;

    unsketchAll(paletteList);
    paletteList.innerHTML = '';

    // La ligne EST l'option : un descendant interactif dans un role="option"
    // n'est pas exposé correctement en mode liste par les lecteurs d'écran.
    matches.forEach((command, index) => {
      const li = document.createElement('li');
      li.id = `palette-option-${index}`;
      li.setAttribute('role', 'option');
      li.className = 'palette-item';
      li.textContent = command.label;
      li.addEventListener('click', () => {
        closeModal(paletteModal);
        command.run();
      });
      paletteList.appendChild(li);
    });

    updateSelection();
  };

  /** Déplace la sélection en bouclant d'un bout à l'autre de la liste. */
  const moveSelection = (delta) => {
    if (matches.length === 0) return;
    selectedIndex = (selectedIndex + delta + matches.length) % matches.length;
    updateSelection();
  };

  const runSelected = () => {
    const command = matches[selectedIndex];
    if (!command) return;
    closeModal(paletteModal);
    command.run();
  };

  const onPaletteKeydown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runSelected();
    }
  };

  const openPalette = () => {
    paletteInput.value = '';
    renderPalette();
    openModal(paletteModal);
    paletteInput.focus();
  };

  const closePalette = () => closeModal(paletteModal);

  paletteInput.addEventListener('input', renderPalette);
  paletteInput.addEventListener('keydown', onPaletteKeydown);

  return { openPalette, closePalette };
};
