/* ---------------------------------------------------------------------------
   Cahier — logique de l'application.
   Le serveur trie, filtre et cherche ; le client affiche la page qu'il reçoit
   et annote le HTML (data-sketch=…) pour que sketch.js y pose les traits.
   --------------------------------------------------------------------------- */

import * as api from './api.js';
import { bindBackdrop, closeModal, isModalOpen, openModal } from './modal.js';

import {
  progress,
  resketch,
  setText,
  setVariant,
  sketchAll,
  strike,
  unsketchAll,
} from './sketch.js';

import {
  $,
  dueStatus,
  escapeHtml,
  formatDate,
  greetingForHour,
  safeColor,
  toIso,
  toLocalDatetimeInput,
  toast,
} from './util.js';

const PAGE_SIZE = 5;
const HIGHLIGHTER = '#f3d15b';
const NEUTRAL_COLOR = 'var(--ink-faint)';
const SEARCH_DEBOUNCE_MS = 150;
const PRIORITY_LABELS = { high: 'haute', medium: 'moyenne', low: 'basse' };

const taskForm = $('task-form');
const taskList = $('task-list');
const taskTitleInput = $('task-title');
const taskDescInput = $('task-desc');
const taskDueInput = $('task-due-date');
const taskCategorySelect = $('task-category');
const taskPrioritySelect = $('task-priority');
const sortSelect = $('sort-select');
const searchInput = $('search-input');

const editModal = $('edit-modal');
const editTitle = $('edit-title');
const editDesc = $('edit-desc');
const editDueDate = $('edit-due-date');
const editCategory = $('edit-category');
const editPriority = $('edit-priority');
const saveEditBtn = $('save-edit');
const closeEditModalBtn = $('close-modal');

const deleteCategoryModal = $('delete-category-modal');
const confirmDeleteCategoryBtn = $('confirm-delete-category');
const cancelDeleteCategoryBtn = $('cancel-delete-category');
const deleteCategoryMessage = $('delete-category-message');

const prevPageBtn = $('prev-page');
const nextPageBtn = $('next-page');
const pageInfo = $('page-info');

const categoryForm = $('category-form');
const categoryInput = $('category-input');
const categoryColorInput = $('category-color-input');
const addCategoryBtn = $('add-category-btn');
const categoriesList = $('categories-list');

const emptyState = $('empty-state');
const skeletonList = $('loading-skeleton');
const subtitle = $('subtitle');
const progressTrack = $('progress-track');
const progressLabel = $('progress-label');

const statTotal = $('stat-total');
const statDone = $('stat-done');
const statActive = $('stat-active');

const filterPills = [...document.querySelectorAll('.pill')];

let state = {
  tasks: [],
  totalPages: 1,
  currentPage: 1,
  sort: 'creation',
  status: 'all',
  category: 'all',
  query: '',
  categories: [],
  stats: { total: 0, done: 0, active: 0, byCategory: [] },
  currentTaskId: null,
  categoryToDelete: null,
};

/* ----------------------------------------------------------------------
   Chargement
   ---------------------------------------------------------------------- */

const queryFor = (page) => ({
  page,
  limit: PAGE_SIZE,
  sort: state.sort,
  status: state.status,
  category: state.category,
  q: state.query,
});

// deux frappes rapprochées lancent deux requêtes : seule la dernière compte,
// sans quoi une réponse lente écraserait un résultat plus récent
let pendingRequest = 0;

/**
 * Recharge la page courante et les compteurs.
 * @param {{page?: number, silent?: boolean}} options `silent` évite le squelette
 * quand l'écran a déjà été mis à jour de façon optimiste.
 */
const refresh = async ({ page = state.currentPage, silent = false } = {}) => {
  const ticket = ++pendingRequest;

  if (!silent) {
    skeletonList.classList.remove('hidden');
    taskList.style.opacity = '0.4';
  }

  try {
    const [list, stats] = await Promise.all([api.listTasks(queryFor(page)), api.fetchStats()]);
    if (ticket !== pendingRequest) return;

    state = {
      ...state,
      tasks: list.tasks || [],
      totalPages: Math.max(1, list.totalPages || 1),
      currentPage: list.currentPage || 1,
      stats,
    };
    render();
  } catch (error) {
    if (ticket === pendingRequest) toast(error.message, 'error');
  } finally {
    if (ticket === pendingRequest) {
      skeletonList.classList.add('hidden');
      taskList.style.opacity = '';
    }
  }
};

