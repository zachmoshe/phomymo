/**
 * localStorage persistence for Phomymo label designs
 */

import { STORAGE_KEYS } from './constants.js';

const STORAGE_KEY = STORAGE_KEYS.DESIGNS;
const MULTI_LABEL_PRESETS_KEY = STORAGE_KEYS.MULTI_LABEL_PRESETS;
export const PRINT_HISTORY_FOLDER = '__phomymo_previously_printed__';
export const PRINT_HISTORY_LIMIT = 20;

/** Store an independent, resolved print snapshot and evict only old history. */
export function recordPrintedDesign(name, snapshot) {
  const designs = getAllDesigns();
  const history = Object.entries(designs).filter(([, d]) => d.folderId === PRINT_HISTORY_FOLDER)
    .sort((a, b) => (b[1].printSequence || 0) - (a[1].printSequence || 0));
  const id = crypto.randomUUID();
  const printedAt = Date.now();
  designs[id] = {
    ...JSON.parse(JSON.stringify(snapshot)),
    name: name || 'Printed design',
    folderId: PRINT_HISTORY_FOLDER,
    savedAt: printedAt,
    printedAt,
    printSequence: (history[0]?.[1].printSequence || 0) + 1,
  };
  for (const [expiredId] of history.slice(PRINT_HISTORY_LIMIT - 1)) delete designs[expiredId];
  // Insertion and eviction are one write: a quota error must not lose history.
  if (!setAllDesigns(designs)) throw new Error('Printed, but the history snapshot could not be saved (browser storage may be full).');
  return id;
}

/**
 * Get all saved designs from localStorage
 */
function getAllDesigns() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error('Saved design data could not be read. It has not been changed.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid saved design data. It has not been changed.');
  }
  return data;
}

/**
 * Save all designs to localStorage
 */
function setAllDesigns(designs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(designs));
    return true;
  } catch (e) {
    console.error('Failed to save designs:', e);
    return false;
  }
}

/**
 * Save a design to localStorage
 * @param {string} name - Design name
 * @param {object} design - { elements: [], labelSize: { width, height } }
 */
export function saveDesign(name, design, { id = null, folderId = null } = {}) {
  if (!name || !name.trim()) {
    throw new Error('Design name is required');
  }

  const designs = getAllDesigns();
  validateFolder(folderId);
  const existing = listDesigns().find(d => d.name === name.trim() && d.folderId === folderId);
  if (id && existing && existing.id !== id) throw new Error('A design with that name already exists in this folder');
  const key = id || existing?.id || (!Object.hasOwn(designs, name.trim()) ? name.trim() : crypto.randomUUID());
  // Define an own property even for names such as "__proto__".
  Object.defineProperty(designs, key, { enumerable: true, configurable: true, writable: true, value: {
    ...design,
    name: name.trim(),
    folderId,
    savedAt: Date.now(),
  } });

  if (!setAllDesigns(designs)) {
    throw new Error('Failed to save design');
  }

  return key;
}

/**
 * Load a design from localStorage
 * @param {string} name - Design name
 * @returns {object|null} - { elements: [], labelSize: { width, height }, savedAt: number }
 */
export function loadDesign(name) {
  const designs = getAllDesigns();
  return Object.hasOwn(designs, name) ? designs[name] : null;
}

/**
 * Get list of saved design names with metadata
 * @returns {Array} - [{ name, savedAt, labelSize, elementCount, isTemplate, templateDataCount, isMultiLabel }]
 */
export function listDesigns() {
  const designs = getAllDesigns();
  return Object.entries(designs)
    .map(([id, design]) => ({
      id,
      name: design.name || id,
      folderId: design.folderId || null,
      savedAt: design.savedAt,
      printedAt: design.printedAt,
      printSequence: design.printSequence,
      labelSize: design.labelSize,
      elementCount: design.elements?.length || 0,
      isTemplate: design.isTemplate || false,
      templateFieldCount: design.templateFields?.length || 0,
      templateDataCount: design.templateData?.length || 0,
      hasImages: design.elements?.some(el => el.type === 'image') || false,
      isMultiLabel: design.multiLabel?.enabled || false,
      multiLabel: design.multiLabel || null,
    }))
    .sort((a, b) => a.folderId === PRINT_HISTORY_FOLDER && b.folderId === PRINT_HISTORY_FOLDER
      ? b.printSequence - a.printSequence : b.savedAt - a.savedAt); // Most recent first
}

