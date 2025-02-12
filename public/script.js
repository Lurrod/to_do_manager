document.addEventListener("DOMContentLoaded", () => {
  // Éléments DOM existants
  const taskForm = document.getElementById("task-form");
  const taskList = document.getElementById("task-list");
  const editModal = document.getElementById("edit-modal");
  const editTitle = document.getElementById("edit-title");
  const editDesc = document.getElementById("edit-desc");
  const editDueDate = document.getElementById("edit-due-date");
  const editCategory = document.getElementById("edit-category");
  const saveEditBtn = document.getElementById("save-edit");
  const closeEditModalBtn = document.getElementById("close-modal");
  const deleteModal = document.getElementById("delete-modal");
  const confirmDeleteBtn = document.getElementById("confirm-delete");
  const cancelDeleteBtn = document.getElementById("cancel-delete");
  const prevPageBtn = document.getElementById("prev-page");
  const nextPageBtn = document.getElementById("next-page");
  const pageInfo = document.getElementById("page-info");
  
  // Éléments pour les catégories
  const categoryInput = document.getElementById("category-input");
  const categoryColorInput = document.getElementById("category-color-input");
  const addCategoryBtn = document.getElementById("add-category-btn");
  const categoriesList = document.getElementById("categories-list");
  const taskCategorySelect = document.getElementById("task-category");

  // Variables d'état
  let currentTaskId = null;
  let currentPage = 1;
  let totalPages = 1;
  let currentTasks = [];
  let currentSortMethod = 'creation';
  let currentCategory = 'all';
  
  // Récupération des catégories du localStorage avec la nouvelle structure
  let categories = JSON.parse(localStorage.getItem('categories')) || [];
  // Conversion des anciennes catégories au nouveau format si nécessaire
  categories = categories.map(cat => {
    return typeof cat === 'string' ? { name: cat, color: '#ff7eb3' } : cat;
  });

  // Fonctions de tri
  const sortFunctions = {
    creation: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    dueDate: (a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    }
  };

  // Fonction pour sauvegarder les catégories
  const saveCategories = () => {
    localStorage.setItem('categories', JSON.stringify(categories));
    updateCategorySelects();
    updateCategoriesList();
  };

  // Fonction pour ajouter une nouvelle catégorie
  const addCategory = (name, color) => {
    if (name && !categories.some(cat => cat.name === name)) {
      categories.push({ name, color });
      saveCategories();
    }
  };

  // Fonction pour supprimer une catégorie
  const deleteCategory = (categoryName) => {
    const index = categories.findIndex(cat => cat.name === categoryName);
    if (index !== -1) {
      // Supprimer la catégorie des tâches existantes
      currentTasks.forEach(async (task) => {
        if (task.category === categoryName) {
          try {
            await fetch(`http://localhost:5000/tasks/${task._id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...task, category: '' }),
            });
          } catch (error) {
            console.error("Erreur lors de la mise à jour de la tâche:", error);
          }
        }
      });

      categories.splice(index, 1);
      if (currentCategory === categoryName) {
        currentCategory = 'all';
      }
      saveCategories();
      fetchTasks(currentPage);
    }
  };

  // Mise à jour des selects de catégories
  const updateCategorySelects = () => {
    const selects = [taskCategorySelect, editCategory];
    selects.forEach(select => {
      select.innerHTML = '<option value="">Sélectionner une catégorie</option>';
      categories.forEach(category => {
        select.innerHTML += `
          <option value="${category.name}" data-color="${category.color}">
            ${category.name}
          </option>
        `;
      });
    });
  };

  // Mise à jour de la liste des catégories
  const updateCategoriesList = () => {
    const categoryItems = [{ name: 'all', color: '#ff7eb3' }, ...categories];
    categoriesList.innerHTML = categoryItems.map(category => {
      const count = currentTasks.filter(task => 
        category.name === 'all' ? true : task.category === category.name
      ).length;
      
      return `
        <li class="category-item ${category.name === currentCategory ? 'active' : ''}" 
            data-category="${category.name}"
            style="background: ${category.name === 'all' ? 'rgba(255, 255, 255, 0.1)' : category.color}">
          <div class="category-content">
            <span>${category.name === 'all' ? 'Toutes les tâches' : category.name}</span>
            <span class="category-count">${count}</span>
          </div>
          ${category.name !== 'all' ? `
            <button class="delete-category" data-category="${category.name}">
              <i class="fas fa-times"></i>
            </button>
          ` : ''}
        </li>
      `;
    }).join('');

    // Ajout des écouteurs d'événements pour les catégories
    document.querySelectorAll('.category-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.delete-category')) {
          currentCategory = item.dataset.category;
          document.querySelectorAll('.category-item').forEach(i => 
            i.classList.remove('active')
          );
          item.classList.add('active');
          renderTasks(currentTasks);
        }
      });
    });

    // Ajout des écouteurs pour les boutons de suppression
    document.querySelectorAll('.delete-category').forEach(button => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        const categoryName = button.dataset.category;
        if (confirm(`Êtes-vous sûr de vouloir supprimer la catégorie "${categoryName}" ?`)) {
          deleteCategory(categoryName);
        }
      });
    });
  };

  // Fonction pour charger les tâches
  const fetchTasks = async (page = 1) => {
    try {
      const response = await fetch(
        `http://localhost:5000/tasks?page=${page}&limit=5`
      );
      const data = await response.json();
      currentTasks = data.tasks;
      totalPages = data.totalPages;
      currentPage = data.currentPage;

      const sortedTasks = sortTasks(currentTasks, currentSortMethod);
      renderTasks(sortedTasks);

      pageInfo.textContent = `Page ${currentPage} / ${totalPages}`;
      prevPageBtn.disabled = currentPage === 1;
      nextPageBtn.disabled = currentPage === totalPages;
    } catch (error) {
      console.error("Erreur lors du chargement des tâches:", error);
    }
  };

  // Fonction pour trier les tâches
  const sortTasks = (tasks, sortMethod) => {
    return [...tasks].sort(sortFunctions[sortMethod]);
  };

  // Fonction pour afficher les tâches
  const renderTasks = (tasks) => {
    const filteredTasks = tasks.filter(task => 
      currentCategory === 'all' ? true : task.category === currentCategory
    );

    taskList.innerHTML = "";
    filteredTasks.forEach((task) => {
      const categoryColor = task.category ? 
        categories.find(cat => cat.name === task.category)?.color : 
        'rgba(255, 255, 255, 0.2)';

      const li = document.createElement("li");
      const formattedDate = task.dueDate
        ? new Date(task.dueDate).toLocaleString()
        : "Aucune date limite";
      
        li.innerHTML = `
        <div class="task-content">
          <div class="task-category-tag" style="background: ${categoryColor}"></div>
          <div>
            <h3 class="task-title">${task.title}</h3>
            <p class="task-desc">${task.description}</p>
            <p class="task-date">Date limite: ${formattedDate}</p>
          </div>
        </div>
        <div class="task-buttons">
          <input type="checkbox" class="verif" data-id="${task._id}" 
                 ${task.completed ? "checked" : ""}>
          <button class="edit" data-id="${task._id}"
                  data-title="${task.title}"
                  data-desc="${task.description}"
                  data-due-date="${task.dueDate || ''}"
                  data-category="${task.category || ''}">
            <i class="fa-solid fa-pen-to-square"></i> Modifier
          </button>
          <button class="delete" data-id="${task._id}">
            <i class="fa-solid fa-trash"></i> Supprimer
          </button>
        </div>
      `;
      taskList.appendChild(li);
    });

    updateCategoriesList();
    attachEventListeners();
  };

  // Attacher les écouteurs d'événements aux éléments de tâche
  const attachEventListeners = () => {
    document.querySelectorAll(".verif").forEach((checkbox) => {
      checkbox.addEventListener("change", async (e) => {
        const taskId = e.target.dataset.id;
        const completed = e.target.checked;

        try {
          await fetch(`http://localhost:5000/tasks/${taskId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ completed }),
          });
          fetchTasks(currentPage);
        } catch (error) {
          console.error("Erreur lors de la mise à jour:", error);
        }
      });
    });

    // Gestion des boutons d'édition
    document.querySelectorAll(".edit").forEach((button) => {
      button.addEventListener("click", (e) => {
        const target = e.currentTarget;
        currentTaskId = target.dataset.id;
        editTitle.value = target.dataset.title;
        editDesc.value = target.dataset.desc;
        editDueDate.value = target.dataset.dueDate.split("T")[0];
        editCategory.value = target.dataset.category;
        editModal.style.display = "flex";
      });
    });

    // Gestion des boutons de suppression
    document.querySelectorAll(".delete").forEach((button) => {
      button.addEventListener("click", (e) => {
        currentTaskId = e.currentTarget.dataset.id;
        deleteModal.style.display = "flex";
      });
    });
  };

  // Événements pour le tri
  document.getElementById("sort-select").addEventListener("change", (e) => {
    currentSortMethod = e.target.value;
    const sortedTasks = sortTasks(currentTasks, currentSortMethod);
    renderTasks(sortedTasks);
  });

  // Événements pour les catégories
  addCategoryBtn.addEventListener("click", () => {
    const categoryName = categoryInput.value.trim();
    const categoryColor = categoryColorInput.value;
    if (categoryName) {
      addCategory(categoryName, categoryColor);
      categoryInput.value = "";
      categoryColorInput.value = "#ff7eb3";
    }
  });

  categoryInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCategoryBtn.click();
    }
  });

  // Événements pour le formulaire de tâche
  taskForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("task-title").value;
    const description = document.getElementById("task-desc").value;
    const dueDateInput = document.getElementById("task-due-date").value;
    const category = taskCategorySelect.value;
    const dueDate = dueDateInput ? new Date(dueDateInput).toISOString() : null;

    try {
      await fetch("http://localhost:5000/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, dueDate, category }),
      });

      taskForm.reset();
      fetchTasks(1);
    } catch (error) {
      console.error("Erreur lors de la création de la tâche:", error);
    }
  });

  // Événements pour l'édition
  saveEditBtn.addEventListener("click", async () => {
    if (currentTaskId) {
      try {
        await fetch(`http://localhost:5000/tasks/${currentTaskId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: editTitle.value,
            description: editDesc.value,
            dueDate: editDueDate.value,
            category: editCategory.value
          }),
        });
        editModal.style.display = "none";
        fetchTasks(currentPage);
      } catch (error) {
        console.error("Erreur lors de la mise à jour:", error);
      }
    }
  });

  closeEditModalBtn.addEventListener("click", () => {
    editModal.style.display = "none";
  });

  // Événements pour la suppression
  confirmDeleteBtn.addEventListener("click", async () => {
    if (currentTaskId) {
      try {
        await fetch(`http://localhost:5000/tasks/${currentTaskId}`, {
          method: "DELETE",
        });
        deleteModal.style.display = "none";
        fetchTasks(1);
      } catch (error) {
        console.error("Erreur lors de la suppression:", error);
      }
    }
  });

  cancelDeleteBtn.addEventListener("click", () => {
    deleteModal.style.display = "none";
  });

  // Événements pour la pagination
  prevPageBtn.addEventListener("click", () => {
    if (currentPage > 1) {
      fetchTasks(currentPage - 1);
    }
  });

  nextPageBtn.addEventListener("click", () => {
    if (currentPage < totalPages) {
      fetchTasks(currentPage + 1);
    }
  });

  // Initialisation
  updateCategorySelects();
  fetchTasks();
});