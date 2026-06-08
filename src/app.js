const DB_NAME = "gitnotes-db";
const DB_VERSION = 1;
const STORE = "kv";
const CONFIG_KEY = "config";
const TOKEN_KEY = "token";
const NOTES_KEY = "notes";
const FOLDERS_KEY = "folders";
const SELECTED_KEY = "selectedPath";
const MASKED_TOKEN = "****************";

const state = {
  config: null,
  token: "",
  notes: [],
  folders: [],
  selectedPath: "",
  selectedNote: null,
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
  settingsError: document.querySelector("#settingsError"),
  clearTokenButton: document.querySelector("#clearTokenButton"),
  searchInput: document.querySelector("#searchInput"),
  newNoteButton: document.querySelector("#newNoteButton"),
  newItemDialog: document.querySelector("#newItemDialog"),
  newItemForm: document.querySelector("#newItemForm"),
  newTypeFile: document.querySelector("#newTypeFile"),
  newTypeFolder: document.querySelector("#newTypeFolder"),
  newItemNameInput: document.querySelector("#newItemNameInput"),
  newLocationTree: document.querySelector("#newLocationTree"),
  newItemError: document.querySelector("#newItemError"),
  syncButton: document.querySelector("#syncButton"),
  saveButton: document.querySelector("#saveButton"),
  deleteButton: document.querySelector("#deleteButton"),
  mobileFilesButton: document.querySelector("#mobileFilesButton"),
  filePickerDialog: document.querySelector("#filePickerDialog"),
  mobileSearchInput: document.querySelector("#mobileSearchInput"),
  mobileFileList: document.querySelector("#mobileFileList"),
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
  conflictOverwrite: document.querySelector("#conflictOverwrite"),
  saveConfirmDialog: document.querySelector("#saveConfirmDialog"),
  saveConfirmForm: document.querySelector("#saveConfirmForm"),
  saveConfirmTitle: document.querySelector("#saveConfirmTitle"),
  confirmSaveButton: document.querySelector("#confirmSaveButton"),
  cancelSaveButton: document.querySelector("#cancelSaveButton"),
  saveSummary: document.querySelector("#saveSummary"),
  savePreview: document.querySelector("#savePreview")
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
  els.mobileSearchInput.addEventListener("input", renderNotes);
  els.mobileFilesButton.addEventListener("click", openFilePicker);
  els.newNoteButton.addEventListener("click", openNewItemDialog);
  els.syncButton.addEventListener("click", () => syncFromRemote());
  els.saveButton.addEventListener("click", () => saveAllNotes());
  els.deleteButton.addEventListener("click", deleteCurrentNote);
  els.clearTokenButton.addEventListener("click", clearToken);

  els.settingsForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    await saveSettings();
  });

  els.newItemForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    await createNewItem();
  });

  els.saveConfirmForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (event.submitter?.value === "cancel") {
      els.saveConfirmDialog.close("cancel");
      return;
    }
    els.saveConfirmDialog.close("confirm");
  });

  els.newTypeFile.addEventListener("change", updateNewItemPlaceholder);
  els.newTypeFolder.addEventListener("change", updateNewItemPlaceholder);

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
    savedContent: note.savedContent ?? (note.dirty || note.pending ? "" : note.content || ""),
    title: titleFromPath(note.path)
  }));
  state.folders = (await getValue(FOLDERS_KEY)) || [];
  state.selectedPath = (await getValue(SELECTED_KEY)) || "";
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
  return hasSetupFields();
}

function openSettings() {
  showSettingsError("");
  els.tokenInput.value = state.token ? MASKED_TOKEN : "";
  els.ownerInput.value = state.config?.owner || "";
  els.repoInput.value = state.config?.repo || "";
  els.branchInput.value = state.config?.branch || "main";
  els.folderInput.value = state.config?.folder || "";
  debugState("settings opened");
  els.settingsDialog.showModal();
}

