/** SI Project Command Center - simple project tracker (Sheets + Drive) */
const APP_TITLE = 'SI Project Command Center';
const MAX_MB = 15;
const SCHEMA = {
  Projects: ['id','name','type','status','priority','description','stack','repo','localPath','constraints','state','nextAction','archived','folderId','createdAt','updatedAt'],
  Items: ['id','projectId','kind','title','details','status','level','sort','createdAt','updatedAt','doneAt'],
  Docs: ['id','projectId','name','category','fileId','url','size','note','createdAt','updatedAt']
};
const STATUS = ['Planning','Active','Blocked','On hold','Done'];
const PRIORITY = ['High','Medium','Low'];
const LEVELS = ['Critical','High','Medium','Low'];
const ITEM_STATUS = { phase:['Planned','Next','Current','Done'], problem:['Open','Resolved'], pending:['Open','Done'], deferred:['Deferred','Dropped'], note:[''] };
const DONE = ['Done','Resolved','Dropped'];
const PROJECT_FIELDS = ['name','type','status','priority','description','stack','repo','localPath','constraints','state','nextAction','archived'];

function doGet() {
  ss_();
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

/* ---------- public API (called from the page) ---------- */
function getData() {
  return { projects: readAll_('Projects'), items: readAll_('Items'), docs: readAll_('Docs'), sheetUrl: ss_().getUrl(), maxMb: MAX_MB };
}

function saveProject(input) {
  input = input || {};
  return locked_(function () {
    if (!input.id && !str_(input.name)) throw new Error('Project name is required.');
    if (input.name !== undefined && !str_(input.name)) throw new Error('Project name cannot be empty.');
    if (input.status !== undefined && STATUS.indexOf(input.status) < 0) throw new Error('Invalid status.');
    if (input.priority !== undefined && PRIORITY.indexOf(input.priority) < 0) throw new Error('Invalid priority.');
    return save_('Projects', input, PROJECT_FIELDS, { type: 'Other', status: 'Active', priority: 'Medium', archived: '' }, 'p_');
  });
}

function deleteProject(id) {
  return locked_(function () {
    const p = get_('Projects', id);
    if (!p) return { ok: true };
    if (!p.archived) throw new Error('Archive the project before deleting it.');
    deleteWhere_('Items', 'projectId', p.id);
    deleteWhere_('Docs', 'projectId', p.id);
    if (p.folderId) { try { DriveApp.getFolderById(p.folderId).setTrashed(true); } catch (e) {} }
    const sh = sheet_('Projects');
    sh.deleteRow(findRow_(sh, p.id));
    return { ok: true };
  });
}

function saveItem(input) {
  input = input || {};
  return locked_(function () {
    const old = input.id ? get_('Items', input.id) : null;
    if (input.id && !old) throw new Error('This item no longer exists. Refresh the page.');
    const pid = old ? old.projectId : String(input.projectId || '');
    if (!get_('Projects', pid)) throw new Error('Project not found.');
    const kind = input.kind !== undefined ? input.kind : (old ? old.kind : '');
    if (!ITEM_STATUS[kind]) throw new Error('Unknown item type.');
    const pick = function (k) { return input[k] !== undefined ? str_(input[k]) : (old ? String(old[k]) : ''); };
    const status = input.status !== undefined ? str_(input.status) : (old && old.kind === kind ? old.status : ITEM_STATUS[kind][0]);
    if (ITEM_STATUS[kind].indexOf(status) < 0) throw new Error('Invalid status for ' + kind + '.');
    const title = pick('title'), details = pick('details');
    if (kind === 'note' ? !(title || details) : !title) throw new Error(kind === 'note' ? 'Write something in the note.' : 'A title is required.');
    let level = pick('level');
    if (kind === 'problem' || kind === 'pending') { if (LEVELS.indexOf(level) < 0) level = 'Medium'; }
    else level = (kind === 'note' && level === 'Pinned') ? 'Pinned' : '';
    let sort = Number(input.sort);
    if (!isFinite(sort) || input.sort === '' || input.sort == null) {
      sort = old ? old.sort : readAll_('Items').filter(function (i) { return i.projectId === pid && i.kind === 'phase'; })
        .reduce(function (m, i) { return Math.max(m, i.sort); }, 0) + 1;
    }
    const wasDone = old && DONE.indexOf(old.status) >= 0;
    const doneAt = DONE.indexOf(status) >= 0 ? (wasDone && old.doneAt ? old.doneAt : new Date().toISOString()) : '';
    const item = save_('Items', { id: input.id, kind: kind, title: title, details: details, status: status, level: level, sort: sort, doneAt: doneAt },
      ['kind','title','details','status','level','sort','doneAt'], { projectId: pid }, 'i_');
    touch_(pid);
    return item;
  });
}

function deleteItem(id) {
  return locked_(function () {
    const it = get_('Items', id);
    if (!it) return { ok: true };
    const sh = sheet_('Items');
    sh.deleteRow(findRow_(sh, it.id));
    touch_(it.projectId);
    return { ok: true };
  });
}

function uploadDoc(input) {
  input = input || {};
  return locked_(function () {
    const project = get_('Projects', input.projectId);
    if (!project) throw new Error('Project not found.');
    const blob = blob_(input);
    const file = projectFolder_(project).createFile(blob);
    let doc;
    try {
      doc = save_('Docs', { name: str_(input.name) || blob.getName(), category: str_(input.category) || 'Other', note: str_(input.note),
        fileId: file.getId(), url: file.getUrl(), size: blob.getBytes().length },
        ['name','category','note','fileId','url','size'], { projectId: project.id }, 'd_');
    } catch (e) { try { file.setTrashed(true); } catch (e2) {} throw e; }
    touch_(project.id);
    return doc;
  });
}

function addLink(input) {
  input = input || {};
  return locked_(function () {
    if (!get_('Projects', input.projectId)) throw new Error('Project not found.');
    const url = str_(input.url);
    if (!/^https?:\/\/\S+$/i.test(url)) throw new Error('Enter a link starting with http:// or https://');
    const d = save_('Docs', { name: str_(input.name) || url, category: str_(input.category) || 'Other', note: str_(input.note), url: url },
      ['name','category','note','url'], { projectId: input.projectId, fileId: '', size: 0 }, 'd_');
    touch_(input.projectId);
    return d;
  });
}

function replaceDoc(input) {
  input = input || {};
  return locked_(function () {
    const doc = get_('Docs', input.id);
    if (!doc) throw new Error('Document not found.');
    const project = get_('Projects', doc.projectId);
    const blob = blob_(input);
    const file = projectFolder_(project).createFile(blob);
    let saved;
    try {
      saved = save_('Docs', { id: doc.id, fileId: file.getId(), url: file.getUrl(), size: blob.getBytes().length }, ['fileId','url','size'], {}, 'd_');
    } catch (e) { try { file.setTrashed(true); } catch (e2) {} throw e; }
    try { DriveApp.getFileById(doc.fileId).setTrashed(true); } catch (e) {} // old version stays in Drive trash
    touch_(doc.projectId);
    return saved;
  });
}

function saveDocInfo(input) {
  input = input || {};
  return locked_(function () {
    const doc = get_('Docs', input.id);
    if (!doc) throw new Error('Document not found.');
    if (input.name !== undefined && !str_(input.name)) throw new Error('Name cannot be empty.');
    const d = save_('Docs', input, ['name','category','note'], {}, 'd_');
    touch_(doc.projectId);
    return d;
  });
}

function deleteDoc(id) {
  return locked_(function () {
    const d = get_('Docs', id);
    if (!d) return { ok: true };
    if (d.fileId) { try { DriveApp.getFileById(d.fileId).setTrashed(true); } catch (e) {} } // recoverable from Drive trash
    const sh = sheet_('Docs');
    sh.deleteRow(findRow_(sh, d.id));
    touch_(d.projectId);
    return { ok: true };
  });
}

/* ---------- helpers (private) ---------- */
function locked_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function str_(v) { return String(v == null ? '' : v).trim(); }
function newId_(prefix) { return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 10); }