const loadCategories = async () => {
  try {
    state = { ...state, categories: await api.listCategories() };
    updateCategorySelects();
  } catch (error) {
    toast('Impossible de charger les catégories.', 'error');
  }
};

/* ----------------------------------------------------------------------
   Actions
   ---------------------------------------------------------------------- */

const addCategory = async (name, color) => {
  if (state.categories.some((c) => c.name === name)) {
    toast('Cette catégorie existe déjà.', 'error');
    return;
  }
  try {
    await api.createCategory(name, color);
    await loadCategories();
    await refresh({ silent: true });
    toast(`Catégorie « ${name} » ajoutée.`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
};

const removeCategory = async (name) => {
  try {
    await api.deleteCategory(name);
    if (state.category === name) state = { ...state, category: 'all' };
    await loadCategories();
    await refresh({ page: 1 });
    closeModal(deleteCategoryModal);
    toast('Catégorie supprimée.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
};

/** Bascule affichée immédiatement, puis confirmée par le serveur. */
const toggleTask = async (task, completed) => {
  const delta = completed ? 1 : -1;
  state = {
    ...state,
    tasks: state.tasks.map((t) => (t._id === task._id ? { ...t, completed } : t)),
    stats: {
      ...state.stats,
      done: state.stats.done + delta,
      active: state.stats.active - delta,
    },
  };
  render();

  try {
    await api.updateTask(task._id, { completed });
  } catch (error) {
    toast(error.message, 'error');
  }
  await refresh({ silent: true });
};

/** Suppression immédiate, réparable tant que la note « Annuler » est affichée. */
const removeTask = async (task) => {
  state = { ...state, tasks: state.tasks.filter((t) => t._id !== task._id) };
  render();

  try {
    await api.deleteTask(task._id);
    toast('Tâche supprimée.', 'info', {
      label: 'Annuler',
      onClick: () => restoreTask(task._id),
    });
  } catch (error) {
    toast(error.message, 'error');
  }
  await refresh({ silent: true });
};

const restoreTask = async (id) => {
  try {
    await api.restoreTask(id);
    await refresh({ silent: true });
    toast('Tâche restaurée.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
};

/* ----------------------------------------------------------------------
   Rendu
   ---------------------------------------------------------------------- */

const updateCategorySelects = () => {
  [taskCategorySelect, editCategory].forEach((select) => {
    const current = select.value;
    select.innerHTML = '<option value="">Sans catégorie</option>';
    state.categories.forEach((category) => {
      const opt = document.createElement('option');
      opt.value = category.name;
      opt.textContent = category.name;
      select.appendChild(opt);
    });
    if (current) select.value = current;
    // la largeur du croquis est mesurée à l'attache : on redessine après coup
    resketch(select.closest('[data-sketch="select"]'));
  });
};

const categoryRow = (name, label, color, count) => {
  const isActive = state.category === name;
  const li = document.createElement('li');
  li.className = 'cat-item';
  li.dataset.category = name;
  li.innerHTML = `
    <span class="cat-dot" style="background: ${escapeHtml(color)}"></span>
    <span class="cat-name"${isActive ? ` data-sketch="highlight" data-stroke="${HIGHLIGHTER}"` : ''}>${escapeHtml(label)}</span>
    <span class="cat-count">${count}</span>
    ${name === 'all' ? '' : `<button class="cat-delete" type="button" data-category="${escapeHtml(name)}" aria-label="Supprimer ${escapeHtml(name)}">×</button>`}
  `;
  return li;
};

const renderCategories = () => {
  const counts = new Map(state.stats.byCategory.map(({ category, count }) => [category, count]));

  unsketchAll(categoriesList);
  categoriesList.innerHTML = '';
  categoriesList.appendChild(
    categoryRow('all', 'Toutes les tâches', NEUTRAL_COLOR, state.stats.total)
  );
  state.categories.forEach((category) => {
    categoriesList.appendChild(
      categoryRow(
        category.name,
        category.name,
        safeColor(category.color, NEUTRAL_COLOR),
        counts.get(category.name) || 0
      )
    );
  });

  categoriesList.querySelectorAll('.cat-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.cat-delete')) return;
      state = { ...state, category: item.dataset.category };
      refresh({ page: 1 });
    });
  });

  categoriesList.querySelectorAll('.cat-delete').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state = { ...state, categoryToDelete: btn.dataset.category };
      deleteCategoryMessage.textContent = `La catégorie « ${state.categoryToDelete} » sera retirée des tâches associées.`;
      openModal(deleteCategoryModal);
    });
  });

  sketchAll(categoriesList);
};