async function saveSettings() {
  const tokenValue = els.tokenInput.value.trim();
  const nextToken = tokenValue === MASKED_TOKEN ? state.token : tokenValue;
  const nextConfig = {
    owner: els.ownerInput.value.trim(),
    repo: els.repoInput.value.trim(),
    branch: els.branchInput.value.trim() || "main",
    folder: normalizeBaseDirectory(els.folderInput.value)
  };

  if (!nextConfig.owner || !nextConfig.repo || !nextConfig.branch) {
    showSettingsError("Repository owner, repository name, and branch are required.");
    return;
  }

  if (!nextToken) {
    showSettingsError("A GitHub token is required.");
    return;
  }

  const previousConfig = state.config;
  const previousToken = state.token;
  state.config = nextConfig;
  state.token = nextToken;
  debugState("settings validation started");

  try {
    await listMarkdownFiles({ allowMissingDirectory: false });
  } catch (error) {
    state.config = previousConfig;
    state.token = previousToken;
    debugState("settings validation failed", { error: readableError(error) });
    showSettingsError(`Could not read that repo or directory: ${readableError(error)}`);
    return;
  }

  if (tokenValue !== MASKED_TOKEN) {
    await setValue(TOKEN_KEY, state.token);
  }
  await setValue(CONFIG_KEY, state.config);
  els.settingsDialog.close();
  showSettingsError("");
  debugState("settings saved");
  render();
  await syncFromRemote();
}

