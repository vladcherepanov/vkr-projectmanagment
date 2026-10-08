const STORAGE_KEY = 'pmAppState';

const defaultState = {
    projects: [
        {
            id: 1,
            name: 'Внедрение CRM',
            tasks: [
                { id: 101, text: 'Проанализировать требования', done: true, priority: 'high' },
                { id: 102, text: 'Настроить интеграцию с 1С', done: false, priority: 'high' },
                { id: 103, text: 'Обучить менеджеров', done: false, priority: 'medium' },
            ]
        },
        {
            id: 2,
            name: 'Разработка веб-приложения',
            tasks: [
                { id: 201, text: 'Спроектировать базу данных', done: true, priority: 'high' },
                { id: 202, text: 'Разработать API', done: false, priority: 'high' },
                { id: 203, text: 'Написать фронтенд', done: false, priority: 'medium' },
                { id: 204, text: 'Провести тестирование', done: false, priority: 'low' },
            ]
        }
    ],
    currentProjectId: 1
};

const MAX_PROJECTS = 100;
const MAX_TASKS = 10000;
const MAX_FILE_SIZE = 8 * 1024 * 1024;
let storageBlocked = false;
let storageMessage = '';

let state = loadState();

function isValidDueDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1 || month < 1 || month > 12) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day >= 1 && day <= days[month - 1];
}

function getLocalDate(date = new Date()) {
    return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isTaskOverdue(task, today = getLocalDate()) {
    // Сегодняшний срок еще не считается просроченным.
    return !task.done && !!task.dueDate && task.dueDate < today;
}

function validateState(data) {
    const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const validId = value => Number.isSafeInteger(value) && value > 0;
    const validText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
    if (!isObject(data) || !Array.isArray(data.projects)) {
        throw new Error('Отсутствует массив projects.');
    }
    if (data.projects.length > MAX_PROJECTS) throw new Error('Допускается не более 100 проектов.');
    const projectIds = new Set();
    const names = new Set();
    let taskCount = 0;
    const projects = data.projects.map(project => {
        if (!isObject(project) || !validId(project.id) || projectIds.has(project.id)) {
            throw new Error('Идентификаторы проектов должны быть уникальными положительными целыми числами.');
        }
        if (!validText(project.name, 40)) throw new Error('Название проекта должно содержать от 1 до 40 символов.');
        const name = project.name.trim();
        if (names.has(name.toLowerCase())) throw new Error('Названия проектов не должны повторяться.');
        if (!Array.isArray(project.tasks)) throw new Error('У каждого проекта должен быть массив tasks.');
        projectIds.add(project.id);
        names.add(name.toLowerCase());
        taskCount += project.tasks.length;
        if (taskCount > MAX_TASKS) throw new Error('Допускается не более 10000 задач.');
        const taskIds = new Set();
        const tasks = project.tasks.map(task => {
            if (!isObject(task) || !validId(task.id) || taskIds.has(task.id)) {
                throw new Error('Идентификаторы задач должны быть уникальными положительными целыми числами внутри проекта.');
            }
            if (!validText(task.text, 100)) throw new Error('Текст задачи должен содержать от 1 до 100 символов.');
            if (typeof task.done !== 'boolean') throw new Error('Поле done должно быть логическим значением.');
            if (!['high', 'medium', 'low'].includes(task.priority)) throw new Error('Неизвестный приоритет задачи.');
            const dueDate = task.dueDate === undefined ? null : task.dueDate;
            if (dueDate !== null && !isValidDueDate(dueDate)) throw new Error('Срок задачи должен быть существующей датой в формате YYYY-MM-DD или null.');
            taskIds.add(task.id);
            return { id: task.id, text: task.text.trim(), done: task.done, priority: task.priority, dueDate };
        });
        return { id: project.id, name, tasks };
    });
    const currentProjectId = projects.some(p => p.id === data.currentProjectId)
        ? data.currentProjectId : (projects[0]?.id ?? null);
    return { projects, currentProjectId };
}

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === null) return validateState(defaultState);
        return validateState(JSON.parse(raw));
    } catch (error) {
        // Поврежденную запись оставляем в хранилище для восстановления.
        storageBlocked = true;
        storageMessage = 'Сохраненные данные недоступны или повреждены. Автосохранение отключено, исходная запись не изменена. Для восстановления импортируйте корректный JSON. Причина: ' + error.message;
        return { projects: [], currentProjectId: null };
    }
}

