const DB_NAME = "gitnotes-db";
const DB_VERSION = 1;
const STORE = "kv";
const CONFIG_KEY = "config";
const TOKEN_KEY = "token";
const NOTES_KEY = "notes";
const SELECTED_KEY = "selectedPath";
const VALID_SETUP_KEY = "validSetup";

const state = {
  config: null,
  token: "",
  notes: [],
  selectedPath: "",
  selectedNote: null,
  validSetup: false,
  dirty: false,
  saving: false,
  online: navigator.onLine
};

const els = {
  app: document.querySelector("#app"),
  settingsButton: document.querySelector("#settingsButton"),
  emptySetupButton: document.querySelector("#emptySetupButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsForm: document.querySelector("#settingsForm"),
  tokenInput: document.querySelector("#tokenInput"),
  ownerInput: document.querySelector("#ownerInput"),
  repoInput: document.querySelector("#repoInput"),
  branchInput: document.querySelector("#branchInput"),
  folderInput: document.querySelector("#folderInput"),
  clearTokenButton: document.querySelector("#clearTokenButton"),
  searchInput: document.querySelector("#searchInput"),
  newNoteButton: document.querySelector("#newNoteButton"),
  syncButton: document.querySelector("#syncButton"),
  saveButton: document.querySelector("#saveButton"),
  deleteButton: document.querySelector("#deleteButton"),
  noteList: document.querySelector("#noteList"),
  titleInput: document.querySelector("#titleInput"),
  noteEditor: document.querySelector("#noteEditor"),
  emptyState: document.querySelector("#emptyState"),
  editorState: document.querySelector("#editorState"),
  syncStatus: document.querySelector("#syncStatus"),
  syncText: document.querySelector("#syncText"),
  noteMeta: document.querySelector("#noteMeta"),
  pendingMeta: document.querySelector("#pendingMeta"),
  toast: document.querySelector("#toast"),
  conflictDialog: document.querySelector("#conflictDialog"),
  conflictReload: document.querySelector("#conflictReload"),
  conflictCopy: document.querySelector("#conflictCopy"),
  conflictOverwrite: document.querySelector("#conflictOverwrite")
};

let dbPromise;
let toastTimer;

init();

async function init() {
  bindEvents();
  await loadState();
  await registerServiceWorker();
  render();

  if (hasSetupFields()) {
    syncFromRemote({ silent: true }).catch((error) => {
      setSync("error", readableError(error));
    });
  } else {
    openSettings();
  }
}

function bindEvents() {
  els.settingsButton.addEventListener("click", openSettings);
  els.emptySetupButton.addEventListener("click", openSettings);
  els.searchInput.addEventListener("input", renderNotes);
  els.newNoteButton.addEventListener("click", createNote);
  els.syncButton.addEventListener("click", () => syncFromRemote());
  els.saveButton.addEventListener("click", () => saveCurrentNote());
  els.deleteButton.addEventListener("click", deleteCurrentNote);
  els.clearTokenButton.addEventListener("click", clearToken);

  els.settingsForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    await saveSettings();
  });

  els.titleInput.addEventListener("input", () => {
    if (!state.selectedNote) return;
    state.dirty = true;
    state.selectedNote.title = els.titleInput.value.trim() || "Untitled.md";
    renderMeta();
  });

  els.noteEditor.addEventListener("input", () => {
    if (!state.selectedNote) return;
    state.dirty = true;
    state.selectedNote.content = els.noteEditor.value;
    renderMeta();
  });

  window.addEventListener("online", () => {
    state.online = true;
    renderMeta();
    syncPendingNotes().catch((error) => setSync("error", readableError(error)));
  });

  window.addEventListener("offline", () => {
    state.online = false;
    setSync("error", "Offline");
    renderMeta();
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function loadState() {
  state.config = (await getValue(CONFIG_KEY)) || null;
  state.token = (await getValue(TOKEN_KEY)) || "";
  state.notes = ((await getValue(NOTES_KEY)) || []).map((note) => ({
    ...note,
    title: titleFromPath(note.path)
  }));
  state.selectedPath = (await getValue(SELECTED_KEY)) || "";
  state.validSetup = Boolean(await getValue(VALID_SETUP_KEY));
  state.selectedNote = state.notes.find((note) => note.path === state.selectedPath) || null;
}

async function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function getValue(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function setValue(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteValue(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function hasSetupFields() {
  return Boolean(state.token && state.config?.owner && state.config?.repo && state.config?.branch);
}

function hasValidSetup() {
  return hasSetupFields() && state.validSetup;
}

function openSettings() {
  els.tokenInput.value = state.token ? "****************" : "";
  els.ownerInput.value = state.config?.owner || "";
  els.repoInput.value = state.config?.repo || "";
  els.branchInput.value = state.config?.branch || "main";
  els.folderInput.value = state.config?.folder || "";
  els.settingsDialog.showModal();
}

async function saveSettings() {
  const tokenValue = els.tokenInput.value.trim();
  const nextConfig = {
    owner: els.ownerInput.value.trim(),
    repo: els.repoInput.value.trim(),
    branch: els.branchInput.value.trim() || "main",
    folder: normalizeBaseDirectory(els.folderInput.value)
  };

  if (!nextConfig.owner || !nextConfig.repo || !nextConfig.branch) {
    showToast("Owner, repo, and branch are required.");
    return;
  }

  state.config = nextConfig;
  if (tokenValue && !tokenValue.includes("*")) {
    state.token = tokenValue;
    await setValue(TOKEN_KEY, state.token);
  }
  await setValue(CONFIG_KEY, state.config);
  els.settingsDialog.close();
  render();
  try {
    await syncFromRemote();
  } catch (error) {
    state.validSetup = false;
    await setValue(VALID_SETUP_KEY, false);
    openSettings();
    setSync("error", readableError(error));
    showToast(readableError(error));
  }
}

async function clearToken() {
  state.token = "";
  state.validSetup = false;
  await deleteValue(TOKEN_KEY);
  await setValue(VALID_SETUP_KEY, false);
  els.tokenInput.value = "";
  setSync("idle", "Token removed");
  showToast("Token forgotten on this device.");
  render();
}

function normalizeBaseDirectory(value) {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

async function syncFromRemote({ silent = false } = {}) {
  if (!hasSetupFields()) {
    openSettings();
    return;
  }
  if (!state.online) {
    setSync("error", "Offline");
    return;
  }

  setSync("busy", "Syncing");
  const remoteFiles = await listMarkdownFiles();
  state.validSetup = true;
  await setValue(VALID_SETUP_KEY, true);
  const localByPath = new Map(state.notes.map((note) => [note.path, note]));
  const merged = [];

  for (const file of remoteFiles) {
    const local = localByPath.get(file.path);
    merged.push({
      id: local?.id || crypto.randomUUID(),
      path: file.path,
      title: titleFromPath(file.path),
      sha: file.sha,
      remoteSha: file.sha,
      content: local?.content || "",
      loaded: Boolean(local?.loaded),
      dirty: Boolean(local?.dirty),
      pending: Boolean(local?.pending),
      deleted: false,
      updatedAt: local?.updatedAt || Date.now()
    });
  }

  for (const local of state.notes) {
    if ((local.dirty || local.pending) && !merged.some((note) => note.path === local.path)) {
      merged.unshift(local);
    }
  }

  state.notes = sortNotes(merged);
  state.selectedNote = state.notes.find((note) => note.path === state.selectedPath) || state.notes[0] || null;
  state.selectedPath = state.selectedNote?.path || "";
  await persistNotes();
  render();
  await syncPendingNotes();
  setSync("ok", `Synced ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
  if (!silent) showToast("Synced with GitHub.");
}

async function listMarkdownFiles() {
  const url = apiUrl(contentEndpoint(state.config.folder), {
    ref: state.config.branch
  });
  const response = await githubFetch(url, { allow404: true });
  if (response.status === 404) return [];
  const items = await response.json();
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item.type === "file" && item.name.toLowerCase().endsWith(".md"))
    .map((item) => ({ path: item.path, sha: item.sha }));
}

async function selectNote(path) {
  if (state.dirty) await saveDraftOnly();
  state.selectedPath = path;
  state.selectedNote = state.notes.find((note) => note.path === path) || null;
  state.dirty = false;
  await setValue(SELECTED_KEY, state.selectedPath);

  if (state.selectedNote && !state.selectedNote.loaded && !state.selectedNote.pending) {
    await loadNoteContent(state.selectedNote);
  }
  render();
}

async function loadNoteContent(note) {
  if (!hasSetupFields() || !state.online) return;
  setSync("busy", "Loading note");
  const response = await githubFetch(apiUrl(`/repos/${state.config.owner}/${state.config.repo}/contents/${encodePath(note.path)}`, {
    ref: state.config.branch
  }));
  const file = await response.json();
  note.content = decodeBase64(file.content || "");
  note.sha = file.sha;
  note.remoteSha = file.sha;
  note.loaded = true;
  note.title = titleFromPath(note.path);
  note.updatedAt = Date.now();
  await persistNotes();
  setSync("ok", "Note loaded");
}

async function createNote() {
  if (!hasValidSetup()) {
    openSettings();
    return;
  }
  const path = uniquePath(joinBaseDirectory(state.config?.folder || "", "Untitled.md"));
  const title = titleFromPath(path);
  const note = {
    id: crypto.randomUUID(),
    path,
    title,
    sha: "",
    remoteSha: "",
    content: "",
    loaded: true,
    dirty: true,
    pending: true,
    deleted: false,
    updatedAt: Date.now()
  };
  state.notes.unshift(note);
  state.selectedNote = note;
  state.selectedPath = note.path;
  state.dirty = true;
  await persistNotes();
  render();
  els.titleInput.focus();
  els.titleInput.select();
}

async function saveDraftOnly() {
  if (!state.selectedNote) return;
  applyEditorToSelected();
  state.selectedNote.dirty = true;
  state.selectedNote.pending = true;
  state.selectedNote.updatedAt = Date.now();
  state.dirty = false;
  await persistNotes();
}

async function saveCurrentNote({ overwrite = false } = {}) {
  if (!state.selectedNote) return;
  if (!hasSetupFields()) {
    await saveDraftOnly();
    openSettings();
    return;
  }

  applyEditorToSelected();
  const previousPath = state.selectedNote.path;
  const previousSha = state.selectedNote.sha;
  state.selectedNote.path = pathForTitle(state.selectedNote.title, state.selectedNote.path);
  state.selectedNote.title = titleFromPath(state.selectedNote.path);
  state.selectedNote.previousPath = previousPath === state.selectedNote.path ? "" : previousPath;
  state.selectedNote.previousSha = previousPath === state.selectedNote.path ? "" : previousSha;
  if (state.selectedNote.previousPath) {
    state.selectedNote.sha = "";
    state.selectedNote.remoteSha = "";
  }
  state.selectedPath = state.selectedNote.path;
  state.selectedNote.dirty = true;
  state.selectedNote.pending = true;
  state.selectedNote.updatedAt = Date.now();
  await persistNotes();

  if (!state.online) {
    setSync("error", "Saved locally");
    showToast("Saved locally. It will push when online.");
    render();
    return;
  }

  await pushNote(state.selectedNote, { overwrite });
  render();
}

function applyEditorToSelected() {
  state.selectedNote.title = els.titleInput.value.trim() || "Untitled.md";
  state.selectedNote.content = els.noteEditor.value;
}

async function pushNote(note, { overwrite = false } = {}) {
  state.saving = true;
  setSync("busy", "Pushing");
  renderMeta();

  try {
    if (!overwrite && note.sha) {
      const remoteSha = await getRemoteSha(note.path);
      if (remoteSha && remoteSha !== note.sha) {
        await handleConflict(note);
        return;
      }
    }

    const body = {
      message: commitMessage(note),
      content: encodeBase64(note.content),
      branch: state.config.branch
    };
    if (note.sha && !overwrite) body.sha = note.sha;
    if (note.sha && overwrite) body.sha = await getRemoteSha(note.path);

    const response = await githubFetch(
      apiUrl(`/repos/${state.config.owner}/${state.config.repo}/contents/${encodePath(note.path)}`),
      {
        method: "PUT",
        body: JSON.stringify(body)
      }
    );
    const result = await response.json();
    note.sha = result.content?.sha || note.sha;
    note.remoteSha = note.sha;
    if (note.previousPath && note.previousSha) {
      await deleteRemoteFile(note.previousPath, note.previousSha, `Rename ${note.previousPath} to ${note.path}`);
      note.previousPath = "";
      note.previousSha = "";
    }
    note.dirty = false;
    note.pending = false;
    note.loaded = true;
    state.dirty = false;
    await persistNotes();
    setSync("ok", "Pushed to GitHub");
    showToast("Saved and pushed.");
  } finally {
    state.saving = false;
    renderMeta();
  }
}

async function handleConflict(note) {
  setSync("error", "Conflict");
  const choice = await showConflictDialog();
  if (choice === "reload") {
    await loadNoteContent(note);
    state.dirty = false;
    render();
    showToast("Reloaded remote note.");
    return;
  }
  if (choice === "copy") {
    note.path = uniquePath(note.path.replace(/\.md$/i, ` copy ${Date.now()}.md`));
    note.sha = "";
    note.remoteSha = "";
    await pushNote(note, { overwrite: true });
    return;
  }
  if (choice === "overwrite") {
    await pushNote(note, { overwrite: true });
  }
}

function showConflictDialog() {
  return new Promise((resolve) => {
    const onClose = () => {
      els.conflictDialog.removeEventListener("close", onClose);
      resolve(els.conflictDialog.returnValue || "reload");
    };
    els.conflictDialog.addEventListener("close", onClose);
    els.conflictDialog.showModal();
  });
}

async function syncPendingNotes() {
  if (!hasSetupFields() || !state.online) return;
  const pending = state.notes.filter((note) => note.pending && !note.deleted);
  for (const note of pending) {
    await pushNote(note);
  }
}

async function deleteCurrentNote() {
  if (!state.selectedNote) return;
  const note = state.selectedNote;
  const confirmed = window.confirm(`Delete "${note.title}"?`);
  if (!confirmed) return;

  state.notes = state.notes.filter((item) => item.id !== note.id);
  state.selectedNote = state.notes[0] || null;
  state.selectedPath = state.selectedNote?.path || "";
  state.dirty = false;
  await persistNotes();
  render();

  if (!note.sha || !hasSetupFields() || !state.online) {
    showToast("Deleted locally.");
    return;
  }

  setSync("busy", "Deleting");
  await githubFetch(apiUrl(`/repos/${state.config.owner}/${state.config.repo}/contents/${encodePath(note.path)}`), {
    method: "DELETE",
    body: JSON.stringify(deleteBody(note.path, note.sha))
  });
  setSync("ok", "Deleted on GitHub");
  showToast("Deleted from GitHub.");
}

async function deleteRemoteFile(path, sha, message) {
  await githubFetch(apiUrl(`/repos/${state.config.owner}/${state.config.repo}/contents/${encodePath(path)}`), {
    method: "DELETE",
    body: JSON.stringify(deleteBody(path, sha, message))
  });
}

function deleteBody(path, sha, message = `Delete ${path}`) {
  return {
    message,
    sha,
    branch: state.config.branch
  };
}

async function getRemoteSha(path) {
  const response = await githubFetch(apiUrl(`/repos/${state.config.owner}/${state.config.repo}/contents/${encodePath(path)}`, {
    ref: state.config.branch
  }), { allow404: true });
  if (response.status === 404) return "";
  const file = await response.json();
  return file.sha || "";
}

async function githubFetch(url, options = {}) {
  const { allow404 = false, ...fetchOptions } = options;
  const response = await fetch(url, {
    ...fetchOptions,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${state.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(fetchOptions.headers || {})
    }
  });
  if (!response.ok && !(allow404 && response.status === 404)) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const error = await response.json();
      message = error.message || message;
    } catch {
      // Keep the HTTP status message.
    }
    throw new Error(message);
  }
  return response;
}

function apiUrl(path, params = {}) {
  const url = new URL(`https://api.github.com${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function render() {
  renderNotes();
  renderEditor();
  renderMeta();
  renderSetupPrompt();
  renderLayout();
}

function renderNotes() {
  const query = els.searchInput.value.trim().toLowerCase();
  const notes = state.notes.filter((note) => {
    if (!query) return true;
    return note.title.toLowerCase().includes(query) || note.path.toLowerCase().includes(query);
  });

  els.noteList.innerHTML = "";
  if (!notes.length) {
    const empty = document.createElement("p");
    empty.className = "help-text";
    empty.textContent = state.notes.length ? "No matching notes." : "No notes yet.";
    els.noteList.append(empty);
    return;
  }

  for (const note of notes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `note-item${note.path === state.selectedPath ? " is-active" : ""}`;
    button.addEventListener("click", () => {
      selectNote(note.path).catch((error) => setSync("error", readableError(error)));
    });

    const title = document.createElement("span");
    title.className = "note-title";
    title.textContent = `${note.title}${note.pending ? " *" : ""}`;

    const subtitle = document.createElement("span");
    subtitle.className = "note-subtitle";
    subtitle.textContent = note.path;

    button.append(title, subtitle);
    els.noteList.append(button);
  }
}

function renderEditor() {
  const showLanding = !hasValidSetup();
  const hasNote = Boolean(state.selectedNote);
  els.emptyState.hidden = !showLanding;
  els.editorState.hidden = showLanding || !hasNote;
  els.titleInput.disabled = !hasNote;
  els.noteEditor.disabled = !hasNote;
  els.saveButton.disabled = !hasNote || state.saving;
  els.deleteButton.disabled = !hasNote;

  if (!hasNote) {
    els.titleInput.value = "";
    els.noteEditor.value = "";
    return;
  }

  if (document.activeElement !== els.titleInput) {
    els.titleInput.value = state.selectedNote.title;
  }
  if (document.activeElement !== els.noteEditor) {
    els.noteEditor.value = state.selectedNote.content || "";
  }
}

function renderMeta() {
  if (!hasSetupFields()) setSync("idle", "Not configured");
  if (!state.selectedNote) {
    els.noteMeta.textContent = "No note selected";
    els.pendingMeta.textContent = "";
    return;
  }
  const words = (els.noteEditor.value.trim().match(/\S+/g) || []).length;
  els.noteMeta.textContent = `${words} word${words === 1 ? "" : "s"} - ${state.selectedNote.path}`;
  const pending = state.dirty || state.selectedNote.pending || state.selectedNote.dirty;
  els.pendingMeta.textContent = pending ? "Unsynced changes" : "Saved";
}

function renderSetupPrompt() {
  els.emptyState.hidden = hasValidSetup();
}

function renderLayout() {
  els.app.classList.toggle("is-list-only", hasValidSetup() && !state.selectedNote);
}

function setSync(kind, text) {
  els.syncStatus.className = `sync-dot is-${kind}`;
  els.syncText.textContent = text;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    els.toast.classList.remove("is-visible");
  }, 2800);
}

async function persistNotes() {
  state.notes = sortNotes(state.notes);
  await setValue(NOTES_KEY, state.notes);
  await setValue(SELECTED_KEY, state.selectedPath);
}

function sortNotes(notes) {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title));
}

function titleFromPath(path) {
  return path.split("/").pop() || "Untitled.md";
}

function uniquePath(path) {
  const paths = new Set(state.notes.map((note) => note.path));
  if (!paths.has(path)) return path;
  const slashIndex = path.lastIndexOf("/");
  const dir = slashIndex >= 0 ? path.slice(0, slashIndex + 1) : "";
  const filename = slashIndex >= 0 ? path.slice(slashIndex + 1) : path;
  const extIndex = filename.toLowerCase().lastIndexOf(".md");
  const stem = extIndex >= 0 ? filename.slice(0, extIndex) : filename;
  const ext = extIndex >= 0 ? filename.slice(extIndex) : "";
  let index = 2;
  while (paths.has(`${dir}${stem}-${index}${ext}`)) index += 1;
  return `${dir}${stem}-${index}${ext}`;
}

function pathForTitle(title, currentPath) {
  const nextPath = joinBaseDirectory(state.config?.folder || "", title || "Untitled.md");
  if (currentPath === nextPath) return currentPath;
  return uniquePath(nextPath);
}

function joinBaseDirectory(baseDirectory, filename) {
  const normalizedBase = normalizeBaseDirectory(baseDirectory);
  return normalizedBase ? `${normalizedBase}/${filename}` : filename;
}

function contentEndpoint(baseDirectory) {
  const normalizedBase = normalizeBaseDirectory(baseDirectory);
  return normalizedBase ? `/repos/${state.config.owner}/${state.config.repo}/contents/${encodePath(normalizedBase)}` : `/repos/${state.config.owner}/${state.config.repo}/contents`;
}

function commitMessage(note) {
  const action = note.sha ? "Update" : "Create";
  return `${action} ${note.path}`;
}

function readableError(error) {
  return error?.message || "Something went wrong";
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}
