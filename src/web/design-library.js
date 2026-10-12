import { CanvasRenderer } from './canvas.js?v=126';
import { listDesigns, loadDesign, deleteDesign, listFolders, saveFolder, deleteFolder, organizeDesign, folderPath, exportDesign, PRINT_HISTORY_FOLDER, PRINT_HISTORY_LIMIT } from './storage.js?v=108';
import { evaluateExpressions, substituteFields } from './templates.js?v=102';

const $ = selector => document.querySelector(selector);
const DESIGN_DRAG_TYPE = 'application/x-phomymo-design';
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const button = (text, action, className = '') => {
  const element = node('button', className, text);
  element.type = 'button';
  element.addEventListener('click', action);
  return element;
};

export class DesignLibrary {
  constructor({ onOpen, onSave, onChange, getSize }) {
    this.onOpen = onOpen;
    this.onChange = onChange;
    this.getSize = getSize;
    this.folderId = null;
    this.previews = [];
    try { this.folderId = localStorage.getItem('phomymo_library_folder') || null; } catch {}
    $('#library-new-folder').onclick = () => this.edit('folder');
    $('#library-location-root').onclick = () => this.navigate(null);
    $('#library-location-history').onclick = () => this.navigate(PRINT_HISTORY_FOLDER);
    $('#library-save-current').onclick = () => { this.hide(); onSave(); };
    $('#library-search').oninput = () => this.renderCards();
    $('#library-size-filter').onchange = () => this.renderCards();
    $('#library-current-size').onclick = () => {
      const size = this.getSize();
      const value = this.sizeKey(size);
      const select = $('#library-size-filter');
      if (![...select.options].some(o => o.value === value)) select.add(new Option(`${size.width} × ${size.height} mm`, value));
      select.value = value;
      this.renderCards();
    };
    $('#library-edit-cancel').onclick = () => this.closeEdit();
    $('#library-edit-form').onsubmit = event => {
      event.preventDefault();
      try {
        const name = $('#library-edit-name').value.trim();
        const parent = $('#library-edit-parent').value || null;
        if (this.editing.type === 'folder') saveFolder(name, parent, this.editing.id);
        else organizeDesign(this.editing.id, name, parent);
        this.onChange();
        this.closeEdit();
        this.render();
      } catch (error) { $('#library-edit-error').textContent = error.message; }
    };
    $('#load-dialog').addEventListener('keydown', event => {
      this.modalKeys(event);
      if (event.key === 'Escape') this.hide();
    });
    $('#library-edit-dialog').addEventListener('keydown', event => {
      this.modalKeys(event);
      if (event.key === 'Escape') this.closeEdit();
    });
  }

