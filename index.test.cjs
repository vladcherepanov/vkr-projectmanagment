const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

// Небольшой DOM-дублер позволяет проверять обработчики без браузера и зависимостей.
class Element {
    constructor() {
        this.children = [];
        this.listeners = {};
        this.style = {};
        this.attributes = {};
        this.value = '';
        this.textContent = '';
        this.validity = { badInput: false };
        this.open = false;
    }
    focus() { this.focused = true; }
    showModal() { this.open = true; }
    close() { this.open = false; this.listeners.close?.(); }
    set innerHTML(value) { this.children = []; this.markup = value; }
    get innerHTML() {
        return this.markup || this.textContent.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    }
    appendChild(child) { this.children.push(child); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, handler) { this.listeners[name] = handler; }
}

function app({ raw = null, writeError = false, readError = false, confirmed = true } = {}) {
    const elements = new Map();
    const writes = [];
    const alerts = [];
    const readers = [];
    const timers = [];
    let confirmations = 0;
    const context = vm.createContext({
        document: {
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, new Element());
                return elements.get(id);
            },
            createElement: () => new Element(),
        },
        localStorage: {
            getItem() { if (readError) throw new Error('SecurityError'); return raw; },
            setItem(key, value) {
                if (writeError) throw new Error('QuotaExceededError');
                writes.push({ key, value });
            },
        },
        setInterval: handler => timers.push(handler),
        alert: message => alerts.push(message),
        confirm: () => { confirmations++; return confirmed; },
        FileReader: class {
            constructor() { readers.push(this); }
            readAsText(file) { this.onload({ target: { result: file.text } }); }
        },
    });
    vm.runInContext(script, context);
    return {
        context, elements, writes, alerts, readers, timers,
        run: code => vm.runInContext(code, context),
        snapshot: () => JSON.parse(vm.runInContext('JSON.stringify(state)', context)),
        confirmations: () => confirmations,
        import(data, size = 100) {
            elements.get('fileInput').listeners.change({ target: { files: [{ size, text: typeof data === 'string' ? data : JSON.stringify(data) }] } });
        },
    };
}

const valid = () => ({
    projects: [{ id: 1, name: 'Проект', tasks: [{ id: 2, text: 'Задача', done: false, priority: 'high', dueDate: null }] }],
    currentProjectId: 1,
});