let _ss = null;
function ss_() {
  if (_ss) return _ss;
  const props = PropertiesService.getScriptProperties();
  const open = function () { const id = props.getProperty('SHEET_ID'); if (!id) return null; try { return SpreadsheetApp.openById(id); } catch (e) { return null; } };
  let ss = open();
  if (!ss) {
    const lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      ss = open();
      if (!ss) { ss = SpreadsheetApp.create(APP_TITLE + ' - Data'); props.setProperty('SHEET_ID', ss.getId()); }
    } finally { lock.releaseLock(); }
  }
  Object.keys(SCHEMA).forEach(function (name) {
    if (ss.getSheetByName(name)) return;
    const sh = ss.insertSheet(name), cols = SCHEMA[name];
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@'); // plain text: no formula/date surprises
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  const def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  return (_ss = ss);
}
function sheet_(name) { return ss_().getSheetByName(name); }

function rowToObj_(row, cols) {
  const o = {};
  cols.forEach(function (c, i) { let v = row[i]; if (v instanceof Date) v = v.toISOString(); o[c] = v == null ? '' : v; });
  if ('sort' in o) o.sort = Number(o.sort) || 0;
  if ('size' in o) o.size = Number(o.size) || 0;
  return o;
}
function readAll_(name) {
  const sh = sheet_(name), cols = SCHEMA[name], last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, cols.length).getValues().map(function (r) { return rowToObj_(r, cols); });
}
function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2 || !id) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}
function get_(name, id) {
  const sh = sheet_(name), row = findRow_(sh, id);
  return row < 0 ? null : rowToObj_(sh.getRange(row, 1, 1, SCHEMA[name].length).getValues()[0], SCHEMA[name]);
}
function save_(name, input, editable, defaults, prefix) {
  const sh = sheet_(name), cols = SCHEMA[name], now = new Date().toISOString();
  let obj, row = -1;
  if (input.id) {
    row = findRow_(sh, input.id);
    if (row < 0) throw new Error('This record no longer exists. Refresh the page.');
    obj = rowToObj_(sh.getRange(row, 1, 1, cols.length).getValues()[0], cols);
  } else {
    obj = Object.assign({}, defaults, { id: newId_(prefix), createdAt: now });
  }
  editable.forEach(function (f) {
    if (input[f] === undefined) return;
    obj[f] = f === 'sort' || f === 'size' ? Number(input[f]) || 0 : str_(input[f]).slice(0, f === 'name' || f === 'title' ? 200 : 20000);
  });
  obj.updatedAt = now;
  const values = cols.map(function (c) { return obj[c] === undefined ? '' : obj[c]; });
  if (row > 0) sh.getRange(row, 1, 1, cols.length).setValues([values]); else sh.appendRow(values);
  return rowToObj_(values, cols);
}
function touch_(projectId) {
  const sh = sheet_('Projects'), row = findRow_(sh, projectId);
  if (row > 0) sh.getRange(row, SCHEMA.Projects.indexOf('updatedAt') + 1).setValue(new Date().toISOString());
}
function deleteWhere_(name, col, value) {
  const sh = sheet_(name), last = sh.getLastRow();
  if (last < 2) return;
  const vals = sh.getRange(2, SCHEMA[name].indexOf(col) + 1, last - 1, 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) if (String(vals[i][0]) === String(value)) sh.deleteRow(i + 2);
}