  modalKeys(event) {
    // Keep editor shortcuts and keyboard focus out of the canvas behind us.
    event.stopPropagation();
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll('button, input, select, [tabindex="0"]')]
      .filter(el => !el.disabled && el.getClientRects().length);
    const target = event.shiftKey ? controls.at(-1) : controls[0];
    if (document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1))) {
      event.preventDefault();
      target?.focus();
    }
  }

  sizeKey(size) { return `${size?.width}x${size?.height}${size?.round ? '-round' : ''}`; }

  clearDrag() {
    this.draggedDesign = null;
    $('#load-dialog').querySelectorAll('.library-dragging, .library-drop-target').forEach(element => {
      element.classList.remove('library-dragging', 'library-drop-target');
    });
  }

  makeDraggable(element, design) {
    element.draggable = true;
    element.title = 'Drag into a folder to move this design, or click to open';
    element.addEventListener('dragstart', event => {
      this.clearDrag();
      this.draggedDesign = design;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(DESIGN_DRAG_TYPE, design.id);
      element.classList.add('library-dragging');
    });
    element.addEventListener('dragend', () => this.clearDrag());
  }

  makeDropTarget(element, folderId) {
    if (folderId === PRINT_HISTORY_FOLDER) return element;
    const isLibraryDrag = event => this.draggedDesign && [...(event.dataTransfer?.types || [])].includes(DESIGN_DRAG_TYPE);
    const hover = event => {
      if (!isLibraryDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const canMove = this.draggedDesign.folderId !== folderId;
      event.dataTransfer.dropEffect = canMove ? 'move' : 'none';
      element.classList.toggle('library-drop-target', canMove);
    };
    element.addEventListener('dragenter', hover);
    element.addEventListener('dragover', hover);
    element.addEventListener('dragleave', event => {
      if (!element.contains(event.relatedTarget)) element.classList.remove('library-drop-target');
    });
    element.addEventListener('drop', event => {
      if (!isLibraryDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const id = this.draggedDesign.id;
      const matches = event.dataTransfer.getData(DESIGN_DRAG_TYPE) === id;
      this.clearDrag();
      if (!matches) return;
      try {
        // Re-read the record so a move cannot overwrite newer design contents.
        const design = loadDesign(id);
        if (!design) throw new Error('Design not found');
        if ((design.folderId || null) === folderId) return;
        const name = design.name || id;
        organizeDesign(id, name, folderId);
        this.onChange();
        this.render();
        $('#library-notice').textContent = `Moved “${name}” to ${folderPath(folderId)}`;
      } catch (error) { $('#library-error').textContent = error.message; }
    });
    return element;
  }

  fillFolderSelect(select, selected = this.folderId) {
    if (selected === PRINT_HISTORY_FOLDER) selected = null;
    select.replaceChildren(new Option('Library (root)', ''));
    for (const folder of listFolders().sort((a, b) => folderPath(a.id).localeCompare(folderPath(b.id)))) {
      select.add(new Option(folderPath(folder.id), folder.id));
    }
    select.value = selected || '';
  }

  show() {
    $('#load-dialog').classList.remove('hidden');
    this.render();
    $('#library-search').focus();
  }

  hide() {
    this.clearDrag();
    $('#load-dialog').classList.add('hidden');
    this.clearPreviews();
    $('#load-btn')?.focus();
  }

  navigate(id) {
    this.folderId = id;
    try { localStorage.setItem('phomymo_library_folder', id || ''); } catch {}
    $('#library-search').value = '';
    $('#library-size-filter').value = '';
    this.render();
  }

  run(action) {
    try { action(); this.onChange(); this.render(); }
    catch (error) { $('#library-error').textContent = error.message; }
  }

  render() {
    try {
      $('#library-error').textContent = '';
      $('#library-notice').textContent = '';
      const folders = listFolders();
      const isHistory = this.folderId === PRINT_HISTORY_FOLDER;
      if (this.folderId && !isHistory && !folders.some(f => f.id === this.folderId)) this.folderId = null;
      $('#library-location-root').setAttribute('aria-current', isHistory ? 'false' : 'location');
      $('#library-location-history').setAttribute('aria-current', isHistory ? 'location' : 'false');
      for (const id of ['library-new-folder', 'library-save-current', 'import-file-btn']) $(`#${id}`).hidden = isHistory;
      $('#library-drag-hint').textContent = isHistory
        ? 'Latest 20 print snapshots. Move one into your library to keep it permanently.'
        : 'Drag a design onto a folder to move it, or use Move / rename.';
      const tree = $('#library-tree');
      tree.replaceChildren();
      const addTreeItem = (name, id, depth) => {
        const item = button(name, () => this.navigate(id), 'library-tree-item');
        item.style.paddingLeft = `${14 + Math.min(depth, 12) * 12}px`;
        item.setAttribute('aria-current', id === this.folderId ? 'location' : 'false');
        item.title = folderPath(id);
        this.makeDropTarget(item, id);
        tree.append(item);
      };
      addTreeItem('Library root', null, 0);
      const visited = new Set();
      const walk = (parent, depth) => {
        for (const folder of folders.filter(f => f.parentId === parent).sort((a, b) => a.name.localeCompare(b.name))) {
          if (visited.has(folder.id)) continue;
          visited.add(folder.id);
          addTreeItem(`▱  ${folder.name}`, folder.id, depth);
          walk(folder.id, depth + 1);
        }
      };
      walk(null, 1);
      addTreeItem('Previously printed', PRINT_HISTORY_FOLDER, 0);
      const ancestors = [];
      let id = this.folderId;
      while (id) {
        const folder = folders.find(f => f.id === id);
        if (!folder || ancestors.some(f => f.id === id)) break;
        ancestors.unshift(folder);
        id = folder.parentId;
      }
      const breadcrumb = $('#library-breadcrumb');
      breadcrumb.replaceChildren(this.makeDropTarget(button('Library', () => this.navigate(null)), null));
      if (isHistory) breadcrumb.replaceChildren(node('span', '', 'Previously printed'));
      for (const folder of ancestors) breadcrumb.append(node('span', '', '/'), this.makeDropTarget(button(folder.name, () => this.navigate(folder.id)), folder.id));
      $('#library-folder-title').textContent = isHistory ? 'Previously printed' : folders.find(f => f.id === this.folderId)?.name || 'Your design library';
      $('#library-organize-folder').hidden = !this.folderId || isHistory;
      $('#library-organize-folder').onclick = () => this.edit('folder', this.folderId);
      const select = $('#library-size-filter');
      const previous = select.value;
      select.replaceChildren(new Option('All sticker sizes', ''));
      const sizes = new Map(listDesigns().filter(d => d.folderId === this.folderId).map(d => [this.sizeKey(d.labelSize), d.labelSize]));
      for (const [key, size] of sizes) select.add(new Option(`${size.width} × ${size.height} mm${size.round ? ' · round' : ''}`, key));
      select.value = [...select.options].some(o => o.value === previous) ? previous : '';
      this.renderCards();
    } catch (error) { $('#library-error').textContent = error.message; }
  }

  clearPreviews() {
    this.previews.forEach(renderer => renderer.destroy());
    this.previews = [];
  }

  renderCards() {
    this.clearDrag();
    this.clearPreviews();
    const grid = $('#design-list');
    grid.replaceChildren();
    const query = $('#library-search').value.trim().toLocaleLowerCase();
    const size = $('#library-size-filter').value;
    const designs = listDesigns().filter(d => d.folderId === this.folderId);
    const allFolders = listFolders();
    const folders = allFolders.filter(f => f.parentId === this.folderId);
    const isHistory = this.folderId === PRINT_HISTORY_FOLDER;
    $('#library-count').textContent = isHistory ? `${designs.length} of ${PRINT_HISTORY_LIMIT} recent prints` : `${designs.length} design${designs.length === 1 ? '' : 's'} · ${folders.length} folder${folders.length === 1 ? '' : 's'}`;
    const folderGrid = node('div', 'library-folder-grid');
    const currentFolder = allFolders.find(f => f.id === this.folderId);
    if (currentFolder) {
      const parentId = currentFolder.parentId || null;
      const parentName = allFolders.find(f => f.id === parentId)?.name || 'Library root';
      const up = button('', () => this.navigate(parentId), 'library-up');
      up.id = 'library-up';
      up.setAttribute('aria-label', `Go up to ${parentName}`);
      up.title = `Open ${parentName}, or drop a design here to move it up one level`;
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M12 20V4m-7 7 7-7 7 7');
      icon.append(path);
      const label = node('span', 'library-up-label');
      label.append(node('strong', '', 'Up one level'), node('span', '', parentName));
      up.append(icon, label);
      this.makeDropTarget(up, parentId);
      folderGrid.append(up);
    }
    for (const folder of folders.filter(f => f.name.toLocaleLowerCase().includes(query)).sort((a, b) => a.name.localeCompare(b.name))) {
      const card = node('article', 'library-folder-card');
      this.makeDropTarget(card, folder.id);
      const open = button('', () => this.navigate(folder.id), 'library-folder');
      open.append(node('span', 'library-folder-icon', '▱'), node('span', '', folder.name));
      const actions = node('div', 'library-card-actions');
      actions.append(button('Move / rename', () => this.edit('folder', folder.id)));
      actions.append(button('Delete', () => this.run(() => {
        if (confirm(`Delete empty folder "${folder.name}"?`)) deleteFolder(folder.id);
      }), 'library-delete'));
      card.append(open, actions);
      folderGrid.append(card);
    }
    if (folderGrid.childElementCount) grid.append(folderGrid);
    const matches = designs.filter(d => d.name.toLocaleLowerCase().includes(query) && (!size || this.sizeKey(d.labelSize) === size));
    for (const design of matches) {
      const card = node('article', 'library-design-card');
      const open = button('', () => this.onOpen(design.id), 'design-item');
      this.makeDraggable(open, design);
      open.dataset.name = design.name;
      open.setAttribute('aria-label', `Open ${design.name}`);
      const canvas = node('canvas', 'library-thumbnail');
      canvas.setAttribute('aria-label', `Preview of ${design.name}`);
      const description = node('div', 'library-design-info');
      description.append(node('h4', '', design.name));
      const dimensions = node('dl', 'library-dimensions');
      for (const [label, value] of [['Width', design.labelSize?.width], ['Height', design.labelSize?.height]]) {
        const field = node('div');
        field.append(node('dt', '', label), node('dd', '', `${value} mm`));
        dimensions.append(field);
      }
      description.append(dimensions);
      const detail = [design.isTemplate ? 'Template' : 'Design', design.labelSize?.round ? 'Round' : '', design.isMultiLabel ? `${design.multiLabel.labelsAcross}-up` : '', design.templateDataCount ? `${design.templateDataCount} rows` : ''].filter(Boolean).join(' · ');
      description.append(node('p', 'library-design-detail', detail));
      if (isHistory) {
        const time = node('time', 'library-printed-at', new Date(design.printedAt).toLocaleString());
        time.dateTime = new Date(design.printedAt).toISOString();
        description.append(time);
      }
      open.append(canvas, description);
      const actions = node('div', 'library-card-actions');
      actions.append(button(isHistory ? 'Keep in library' : 'Move / rename', () => this.edit('design', design.id)));
      actions.append(button('Export', () => this.run(() => this.download(design))));
      actions.append(button('Delete', () => this.run(() => {
        if (confirm(`Delete "${design.name}" from the library?`)) {
          if (!deleteDesign(design.id)) throw new Error('Could not delete design');
        }
      }), 'library-delete'));
      card.append(open, actions);
      grid.append(card);
      this.preview(canvas, loadDesign(design.id));
    }
    if (!matches.length) {
      const empty = node('div', 'library-empty');
      empty.append(node('h4', '', query || size ? 'No matching designs' : isHistory ? 'Your next print starts here' : 'Room for your next idea'), node('p', '', query || size ? 'Try a different name or sticker size.' : isHistory ? 'After a print is sent successfully, its design and filled-in values will appear here automatically.' : 'Save your current design here, import a JSON file, or create a folder to get organized.'));
      grid.append(empty);
    }
  }

  preview(canvas, data) {
    try {
      const renderer = new CanvasRenderer(document.createElement('canvas'));
      this.previews.push(renderer);
      const rotated = data.editorRotation === 90 && !data.multiLabel?.enabled && !data.labelSize.round;
      renderer.setDimensions(rotated ? data.labelSize.height : data.labelSize.width, rotated ? data.labelSize.width : data.labelSize.height, 1, !!data.labelSize.round);
      if (data.multiLabel?.enabled) {
        const m = data.multiLabel;
        renderer.setMultiLabelDimensions(m.labelWidth, m.labelHeight, m.labelsAcross, m.gapMm);
      }
      canvas.width = 480;
      canvas.height = 280;
      const draw = () => {
        if (!canvas.isConnected) return;
        const ctx = canvas.getContext('2d');
        ctx.resetTransform();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const scale = Math.min(440 / renderer.labelWidth, 240 / renderer.labelHeight);
        ctx.save();
        ctx.translate((480 - renderer.labelWidth * scale) / 2, (280 - renderer.labelHeight * scale) / 2);
        ctx.scale(scale, scale);
        ctx.beginPath();
        if (data.labelSize.round) ctx.ellipse(renderer.labelWidth / 2, renderer.labelHeight / 2, renderer.labelWidth / 2, renderer.labelHeight / 2, 0, 0, Math.PI * 2);
        else ctx.rect(0, 0, renderer.labelWidth, renderer.labelHeight);
        ctx.fillStyle = 'white';
        ctx.fill();
        ctx.clip();
        const elements = data.printedAt ? data.elements || [] : evaluateExpressions(substituteFields(data.elements || [], data.templateData?.[0] || {}));
        renderer.renderAllToContext(ctx, elements, [], { forPrint: true });
        ctx.restore();
      };
      renderer.onAsyncLoad = draw;
      draw();
    } catch { canvas.replaceWith(node('div', 'library-thumbnail', 'Preview unavailable')); }
  }

  edit(type, id = null) {
    this.editing = { type, id };
    const item = type === 'folder' ? listFolders().find(f => f.id === id) : listDesigns().find(d => d.id === id);
    $('#library-edit-title').textContent = id ? `Move or rename ${type}` : 'New folder';
    if (item?.folderId === PRINT_HISTORY_FOLDER) $('#library-edit-title').textContent = 'Keep in library';
    $('#library-edit-name').value = item?.name || '';
    this.fillFolderSelect($('#library-edit-parent'), item ? (type === 'folder' ? item.parentId : item.folderId) : this.folderId);
    $('#library-edit-error').textContent = '';
    $('#library-edit-dialog').classList.remove('hidden');
    $('#library-edit-name').focus();
    $('#library-edit-name').select();
  }

  closeEdit() {
    $('#library-edit-dialog').classList.add('hidden');
    $('#library-search').focus();
  }

  download(design) {
    const url = URL.createObjectURL(new Blob([exportDesign(design.id)], { type: 'application/json' }));
    const link = node('a');
    link.href = url;
    link.download = `${design.name.replace(/[\\/:*?"<>|]/g, '-')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
