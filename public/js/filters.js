/* ---------------------------------------------------------------------------
   Cahier — filtres : les deux rangées de pastilles (statut, échéance).
   Un seul sujet, une seule invariante à tenir : les deux rangées ne doivent
   jamais raconter un statut et une échéance incompatibles entre eux.
   --------------------------------------------------------------------------- */

import { setVariant } from './sketch.js';
import { $ } from './util.js';

// `.pill` est porté par les deux rangées : on les sépare sur leur attribut
const filterPills = [...document.querySelectorAll('.pill[data-filter]')];
const duePills = [...document.querySelectorAll('.due-pill')];
const dueOverdueCount = $('due-overdue-count');

/** Marque une pastille comme seule active de sa rangée. */
const activatePill = (pills, target) => {
  pills.forEach((p) => {
    const isTarget = p === target;
    p.classList.toggle('is-active', isTarget);
    // sans cet état, une aide technique ne sait pas quel filtre est appliqué :
    // la classe CSS et le trait drawably ne disent rien à personne d'autre
    p.setAttribute('aria-pressed', String(isTarget));
    setVariant(p, isTarget ? 'solid' : null);
  });
};

/** Reporte le nombre de tâches en retard sur le badge et la pastille. */
export const showOverdueCount = (count) => {
  dueOverdueCount.textContent = count;
  dueOverdueCount.hidden = count === 0;

  // sans cela le nom accessible du bouton devient « En retard 3 », un nombre
  // posé là sans dire de quoi il parle
  const overduePill = duePills.find((p) => p.dataset.due === 'overdue');
  overduePill.setAttribute(
    'aria-label',
    count === 0 ? 'En retard' : `En retard, ${count} tâche${count > 1 ? 's' : ''}`
  );
};

/**
 * Accorde les deux rangées entre elles.
 *
 * Les réglages d'ouverture sont deux champs indépendants ; rien n'empêche d'y
 * enregistrer « toutes les tâches » et « en retard », qui ne vont pas ensemble.
 * C'est la même règle que celle tenue au clic : le retard se lit parmi ce
 * qui reste à faire.
 */
export const accorderOuverture = ({ statut, horizon }) =>
  horizon === 'overdue' ? { statut: 'active', horizon } : { statut, horizon };

/**
 * Pose les deux rangées sans rien recharger.
 *
 * Passer par un clic déclencherait un chargement de plus au démarrage, et un
 * bref affichage de la mauvaise vue avant la bonne.
 */
export const appliquerOuverture = ({ statut, horizon }) => {
  activatePill(
    filterPills,
    filterPills.find((p) => p.dataset.filter === statut)
  );
  activatePill(
    duePills,
    duePills.find((p) => p.dataset.due === horizon)
  );
};

/** Active l'horizon nommé, comme si sa pastille était cliquée. */
export const selectDue = (due) => {
  duePills.find((p) => p.dataset.due === due)?.click();
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
        activatePill(
          duePills,
          duePills.find((p) => p.dataset.due === due)
        );
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
        activatePill(
          filterPills,
          filterPills.find((p) => p.dataset.filter === status)
        );
      }

      setState({ due, status });
      refresh({ page: 1 });
    });
  });
};
