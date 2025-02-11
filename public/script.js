document.addEventListener("DOMContentLoaded", () => {
  const taskForm = document.getElementById("task-form");
  const taskList = document.getElementById("task-list");
  // Ajouter les éléments existants
  const editModal = document.getElementById("edit-modal");
  const editTitle = document.getElementById("edit-title");
  const editDesc = document.getElementById("edit-desc");
  const editDueDate = document.getElementById("edit-due-date");
  const saveEditBtn = document.getElementById("save-edit");
  const closeEditModalBtn = document.getElementById("close-modal");
  const deleteModal = document.getElementById("delete-modal");
  const confirmDeleteBtn = document.getElementById("confirm-delete");
  const cancelDeleteBtn = document.getElementById("cancel-delete");
  const prevPageBtn = document.getElementById("prev-page");
  const nextPageBtn = document.getElementById("next-page");
  const pageInfo = document.getElementById("page-info");

  let currentTaskId = null;
  let currentPage = 1;
  let totalPages = 1;
  let currentTasks = []; // Stocker les tâches actuelles
  let currentSortMethod = 'creation'; // Par défaut : tri par date de création

  // Fonctions de tri
  const sortFunctions = {
    creation: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    dueDate: (a, b) => {
      // Gérer le cas où une tâche n'a pas de date limite
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    }
  };

  // Fonction pour appliquer le tri
  const sortTasks = (tasks, sortMethod) => {
    return [...tasks].sort(sortFunctions[sortMethod]);
  };

  // Modifier fetchTasks pour inclure le tri
  const fetchTasks = async (page = 1) => {
    const response = await fetch(
      `http://localhost:5000/tasks?page=${page}&limit=5`
    );
    const data = await response.json();
    currentTasks = data.tasks; // Sauvegarder les tâches
    totalPages = data.totalPages;
    currentPage = data.currentPage;

    // Appliquer le tri
    const sortedTasks = sortTasks(currentTasks, currentSortMethod);
    renderTasks(sortedTasks);

    // Mise à jour des infos de pagination
    pageInfo.textContent = `Page ${currentPage} / ${totalPages}`;
    prevPageBtn.disabled = currentPage === 1;
    nextPageBtn.disabled = currentPage === totalPages;
  };

  // Nouvelle fonction pour rendre les tâches
  const renderTasks = (tasks) => {
    taskList.innerHTML = "";
    tasks.forEach((task) => {
      const li = document.createElement("li");
      const formattedDate = task.dueDate
        ? new Date(task.dueDate).toLocaleString()
        : "Aucune date limite";
      const createdAtDate = new Date(task.createdAt).toLocaleString();
      
      li.innerHTML = `
        <div class="task-content">
            <h3 class="task-title">${task.title}</h3>
            <p class="task-desc">${task.description}</p>
            <p class="task-date">Date limite: ${formattedDate}</p>
        </div>
        <div class="task-buttons">
            <input type="checkbox" class="verif" data-id="${task._id}" ${
        task.completed ? "checked" : ""
      }>
            <button class="edit" data-id="${task._id}" data-title="${
        task.title
      }" data-desc="${task.description}" data-due-date="${
        task.dueDate || ""
      }"><i class="fa-solid fa-pen-to-square"></i> Modifier</button>
            <button class="delete" data-id="${task._id}"><i class="fa-solid fa-trash"></i> Supprimer</button>
        </div>
      `;

      taskList.appendChild(li);
    });

    attachEventListeners();
  };

  const attachEventListeners = () => {
    document.querySelectorAll(".verif").forEach((checkbox) => {
      checkbox.addEventListener("change", async (e) => {
        const taskId = e.target.dataset.id;
        const completed = e.target.checked;

        await fetch(`http://localhost:5000/tasks/${taskId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completed }),
        });
        fetchTasks(currentPage);
      });
    });

    document.querySelectorAll(".edit").forEach((button) => {
      button.addEventListener("click", (e) => {
        currentTaskId = e.target.dataset.id;
        editTitle.value = e.target.dataset.title;
        editDesc.value = e.target.dataset.desc;
        editDueDate.value = e.target.dataset.dueDate.split("T")[0];
        editModal.style.display = "flex";
      });
    });

    document.querySelectorAll(".delete").forEach((button) => {
      button.addEventListener("click", (e) => {
        currentTaskId = e.target.dataset.id;
        deleteModal.style.display = "flex";
      });
    });
  };

  const sortingControls = `
    <div class="sorting-controls">
      <label>Trier par:</label>
      <select id="sort-select">
        <option value="creation">Date de création</option>
        <option value="dueDate">Date limite</option>
      </select>
    </div>
  `;
  
  taskForm.insertAdjacentHTML('afterend', sortingControls);
  
  document.getElementById("sort-select").addEventListener("change", (e) => {
    currentSortMethod = e.target.value;
    const sortedTasks = sortTasks(currentTasks, currentSortMethod);
    renderTasks(sortedTasks);
  });

  // Garder le reste du code existant...
  saveEditBtn.addEventListener("click", async () => {
    if (currentTaskId) {
      await fetch(`http://localhost:5000/tasks/${currentTaskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.value,
          description: editDesc.value,
          dueDate: editDueDate.value,
        }),
      });
      editModal.style.display = "none";
      fetchTasks(currentPage);
    }
  });

  closeEditModalBtn.addEventListener("click", () => {
    editModal.style.display = "none";
  });

  confirmDeleteBtn.addEventListener("click", async () => {
    if (currentTaskId) {
      await fetch(`http://localhost:5000/tasks/${currentTaskId}`, {
        method: "DELETE",
      });
      deleteModal.style.display = "none";
      fetchTasks(1);
    }
  });

  cancelDeleteBtn.addEventListener("click", () => {
    deleteModal.style.display = "none";
  });

  taskForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("task-title").value;
    const description = document.getElementById("task-desc").value;
    const dueDateInput = document.getElementById("task-due-date").value;
    const dueDate = dueDateInput ? new Date(dueDateInput).toISOString() : null;

    await fetch("http://localhost:5000/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description, dueDate }),
    });

    taskForm.reset();
    fetchTasks(1);
  });

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

  // Charger les tâches initiales
  fetchTasks();
});