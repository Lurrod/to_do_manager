/* ---------------------------------------------------------------------------
   Cahier — raccourcis clavier : navigation dans la liste des tâches et
   ouverture de la palette de commandes. Lit `state.cursor` et `state.tasks`
   via `getState` ; tout ce qu'elle ne peut pas faire elle-même (basculer,
   supprimer, focus, palette) lui est injecté.
   --------------------------------------------------------------------------- */

import { isModalOpen } from './modal.js';
import { $ } from './util.js';

const taskList = $('task-list');

/**
 * Câble les raccourcis clavier.
 * @param {{
 *   getState: () => {cursor: number, tasks: Array},
 *   setState: (patch: {cursor?: number}) => void,
 *   toggleTask: (task: object, completed: boolean) => Promise<void>,
 *   removeTask: (task: object) => Promise<void>,
 *   openPalette: () => void,
 *   closePalette: () => void,
 *   focusSearch: () => void,
 *   focusTitle: () => void,
 * }} deps
 * @returns {{applyCursor: () => void}} `applyCursor` est repris par `render()`
 * dans app.js, qui doit reporter le curseur sur le DOM après chaque rendu.
 */
export const initKeyboard = ({
  getState,
  setState,
  toggleTask,
  removeTask,
  openPalette,
  closePalette,
  focusSearch,
  focusTitle,
}) => {
  const taskAt = (index) => getState().tasks[index] || null;

  /**
   * Une frappe partie d'un champ appartient au champ, pas aux raccourcis.
   * `matches` n'existe que sur les éléments : un événement clavier envoyé au
   * document (ce que font les tests) a `document` pour cible, et appeler
   * `document.matches` lèverait une TypeError.
   */
  const isTyping = (target) =>
    typeof target?.matches === 'function' && target.matches('input, textarea, select');

  const applyCursor = () => {
    const rows = [...taskList.querySelectorAll('.task')];
    rows.forEach((row, index) => row.classList.toggle('is-cursor', index === getState().cursor));
  };

  /** Déplace le curseur clavier, en restant dans les bornes de la page affichée. */
  const moveCursor = (delta) => {
    if (getState().tasks.length === 0) return;
    const next = Math.min(getState().tasks.length - 1, Math.max(0, getState().cursor + delta));
    setState({ cursor: getState().cursor === -1 && delta > 0 ? 0 : next });
    applyCursor();
  };

  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      // la palette se referme sur elle-même ; une autre modale garde la main
      // (closePalette ne fait rien si ce n'est pas elle qui est ouverte)
      if (isModalOpen()) {
        closePalette();
        return;
      }
      openPalette();
      return;
    }

    if (isModalOpen()) return;
    // un raccourci d'une lettre ne doit jamais manger une frappe de saisie
    if (isTyping(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const cursorTask = taskAt(getState().cursor);

    switch (e.key) {
      case '/':
        e.preventDefault();
        focusSearch();
        break;
      case 'n':
        e.preventDefault();
        focusTitle();
        break;
      case 'j':
        e.preventDefault();
        moveCursor(1);
        break;
      case 'k':
        e.preventDefault();
        moveCursor(-1);
        break;
      case 'x':
        if (cursorTask) {
          e.preventDefault();
          toggleTask(cursorTask, !cursorTask.completed);
        }
        break;
      case 'e':
        if (cursorTask) {
          e.preventDefault();
          taskList.querySelectorAll('.task .edit')[getState().cursor]?.click();
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (cursorTask) {
          e.preventDefault();
          removeTask(cursorTask);
        }
        break;
      default:
        break;
    }
  });

  return { applyCursor };
};
