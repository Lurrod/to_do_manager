/* ---------------------------------------------------------------------------
   Cahier — filtres : les deux rangées de pastilles (statut, échéance).
   Un seul sujet, une seule invariante à tenir : les deux rangées ne doivent
   jamais raconter un statut et une échéance incompatibles entre eux.
   --------------------------------------------------------------------------- */

import { setVariant } from './sketch.js';

// `.pill` est porté par les deux rangées : on les sépare sur leur attribut
export const filterPills = [...document.querySelectorAll('.pill[data-filter]')];
export const duePills = [...document.querySelectorAll('.due-pill')];

/** Marque une pastille comme seule active de sa rangée. */
export const activatePill = (pills, target) => {
  pills.forEach((p) => {
    const isTarget = p === target;
    p.classList.toggle('is-active', isTarget);
    // sans cet état, une aide technique ne sait pas quel filtre est appliqué :
    // la classe CSS et le trait drawably ne disent rien à personne d'autre
    p.setAttribute('aria-pressed', String(isTarget));
    setVariant(p, isTarget ? 'solid' : null);
  });
};

/**
 * Câble les deux rangées de pastilles de filtre.
 * @param {{
 *   getState: () => {status: string, due: string},
 *   setState: (patch: {status?: string, due?: string}) => void,
 *   refresh: (options?: {page?: number}) => Promise<void>,
 * }} deps
 */
export const initFilters = ({ getState, setState, refresh }) => {
  filterPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      const status = pill.dataset.filter;
      activatePill(filterPills, pill);

      // élargir le statut ferait diverger l'onglet « en retard » et son badge :
      // on quitte l'horizon plutôt que de le laisser mentir
      const due = getState().due === 'overdue' && status !== 'active' ? 'all' : getState().due;
      if (due !== getState().due) {
        activatePill(duePills, duePills.find((p) => p.dataset.due === due));
      }

      setState({ status, due });
      refresh({ page: 1 });
    });
  });

  duePills.forEach((pill) => {
    pill.addEventListener('click', () => {
      const due = pill.dataset.due;
      activatePill(duePills, pill);

      // le badge compte le travail qui reste : l'onglet doit montrer la même
      // chose, et la rangée « Statut » doit dire la vérité sur ce qui est filtré
      const status = due === 'overdue' ? 'active' : getState().status;
      if (status !== getState().status) {
        activatePill(filterPills, filterPills.find((p) => p.dataset.filter === status));
      }

      setState({ due, status });
      refresh({ page: 1 });
    });
  });
};