const priorityMark = (priority) => {
  if (!PRIORITY_LABELS[priority]) return '';
  return `<span class="task-prio" data-level="${priority}" role="img" aria-label="Priorité ${PRIORITY_LABELS[priority]}">*</span>`;
};

const renderTaskItem = (task) => {
  const li = document.createElement('li');
  li.className = `task${task.completed ? ' is-done' : ''}`;
  li.dataset.sketch = 'card';

  const category = state.categories.find((c) => c.name === task.category);
  const categoryColor = safeColor(category?.color, NEUTRAL_COLOR);
  const formattedDate = formatDate(task.dueDate);
  const status = dueStatus(task.dueDate);

  const metaParts = [];
  if (formattedDate) {
    const cls = status === 'overdue' ? ' is-overdue' : status === 'soon' ? ' is-soon' : '';
    const label = status === 'overdue' ? 'En retard' : 'Échéance';
    metaParts.push(
      `<span class="task-due${cls}">${escapeHtml(label)} · ${escapeHtml(formattedDate)}</span>`
    );
  }
  if (task.category) {
    metaParts.push(
      `<span class="tag" data-sketch="badge" data-stroke="${escapeHtml(categoryColor)}">${escapeHtml(task.category)}</span>`
    );
  }

  li.innerHTML = `
    <span class="task-check" data-sketch="checkbox">
      <input type="checkbox" ${task.completed ? 'checked' : ''} aria-label="Marquer comme ${task.completed ? 'non terminée' : 'terminée'}" />
    </span>
    <div class="task-body">
      <span class="task-title">${priorityMark(task.priority)}${escapeHtml(task.title)}</span>
      ${task.description ? `<p class="task-desc">${escapeHtml(task.description)}</p>` : ''}
      ${metaParts.length ? `<div class="task-meta">${metaParts.join('')}</div>` : ''}
    </div>
    <div class="task-actions">
      <button class="btn edit" type="button" data-sketch="button" data-tone="neutral">Modifier</button>
      <button class="btn delete" type="button" data-sketch="button" data-tone="danger">Supprimer</button>
    </div>
  `;

  li.querySelector('.task-check input').addEventListener('change', (e) => {
    toggleTask(task, e.target.checked);
  });

  li.querySelector('.edit').addEventListener('click', () => {
    state = { ...state, currentTaskId: task._id };
    editTitle.value = task.title || '';
    editDesc.value = task.description || '';
    editDueDate.value = toLocalDatetimeInput(task.dueDate);
    editCategory.value = task.category || '';
    editPriority.value = task.priority || '';
    openModal(editModal);
  });

  li.querySelector('.delete').addEventListener('click', () => removeTask(task));

  return li;
};

const EMPTY_COPY = {
  search: ['Rien sous ce mot.', 'Aucune tâche ne contient « %s ».'],
  done: ['Aucune tâche rayée.', 'Coche une tâche pour la barrer d’un trait.'],
  cleared: ['Tout est rayé.', 'Plus rien en attente.'],
  category: ['Catégorie vide.', 'Aucune tâche rangée ici pour le moment.'],
  blank: ['Page blanche.', 'Écris ta première tâche là-haut pour commencer.'],
};

const updateEmptyState = () => {
  if (state.tasks.length > 0) {
    emptyState.classList.add('hidden');
    return;
  }

  let key = 'blank';
  if (state.query) key = 'search';
  else if (state.status === 'done') key = 'done';
  else if (state.status === 'active' && state.stats.total > 0) key = 'cleared';
  else if (state.category !== 'all') key = 'category';

  const [title, sub] = EMPTY_COPY[key];
  emptyState.querySelector('.empty-title').textContent = title;
  emptyState.querySelector('.empty-sub').textContent = sub.replace('%s', state.query);
  emptyState.classList.remove('hidden');
  sketchAll(emptyState);
};

const render = () => {
  // les croquis tiennent un ResizeObserver sur leur hôte : on les détache
  // avant de jeter le DOM qui les porte
  unsketchAll(taskList);
  taskList.innerHTML = '';

  const rendered = state.tasks.map((task) => ({ task, li: renderTaskItem(task) }));
  rendered.forEach(({ li }) => taskList.appendChild(li));
  sketchAll(taskList);

  // le trait de biffage se mesure sur le titre une fois mis en page
  rendered.forEach(({ task, li }) => {
    if (task.completed) strike(li.querySelector('.task-title'));
  });

  updateEmptyState();

  pageInfo.textContent = `Page ${state.currentPage} / ${state.totalPages}`;
  prevPageBtn.disabled = state.currentPage <= 1;
  nextPageBtn.disabled = state.currentPage >= state.totalPages;

  renderCategories();
  updateGreeting();
  updateCounters();
};