function showStorageMessage(message) {
    const status = document.getElementById('storageStatus');
    status.textContent = message;
    status.hidden = !message;
}

function saveState(nextState = state, replaceBlocked = false) {
    if (storageBlocked && !replaceBlocked) {
        showStorageMessage(storageMessage + ' Текущие изменения существуют только в памяти: экспортируйте их перед закрытием страницы.');
        return false;
    }
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
        storageBlocked = false;
        storageMessage = '';
        showStorageMessage('');
        return true;
    } catch (error) {
        showStorageMessage('Изменения не сохранены. Экспортируйте данные перед закрытием страницы. Причина: ' + error.message);
        return false;
    }
}

function persistAndRender() {
    saveState();
    renderAll();
}

function generateId() {
    const used = new Set(state.projects.flatMap(p => [p.id, ...p.tasks.map(t => t.id)]));
    let id = Date.now();
    while (used.has(id)) id++;
    return id;
}

function getCurrentProject() {
    return state.projects.find(p => p.id === state.currentProjectId) || null;
}

function getTasksForCurrentProject() {
    const proj = getCurrentProject();
    return proj ? proj.tasks : [];
}

function renderAll() {
    renderProjects();
    renderTasks();
    renderStats();
    updateProjectTitle();
}

function renderProjects() {
    const list = document.getElementById('projectList');
    list.innerHTML = '';
    state.projects.forEach(proj => {
        const li = document.createElement('li');
        li.className = 'project-item' + (proj.id === state.currentProjectId ? ' active' : '');
        const nameSpan = document.createElement('span');
        nameSpan.textContent = proj.name;
        const delBtn = document.createElement('button');
        delBtn.className = 'del-proj';
        delBtn.textContent = '✕';
        delBtn.title = 'Удалить проект';
        delBtn.setAttribute('aria-label', `Удалить проект ${proj.name}`);
        li.appendChild(nameSpan);
        li.appendChild(delBtn);
        li.addEventListener('click', (e) => {
            // Удаление не должно переключать выбранный проект.
            if (e.target.closest('.del-proj')) return;
            state.currentProjectId = proj.id;
            persistAndRender();
        });
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.projects.length <= 1) {
                alert('Нельзя удалить последний проект.');
                return;
            }
            if (!confirm(`Удалить проект "${proj.name}" со всеми задачами?`)) return;
            state.projects = state.projects.filter(p => p.id !== proj.id);
            if (state.currentProjectId === proj.id) {
                state.currentProjectId = state.projects[0].id;
            }
            persistAndRender();
        });
        list.appendChild(li);
    });
    document.getElementById('projectCount').textContent = state.projects.length;
}