function rootFolder_() {
  const props = PropertiesService.getScriptProperties();
  let f = null;
  try { const id = props.getProperty('ROOT_FOLDER_ID'); if (id) { f = DriveApp.getFolderById(id); if (f.isTrashed()) f = null; } } catch (e) { f = null; }
  if (!f) { f = DriveApp.createFolder(APP_TITLE + ' - Files'); props.setProperty('ROOT_FOLDER_ID', f.getId()); }
  return f;
}
function projectFolder_(project) {
  let f = null;
  try { if (project.folderId) { f = DriveApp.getFolderById(project.folderId); if (f.isTrashed()) f = null; } } catch (e) { f = null; }
  if (!f) {
    f = rootFolder_().createFolder(project.name + ' [' + project.id + ']');
    const sh = sheet_('Projects'), row = findRow_(sh, project.id);
    sh.getRange(row, SCHEMA.Projects.indexOf('folderId') + 1).setValue(f.getId());
  }
  return f;
}
function blob_(input) {
  const name = str_(input.fileName);
  if (!name || !input.base64) throw new Error('No file received.');
  const bytes = Utilities.base64Decode(input.base64);
  if (bytes.length > MAX_MB * 1024 * 1024) throw new Error('File is larger than ' + MAX_MB + ' MB.');
  return Utilities.newBlob(bytes, str_(input.mimeType) || 'application/octet-stream', name);
}
