document.addEventListener("DOMContentLoaded", () => {
    const taskForm = document.getElementById("task-form");
    const taskList = document.getElementById("task-list");
    
    // Modale pour l'édition
    const editModal = document.getElementById("edit-modal");
    const editTitle = document.getElementById("edit-title");
    const editDesc = document.getElementById("edit-desc");
    const saveEditBtn = document.getElementById("save-edit");
    const closeEditModalBtn = document.getElementById("close-modal");

    // Modale pour la suppression
    const deleteModal = document.getElementById("delete-modal");
    const confirmDeleteBtn = document.getElementById("confirm-delete");
    const cancelDeleteBtn = document.getElementById("cancel-delete");

    let currentTaskId = null;

    // Charger les tâches
    const fetchTasks = async () => {
        const response = await fetch("http://localhost:5000/tasks");
        const tasks = await response.json();
        taskList.innerHTML = "";
        tasks.forEach(task => {
            const li = document.createElement("li");
            li.innerHTML = `
                <span>${task.title} - ${task.description}</span>
                <div class="task-buttons">
                    <button class="edit" data-id="${task._id}" data-title="${task.title}" data-desc="${task.description}">✏️ Modifier</button>
                    <button class="delete" data-id="${task._id}">🗑️ Supprimer</button>
                </div>
            `;
            taskList.appendChild(li);
        });

        // Gestion des boutons Modifier
        document.querySelectorAll(".edit").forEach(button => {
            button.addEventListener("click", (e) => {
                currentTaskId = e.target.getAttribute("data-id");
                editTitle.value = e.target.getAttribute("data-title");
                editDesc.value = e.target.getAttribute("data-desc");
                editModal.style.display = "flex";
            });
        });

        // Gestion des boutons Supprimer
        document.querySelectorAll(".delete").forEach(button => {
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
                body: JSON.stringify({ title: editTitle.value, description: editDesc.value })
            });
            editModal.style.display = "none";
            fetchTasks();
        }
    });

    // Annuler l'édition
    closeEditModalBtn.addEventListener("click", () => {
        editModal.style.display = "none";
    });

    // Confirmation de suppression
    confirmDeleteBtn.addEventListener("click", async () => {
        if (currentTaskId) {
            await fetch(`http://localhost:5000/tasks/${currentTaskId}`, { method: "DELETE" });
            deleteModal.style.display = "none";
            fetchTasks();
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

        await fetch("http://localhost:5000/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, description })
        });

        taskForm.reset();
        fetchTasks();
    });

    fetchTasks();
});