function renderTasks() {
    const container = document.getElementById('taskList');
    const emptyMsg = document.getElementById('emptyMessage');
    const tasks = getTasksForCurrentProject();

    container.innerHTML = '';

    if (!tasks || tasks.length === 0) {
        emptyMsg.style.display = 'block';
        return;
    }
    emptyMsg.style.display = 'none';

    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const sorted = [...tasks].sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1);
    });

    const today = getLocalDate();
    sorted.forEach(task => {
        const li = document.createElement('li');
        const overdue = isTaskOverdue(task, today);
        li.className = 'task-item' + (task.done ? ' done' : '') + (overdue ? ' overdue' : '');

        const leftDiv = document.createElement('div');
        leftDiv.className = 'task-left';

        const check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'task-check';
        check.checked = task.done;
        check.setAttribute('aria-label', `Выполнено: ${task.text}`);
        check.addEventListener('change', () => {
            task.done = check.checked;
            persistAndRender();
        });

        const textSpan = document.createElement('span');
        textSpan.className = 'task-text';
        textSpan.textContent = task.text;

        const badge = document.createElement('span');
        badge.className = `priority-badge priority-${task.priority}`;
        const labels = { high: 'Высокий', medium: 'Средний', low: 'Низкий' };
        badge.textContent = labels[task.priority] || 'Средний';

        leftDiv.appendChild(check);
        leftDiv.appendChild(textSpan);
        leftDiv.appendChild(badge);
        if (task.dueDate) {
            const deadline = document.createElement('span');
            deadline.className = 'task-deadline' + (overdue ? ' overdue' : '');
            const [year, month, day] = task.dueDate.split('-');
            deadline.textContent = `${overdue ? 'Просрочено · ' : 'Срок: '}${day}.${month}.${year}`;
            leftDiv.appendChild(deadline);
        }

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'task-actions';

        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-danger btn-sm';
        delBtn.innerHTML = '<svg class="delete-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7M14 10v7"/></svg>';
        delBtn.setAttribute('aria-label', `Удалить задачу ${task.text}`);
        delBtn.addEventListener('click', () => {
            if (!confirm(`Удалить задачу "${task.text}"?`)) return;
            const proj = getCurrentProject();
            if (!proj) return;
            proj.tasks = proj.tasks.filter(t => t.id !== task.id);
            persistAndRender();
        });

        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-outline btn-sm';
        editBtn.textContent = 'Изменить';
        editBtn.setAttribute('aria-label', `Редактировать задачу ${task.text}`);
        editBtn.addEventListener('click', () => openTaskEditor(task));
        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(delBtn);
        li.appendChild(leftDiv);
        li.appendChild(actionsDiv);
        container.appendChild(li);
    });
}

let editingTask = null;
const taskEditor = document.getElementById('taskEditor');

function showEditError(message) {
    const error = document.getElementById('editTaskError');
    error.textContent = message;
    error.hidden = !message;
}

function openTaskEditor(task) {
    editingTask = { projectId: state.currentProjectId, taskId: task.id };
    document.getElementById('editTaskText').value = task.text;
    document.getElementById('editTaskPriority').value = task.priority;
    document.getElementById('editTaskDueDate').value = task.dueDate ?? '';
    showEditError('');
    taskEditor.showModal();
    document.getElementById('editTaskText').focus();
}

document.getElementById('editTaskForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!editingTask) return;
    const text = document.getElementById('editTaskText').value.trim();
    const priority = document.getElementById('editTaskPriority').value;
    const dateInput = document.getElementById('editTaskDueDate');
    const dueDate = dateInput.value || null;
    if (!text || text.length > 100) {
        showEditError('Введите текст задачи от 1 до 100 символов.'); return;
    }
    if (!['high', 'medium', 'low'].includes(priority)) {
        showEditError('Выберите корректный приоритет.'); return;
    }
    if (dateInput.validity.badInput || (dueDate !== null && !isValidDueDate(dueDate))) {
        showEditError('Введите существующую дату от 0001-01-01 до 9999-12-31 или очистите поле.'); return;
    }
    const project = state.projects.find(p => p.id === editingTask.projectId);
    const task = project?.tasks.find(t => t.id === editingTask.taskId);
    if (!task) { showEditError('Задача больше не существует. Закройте окно и обновите список.'); return; }
    Object.assign(task, { text, priority, dueDate });
    taskEditor.close();
    persistAndRender();
});
document.getElementById('cancelEditTaskBtn').addEventListener('click', () => taskEditor.close());
taskEditor.addEventListener('close', () => { editingTask = null; });

function renderStats() {
    let total = 0, done = 0;
    state.projects.forEach(p => {
        total += p.tasks.length;
        done += p.tasks.filter(t => t.done).length;
    });
    document.getElementById('statProjects').textContent = state.projects.length;
    document.getElementById('statTotal').textContent = total;
    document.getElementById('statDone').textContent = done;
    document.getElementById('statActive').textContent = total - done;
}