async function clearToken() {
  state.token = "";
  await deleteValue(TOKEN_KEY);
  els.tokenInput.value = "";
  showSettingsError("");
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
  const plan = await buildPullPlan(remoteFiles, { includeDiff: !silent });

  if (!silent && plan.changes.length) {
    const review = await confirmDiff({
      title: "Pull from GitHub",
      confirmLabel: "Confirm pull",
      changes: plan.changes,
      emptyMessage: "No remote changes.",
      mode: "pull"
    });
    if (!review.confirmed) {
      setSync("idle", "Pull cancelled");
      return;
    }
    plan.changes = review.changes;
  } else if (!silent && !plan.changes.length) {
    showToast("No remote changes.");
  }

  applyPullPlan(plan, plan.changes);
  await persistNotes();

  if (state.selectedNote && !state.selectedNote.loaded && !state.selectedNote.pending) {
    await loadNoteContent(state.selectedNote);
  }

  debugState("sync complete", { remoteFileCount: remoteFiles.files.length, folderCount: state.folders.length });
  render();
  setSync("ok", `Synced ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
  if (!silent) showToast("Synced with GitHub.");
}

async function buildPullPlan(remoteFiles, { includeDiff = true } = {}) {
  const markdownFiles = remoteFiles.files;
  const localByPath = new Map(state.notes.map((note) => [note.path, note]));
  const merged = [];
  const changes = [];

  for (const file of markdownFiles) {
    const local = localByPath.get(file.path);
    const hasLocalChanges = Boolean(local?.dirty || local?.pending);
    const remoteChanged = Boolean(local?.sha && local.sha !== file.sha);
    const isNewRemote = !local;
    const shouldFetchRemote = includeDiff && (isNewRemote || remoteChanged);
    const remoteContent = shouldFetchRemote ? await fetchMarkdownContent(file.path) : "";
    const keepLocalContent = Boolean(local && (!remoteChanged || (!includeDiff && hasLocalChanges)));

    if (includeDiff && (isNewRemote || remoteChanged)) {
      changes.push(createDiffChange({
        path: file.path,
        before: local?.savedContent ?? local?.content ?? "",
        after: remoteContent,
        status: isNewRemote ? "added" : hasLocalChanges ? "remote changed" : "modified",
        note: hasLocalChanges ? "Local unsynced changes conflict with remote." : "",
        conflict: hasLocalChanges,
        localContent: local?.content ?? "",
        remoteContent
      }));
    }

    merged.push({
      id: local?.id || crypto.randomUUID(),
      path: file.path,
      title: titleFromPath(file.path),
      sha: file.sha,
      remoteSha: file.sha,
      content: keepLocalContent ? local.content || "" : remoteContent,
      savedContent: keepLocalContent ? local.savedContent ?? (hasLocalChanges ? "" : local.content || "") : remoteContent,
      loaded: keepLocalContent ? Boolean(local?.loaded) : Boolean(remoteContent),
      dirty: keepLocalContent ? Boolean(local?.dirty) : false,
      pending: keepLocalContent ? Boolean(local?.pending) : false,
      deleted: false,
      updatedAt: local?.updatedAt || Date.now()
    });
  }

  for (const local of state.notes) {
    const missingRemote = !markdownFiles.some((file) => file.path === local.path);
    if ((local.dirty || local.pending) && missingRemote && !includeDiff) {
      merged.unshift(local);
    } else if ((local.dirty || local.pending) && missingRemote && includeDiff) {
      changes.push(createDiffChange({
        path: local.path,
        before: local.savedContent ?? local.content ?? "",
        after: "",
        status: "deleted remotely",
        note: "Local unsynced changes conflict with remote deletion.",
        conflict: true,
        localContent: local.content ?? "",
        remoteContent: "",
        noteId: local.id
      }));
    } else if (includeDiff && !local.dirty && !local.pending && missingRemote) {
      changes.push(createDiffChange({
        path: local.path,
        before: local.savedContent ?? local.content ?? "",
        after: "",
        status: "deleted"
      }));
    }
  }

  return {
    folders: remoteFiles.folders,
    notes: sortNotes(merged),
    changes
  };
}

function applyPullPlan(plan, changes = []) {
  state.folders = plan.folders;
  state.notes = plan.notes;
  for (const change of changes) {
    if (!change.conflict || change.mode !== "merge") continue;
    let note = state.notes.find((item) => item.path === change.path);
    if (!note) {
      note = {
        id: change.noteId || crypto.randomUUID(),
        path: change.path,
        title: titleFromPath(change.path),
        sha: "",
        remoteSha: "",
        content: "",
        savedContent: "",
        loaded: true,
        dirty: true,
        pending: true,
        deleted: false,
        updatedAt: Date.now()
      };
      state.notes.unshift(note);
    }
    note.content = buildMergedConflictContent(change.path, change.localContent, change.remoteContent);
    note.savedContent = change.remoteContent;
    note.loaded = true;
    note.dirty = true;
    note.pending = true;
    note.updatedAt = Date.now();
  }
  state.selectedNote = state.notes.find((note) => note.path === state.selectedPath) || state.notes[0] || null;
  state.selectedPath = state.selectedNote?.path || "";
}

async function listMarkdownFiles({ allowMissingDirectory = true } = {}) {
  const result = { files: [], folders: [] };
  const directories = [normalizeBaseDirectory(state.config.folder)];

  while (directories.length) {
    const directory = directories.shift();
    const url = apiUrl(contentEndpoint(directory), {
      ref: state.config.branch
    });
    const response = await githubFetch(url, { allow404: allowMissingDirectory });
    if (response.status === 404) continue;

    const items = await response.json();
    if (!Array.isArray(items)) {
      throw new Error("Configured root directory is not a directory.");
    }

    for (const item of items) {
      if (item.type === "dir") {
        result.folders.push(item.path);
        directories.push(item.path);
      } else if (item.type === "file" && item.name.toLowerCase().endsWith(".md")) {
        result.files.push({ path: item.path, sha: item.sha });
      }
    }
  }

  return result;
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
  if (els.filePickerDialog.open) {
    els.filePickerDialog.close();
  }
  render();
}

function openFilePicker() {
  renderNotes();
  els.filePickerDialog.showModal();
  els.mobileSearchInput.focus();
}

async function loadNoteContent(note) {
  if (!hasSetupFields() || !state.online) return;
  setSync("busy", "Loading note");
  const response = await githubFetch(apiUrl(`/repos/${state.config.owner}/${state.config.repo}/contents/${encodePath(note.path)}`, {
    ref: state.config.branch
  }));
  const file = await response.json();
  note.content = decodeBase64(file.content || "");
  note.savedContent = note.content;
  note.sha = file.sha;
  note.remoteSha = file.sha;
  note.loaded = true;
  note.title = titleFromPath(note.path);
  note.updatedAt = Date.now();
  await persistNotes();
  setSync("ok", "Note loaded");
}

async function fetchMarkdownContent(path) {
  const response = await githubFetch(apiUrl(`/repos/${state.config.owner}/${state.config.repo}/contents/${encodePath(path)}`, {
    ref: state.config.branch
  }));
  const file = await response.json();
  return decodeBase64(file.content || "");
}

function openNewItemDialog() {
  if (!hasValidSetup()) {
    openSettings();
    return;
  }

  showNewItemError("");
  els.newTypeFile.checked = true;
  updateNewItemPlaceholder();
  renderLocationTree();
  els.newItemDialog.showModal();
  els.newItemNameInput.focus();
  els.newItemNameInput.select();
}

async function createNewItem() {
  const type = els.newTypeFolder.checked ? "folder" : "file";
  const name = normalizeNewItemName(els.newItemNameInput.value, type);
  const location = selectedNewLocation();

  if (!name) {
    showNewItemError("Name is required.");
    return;
  }

  if (name.includes("/")) {
    showNewItemError("Use the location picker for folders. The name should not include a slash.");
    return;
  }

  if (type === "folder") {
    await createFolder(location, name);
    return;
  }

  await createNote(location, name);
}

async function createNote(location, filename) {
  const path = uniquePath(joinBaseDirectory(location, filename));
  const title = titleFromPath(path);
  const note = {
    id: crypto.randomUUID(),
    path,
    title,
    sha: "",
    remoteSha: "",
    content: "",
    savedContent: "",
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
  els.newItemDialog.close();
  render();
  els.titleInput.focus();
  els.titleInput.select();
}

async function createFolder(location, folderName) {
  if (!state.online) {
    showNewItemError("Folder creation needs GitHub access.");
    return;
  }

  const folderPath = joinBaseDirectory(location, folderName);
  const placeholderPath = joinBaseDirectory(folderPath, ".gitkeep");

  try {
    await githubFetch(apiUrl(`/repos/${state.config.owner}/${state.config.repo}/contents/${encodePath(placeholderPath)}`), {
      method: "PUT",
      body: JSON.stringify({
        message: `Create ${folderPath}`,
        content: encodeBase64(""),
        branch: state.config.branch
      })
    });
  } catch (error) {
    showNewItemError(readableError(error));
    return;
  }

  els.newItemDialog.close();
  showToast("Folder created.");
  await syncFromRemote();
}

function updateNewItemPlaceholder() {
  els.newItemNameInput.value = "";
  els.newItemNameInput.placeholder = els.newTypeFolder.checked ? "Folder name" : "Untitled.md";
}

function normalizeNewItemName(value, type) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (type === "folder") return normalizeBaseDirectory(trimmed);
  return trimmed;
}

function selectedNewLocation() {
  return els.newLocationTree.querySelector("input[name='newLocation']:checked")?.value || normalizeBaseDirectory(state.config?.folder || "");
}

function showNewItemError(message) {
  els.newItemError.textContent = message;
  els.newItemError.hidden = !message;
}

function renderLocationTree() {
  els.newLocationTree.innerHTML = "";
  const rootDirectory = normalizeBaseDirectory(state.config?.folder || "");
  const directories = folderOptionsFromNotes();

  appendLocationOption(rootDirectory, rootDirectory || "Repository root", 0, true);
  for (const directory of directories) {
    if (directory === rootDirectory) continue;
    appendLocationOption(directory, directory.split("/").pop(), directoryDepth(directory, rootDirectory), false);
  }
}

function folderOptionsFromNotes() {
  const rootDirectory = normalizeBaseDirectory(state.config?.folder || "");
  const directories = new Set(rootDirectory ? [rootDirectory] : [""]);

  for (const folder of state.folders) {
    directories.add(folder);
  }

  for (const note of state.notes) {
    let directory = directoryFromPath(note.path);
    while (directory) {
      directories.add(directory);
      directory = directoryFromPath(directory);
    }
  }

  return [...directories].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function appendLocationOption(value, label, depth, checked) {
  const option = document.createElement("label");
  option.className = "location-option";
  option.style.setProperty("--depth", depth);

  const input = document.createElement("input");
  input.type = "radio";
  input.name = "newLocation";
  input.value = value;
  input.checked = checked;

  const text = document.createElement("span");
  text.textContent = label || "Repository root";

  option.append(input, text);
  els.newLocationTree.append(option);
}

function directoryDepth(directory, rootDirectory) {
  const relative = rootDirectory && directory.startsWith(`${rootDirectory}/`) ? directory.slice(rootDirectory.length + 1) : directory;
  return relative ? relative.split("/").length : 0;
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

  const nextDraft = buildSaveDraft();
  const review = await confirmSave(nextDraft);
  if (!review.confirmed) return;
  if (review.changes[0]?.excluded) {
    revertPushChange(review.changes[0], nextDraft);
    await persistNotes();
    render();
    showToast("File changes undone.");
    return;
  }

  applySaveDraft(nextDraft);
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

async function saveAllNotes() {
  if (!hasSetupFields()) {
    if (state.selectedNote && state.dirty) await saveDraftOnly();
    openSettings();
    return;
  }

  const selectedDraft = state.selectedNote && state.dirty ? buildSaveDraft() : null;
  const pendingNotes = state.notes.filter((note) => note !== state.selectedNote && (note.pending || note.dirty));
  const selectedPending = state.selectedNote && !state.dirty && (state.selectedNote.pending || state.selectedNote.dirty)
    ? state.selectedNote
    : null;

  if (!selectedDraft && !selectedPending && !pendingNotes.length) {
    showToast("Nothing to push.");
    return;
  }

  const changes = buildPushChanges({
    selectedDraft,
    selectedPending,
    pendingNotes
  });
  const review = await confirmDiff({
    title: "Push to GitHub",
    confirmLabel: "Confirm push",
    changes,
    emptyMessage: "No local changes.",
    mode: "push"
  });
  if (!review.confirmed) return;

  const activeChanges = review.changes.filter((change) => !change.excluded);
  const revertedChanges = review.changes.filter((change) => change.excluded);
  for (const change of revertedChanges) {
    revertPushChange(change, selectedDraft);
  }

  if (!activeChanges.length) {
    await persistNotes();
    render();
    showToast("No files left to push.");
    return;
  }

  if (selectedDraft && activeChanges.some((change) => change.draft === selectedDraft)) {
    applySaveDraft(selectedDraft);
    state.selectedPath = state.selectedNote.path;
    state.selectedNote.dirty = true;
    state.selectedNote.pending = true;
    state.selectedNote.updatedAt = Date.now();
    state.dirty = false;
  }

  await persistNotes();

  if (!state.online) {
    setSync("error", "Saved locally");
    showToast("Saved locally. It will push when online.");
    render();
    return;
  }

  await syncPendingNotes({ showCompleteToast: true });
  render();
}

function applyEditorToSelected() {
  state.selectedNote.title = els.titleInput.value.trim() || "Untitled.md";
  state.selectedNote.content = els.noteEditor.value;
}

function buildSaveDraft() {
  const note = state.selectedNote;
  const previousPath = note.path;
  const nextTitle = els.titleInput.value.trim() || "Untitled.md";
  const nextContent = els.noteEditor.value;
  const nextPath = pathForTitle(nextTitle, previousPath);

  return {
    previousPath,
    previousSha: note.sha,
    previousContent: note.savedContent ?? "",
    nextPath,
    nextTitle: titleFromPath(nextPath),
    nextContent,
    isNew: !note.sha,
    isRename: previousPath !== nextPath
  };
}

function applySaveDraft(draft) {
  state.selectedNote.path = draft.nextPath;
  state.selectedNote.title = draft.nextTitle;
  state.selectedNote.content = draft.nextContent;
  state.selectedNote.previousPath = draft.isRename ? draft.previousPath : "";
  state.selectedNote.previousSha = draft.isRename ? draft.previousSha : "";
  if (state.selectedNote.previousPath) {
    state.selectedNote.sha = "";
    state.selectedNote.remoteSha = "";
  }
}

function revertPushChange(change, selectedDraft = null) {
  if (change.draft && change.draft === selectedDraft && state.selectedNote) {
    revertNoteToSaved(state.selectedNote, selectedDraft);
    return;
  }

  const note = state.notes.find((item) => item.id === change.noteId || item.path === change.path);
  if (!note) return;
  revertNoteToSaved(note);
}

function revertNoteToSaved(note, draft = null) {
  if (!note.sha && !draft?.previousSha) {
    state.notes = state.notes.filter((item) => item.id !== note.id);
    state.selectedNote = state.notes[0] || null;
    state.selectedPath = state.selectedNote?.path || "";
    state.dirty = false;
    return;
  }

  if (draft?.previousPath) {
    note.path = draft.previousPath;
    note.title = titleFromPath(draft.previousPath);
    note.sha = draft.previousSha;
    note.remoteSha = draft.previousSha;
  }

  note.content = draft?.previousContent ?? note.savedContent ?? "";
  note.title = titleFromPath(note.path);
  note.previousPath = "";
  note.previousSha = "";
  note.dirty = false;
  note.pending = false;
  note.loaded = true;
  note.updatedAt = Date.now();

  if (state.selectedNote?.id === note.id) {
    state.selectedPath = note.path;
    state.dirty = false;
  }
}

function buildMergedConflictContent(path, localContent, remoteContent) {
  return [
    `<<<<<<< local (${path})`,
    localContent,
    "=======",
    remoteContent,
    ">>>>>>> remote",
    ""
  ].join("\n");
}

function confirmSave(draft) {
  return confirmDiff({
    title: "Push to GitHub",
    confirmLabel: "Confirm push",
    changes: [
      createDiffChange({
        path: draft.nextPath,
        previousPath: draft.isRename ? draft.previousPath : "",
        before: draft.previousContent,
        after: draft.nextContent,
        status: draft.isNew ? "added" : draft.isRename ? "renamed" : "modified",
        draft,
        noteId: state.selectedNote?.id || ""
      })
    ],
    emptyMessage: "No content changes.",
    mode: "push"
  });
}

function confirmDiff({ title, confirmLabel, changes, emptyMessage, mode }) {
  renderDiffConfirmation({ title, confirmLabel, changes, emptyMessage, mode });
  return new Promise((resolve) => {
    const onClose = () => {
      els.saveConfirmDialog.removeEventListener("close", onClose);
      resolve({
        confirmed: els.saveConfirmDialog.returnValue === "confirm",
        changes
      });
    };
    els.saveConfirmDialog.addEventListener("close", onClose);
    els.saveConfirmDialog.showModal();
  });
}

function renderDiffConfirmation({ title, confirmLabel, changes, emptyMessage, mode }) {
  els.saveConfirmTitle.textContent = title;
  els.confirmSaveButton.textContent = confirmLabel;
  renderDiffSummary(changes);
  renderDiffFiles(changes, emptyMessage, mode);
}

function renderDiffSummary(changes) {
  els.saveSummary.innerHTML = "";
  const activeChanges = changes.filter((change) => !change.excluded);
  const totals = activeChanges.reduce((acc, change) => {
    acc.added += change.added;
    acc.removed += change.removed;
    return acc;
  }, { added: 0, removed: 0 });

  const rows = [
    ["Files", String(activeChanges.length)],
    ["Added", `+${totals.added}`],
    ["Removed", `-${totals.removed}`]
  ];

  for (const [label, value] of rows) {
    const row = document.createElement("div");
    const labelEl = document.createElement("span");
    const valueEl = document.createElement("strong");
    labelEl.textContent = label;
    valueEl.textContent = value;
    row.append(labelEl, valueEl);
    els.saveSummary.append(row);
  }
}

function buildPushChanges({ selectedDraft, selectedPending, pendingNotes }) {
  const changes = [];

  if (selectedDraft) {
    changes.push(createDiffChange({
      path: selectedDraft.nextPath,
      previousPath: selectedDraft.isRename ? selectedDraft.previousPath : "",
      before: selectedDraft.previousContent,
      after: selectedDraft.nextContent,
      status: selectedDraft.isNew ? "added" : selectedDraft.isRename ? "renamed" : "modified",
      draft: selectedDraft,
      noteId: state.selectedNote?.id || ""
    }));
  } else if (selectedPending) {
    changes.push(createDiffChange({
      path: selectedPending.path,
      before: selectedPending.savedContent ?? "",
      after: selectedPending.content ?? "",
      status: selectedPending.sha ? "modified" : "added",
      noteId: selectedPending.id
    }));
  }

  for (const note of pendingNotes) {
    changes.push(createDiffChange({
      path: note.path,
      previousPath: note.previousPath || "",
      before: note.savedContent ?? "",
      after: note.content ?? "",
      status: note.sha ? "modified" : "added",
      noteId: note.id
    }));
  }

  return changes;
}

function createDiffChange({
  path,
  previousPath = "",
  before,
  after,
  status,
  note = "",
  conflict = false,
  localContent = "",
  remoteContent = "",
  draft = null,
  noteId = ""
}) {
  const lines = diffLines(before, after);
  return {
    path,
    previousPath,
    status,
    note,
    conflict,
    localContent,
    remoteContent,
    draft,
    noteId,
    mode: conflict ? "overwrite" : "",
    excluded: false,
    added: lines.filter((line) => line.type === "add").length,
    removed: lines.filter((line) => line.type === "remove").length,
    lines
  };
}

function renderDiffFiles(changes, emptyMessage, mode) {
  els.savePreview.innerHTML = "";
  if (!changes.length) {
    const empty = document.createElement("p");
    empty.className = "diff-empty";
    empty.textContent = emptyMessage;
    els.savePreview.append(empty);
    return;
  }

  for (const change of changes) {
    els.savePreview.append(createDiffFile(change, mode, changes));
  }
}

function createDiffFile(change, mode, changes) {
  const details = document.createElement("details");
  details.className = "diff-file";
  details.open = true;

  const summary = document.createElement("summary");
  summary.className = "diff-file-header";

  const title = document.createElement("span");
  title.className = "diff-file-title";
  title.textContent = change.path;

  const meta = document.createElement("span");
  meta.className = "diff-file-meta";
  meta.textContent = `${change.status}  +${change.added} -${change.removed}`;

  summary.append(title, meta);

  if (mode === "push") {
    const undoButton = document.createElement("button");
    undoButton.type = "button";
    undoButton.className = "diff-file-action";
    undoButton.textContent = change.excluded ? "Keep change" : "Undo file";
    undoButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      change.excluded = !change.excluded;
      details.classList.toggle("is-excluded", change.excluded);
      undoButton.textContent = change.excluded ? "Keep change" : "Undo file";
      renderDiffSummary(changes);
    });
    summary.append(undoButton);
  }

  details.append(summary);

  if (change.previousPath) {
    const previous = document.createElement("div");
    previous.className = "diff-file-note";
    previous.textContent = `from ${change.previousPath}`;
    details.append(previous);
  }

  if (change.note) {
    const note = document.createElement("div");
    note.className = "diff-file-note";
    note.textContent = change.note;
    details.append(note);
  }

  if (mode === "pull" && change.conflict) {
    details.append(createPullConflictOptions(change));
  }

  const lines = document.createElement("div");
  lines.className = "diff-lines";
  if (!change.lines.length) {
    const row = document.createElement("div");
    row.className = "diff-line";
    row.textContent = "No content changes.";
    lines.append(row);
  }

  for (const line of change.lines) {
    lines.append(createDiffLine(line));
  }

  details.append(lines);
  return details;
}

function createPullConflictOptions(change) {
  const controls = document.createElement("div");
  controls.className = "diff-conflict-controls";

  for (const [value, label] of [["overwrite", "Overwrite local"], ["merge", "Merge"]]) {
    const option = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = `pull-${change.path}`;
    input.value = value;
    input.checked = change.mode === value;
    input.addEventListener("change", () => {
      change.mode = value;
    });

    const text = document.createElement("span");
    text.textContent = label;
    option.append(input, text);
    controls.append(option);
  }

  return controls;
}

function createDiffLine(line) {
  const row = document.createElement("div");
  row.className = `diff-line is-${line.type}`;

  const marker = document.createElement("span");
  marker.className = "diff-marker";
  marker.textContent = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";

  const content = document.createElement("span");
  content.className = "diff-content";
  content.textContent = line.value;

  row.append(marker, content);
  return row;
}

function diffLines(before, after) {
  if (before === after) return [];

  const oldLines = splitDiffLines(before);
  const newLines = splitDiffLines(after);
  const table = Array.from({ length: oldLines.length + 1 }, () => Array(newLines.length + 1).fill(0));

  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? table[oldIndex + 1][newIndex + 1] + 1
        : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
    }
  }

  const lines = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      lines.push({ type: "context", value: oldLines[oldIndex] });
      oldIndex += 1;
      newIndex += 1;
    } else if (table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1]) {
      lines.push({ type: "remove", value: oldLines[oldIndex] });
      oldIndex += 1;
    } else {
      lines.push({ type: "add", value: newLines[newIndex] });
      newIndex += 1;
    }
  }

  while (oldIndex < oldLines.length) {
    lines.push({ type: "remove", value: oldLines[oldIndex] });
    oldIndex += 1;
  }
  while (newIndex < newLines.length) {
    lines.push({ type: "add", value: newLines[newIndex] });
    newIndex += 1;
  }

  return trimDiffContext(lines);
}

function splitDiffLines(value) {
  if (!value) return [];
  return value.replace(/\n$/, "").split("\n");
}

function trimDiffContext(lines) {
  const output = [];
  let skipped = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.type !== "context") {
      if (skipped) {
        output.push({ type: "context", value: `... ${skipped} unchanged line${skipped === 1 ? "" : "s"}` });
        skipped = 0;
      }
      output.push(line);
      continue;
    }

    const nearChange = lines.slice(Math.max(0, index - 2), index + 3).some((item) => item.type !== "context");
    if (nearChange) {
      if (skipped) {
        output.push({ type: "context", value: `... ${skipped} unchanged line${skipped === 1 ? "" : "s"}` });
        skipped = 0;
      }
      output.push(line);
    } else {
      skipped += 1;
    }
  }

  return output;
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
    note.savedContent = note.content;
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

async function syncPendingNotes({ showCompleteToast = false } = {}) {
  if (!hasSetupFields() || !state.online) return;
  const pending = state.notes.filter((note) => note.pending && !note.deleted);
  for (const note of pending) {
    await pushNote(note);
  }
  if (showCompleteToast && pending.length) {
    setSync("ok", `Pushed ${pending.length} file${pending.length === 1 ? "" : "s"}`);
    showToast(`Pushed ${pending.length} file${pending.length === 1 ? "" : "s"} to GitHub.`);
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
  renderLayout();
  debugState("render");
}

function renderNotes() {
  renderNoteList(els.noteList, els.searchInput.value);
  renderNoteList(els.mobileFileList, els.mobileSearchInput.value);
}

function renderNoteList(container, searchValue) {
  const query = searchValue.trim().toLowerCase();
  const notes = state.notes.filter((note) => {
    if (!query) return true;
    return note.title.toLowerCase().includes(query) || note.path.toLowerCase().includes(query);
  });
  const folders = state.folders.filter((folder) => {
    if (!query) return true;
    return folder.toLowerCase().includes(query) || notes.some((note) => note.path.startsWith(`${folder}/`));
  });

  container.innerHTML = "";
  if (!notes.length && !folders.length) {
    const empty = document.createElement("p");
    empty.className = "help-text";
    empty.textContent = state.notes.length ? "No matching notes." : "No notes yet.";
    container.append(empty);
    return;
  }

  renderNoteTree(buildNoteTree(notes, folders), container, 0);
}

function buildNoteTree(notes, folders = []) {
  const root = { dirs: new Map(), files: [] };

  for (const folder of folders) {
    const parts = folder.split("/").filter(Boolean);
    let node = root;

    for (const part of parts) {
      if (!node.dirs.has(part)) {
        node.dirs.set(part, { name: part, dirs: new Map(), files: [] });
      }
      node = node.dirs.get(part);
    }
  }

  for (const note of notes) {
    const parts = note.path.split("/");
    const filename = parts.pop();
    let node = root;

    for (const part of parts) {
      if (!node.dirs.has(part)) {
        node.dirs.set(part, { name: part, dirs: new Map(), files: [] });
      }
      node = node.dirs.get(part);
    }

    node.files.push({ ...note, title: filename || note.title });
  }

  return root;
}

function renderNoteTree(node, container, depth) {
  for (const file of sortNotes(node.files)) {
    container.append(createNoteButton(file, depth));
  }

  for (const directory of [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const row = document.createElement("div");
    row.className = "folder-item";
    row.style.setProperty("--depth", depth);
    row.textContent = directory.name;
    container.append(row);
    renderNoteTree(directory, container, depth + 1);
  }
}

function createNoteButton(note, depth) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `note-item${note.path === state.selectedPath ? " is-active" : ""}`;
  button.style.setProperty("--depth", depth);
  button.addEventListener("click", () => {
    selectNote(note.path).catch((error) => setSync("error", readableError(error)));
  });

  const title = document.createElement("span");
  title.className = "note-title";
  title.textContent = `${note.title}${note.pending ? " *" : ""}`;

  button.append(title);
  return button;
}

function renderEditor() {
  const hasSetup = hasSetupFields();
  const hasNote = Boolean(state.selectedNote);
  els.emptyState.hidden = hasSetup;
  els.editorState.hidden = !hasSetup || !hasNote;
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

function renderLayout() {
  els.app.classList.toggle("is-list-only", hasSetupFields() && !state.selectedNote);
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

function showSettingsError(message) {
  els.settingsError.textContent = message;
  els.settingsError.hidden = !message;
}

function debugState(label, details = {}) {
  console.debug("[GitNotes]", label, {
    configured: hasSetupFields(),
    owner: state.config?.owner || "",
    repo: state.config?.repo || "",
    branch: state.config?.branch || "",
    folder: state.config?.folder || "",
    noteCount: state.notes.length,
    selectedPath: state.selectedPath,
    selectedLoaded: Boolean(state.selectedNote?.loaded),
    emptyHidden: els.emptyState.hidden,
    editorHidden: els.editorState.hidden,
    ...details
  });
}

async function persistNotes() {
  state.notes = sortNotes(state.notes);
  await setValue(NOTES_KEY, state.notes);
  await setValue(FOLDERS_KEY, state.folders);
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
  const currentDirectory = directoryFromPath(currentPath);
  const baseDirectory = currentDirectory || state.config?.folder || "";
  const nextPath = joinBaseDirectory(baseDirectory, title || "Untitled.md");
  if (currentPath === nextPath) return currentPath;
  return uniquePath(nextPath);
}

function directoryFromPath(path) {
  const slashIndex = path.lastIndexOf("/");
  return slashIndex >= 0 ? path.slice(0, slashIndex) : "";
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
