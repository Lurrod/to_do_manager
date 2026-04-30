document.addEventListener('DOMContentLoaded', () => {
  const API_BASE_URL = '/';
  const PAGE_SIZE = 5;

  const $ = (id) => document.getElementById(id);

  const taskForm = $('task-form');
  const taskList = $('task-list');
  const taskTitleInput = $('task-title');
  const taskDescInput = $('task-desc');
  const taskDueInput = $('task-due-date');
  const taskCategorySelect = $('task-category');
  const sortSelect = $('sort-select');
  const searchInput = $('search-input');

  const editModal = $('edit-modal');
  const editTitle = $('edit-title');
  const editDesc = $('edit-desc');
  const editDueDate = $('edit-due-date');
  const editCategory = $('edit-category');
  const saveEditBtn = $('save-edit');
  const closeEditModalBtn = $('close-modal');

  const deleteModal = $('delete-modal');
  const confirmDeleteBtn = $('confirm-delete');
  const cancelDeleteBtn = $('cancel-delete');

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
  const toastContainer = $('toast-container');
  const subtitle = $('subtitle');

  const statTotal = $('stat-total');
  const statDone = $('stat-done');
  const statActive = $('stat-active');

  const filterPills = document.querySelectorAll('.pill');

  let state = {
    currentTaskId: null,
    currentPage: 1,
    totalPages: 1,
    totalCount: 0,
    doneCount: 0,
    tasks: [],
    sortMethod: 'creation',
    statusFilter: 'all',
    categoryFilter: 'all',
    searchQuery: '',
    categories: [],
    categoryToDelete: null,
  };

  /* ----------------------------------------------------------------------
     Utilities
     ---------------------------------------------------------------------- */

  const escapeHtml = (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const formatDate = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const now = new Date();
    const sameDay = (a, b) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (sameDay(d, now)) return `Aujourd'hui · ${time}`;
    if (sameDay(d, tomorrow)) return `Demain · ${time}`;
    if (sameDay(d, yesterday)) return `Hier · ${time}`;
    return d.toLocaleString('fr-FR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const dueStatus = (iso) => {
    if (!iso) return 'none';
    const due = new Date(iso).getTime();
    const now = Date.now();
    if (Number.isNaN(due)) return 'none';
    if (due < now) return 'overdue';
    if (due - now < 24 * 60 * 60 * 1000) return 'soon';
    return 'ok';
  };

  const toLocalDatetimeInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const toIso = (datetimeLocal) => {
    if (!datetimeLocal) return null;
    const d = new Date(datetimeLocal);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  };

  const toast = (message, variant = 'info') => {
    const el = document.createElement('div');
    el.className = `toast ${variant}`;
    el.textContent = message;
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 3100);
  };

  const openModal = (modal) => modal.classList.add('active');
  const closeModal = (modal) => modal.classList.remove('active');

  /* ----------------------------------------------------------------------
     API
     ---------------------------------------------------------------------- */

  const api = async (path, options = {}) => {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Erreur ${res.status}`);
    }
    if (res.status === 204) return null;
    return res.json();
  };

  const fetchCategories = async () => {
    try {
      state.categories = await api('categories');
      updateCategorySelects();
      updateCategoriesList();
    } catch (error) {
      toast('Impossible de charger les catégories.', 'error');
    }
  };

  const addCategory = async (name, color) => {
    if (!name) return;
    if (state.categories.some((c) => c.name === name)) {
      toast('Cette catégorie existe déjà.', 'error');
      return;
    }
    try {
      await api('categories', {
        method: 'POST',
        body: JSON.stringify({ name, color }),
      });
      await fetchCategories();
      toast(`Catégorie « ${name} » ajoutée.`, 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const deleteCategory = async (name) => {
    try {
      await api(`categories/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (state.categoryFilter === name) state.categoryFilter = 'all';
      await fetchCategories();
      await fetchTasks(state.currentPage);
      closeModal(deleteCategoryModal);
      toast('Catégorie supprimée.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const fetchTasks = async (page = 1) => {
    try {
      skeletonList.classList.remove('hidden');
      taskList.style.opacity = '0.4';
      const data = await api(`tasks?page=${page}&limit=${PAGE_SIZE}`);
      state.tasks = data.tasks || [];
      state.totalPages = Math.max(1, data.totalPages || 1);
      state.currentPage = data.currentPage || 1;
      render();
    } catch (error) {
      toast('Impossible de charger les tâches.', 'error');
    } finally {
      skeletonList.classList.add('hidden');
      taskList.style.opacity = '';
    }
  };

  const fetchAllForStats = async () => {
    try {
      const data = await api(`tasks?page=1&limit=10000`);
      const all = data.tasks || [];
      state.totalCount = all.length;
      state.doneCount = all.filter((t) => t.completed).length;
      statTotal.textContent = state.totalCount;
      statDone.textContent = state.doneCount;
      statActive.textContent = state.totalCount - state.doneCount;
      updateSubtitle();
      updateProgress();
    } catch {
      // silent — stats are non-critical
    }
  };

  /* ----------------------------------------------------------------------
     Rendering
     ---------------------------------------------------------------------- */

  const sortTasks = (tasks) => {
    const sorted = [...tasks];
    if (state.sortMethod === 'creation') {
      sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else if (state.sortMethod === 'dueDate') {
      sorted.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate) - new Date(b.dueDate);
      });
    }
    return sorted;
  };

  const filterTasks = (tasks) => {
    return tasks.filter((task) => {
      if (state.categoryFilter !== 'all' && task.category !== state.categoryFilter) return false;
      if (state.statusFilter === 'active' && task.completed) return false;
      if (state.statusFilter === 'done' && !task.completed) return false;
      if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        const haystack = `${task.title || ''} ${task.description || ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  };

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
    });
  };

  const updateCategoriesList = () => {
    const allItem = `
      <li class="category-item ${state.categoryFilter === 'all' ? 'active' : ''}" data-category="all">
        <div class="category-content">
          <span class="category-dot" style="background: var(--text-muted)"></span>
          <span class="category-name">Toutes les tâches</span>
        </div>
        <span class="category-count" data-count="all">0</span>
      </li>
    `;

    const items = state.categories.map((category) => {
      const isActive = state.categoryFilter === category.name;
      return `
        <li class="category-item ${isActive ? 'active' : ''}" data-category="${escapeHtml(category.name)}">
          <div class="category-content">
            <span class="category-dot" style="background: ${escapeHtml(category.color)}"></span>
            <span class="category-name">${escapeHtml(category.name)}</span>
          </div>
          <span class="category-count" data-count="${escapeHtml(category.name)}">0</span>
          <button class="delete-category" data-category="${escapeHtml(category.name)}" aria-label="Supprimer ${escapeHtml(category.name)}">×</button>
        </li>
      `;
    });

    categoriesList.innerHTML = allItem + items.join('');

    document.querySelectorAll('.category-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.delete-category')) return;
        state.categoryFilter = item.dataset.category;
        render();
      });
    });

    document.querySelectorAll('.delete-category').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.categoryToDelete = btn.dataset.category;
        deleteCategoryMessage.textContent = `La catégorie « ${state.categoryToDelete} » sera retirée des tâches associées.`;
        openModal(deleteCategoryModal);
      });
    });
  };

  const updateCategoryCounts = () => {
    document.querySelectorAll('.category-count').forEach((el) => {
      const key = el.dataset.count;
      if (key === 'all') {
        el.textContent = state.tasks.length;
      } else {
        el.textContent = state.tasks.filter((t) => t.category === key).length;
      }
    });
  };

  const renderTaskItem = (task) => {
    const li = document.createElement('li');
    li.className = `task-item${task.completed ? ' completed' : ''}`;

    const category = state.categories.find((c) => c.name === task.category);
    const categoryColor = category ? category.color : 'var(--text-subtle)';
    const formattedDate = formatDate(task.dueDate);
    const ds = dueStatus(task.dueDate);

    const metaParts = [];
    if (formattedDate) {
      const cls = ds === 'overdue' ? 'overdue' : ds === 'soon' ? 'due-soon' : '';
      const label = ds === 'overdue' ? 'En retard' : 'Échéance';
      metaParts.push(
        `<span class="task-meta-item ${cls}">⏱ ${escapeHtml(label)} : ${escapeHtml(formattedDate)}</span>`
      );
    }
    if (task.category) {
      metaParts.push(
        `<span class="task-cat-tag" style="background: ${escapeHtml(categoryColor)}33; color: ${escapeHtml(categoryColor)}">${escapeHtml(task.category)}</span>`
      );
    }

    li.innerHTML = `
      <input type="checkbox" class="task-check" data-id="${task._id}" ${task.completed ? 'checked' : ''} aria-label="Marquer comme ${task.completed ? 'non terminée' : 'terminée'}" />
      <div class="task-body">
        <div class="task-title-row">
          <span class="task-cat-dot" style="background: ${escapeHtml(categoryColor)}"></span>
          <span class="task-title">${escapeHtml(task.title)}</span>
        </div>
        ${task.description ? `<p class="task-desc">${escapeHtml(task.description)}</p>` : ''}
        ${metaParts.length ? `<div class="task-meta">${metaParts.join('')}</div>` : ''}
      </div>
      <div class="task-actions">
        <button class="edit" data-id="${task._id}">Modifier</button>
        <button class="delete" data-id="${task._id}">Supprimer</button>
      </div>
    `;

    li.querySelector('.task-check').addEventListener('change', async (e) => {
      const taskId = e.target.dataset.id;
      const completed = e.target.checked;
      try {
        await api(`tasks/${taskId}`, {
          method: 'PUT',
          body: JSON.stringify({ completed }),
        });
        await fetchTasks(state.currentPage);
        fetchAllForStats();
      } catch (error) {
        toast(error.message, 'error');
        await fetchTasks(state.currentPage);
      }
    });

    li.querySelector('.edit').addEventListener('click', () => {
      state.currentTaskId = task._id;
      editTitle.value = task.title || '';
      editDesc.value = task.description || '';
      editDueDate.value = toLocalDatetimeInput(task.dueDate);
      editCategory.value = task.category || '';
      openModal(editModal);
      setTimeout(() => editTitle.focus(), 50);
    });

    li.querySelector('.delete').addEventListener('click', () => {
      state.currentTaskId = task._id;
      openModal(deleteModal);
    });

    return li;
  };

  const render = () => {
    const sorted = sortTasks(state.tasks);
    const filtered = filterTasks(sorted);

    taskList.innerHTML = '';
    filtered.forEach((task) => taskList.appendChild(renderTaskItem(task)));

    if (filtered.length === 0) {
      emptyState.classList.remove('hidden');
      if (state.searchQuery) {
        emptyState.querySelector('.empty-title').textContent = 'Aucun résultat.';
        emptyState.querySelector('.empty-sub').textContent = `Pas de tâche pour « ${state.searchQuery} ».`;
      } else if (state.statusFilter === 'done') {
        emptyState.querySelector('.empty-title').textContent = 'Aucune tâche terminée.';
        emptyState.querySelector('.empty-sub').textContent = 'Coche tes tâches pour les voir apparaître ici.';
      } else if (state.statusFilter === 'active' && state.tasks.length > 0) {
        emptyState.querySelector('.empty-title').textContent = 'Tout est fait.';
        emptyState.querySelector('.empty-sub').textContent = 'Pas de tâche en attente sur cette page.';
      } else {
        emptyState.querySelector('.empty-title').textContent = 'Rien à faire ici.';
        emptyState.querySelector('.empty-sub').textContent = 'Ajoute ta première tâche ci-dessus pour démarrer.';
      }
    } else {
      emptyState.classList.add('hidden');
    }

    pageInfo.textContent = `Page ${state.currentPage} / ${state.totalPages}`;
    prevPageBtn.disabled = state.currentPage <= 1;
    nextPageBtn.disabled = state.currentPage >= state.totalPages;

    updateCategoriesList();
    updateCategoryCounts();
    updateGreeting();
    updateSubtitle();
    updateProgress();
  };

  const updateProgress = () => {
    const total = state.totalCount;
    const ratio = total > 0 ? state.doneCount / total : 0;
    const bar = document.getElementById('progress-bar');
    const label = document.getElementById('progress-label');
    if (bar) bar.style.width = `${Math.round(ratio * 100)}%`;
    if (label) label.textContent = total > 0 ? `${Math.round(ratio * 100)}%` : '–';
  };

  const greetingForHour = (hour) => {
    if (hour < 5) return 'Bonsoir';
    if (hour < 12) return 'Bonjour';
    if (hour < 18) return 'Bon après-midi';
    return 'Bonsoir';
  };

  const updateGreeting = () => {
    const greetEl = document.querySelector('.display .greeting');
    if (!greetEl) return;
    greetEl.textContent = greetingForHour(new Date().getHours());
  };

  const updateSubtitle = () => {
    const total = state.totalCount;
    const remaining = total - state.doneCount;
    if (total === 0) {
      subtitle.textContent = "Aucune tâche pour l'instant. Ajoutes-en une pour commencer.";
    } else if (remaining === 0) {
      subtitle.textContent = 'Tout est fait. Bien joué.';
    } else if (remaining === 1) {
      subtitle.textContent = 'Une tâche reste à traiter.';
    } else {
      subtitle.textContent = `${remaining} tâches restent à traiter.`;
    }
  };

  /* ----------------------------------------------------------------------
     Events
     ---------------------------------------------------------------------- */

  taskForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = taskTitleInput.value.trim();
    if (!title) return;
    const description = taskDescInput.value.trim();
    const dueDate = toIso(taskDueInput.value);
    const category = taskCategorySelect.value;

    try {
      await api('tasks', {
        method: 'POST',
        body: JSON.stringify({ title, description, dueDate, category }),
      });
      taskForm.reset();
      await fetchTasks(1);
      fetchAllForStats();
      toast('Tâche ajoutée.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  const submitCategoryForm = () => {
    const name = categoryInput.value.trim();
    const color = categoryColorInput.value || '#f3a366';
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
    state.sortMethod = e.target.value;
    render();
  });

  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim();
    render();
  });

  filterPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      filterPills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      state.statusFilter = pill.dataset.filter;
      render();
    });
  });

  saveEditBtn.addEventListener('click', async () => {
    if (!state.currentTaskId) return;
    try {
      await api(`tasks/${state.currentTaskId}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: editTitle.value.trim(),
          description: editDesc.value.trim(),
          dueDate: toIso(editDueDate.value),
          category: editCategory.value,
        }),
      });
      closeModal(editModal);
      await fetchTasks(state.currentPage);
      fetchAllForStats();
      toast('Tâche modifiée.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  closeEditModalBtn.addEventListener('click', () => closeModal(editModal));

  confirmDeleteBtn.addEventListener('click', async () => {
    if (!state.currentTaskId) return;
    try {
      await api(`tasks/${state.currentTaskId}`, { method: 'DELETE' });
      closeModal(deleteModal);
      await fetchTasks(state.currentPage);
      fetchAllForStats();
      toast('Tâche supprimée.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  cancelDeleteBtn.addEventListener('click', () => closeModal(deleteModal));

  confirmDeleteCategoryBtn.addEventListener('click', () => {
    if (state.categoryToDelete) {
      deleteCategory(state.categoryToDelete);
      state.categoryToDelete = null;
    }
  });

  cancelDeleteCategoryBtn.addEventListener('click', () => {
    closeModal(deleteCategoryModal);
    state.categoryToDelete = null;
  });

  prevPageBtn.addEventListener('click', () => {
    if (state.currentPage > 1) fetchTasks(state.currentPage - 1);
  });

  nextPageBtn.addEventListener('click', () => {
    if (state.currentPage < state.totalPages) fetchTasks(state.currentPage + 1);
  });

  // Close modals with Escape, click on backdrop
  document.querySelectorAll('.modal').forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      [editModal, deleteModal, deleteCategoryModal].forEach(closeModal);
    }
    if (e.key === '/' && document.activeElement !== searchInput && !e.target.matches('input, textarea')) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  /* ----------------------------------------------------------------------
     Init
     ---------------------------------------------------------------------- */

  (async () => {
    await fetchCategories();
    await fetchAllForStats();
    await fetchTasks();
  })();
});