const updateCounters = () => {
  const { total, done, active } = state.stats;
  statTotal.textContent = total;
  statDone.textContent = done;
  setText(statActive, active);

  const ratio = total > 0 ? done / total : 0;
  progress(progressTrack, ratio);
  progressLabel.textContent = total > 0 ? `${Math.round(ratio * 100)}%` : '–';

  if (total === 0) {
    subtitle.textContent = "Le cahier est vierge. Ajoute une ligne pour l'ouvrir.";
  } else if (active === 0) {
    subtitle.textContent = 'Tout est rayé. Bien joué.';
  } else if (active === 1) {
    subtitle.textContent = 'Une tâche reste à traiter.';
  } else {
    subtitle.textContent = `${active} tâches restent à traiter.`;
  }
};

const updateGreeting = () => {
  setText(document.querySelector('.display .greeting'), greetingForHour(new Date().getHours()));
};

/* ----------------------------------------------------------------------
   Événements
   ---------------------------------------------------------------------- */

taskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = taskTitleInput.value.trim();
  if (!title) return;

  try {
    await api.createTask({
      title,
      description: taskDescInput.value.trim(),
      dueDate: toIso(taskDueInput.value),
      category: taskCategorySelect.value,
      priority: taskPrioritySelect.value,
    });
    taskForm.reset();
    await refresh({ page: 1 });
    toast('Tâche ajoutée.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
});

const submitCategoryForm = () => {
  const name = categoryInput.value.trim();
  const color = categoryColorInput.value || '#1f2f5c';
  if (!name) {
    categoryInput.focus();
    return;
  }
  addCategory(name, color);
  categoryInput.value = '';
  categoryInput.focus();
};

categoryForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitCategoryForm();
});

addCategoryBtn.addEventListener('click', (e) => {
  e.preventDefault();
  submitCategoryForm();
});

sortSelect.addEventListener('change', (e) => {
  state = { ...state, sort: e.target.value };
  refresh({ page: 1 });
});

let searchTimer = null;
searchInput.addEventListener('input', (e) => {
  const query = e.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state = { ...state, query };
    refresh({ page: 1 });
  }, SEARCH_DEBOUNCE_MS);
});

filterPills.forEach((pill) => {
  pill.addEventListener('click', () => {
    filterPills.forEach((p) => {
      p.classList.remove('is-active');
      setVariant(p, null);
    });
    pill.classList.add('is-active');
    setVariant(pill, 'solid');
    state = { ...state, status: pill.dataset.filter };
    refresh({ page: 1 });
  });
});

saveEditBtn.addEventListener('click', async () => {
  if (!state.currentTaskId) return;
  try {
    await api.updateTask(state.currentTaskId, {
      title: editTitle.value.trim(),
      description: editDesc.value.trim(),
      dueDate: toIso(editDueDate.value),
      category: editCategory.value,
      priority: editPriority.value,
    });
    closeModal(editModal);
    await refresh();
    toast('Tâche modifiée.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
});

closeEditModalBtn.addEventListener('click', () => closeModal(editModal));

confirmDeleteCategoryBtn.addEventListener('click', () => {
  if (state.categoryToDelete) {
    removeCategory(state.categoryToDelete);
    state = { ...state, categoryToDelete: null };
  }
});

cancelDeleteCategoryBtn.addEventListener('click', () => {
  closeModal(deleteCategoryModal);
  state = { ...state, categoryToDelete: null };
});

prevPageBtn.addEventListener('click', () => {
  if (state.currentPage > 1) refresh({ page: state.currentPage - 1 });
});

nextPageBtn.addEventListener('click', () => {
  if (state.currentPage < state.totalPages) refresh({ page: state.currentPage + 1 });
});

document.querySelectorAll('.modal').forEach(bindBackdrop);

document.addEventListener('keydown', (e) => {
  if (isModalOpen()) return;
  if (e.key === '/' && document.activeElement !== searchInput && !e.target.matches('input, textarea')) {
    e.preventDefault();
    searchInput.focus();
  }
});

/* ----------------------------------------------------------------------
   Démarrage
   ---------------------------------------------------------------------- */

sketchAll();
updateGreeting();

(async () => {
  // les catégories d'abord : le rendu des tâches y lit les couleurs
  await loadCategories();
  await refresh({ page: 1 });
})();
