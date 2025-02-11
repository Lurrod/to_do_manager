document.addEventListener("DOMContentLoaded", () => {
  const taskForm = document.getElementById("task-form");
  const taskList = document.getElementById("task-list");

  // Modale pour l'édition
  const editModal = document.getElementById("edit-modal");
  const editTitle = document.getElementById("edit-title");
  const editDesc = document.getElementById("edit-desc");
  const editDueDate = document.getElementById("edit-due-date");
  const saveEditBtn = document.getElementById("save-edit");
  const closeEditModalBtn = document.getElementById("close-modal");

  // Modale pour la suppression
  const deleteModal = document.getElementById("delete-modal");
  const confirmDeleteBtn = document.getElementById("confirm-delete");
  const cancelDeleteBtn = document.getElementById("cancel-delete");

  // Pagination
  const prevPageBtn = document.getElementById("prev-page");
  const nextPageBtn = document.getElementById("next-page");
  const pageInfo = document.getElementById("page-info");

  let currentTaskId = null;
  let currentPage = 1;
  let totalPages = 1;

  // Charger les tâches avec pagination
  const fetchTasks = async (page = 1) => {
    const response = await fetch(
      `http://localhost:5000/tasks?page=${page}&limit=5`
    );
    const data = await response.json();
    const tasks = data.tasks;
    totalPages = data.totalPages;
    currentPage = data.currentPage;

    taskList.innerHTML = "";
    tasks.forEach((task) => {
      const li = document.createElement("li");
      const formattedDate = task.dueDate
        ? new Date(task.dueDate).toLocaleString()
        : null;
        li.innerHTML = `
        <div class="task-content">
            <h3 class="task-title">${task.title}</h3>
            <p class="task-desc">${task.description}</p>
            ${formattedDate ? `<p class="task-date">Date de fin: <span>${formattedDate}</span></p>` : ''}
        </div>
        <div class="task-buttons">
            <input type="checkbox" class="verif" data-id="${task._id}" ${
        task.completed ? "checked" : ""
      }>
            <button class="edit" data-id="${task._id}" data-title="${
        task.title
      }" data-desc="${task.description}" data-due-date="${
        task.dueDate
      }">✏️ Modifier</button>
            <button class="delete" data-id="${task._id}">🗑️ Supprimer</button>
        </div>
      `;

      taskList.appendChild(li);
    });

    // Mise à jour des infos de pagination
    pageInfo.textContent = `Page ${currentPage} / ${totalPages}`;
    prevPageBtn.disabled = currentPage === 1;
    nextPageBtn.disabled = currentPage === totalPages;

    // Gestion de la vérification d'une tâche
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

    // Gestion des boutons Modifier
    document.querySelectorAll(".edit").forEach((button) => {
      button.addEventListener("click", (e) => {
        currentTaskId = e.target.getAttribute("data-id");
        editTitle.value = e.target.getAttribute("data-title");
        editDesc.value = e.target.getAttribute("data-desc");
        editDueDate.value = e.target
          .getAttribute("data-due-date")
          .split("T")[0];
        editModal.style.display = "flex";
      });
    });

    // Gestion des boutons Supprimer
    document.querySelectorAll(".delete").forEach((button) => {
      button.addEventListener("click", (e) => {
        currentTaskId = e.target.getAttribute("data-id");
        deleteModal.style.display = "flex";
      });
    });
  };

  // Sauvegarde des modifications
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

  // Annuler l'édition
  closeEditModalBtn.addEventListener("click", () => {
    editModal.style.display = "none";
  });

  // Confirmation de suppression
  confirmDeleteBtn.addEventListener("click", async () => {
    if (currentTaskId) {
      await fetch(`http://localhost:5000/tasks/${currentTaskId}`, {
        method: "DELETE",
      });
      deleteModal.style.display = "none";
      fetchTasks(1); // Réinitialiser à la première page après suppression
    }
  });

  // Annuler la suppression
  cancelDeleteBtn.addEventListener("click", () => {
    deleteModal.style.display = "none";
  });

  // Ajouter une nouvelle tâche
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
    fetchTasks(1); // Réinitialiser à la première page après ajout
  });

  // Gestion de la pagination
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