test('HTML подключает внешние стили и JavaScript без встроенных блоков', () => {
    assert.match(html, /<link rel="stylesheet" href="styles\.css">/);
    assert.match(html, /<script src="app\.js"><\/script>/);
    assert.doesNotMatch(html, /<style\b|<script>|\sstyle=/);
    assert.ok(fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8').length > 0);
});

test('запуск и повторный рендеринг не записывают данные', () => {
    const a = app();
    assert.equal(a.snapshot().projects.length, 2);
    a.run('renderAll()');
    assert.equal(a.writes.length, 0);
});

test('сортировка: активные high/medium/low, затем выполненные', () => {
    const data = valid();
    data.projects[0].tasks = [
        { id: 10, text: 'medium', done: false, priority: 'medium' },
        { id: 11, text: 'done', done: true, priority: 'high' },
        { id: 12, text: 'low', done: false, priority: 'low' },
        { id: 13, text: 'high', done: false, priority: 'high' },
    ];
    const a = app({ raw: JSON.stringify(data) });
    const texts = a.elements.get('taskList').children.map(li => li.children[0].children[1].textContent);
    assert.deepEqual(texts, ['high', 'medium', 'low', 'done']);
    assert.deepEqual(a.snapshot().projects[0].tasks, data.projects[0].tasks.map(t => ({ ...t, dueDate: null })));
});

test('валидация отклоняет некорректные типы, ID, дубли и поля', () => {
    const a = app();
    const bad = [null, [], { projects: [null] }];
    for (const mutate of [
        d => { d.projects[0].name = 42; },
        d => { d.projects[0].name = ' '; },
        d => { d.projects[0].name = 'a'.repeat(41); },
        d => { d.projects[0].id = '\" onclick=\"alert(1)'; },
        d => { d.projects[0].id = -1; },
        d => { d.projects[0].tasks = {}; },
        d => { d.projects[0].tasks[0] = null; },
        d => { d.projects[0].tasks[0].text = 'a'.repeat(101); },
        d => { d.projects[0].tasks[0].done = 'false'; },
        d => { d.projects[0].tasks[0].priority = 'urgent'; },
        d => { d.projects[0].tasks.push({ ...d.projects[0].tasks[0] }); },
        d => { d.projects.push({ ...d.projects[0] }); },
        d => { d.projects.push({ id: 3, name: ' ПРОЕКТ ', tasks: [] }); },
        d => { d.projects = Array.from({ length: 101 }, (_, i) => ({ id: i + 1, name: String(i), tasks: [] })); },
        d => { d.projects[0].tasks = Array.from({ length: 10001 }, (_, i) => ({ id: i + 1, text: 't', done: false, priority: 'low' })); },
    ]) {
        const data = valid();
        mutate(data);
        bad.push(data);
    }
    for (const data of bad) {
        a.context.input = data;
        assert.throws(() => a.run('validateState(input)'));
    }
});

test('валидатор создает независимую копию и восстанавливает выбор проекта', () => {
    const a = app();
    a.context.input = valid();
    a.context.input.currentProjectId = 999;
    const result = a.run('validateState(input)');
    assert.equal(result.currentProjectId, 1);
    result.projects[0].tasks[0].text = 'changed';
    assert.equal(a.context.input.projects[0].tasks[0].text, 'Задача');
    a.context.input = { projects: [], currentProjectId: 1 };
    assert.equal(a.run('validateState(input).currentProjectId'), null);
});

test('поврежденное или недоступное хранилище не перезаписывается', () => {
    for (const options of [{ raw: '{bad' }, { raw: JSON.stringify({ projects: [null] }) }, { readError: true }]) {
        const a = app(options);
        assert.equal(a.run('storageBlocked'), true);
        assert.equal(a.snapshot().projects.length, 0);
        assert.equal(a.run('saveState()'), false);
        assert.equal(a.writes.length, 0);
        assert.equal(a.elements.get('storageStatus').hidden, false);
    }
});

test('ошибка сохранения перехватывается и показана пользователю', () => {
    const a = app({ writeError: true });
    assert.equal(a.run('saveState()'), false);
    assert.match(a.elements.get('storageStatus').textContent, /QuotaExceededError/);
});

test('невалидный, слишком большой и отмененный импорт сохраняют прежнее состояние', () => {
    for (const options of [{}, { confirmed: false }]) {
        const a = app(options);
        const before = a.snapshot();
        a.import('{bad');
        a.import({ projects: [null] });
        a.import(valid(), 8 * 1024 * 1024 + 1);
        if (options.confirmed === false) a.import(valid());
        assert.deepEqual(a.snapshot(), before);
        assert.equal(a.writes.length, 0);
    }
});

test('импорт не меняет рабочее состояние при ошибке записи', () => {
    const a = app({ writeError: true });
    const before = a.snapshot();
    a.import(valid());
    assert.deepEqual(a.snapshot(), before);
    assert.match(a.alerts.at(-1), /Импорт отменен/);
});

test('подтвержденный импорт сохраняет данные и снимает блокировку', () => {
    const a = app({ raw: '{bad' });
    a.import(valid());
    assert.deepEqual(a.snapshot(), valid());
    assert.deepEqual(JSON.parse(a.writes[0].value), valid());
    assert.equal(a.run('storageBlocked'), false);
    assert.equal(a.confirmations(), 1);
    assert.equal(a.elements.get('storageStatus').hidden, true);
});

test('новые ID не совпадают с существующими даже при одинаковом времени', () => {
    const a = app();
    a.run('Date.now = () => 101');
    assert.equal(a.run('generateId()'), 104);
});

test('добавление проекта и задачи сохраняется; отметка выполнения и удаление работают', () => {
    const a = app();
    a.elements.get('projectInput').value = ' Новый проект ';
    a.elements.get('addProjectBtn').listeners.click();
    assert.equal(a.snapshot().projects.at(-1).name, 'Новый проект');
    a.elements.get('taskInput').value = ' Новая задача ';
    a.run("document.getElementById('prioritySelect').value = 'medium'");
    a.elements.get('addTaskBtn').listeners.click();
    assert.equal(a.snapshot().projects.at(-1).tasks[0].text, 'Новая задача');
    let li = a.elements.get('taskList').children[0];
    const checkbox = li.children[0].children[0];
    checkbox.checked = true;
    checkbox.listeners.change();
    assert.equal(a.snapshot().projects.at(-1).tasks[0].done, true);
    li = a.elements.get('taskList').children[0];
    li.children[1].children[1].listeners.click();
    assert.equal(a.snapshot().projects.at(-1).tasks.length, 0);
    assert.equal(a.writes.length, 4);
});

test('название проекта отображается как текст, а не HTML', () => {
    const data = valid();
    data.projects[0].name = '<img src=x onerror=alert(1)>';
    const a = app({ raw: JSON.stringify(data) });
    const li = a.elements.get('projectList').children[0];
    assert.equal(li.children[0].textContent, data.projects[0].name);
    assert.equal(li.markup, undefined);
    assert.equal(li.children[1].attributes['data-id'], undefined);
});

test('кнопка удаления использует контурный SVG вместо цветного эмодзи', () => {
    const a = app({ raw: JSON.stringify(valid()) });
    const button = a.elements.get('taskList').children[0].children[1].children[1];
    assert.match(button.innerHTML, /<svg/);
    assert.match(button.innerHTML, /fill="none"/);
    assert.match(button.innerHTML, /stroke="currentColor"/);
    assert.equal(button.attributes['aria-label'], 'Удалить задачу Задача');
});

function openEditor(a) {
    a.elements.get('taskList').children[0].children[1].children[0].listeners.click();
}
function submitEditor(a) {
    a.elements.get('editTaskForm').listeners.submit({ preventDefault() {} });
}

test('старые данные без dueDate совместимы при загрузке и импорте', () => {
    const data = valid();
    delete data.projects[0].tasks[0].dueDate;
    const a = app({ raw: JSON.stringify(data) });
    assert.equal(a.run('storageBlocked'), false);
    assert.equal(a.snapshot().projects[0].tasks[0].dueDate, null);
    a.import(data);
    assert.equal(a.snapshot().projects[0].tasks[0].dueDate, null);
});

test('валидация дат проверяет формат, календарь и високосные годы', () => {
    const a = app();
    for (const date of ['2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31']) {
        a.context.date = date;
        assert.equal(a.run('isValidDueDate(date)'), true);
    }
    for (const date of ['2025-02-29', '1900-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', '0000-01-01', '10000-01-01', '2026-1-01', '', 42, {}]) {
        a.context.date = date;
        assert.equal(a.run('isValidDueDate(date)'), false);
        const before = a.snapshot();
        const data = valid();
        data.projects[0].tasks[0].dueDate = date;
        a.import(data);
        assert.deepEqual(a.snapshot(), before);
    }
});

test('просрочка считается по местной дате: сегодня еще не просрочено', () => {
    const a = app();
    assert.equal(a.run("getLocalDate(new Date(2026, 9, 8, 23, 59))"), '2026-10-08');
    a.context.task = { done: false, dueDate: '2026-10-08' };
    assert.equal(a.run("isTaskOverdue(task, '2026-10-08')"), false);
    assert.equal(a.run("isTaskOverdue(task, '2026-10-09')"), true);
    a.context.task.done = true;
    assert.equal(a.run("isTaskOverdue(task, '2026-10-09')"), false);
    a.context.task = { done: false, dueDate: null };
    assert.equal(a.run("isTaskOverdue(task, '2026-10-09')"), false);
});

test('срок сохраняется при добавлении, перезагрузке и импорте', () => {
    const a = app();
    a.elements.get('taskInput').value = 'Задача со сроком';
    a.run("document.getElementById('prioritySelect').value = 'low'; document.getElementById('dueDateInput').value = '2028-02-29'");
    a.run('addTask()');
    assert.equal(a.snapshot().projects[0].tasks.at(-1).dueDate, '2028-02-29');
    assert.equal(a.elements.get('dueDateInput').value, '');
    const b = app({ raw: a.writes.at(-1).value });
    assert.deepEqual(b.snapshot(), a.snapshot());
    b.import(a.snapshot());
    assert.deepEqual(b.snapshot(), a.snapshot());
});

test('неполный ввод даты не принимается при добавлении', () => {
    const a = app();
    const before = a.snapshot();
    a.elements.get('taskInput').value = 'Задача';
    a.run("document.getElementById('prioritySelect').value = 'high'; document.getElementById('dueDateInput').validity.badInput = true");
    a.run('addTask()');
    assert.deepEqual(a.snapshot(), before);
    assert.equal(a.writes.length, 0);
});

test('редактирование сохраняет текст, приоритет и срок без изменения ID и done', () => {
    const data = valid();
    data.projects[0].tasks[0].done = true;
    const a = app({ raw: JSON.stringify(data) });
    openEditor(a);
    assert.equal(a.elements.get('taskEditor').open, true);
    assert.equal(a.elements.get('editTaskText').value, 'Задача');
    a.elements.get('editTaskText').value = ' Новое название ';
    a.elements.get('editTaskPriority').value = 'low';
    a.elements.get('editTaskDueDate').value = '2026-12-31';
    submitEditor(a);
    assert.deepEqual(a.snapshot().projects[0].tasks[0], { id: 2, text: 'Новое название', done: true, priority: 'low', dueDate: '2026-12-31' });
    assert.equal(a.elements.get('taskEditor').open, false);
    assert.equal(a.run('editingTask'), null);
    assert.deepEqual(JSON.parse(a.writes.at(-1).value), a.snapshot());
    openEditor(a);
    a.elements.get('editTaskDueDate').value = '';
    submitEditor(a);
    assert.equal(a.snapshot().projects[0].tasks[0].dueDate, null);
});

test('отмена и Escape не меняют задачу', () => {
    const a = app({ raw: JSON.stringify(valid()) });
    const before = a.snapshot();
    openEditor(a);
    a.elements.get('editTaskText').value = 'Черновик';
    a.elements.get('cancelEditTaskBtn').listeners.click();
    assert.deepEqual(a.snapshot(), before);
    openEditor(a);
    assert.equal(a.elements.get('editTaskText').value, 'Задача');
    // Браузер закрывает dialog по Escape и отправляет событие close.
    a.elements.get('taskEditor').close();
    assert.equal(a.run('editingTask'), null);
    assert.equal(a.writes.length, 0);
});

test('ошибки редактирования оставляют диалог открытым и задачу неизменной', () => {
    const a = app({ raw: JSON.stringify(valid()) });
    const before = a.snapshot();
    for (const field of [
        ['editTaskText', ' '], ['editTaskText', 'a'.repeat(101)],
        ['editTaskPriority', 'urgent'], ['editTaskDueDate', '2026-02-30'],
    ]) {
        openEditor(a);
        a.elements.get(field[0]).value = field[1];
        submitEditor(a);
        assert.deepEqual(a.snapshot(), before);
        assert.equal(a.elements.get('taskEditor').open, true);
        assert.equal(a.elements.get('editTaskError').hidden, false);
        a.elements.get('taskEditor').close();
    }
    assert.equal(a.writes.length, 0);
});

test('подсветка просрочки исчезает после выполнения и обновляется при смене дня', () => {
    const data = valid();
    data.projects[0].tasks[0].dueDate = '2026-10-08';
    const a = app({ raw: JSON.stringify(data) });
    a.run("getLocalDate = () => '2026-10-08'; displayedDate = '2026-10-08'; renderTasks()");
    let li = a.elements.get('taskList').children[0];
    assert.doesNotMatch(li.className, /overdue/);
    a.run("getLocalDate = () => '2026-10-09'");
    a.timers[0]();
    li = a.elements.get('taskList').children[0];
    assert.match(li.className, /overdue/);
    assert.equal(li.children[0].children[3].textContent, 'Просрочено · 08.10.2026');
    assert.equal(a.writes.length, 0);
    const checkbox = li.children[0].children[0];
    checkbox.checked = true;
    checkbox.listeners.change();
    li = a.elements.get('taskList').children[0];
    assert.doesNotMatch(li.className, /overdue/);
    assert.equal(li.children[0].children[3].textContent, 'Срок: 08.10.2026');
});