function updateProjectTitle() {
    const proj = getCurrentProject();
    const titleEl = document.getElementById('currentProjectTitle');
    if (proj) {
        titleEl.innerHTML = `Задачи <span class="project-name">— ${escapeHtml(proj.name)}</span>`;
    } else {
        titleEl.innerHTML = `Задачи <span class="project-name">— выберите проект</span>`;
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

document.getElementById('addProjectBtn').addEventListener('click', () => {
    const input = document.getElementById('projectInput');
    const name = input.value.trim();
    if (!name || name.length > 40) { alert('Введите название проекта от 1 до 40 символов.'); return; }
    if (state.projects.length >= MAX_PROJECTS) { alert('Допускается не более 100 проектов.'); return; }
    if (state.projects.some(p => p.name.toLowerCase() === name.toLowerCase())) {
        alert('Проект с таким названием уже существует.');
        return;
    }
    const newProj = {
        id: generateId(),
        name: name,
        tasks: []
    };
    state.projects.push(newProj);
    state.currentProjectId = newProj.id;
    input.value = '';
    persistAndRender();
});

function addTask() {
    const input = document.getElementById('taskInput');
    const text = input.value.trim();
    if (!text || text.length > 100) { alert('Введите текст задачи от 1 до 100 символов.'); return; }
    if (state.projects.reduce((count, p) => count + p.tasks.length, 0) >= MAX_TASKS) {
        alert('Допускается не более 10000 задач.'); return;
    }
    const proj = getCurrentProject();
    if (!proj) { alert('Сначала выберите проект.'); return; }
    const priority = document.getElementById('prioritySelect').value;
    if (!['high', 'medium', 'low'].includes(priority)) { alert('Выберите корректный приоритет.'); return; }
    const dateInput = document.getElementById('dueDateInput');
    const dueDate = dateInput.value || null;
    if (dateInput.validity.badInput || (dueDate !== null && !isValidDueDate(dueDate))) {
        alert('Введите существующую дату от 0001-01-01 до 9999-12-31 или очистите поле.'); return;
    }
    proj.tasks.push({
        id: generateId(),
        text: text,
        done: false,
        priority: priority,
        dueDate
    });
    input.value = '';
    dateInput.value = '';
    persistAndRender();
}

document.getElementById('addTaskBtn').addEventListener('click', addTask);
document.getElementById('taskInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTask();
});
document.getElementById('projectInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('addProjectBtn').click();
});

document.getElementById('exportBtn').addEventListener('click', () => {
    const dataStr = JSON.stringify(state, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    a.download = `pm_backup_${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

const fileInput = document.getElementById('fileInput');
document.getElementById('importBtn').addEventListener('click', () => {
    fileInput.click();
});
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
        alert('Размер файла не должен превышать 8 МБ.');
        fileInput.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const imported = validateState(JSON.parse(ev.target.result));
            const message = storageBlocked
                ? 'Заменить исходную запись в хранилище и текущие данные импортируемыми? Эта операция необратима.'
                : 'Заменить все текущие проекты и задачи? Перед заменой рекомендуется экспортировать резервную копию.';
            if (!confirm(message)) return;
            // Сначала сохраняем импорт, затем заменяем текущие данные.
            if (!saveState(imported, true)) {
                alert('Импорт отменен: не удалось сохранить данные. Текущие проекты не изменены.');
                return;
            }
            state = imported;
            renderAll();
            alert('Данные успешно импортированы.');
        } catch (err) {
            alert('Ошибка при импорте: ' + err.message);
        }
    };
    reader.onerror = () => alert('Не удалось прочитать файл. Попробуйте выбрать его повторно.');
    reader.readAsText(file);
    fileInput.value = ''; // сброс для повторного выбора того же файла
});

// При запуске только читаем данные, без записи в хранилище.
renderAll();
showStorageMessage(storageMessage);
let displayedDate = getLocalDate();
// Перерисовываем список только при смене дня.
setInterval(() => {
    const today = getLocalDate();
    if (today !== displayedDate) {
        displayedDate = today;
        renderTasks();
    }
}, 60000);
