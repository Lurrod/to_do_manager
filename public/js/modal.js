/* ---------------------------------------------------------------------------
   Modales : ouverture, fermeture, et piège de focus.
   Une boîte marquée aria-modal doit retenir la tabulation et rendre le focus
   à l'élément qui l'a ouverte.
   --------------------------------------------------------------------------- */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

let openDialog = null;
let opener = null;

const focusables = (modal) => [...modal.querySelectorAll(FOCUSABLE)];

const onKeydown = (event) => {
  if (!openDialog) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeModal(openDialog);
    return;
  }

  if (event.key !== 'Tab') return;

  const items = focusables(openDialog);
  if (items.length === 0) return;

  const first = items[0];
  const last = items[items.length - 1];
  const current = document.activeElement;
  const outside = !openDialog.contains(current);

  if (event.shiftKey && (current === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (current === last || outside)) {
    event.preventDefault();
    first.focus();
  }
};

export const isModalOpen = () => Boolean(openDialog);

export function openModal(modal) {
  if (!modal || openDialog === modal) return;
  opener = document.activeElement;
  openDialog = modal;
  modal.classList.add('active');
  focusables(modal)[0]?.focus();
  document.addEventListener('keydown', onKeydown, true);
}

export function closeModal(modal) {
  if (!modal) return;
  modal.classList.remove('active');
  if (openDialog !== modal) return;

  openDialog = null;
  document.removeEventListener('keydown', onKeydown, true);
  // le focus revient là où l'utilisateur l'avait laissé
  if (opener && document.contains(opener)) opener.focus();
  opener = null;
}

/** Ferme la modale quand on clique en dehors de son contenu. */
export function bindBackdrop(modal) {
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal(modal);
  });
}