/**
 * Delete a design from localStorage
 * @param {string} name - Design name
 */
export function deleteDesign(name) {
  const designs = getAllDesigns();
  if (!Object.hasOwn(designs, name)) {
    return false;
  }

  delete designs[name];
  return setAllDesigns(designs);
}

/**
 * Rename a design
 * @param {string} oldName - Current name
 * @param {string} newName - New name
 */
export function renameDesign(oldName, newName) {
  if (!newName || !newName.trim()) {
    throw new Error('New name is required');
  }

  const design = loadDesign(oldName);
  if (!design) {
    throw new Error('Design not found');
  }

  return saveDesign(newName, design, { id: oldName, folderId: design.folderId || null });
}

/**
 * Check if a design name exists
 * @param {string} name - Design name
 */
export function designExists(name) {
  const designs = getAllDesigns();
  return Object.hasOwn(designs, name);
}

/**
 * Export design as JSON string (for file download)
 * @param {string} name - Design name
 */
export function exportDesign(name) {
  const design = loadDesign(name);
  if (!design) {
    throw new Error('Design not found');
  }

  return JSON.stringify({
    ...design,
    folderId: undefined,
    name: design.name || name,
    version: 9,
  }, null, 2);
}

/**
 * Import design from JSON string
 * @param {string} jsonString - JSON data
 * @param {string} overrideName - Optional name override
 * @returns {object} - { name, hasTemplateData, hasMultiLabel }
 */
export function importDesign(jsonString, overrideName = null, folderId = null) {
  try {
    const data = JSON.parse(jsonString);

    if (!data.elements || !Array.isArray(data.elements)) {
      throw new Error('Invalid design format: missing elements');
    }

    if (!data.labelSize || ![data.labelSize.width, data.labelSize.height].every(n => Number.isFinite(n) && n > 0 && n <= 2000)) {
      throw new Error('Invalid design format: missing label size');
    }

    const baseName = String(overrideName || data.name || 'Imported design').trim() || 'Imported design';
    let name = baseName;
    let suffix = 2;
    // Import is additive: never silently overwrite an existing library design.
    while (listDesigns().some(d => d.folderId === folderId && d.name === name)) name = `${baseName} (${suffix++})`;

    const designData = {
      elements: data.elements,
      labelSize: data.labelSize,
      editorRotation: data.editorRotation === 90 ? 90 : 0,
    };

    // Import template data if present
    if (data.isTemplate) {
      designData.isTemplate = true;
    }
    if (data.templateFields && Array.isArray(data.templateFields)) {
      designData.templateFields = data.templateFields;
    }
    if (data.templateColumns && Array.isArray(data.templateColumns)) {
      designData.templateColumns = data.templateColumns;
    }
    if (data.templateData && Array.isArray(data.templateData)) {
      designData.templateData = data.templateData;
    }

    // Import multi-label configuration if present
    if (data.multiLabel && typeof data.multiLabel === 'object') {
      designData.multiLabel = {
        enabled: data.multiLabel.enabled || false,
        labelWidth: data.multiLabel.labelWidth || 10,
        labelHeight: data.multiLabel.labelHeight || 20,
        labelsAcross: data.multiLabel.labelsAcross || 4,
        gapMm: data.multiLabel.gapMm ?? 2,
        cloneMode: data.multiLabel.cloneMode !== false, // Default to true
      };
    }

    const id = saveDesign(name, designData, { folderId });

    return {
      name,
      id,
      hasTemplateData: (data.templateData?.length || 0) > 0,
      templateDataCount: data.templateData?.length || 0,
      hasMultiLabel: data.multiLabel?.enabled || false,
    };
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error('Invalid JSON format');
    }
    throw e;
  }
}

/**
 * Get storage usage info
 */
export function getStorageInfo() {
  const designs = getAllDesigns();
  const designCount = Object.keys(designs).length;
  const dataSize = JSON.stringify(designs).length;

  return {
    designCount,
    dataSize,
    dataSizeKB: (dataSize / 1024).toFixed(2),
  };
}

// Folder metadata is separate from design payloads. Legacy designs have no
// folderId and naturally appear at the root; their original keys stay intact.
const FOLDERS_KEY = 'phomymo_library_folders';

export function listFolders() {
  const folders = JSON.parse(localStorage.getItem(FOLDERS_KEY) || '[]');
  if (!Array.isArray(folders)) throw new Error('Invalid library folder data');
  return folders;
}

function validateFolder(id) {
  if (id !== null && !listFolders().some(folder => folder.id === id)) throw new Error('Folder not found');
}

export function saveFolder(name, parentId = null, id = null) {
  name = String(name).trim();
  if (!name) throw new Error('Folder name is required');
  validateFolder(parentId);
  const folders = listFolders();
  if (id && !folders.some(f => f.id === id)) throw new Error('Folder not found');
  if (folders.some(f => f.parentId === parentId && f.name === name && f.id !== id)) throw new Error('A folder with that name already exists here');
  let ancestor = parentId;
  const visited = new Set();
  while (ancestor) {
    if (ancestor === id || visited.has(ancestor)) throw new Error('A folder cannot be moved inside itself or its descendants');
    visited.add(ancestor);
    ancestor = folders.find(f => f.id === ancestor)?.parentId;
  }
  const folder = { id: id || crypto.randomUUID(), name, parentId };
  const next = folders.filter(f => f.id !== folder.id);
  next.push(folder);
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(next));
  return folder.id;
}

export function deleteFolder(id) {
  validateFolder(id);
  if (listFolders().some(f => f.parentId === id) || listDesigns().some(d => d.folderId === id)) {
    throw new Error('Move or delete the contents of this folder first');
  }
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(listFolders().filter(f => f.id !== id)));
}

export function organizeDesign(id, name, folderId) {
  const design = loadDesign(id);
  if (!design) throw new Error('Design not found');
  return saveDesign(name, design, { id, folderId });
}

export function folderPath(id) {
  if (id === PRINT_HISTORY_FOLDER) return 'Previously printed';
  const folders = listFolders();
  const names = [];
  const visited = new Set();
  while (id && !visited.has(id)) {
    visited.add(id);
    const folder = folders.find(f => f.id === id);
    if (!folder) break;
    names.unshift(folder.name);
    id = folder.parentId;
  }
  return ['Library', ...names].join(' / ');
}

// =============================================================================
// MULTI-LABEL PRESETS
// =============================================================================

/**
 * Get all saved multi-label presets from localStorage
 * @returns {object} - { presetName: { labelWidth, labelHeight, labelsAcross, gapMm }, ... }
 */
export function getMultiLabelPresets() {
  try {
    const data = localStorage.getItem(MULTI_LABEL_PRESETS_KEY);
    return data ? JSON.parse(data) : {};
  } catch (e) {
    console.error('Failed to load multi-label presets:', e);
    return {};
  }
}

/**
 * Save a multi-label preset
 * @param {string} name - Preset name
 * @param {object} config - { labelWidth, labelHeight, labelsAcross, gapMm }
 */
export function saveMultiLabelPreset(name, config) {
  if (!name || !name.trim()) {
    throw new Error('Preset name is required');
  }

  const presets = getMultiLabelPresets();
  presets[name.trim()] = {
    labelWidth: config.labelWidth,
    labelHeight: config.labelHeight,
    labelsAcross: config.labelsAcross,
    gapMm: config.gapMm,
  };

  try {
    localStorage.setItem(MULTI_LABEL_PRESETS_KEY, JSON.stringify(presets));
    return true;
  } catch (e) {
    console.error('Failed to save multi-label preset:', e);
    throw new Error('Failed to save preset');
  }
}

/**
 * Delete a multi-label preset
 * @param {string} name - Preset name
 */
export function deleteMultiLabelPreset(name) {
  const presets = getMultiLabelPresets();
  if (!(name in presets)) {
    return false;
  }

  delete presets[name];
  try {
    localStorage.setItem(MULTI_LABEL_PRESETS_KEY, JSON.stringify(presets));
    return true;
  } catch (e) {
    console.error('Failed to delete multi-label preset:', e);
    return false;
  }
}

/**
 * List all multi-label presets
 * @returns {Array} - [{ name, labelWidth, labelHeight, labelsAcross, gapMm }]
 */
export function listMultiLabelPresets() {
  const presets = getMultiLabelPresets();
  return Object.entries(presets).map(([name, config]) => ({
    name,
    ...config,
  }));
}
