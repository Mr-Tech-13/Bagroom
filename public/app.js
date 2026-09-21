const slots = Array.from({ length: 12 }, (_, i) => `slot-${i + 1}`);
const standardCommodities = Array.from({ length: 4 }, (_, group) =>
  Array.from({ length: 24 }, (_, letter) => `B${group + 1}${String.fromCharCode(65 + letter)}`)
).flat();
const specialCommodities = ['MXT', 'BJ', 'BY', 'B0X', 'BTX'];
let state = { ulds: [], requirements: [], chuteNames: ['', '', ''], assignments: {}, updatedAt: null };
let draggedUld = null;
let selectedUld = null;
let saveTimer;
let exportPngUrl = null;
let exportPngBlob = null;
let exportPngTitle = 'Bagroom Export';
let exportPngFilename = 'bagroom-export.png';

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

async function load() {
  const response = await fetch('/api/state');
  state = await response.json();
  state.chuteNames = Array.from({ length: 3 }, (_, index) => state.chuteNames?.[index] || '');
  slots.forEach((slot) => { if (!(slot in state.assignments)) state.assignments[slot] = null; });
  render();
  $('#save-status').textContent = state.updatedAt ? `Saved ${formatTime(state.updatedAt)}` : 'Ready';
}

async function save(message) {
  $('#save-status').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const response = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
      if (!response.ok) throw new Error('Save failed');
      const saved = await response.json();
      state.updatedAt = saved.updatedAt;
      $('#save-status').textContent = `Saved ${formatTime(state.updatedAt)}`;
      if (message) toast(message);
    } catch (error) {
      $('#save-status').textContent = 'Save failed';
      toast('Could not save — please try again');
    }
  }, 180);
}

function formatTime(value) { return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }
function assignedIds() { return new Set(Object.values(state.assignments).filter(Boolean)); }
function spareUlds() { const assigned = assignedIds(); return state.ulds.filter((uld) => !assigned.has(uld.id)); }
function findUld(id) { return state.ulds.find((uld) => uld.id === id); }
function canBeT2T(uld) { return /^QKE/.test(uld.number || ''); }
function isT2T(uld) { return Boolean(uld.t2t && canBeT2T(uld)); }

function card(uld) {
  return `<div class="uld-card ${selectedUld === uld.id ? 'selected' : ''}" draggable="true" tabindex="0" role="button" aria-label="Move ${escapeHtml(uld.number)}, commodity ${escapeHtml(uld.commodity || 'unassigned')}" data-uld-id="${escapeHtml(uld.id)}">${isT2T(uld) ? '<span class="t2t">T2T</span>' : ''}<strong>${escapeHtml(uld.number)}</strong><span class="commodity ${uld.commodity ? '' : 'unset'}"><small>Commodity</small>${escapeHtml(uld.commodity || 'UNASSIGNED')}</span></div>`;
}

function render() {
  renderBoard();
  renderRoster();
  document.querySelectorAll('.chute-name-input').forEach((input) => { input.value = state.chuteNames[Number(input.dataset.chuteIndex)] || ''; });
  $('#requirements-input').value = (state.requirements || []).map((item) => `${item.quantity} ${item.commodity}${item.t2t ? ' T2T' : ''}`).join('\n');
}

function renderBoard() {
  $('#assignment-grid').innerHTML = Array.from({ length: 3 }, (_, row) => {
    const rowSlots = slots.slice(row * 4, row * 4 + 4).map((slot, position) => {
      const uld = findUld(state.assignments[slot]);
      return `<div class="dropzone" data-slot="${slot}" data-position="P${position + 1}">${uld ? card(uld) : ''}</div>`;
    }).join('');
    const chuteName = state.chuteNames[row];
    return `<div class="chute-band"><h3>${chuteName ? escapeHtml(chuteName) : 'MU###'}</h3><div class="chute-slots">${rowSlots}</div></div>`;
  }).join('');
  const spare = spareUlds();
  $('#spare-drop').innerHTML = spare.length ? spare.map(card).join('') : '<p class="empty-message">Drop spare ULDs here</p>';
  $('#spare-count').textContent = spare.length;
  $('#move-banner').classList.toggle('show', Boolean(selectedUld));
  if (selectedUld) $('#move-banner span').textContent = `${findUld(selectedUld)?.number || 'ULD'} selected — tap a position or spare parking`;
  const floorCount = assignedIds().size;
  const commodityCount = state.ulds.filter((uld) => uld.commodity).length;
  $('#summary').innerHTML = [
    ['Floor positions', `${floorCount}/12`], ['Spare ULDs', spare.length], ['Commodity set', `${commodityCount}/${state.ulds.length}`], ['T2T marked', state.ulds.filter(isT2T).length]
  ].map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join('');
  bindDragEvents();
}

function bindDragEvents() {
  document.querySelectorAll('.uld-card').forEach((element) => {
    element.addEventListener('dragstart', (event) => { draggedUld = element.dataset.uldId; event.dataTransfer.effectAllowed = 'move'; });
    element.addEventListener('dragend', () => { draggedUld = null; document.querySelectorAll('.drag-over').forEach((node) => node.classList.remove('drag-over')); });
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      const tappedId = element.dataset.uldId;
      if (selectedUld && selectedUld !== tappedId) return moveUld(selectedUld, slots.find((slot) => state.assignments[slot] === tappedId));
      selectedUld = selectedUld === tappedId ? null : tappedId;
      renderBoard();
    });
    element.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); element.click(); } });
  });
  document.querySelectorAll('.dropzone, .spare-drop').forEach((zone) => {
    zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (event) => {
      event.preventDefault(); zone.classList.remove('drag-over');
      if (!draggedUld) return;
      moveUld(draggedUld, zone.dataset.slot);
    });
    zone.addEventListener('click', () => { if (selectedUld) moveUld(selectedUld, zone.dataset.slot); });
  });
}

function moveUld(uldId, target) {
  const origin = slots.find((slot) => state.assignments[slot] === uldId);
  if (!target) { if (origin) state.assignments[origin] = null; }
  else {
    const displaced = state.assignments[target];
    state.assignments[target] = uldId;
    if (origin && origin !== target) state.assignments[origin] = displaced || null;
  }
  selectedUld = null;
  render(); save('Assignment updated');
}

function positionFor(id) {
  const slot = slots.find((key) => state.assignments[key] === id);
  if (!slot) return 'Spare parking';
  const index = Number(slot.split('-')[1]) - 1;
  const row = Math.floor(index / 4);
  return `${state.chuteNames[row] || `Chute ${row + 1}`} · Position ${(index % 4) + 1}`;
}

function renderRoster() {
  const query = ($('#uld-search')?.value || '').toUpperCase();
  const visible = state.ulds.filter((uld) => uld.number.includes(query));
  $('#uld-table').innerHTML = visible.length ? visible.map((uld) => `<tr data-id="${escapeHtml(uld.id)}"><td>${escapeHtml(uld.number)}</td><td><input class="commodity-input" list="commodity-options" value="${escapeHtml(uld.commodity || '')}" placeholder="Select code" maxlength="4"></td><td><label class="switch ${canBeT2T(uld) ? '' : 'disabled'}" title="${canBeT2T(uld) ? 'Mark as T2T' : 'Only QKE containers can be T2T'}"><input class="t2t-input" type="checkbox" ${isT2T(uld) ? 'checked' : ''} ${canBeT2T(uld) ? '' : 'disabled'}><span class="slider"></span></label></td><td>${positionFor(uld.id)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-message">No ULDs found. Import numbers above to begin.</td></tr>';
  bindRosterEvents();
}

function bindRosterEvents() {
  document.querySelectorAll('#uld-table tr[data-id]').forEach((row) => {
    const uld = findUld(row.dataset.id);
    const commodityInput = row.querySelector('.commodity-input');
    commodityInput.addEventListener('input', () => {
      commodityInput.value = commodityInput.value.toUpperCase().replace(/\s/g, '');
      if (isCommodity(commodityInput.value)) commitCommodity(commodityInput, uld, false);
    });
    commodityInput.addEventListener('blur', () => commitCommodity(commodityInput, uld, true));
    commodityInput.addEventListener('change', () => commitCommodity(commodityInput, uld, true));
    commodityInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitCommodity(commodityInput, uld, true);
        commodityInput.blur();
      }
    });
    row.querySelector('.t2t-input').addEventListener('change', (event) => {
      uld.t2t = canBeT2T(uld) && event.target.checked;
      renderBoard();
      save('T2T status updated');
    });
  });
}

function commitCommodity(input, uld, announce) {
  const value = input.value.trim().toUpperCase();
  input.value = value;
  if (value && !isCommodity(value)) {
    input.value = uld.commodity || '';
    toast('Use B1A–B4X or a listed special code');
    return false;
  }
  if (uld.commodity === value) return true;
  uld.commodity = value;
  input.classList.add('saved');
  setTimeout(() => input.classList.remove('saved'), 900);
  renderBoard();
  save(announce ? 'Commodity saved' : null);
  return true;
}

function isCommodity(value) { return /^(B[1-4][A-X]|MXT|BJ|BY|B0X|BTX)$/.test(value); }
function normalizeUldNumber(value) { const number = value.trim().toUpperCase(); return number.endsWith('EK') ? number : `${number}EK`; }
function toast(message) { const node = $('#toast'); node.textContent = message; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 2200); }

function parseRequirements() {
  const lines = $('#requirements-input').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parsed = [];
  for (const line of lines) {
    const match = line.match(/^(?:(\d+)\s+)?([a-zA-Z0-9]+)(?:\s+(T2T))?$/i);
    const quantity = Number(match?.[1] || 1);
    const commodity = match?.[2].toUpperCase();
    if (!match || quantity < 1 || !isCommodity(commodity)) {
      toast(`Check requirement: ${line}`);
      return null;
    }
    parsed.push({ quantity, commodity, t2t: Boolean(match[3]) });
  }
  return parsed;
}

function commodityWindowRank(commodity) {
  const match = commodity.match(/^B([1-4])([A-X])$/);
  if (!match) return 0;
  return Number(match[1]) * 100 + (match[2].charCodeAt(0) - 64);
}

function isHighTransferCommodity(commodity) {
  return commodityWindowRank(commodity) >= commodityWindowRank('B3A');
}

function floorOrderedUlds() {
  const ordered = slots.map((slot) => findUld(state.assignments[slot])).filter(Boolean);
  const assigned = new Set(ordered.map((uld) => uld.id));
  return [...ordered, ...state.ulds.filter((uld) => !assigned.has(uld.id)).sort((a, b) => a.number.localeCompare(b.number))];
}

function drawBarcode128(context, value, x, y, width, height) {
  const patterns = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
  ];
  const codes = [104, ...value.split('').map((character) => character.charCodeAt(0) - 32)];
  const checksum = codes.reduce((sum, code, index) => sum + code * (index || 1), 0) % 103;
  codes.push(checksum, 106);
  const moduleCount = codes.reduce((sum, code) => sum + patterns[code].split('').reduce((total, digit) => total + Number(digit), 0), 0);
  const moduleWidth = width / moduleCount;
  let cursor = x;
  context.fillStyle = '#050505';
  codes.forEach((code) => {
    patterns[code].split('').forEach((digit, index) => {
      const segmentWidth = Number(digit) * moduleWidth;
      if (index % 2 === 0) context.fillRect(cursor, y, Math.ceil(segmentWidth), height);
      cursor += segmentWidth;
    });
  });
}

async function showPngExport({ blob, title, filename, toastMessage }) {
  if (exportPngUrl) URL.revokeObjectURL(exportPngUrl);
  exportPngBlob = blob;
  exportPngTitle = title;
  exportPngFilename = filename;
  exportPngUrl = URL.createObjectURL(blob);
  $('#export-title').textContent = title;
  $('#export-preview').src = exportPngUrl;
  $('#save-export').href = exportPngUrl;
  $('#save-export').download = filename;
  const shareFile = new File([exportPngBlob], filename, { type: 'image/png' });
  $('#share-export').hidden = !(navigator.share && navigator.canShare?.({ files: [shareFile] }));
  const dialog = $('#export-dialog');
  if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  toast(toastMessage);
}

function autoAssignFromRequirements() {
  const requirements = parseRequirements();
  if (!requirements) return;
  if (!requirements.length) return toast('Add commodity requirements first');

  state.requirements = requirements;
  $('#requirements-input').value = requirements.map((item) => `${item.quantity} ${item.commodity}${item.t2t ? ' T2T' : ''}`).join('\n');

  const availableByCommodity = new Map();
  state.ulds
    .filter((uld) => uld.commodity)
    .sort((a, b) => Number(isT2T(b)) - Number(isT2T(a)) || a.number.localeCompare(b.number))
    .forEach((uld) => {
      const list = availableByCommodity.get(uld.commodity) || [];
      list.push(uld);
      availableByCommodity.set(uld.commodity, list);
    });

  const blankUlds = state.ulds
    .filter((uld) => !uld.commodity)
    .sort((a, b) => Number(canBeT2T(a)) - Number(canBeT2T(b)) || a.number.localeCompare(b.number));
  const requirementTasks = requirements.flatMap((item) =>
    Array.from({ length: item.quantity }, () => ({ commodity: item.commodity, t2t: item.t2t }))
  );

  const nextAssignments = Object.fromEntries(slots.map((slot) => [slot, null]));
  const used = new Set();
  const slotIndexes = { bjSecond: 0, by: 0, row2: 0, row3: 0 };
  const slotPools = {
    bjFirst: ['slot-1'],
    bjSecond: ['slot-2', 'slot-3', 'slot-4'],
    by: ['slot-2', 'slot-3', 'slot-4'],
    row2: ['slot-5', 'slot-6', 'slot-7', 'slot-8'],
    row3: ['slot-9', 'slot-10', 'slot-11', 'slot-12']
  };
  const missing = [];
  const overflow = [];

  const takeUld = (task) => {
    const { commodity, t2t } = task;
    const list = availableByCommodity.get(commodity) || [];
    for (let index = 0; index < list.length; index += 1) {
      const uld = list[index];
      if (!used.has(uld.id) && (!t2t || isT2T(uld))) {
        used.add(uld.id);
        list.splice(index, 1);
        return uld;
      }
    }
    const blankIndex = blankUlds.findIndex((uld) => !used.has(uld.id) && (!t2t || canBeT2T(uld)));
    if (blankIndex >= 0) {
      const [uld] = blankUlds.splice(blankIndex, 1);
      used.add(uld.id);
      uld.commodity = commodity;
      uld.t2t = t2t && canBeT2T(uld);
      return uld;
    }
    return null;
  };

  const placeInFirstOpen = (uld, preferredSlots) => {
    const slot = preferredSlots.find((candidate) => !nextAssignments[candidate]);
    if (!slot) return false;
    nextAssignments[slot] = uld.id;
    return true;
  };

  const placeInPool = (uld, poolName) => {
    const pool = slotPools[poolName];
    while (slotIndexes[poolName] < pool.length) {
      const slot = pool[slotIndexes[poolName]];
      slotIndexes[poolName] += 1;
      if (!nextAssignments[slot]) {
        nextAssignments[slot] = uld.id;
        return true;
      }
    }
    return false;
  };

  const placeTasks = (tasks, preferredPool) => {
    tasks.forEach((task) => {
      const uld = takeUld(task);
      if (!uld) { missing.push(`${task.commodity}${task.t2t ? ' T2T' : ''}`); return; }
      if (!placeInPool(uld, preferredPool)) overflow.push(uld);
    });
  };

  const bjTasks = requirementTasks.filter((task) => task.commodity === 'BJ');
  for (let index = 0; index < bjTasks.length; index += 1) {
    const uld = takeUld(bjTasks[index]);
    if (!uld) { missing.push('BJ'); continue; }
    const placed = index === 0
      ? placeInFirstOpen(uld, slotPools.bjFirst)
      : placeInPool(uld, 'bjSecond');
    if (!placed) overflow.push(uld);
  }

  placeTasks(requirementTasks.filter((task) => task.commodity === 'BY'), 'by');

  const otherRequirements = requirementTasks
    .filter((task) => task.commodity !== 'BJ' && task.commodity !== 'BY')
    .sort((a, b) => commodityWindowRank(a.commodity) - commodityWindowRank(b.commodity));

  const otherUlds = [];
  otherRequirements.forEach((task) => {
    const uld = takeUld(task);
    if (!uld) missing.push(`${task.commodity}${task.t2t ? ' T2T' : ''}`);
    else otherUlds.push(uld);
  });
  const rowSlots = { row2: slotPools.row2, row3: slotPools.row3 };
  const openIndexes = (rowName) => rowSlots[rowName].map((slot, index) => nextAssignments[slot] ? null : index).filter((index) => index !== null);
  const placeAtIndex = (rowName, index, group) => {
    const uld = group.ulds.shift();
    if (!uld) return false;
    nextAssignments[rowSlots[rowName][index]] = uld.id;
    return true;
  };
  const placeGroupFromStart = (rowName, group) => {
    for (const index of openIndexes(rowName)) {
      if (!placeAtIndex(rowName, index, group)) break;
    }
  };
  const placeOneFromEnd = (rowName, group) => {
    const indexes = openIndexes(rowName);
    if (!indexes.length || !group.ulds.length) return false;
    return placeAtIndex(rowName, indexes[indexes.length - 1], group);
  };

  const priorityT2TGroups = [...otherUlds.filter(isT2T).reduce((map, uld) => {
    const group = map.get(uld.commodity) || { commodity: uld.commodity, ulds: [], prefersRow3: true };
    group.ulds.push(uld);
    map.set(uld.commodity, group);
    return map;
  }, new Map()).values()].sort((a, b) => b.ulds.length - a.ulds.length || commodityWindowRank(b.commodity) - commodityWindowRank(a.commodity));
  priorityT2TGroups.forEach((group, index) => {
    const rows = index === 0 ? ['row2', 'row3'] : ['row3', 'row2'];
    placeGroupFromStart(rows[0], group);
    while (group.ulds.length && (openIndexes('row2').length || openIndexes('row3').length)) {
      if (!placeOneFromEnd(rows[0], group) && !placeOneFromEnd(rows[1], group)) break;
    }
    overflow.push(...group.ulds);
    group.ulds = [];
  });

  const groupedUlds = [...otherUlds.filter((uld) => !isT2T(uld)).reduce((map, uld) => {
    const group = map.get(uld.commodity) || { commodity: uld.commodity, ulds: [], prefersRow3: false };
    group.ulds.push(uld);
    group.prefersRow3 ||= isHighTransferCommodity(uld.commodity);
    map.set(uld.commodity, group);
    return map;
  }, new Map()).values()].sort((a, b) => b.ulds.length - a.ulds.length || commodityWindowRank(b.commodity) - commodityWindowRank(a.commodity));

  const highGroups = groupedUlds.filter((group) => group.prefersRow3);
  const standardGroups = groupedUlds.filter((group) => !group.prefersRow3);
  if (highGroups[0]) placeGroupFromStart('row3', highGroups[0]);
  if (standardGroups[0]) placeGroupFromStart('row2', standardGroups[0]);

  groupedUlds
    .filter((group) => group.ulds.length)
    .sort((a, b) => a.ulds.length - b.ulds.length || commodityWindowRank(a.commodity) - commodityWindowRank(b.commodity))
    .forEach((group) => {
      const rows = group.prefersRow3 ? ['row3', 'row2'] : ['row2', 'row3'];
      while (group.ulds.length && (openIndexes('row2').length || openIndexes('row3').length)) {
        if (!placeOneFromEnd(rows[0], group) && !placeOneFromEnd(rows[1], group)) break;
      }
      overflow.push(...group.ulds);
      group.ulds = [];
    });

  state.assignments = nextAssignments;
  selectedUld = null;
  render();
  save('Auto assignment applied');

  const placedCount = assignedIds().size;
  const preparedCount = used.size;
  const requiredCount = requirementTasks.length;
  const missingText = missing.length ? ` Missing ${missing.length}: ${missing.join(', ')}.` : '';
  const spareRequired = overflow.map((uld) => `${uld.commodity}${isT2T(uld) ? ' T2T' : ''}`);
  const spareText = spareRequired.length ? ` Spare required ${spareRequired.length}: ${spareRequired.join(', ')}.` : '';
  $('#requirements-note').textContent = `Auto assigned ${placedCount} to floor; prepared ${preparedCount}/${requiredCount} required ULDs.${missingText}${spareText}`;
}

async function exportFloorPhoto() {
  const button = $('#export-photo');
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Creating photo…';
  try {
    const canvas = document.createElement('canvas');
    const spares = spareUlds();
    canvas.width = 1600;
    canvas.height = Math.max(980, 240 + spares.length * 112);
    const context = canvas.getContext('2d');
    const rounded = (x, y, width, height, radius, fill, stroke) => {
      const r = Math.min(radius, width / 2, height / 2);
      context.beginPath(); context.moveTo(x + r, y); context.lineTo(x + width - r, y); context.quadraticCurveTo(x + width, y, x + width, y + r); context.lineTo(x + width, y + height - r); context.quadraticCurveTo(x + width, y + height, x + width - r, y + height); context.lineTo(x + r, y + height); context.quadraticCurveTo(x, y + height, x, y + height - r); context.lineTo(x, y + r); context.quadraticCurveTo(x, y, x + r, y); context.closePath();
      if (fill) { context.fillStyle = fill; context.fill(); }
      if (stroke) { context.strokeStyle = stroke; context.lineWidth = 2; context.stroke(); }
    };
    const text = (value, x, y, size, color = '#eef8f4', weight = 600, align = 'left') => {
      context.fillStyle = color; context.font = `${weight} ${size}px system-ui, sans-serif`; context.textAlign = align; context.fillText(String(value), x, y);
    };
    const drawUld = (uld, x, y, width, height) => {
      rounded(x, y, width, height, 12, '#1b493c', '#4a806e');
      text(uld.number, x + width / 2, y + 48, 21, '#ffffff', 800, 'center');
      const commodity = uld.commodity || 'UNASSIGNED';
      const badgeWidth = Math.max(118, context.measureText(commodity).width + 52);
      rounded(x + (width - badgeWidth) / 2, y + 65, badgeWidth, 38, 19, uld.commodity ? '#b9f15d' : '#2d5548');
      text(`COMMODITY  ${commodity}`, x + width / 2, y + 90, 13, uld.commodity ? '#10231d' : '#d1e0da', 900, 'center');
      if (isT2T(uld)) { rounded(x + width - 57, y + 10, 45, 27, 6, '#ff9d55'); text('T2T', x + width - 34, y + 29, 12, '#251308', 900, 'center'); }
    };

    context.fillStyle = '#08110f'; context.fillRect(0, 0, canvas.width, canvas.height);
    const gradient = context.createRadialGradient(1250, 0, 0, 1250, 0, 800);
    gradient.addColorStop(0, 'rgba(77,157,122,.20)'); gradient.addColorStop(1, 'rgba(8,17,15,0)');
    context.fillStyle = gradient; context.fillRect(0, 0, canvas.width, canvas.height);
    text('BAGROOM FLOOR LAYOUT', 55, 67, 30, '#eef8f4', 850);
    text(new Intl.DateTimeFormat([], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date()), 55, 101, 17, '#8fa39c', 500);

    const floorX = 50; const floorWidth = 1120; const slotGap = 15; const slotWidth = (floorWidth - 55 - slotGap * 3) / 4;
    for (let row = 0; row < 3; row++) {
      const bandY = 140 + row * 260;
      rounded(floorX, bandY, floorWidth, 230, 14, '#10201b', '#29483e');
      context.fillStyle = '#b9f15d'; context.beginPath(); context.arc(floorX + 25, bandY + 30, 6, 0, Math.PI * 2); context.fill();
      text(state.chuteNames[row] || 'MU###', floorX + 43, bandY + 37, 20, '#b9f15d', 850);
      for (let position = 0; position < 4; position++) {
        const x = floorX + 20 + position * (slotWidth + slotGap);
        const y = bandY + 60;
        rounded(x, y, slotWidth, 145, 12, '#0b1714', '#354f46');
        text(`P${position + 1}`, x + 12, y + 23, 13, '#6f887f', 800);
        const uld = findUld(state.assignments[`slot-${row * 4 + position + 1}`]);
        if (uld) drawUld(uld, x + 8, y + 31, slotWidth - 16, 106);
      }
    }

    const spareX = 1205; const spareWidth = 345;
    rounded(spareX, 140, spareWidth, canvas.height - 190, 14, '#10201b', '#29483e');
    text('SPARE PARKING', spareX + 22, 183, 20, '#b9f15d', 850);
    text(`${spares.length} ULD${spares.length === 1 ? '' : 'S'}`, spareX + spareWidth - 22, 183, 14, '#8fa39c', 700, 'right');
    spares.forEach((uld, index) => drawUld(uld, spareX + 18, 210 + index * 112, spareWidth - 36, 100));

    const png = await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG creation failed')), 'image/png'));
    await showPngExport({
      blob: png,
      title: 'Floor layout ready',
      filename: `bagroom-layout-${new Date().toISOString().slice(0, 10)}.png`,
      toastMessage: 'Floor photo ready'
    });
  } catch (error) {
    toast('Could not create floor photo');
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function exportBarcodeSheet() {
  const button = $('#export-barcodes');
  const originalLabel = button.textContent;
  if (!state.ulds.length) return toast('Import ULD numbers first');
  button.disabled = true;
  button.textContent = 'Creating barcodes…';
  try {
    const canvas = document.createElement('canvas');
    const spares = spareUlds();
    canvas.width = 1600;
    canvas.height = Math.max(980, 240 + spares.length * 118);
    const context = canvas.getContext('2d');
    const rounded = (x, y, width, height, radius, fill, stroke) => {
      const r = Math.min(radius, width / 2, height / 2);
      context.beginPath(); context.moveTo(x + r, y); context.lineTo(x + width - r, y); context.quadraticCurveTo(x + width, y, x + width, y + r); context.lineTo(x + width, y + height - r); context.quadraticCurveTo(x + width, y + height, x + width - r, y + height); context.lineTo(x + r, y + height); context.quadraticCurveTo(x, y + height, x, y + height - r); context.lineTo(x, y + r); context.quadraticCurveTo(x, y, x + r, y); context.closePath();
      if (fill) { context.fillStyle = fill; context.fill(); }
      if (stroke) { context.strokeStyle = stroke; context.lineWidth = 2; context.stroke(); }
    };
    const text = (value, x, y, size, color = '#eef8f4', weight = 600, align = 'left') => {
      context.fillStyle = color; context.font = `${weight} ${size}px system-ui, sans-serif`; context.textAlign = align; context.fillText(String(value), x, y);
    };
    const drawBarcodeUld = (uld, x, y, width, height) => {
      rounded(x, y, width, height, 12, '#1b493c', '#4a806e');
      text(uld.number, x + width / 2, y + 26, 15, '#ffffff', 850, 'center');
      rounded(x + 10, y + 36, width - 20, 52, 8, '#f7faf7', '#d6ded9');
      const barcodeX = x + 18;
      const barcodeY = y + 45;
      const barcodeWidth = width - 36;
      const barcodeHeight = 31;
      drawBarcode128(context, uld.number, barcodeX, barcodeY, barcodeWidth, barcodeHeight);
      if (uld.commodity) text(uld.commodity, x + width / 2, y + height - 13, 10, '#d1e0da', 850, 'center');
      if (isT2T(uld)) { rounded(x + width - 48, y + height - 28, 36, 20, 5, '#ff9d55'); text('T2T', x + width - 30, y + height - 14, 9, '#251308', 900, 'center'); }
    };

    context.fillStyle = '#08110f'; context.fillRect(0, 0, canvas.width, canvas.height);
    const gradient = context.createRadialGradient(1250, 0, 0, 1250, 0, 800);
    gradient.addColorStop(0, 'rgba(77,157,122,.20)'); gradient.addColorStop(1, 'rgba(8,17,15,0)');
    context.fillStyle = gradient; context.fillRect(0, 0, canvas.width, canvas.height);
    text('BAGROOM BARCODE LAYOUT', 55, 67, 30, '#eef8f4', 850);
    text(new Intl.DateTimeFormat([], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date()), 55, 101, 17, '#8fa39c', 500);
    text('Same floor layout with scannable ULD barcodes', 1545, 94, 16, '#8fa39c', 700, 'right');

    const floorX = 50; const floorWidth = 1120; const slotGap = 15; const slotWidth = (floorWidth - 55 - slotGap * 3) / 4;
    for (let row = 0; row < 3; row++) {
      const bandY = 140 + row * 260;
      rounded(floorX, bandY, floorWidth, 230, 14, '#10201b', '#29483e');
      context.fillStyle = '#b9f15d'; context.beginPath(); context.arc(floorX + 25, bandY + 30, 6, 0, Math.PI * 2); context.fill();
      text(state.chuteNames[row] || 'MU###', floorX + 43, bandY + 37, 20, '#b9f15d', 850);
      for (let position = 0; position < 4; position++) {
        const x = floorX + 20 + position * (slotWidth + slotGap);
        const y = bandY + 60;
        rounded(x, y, slotWidth, 145, 12, '#0b1714', '#354f46');
        text(`P${position + 1}`, x + 12, y + 23, 13, '#6f887f', 800);
        const uld = findUld(state.assignments[`slot-${row * 4 + position + 1}`]);
        if (uld) drawBarcodeUld(uld, x + 8, y + 31, slotWidth - 16, 106);
      }
    }

    const spareX = 1205; const spareWidth = 345;
    rounded(spareX, 140, spareWidth, canvas.height - 190, 14, '#10201b', '#29483e');
    text('SPARE PARKING', spareX + 22, 183, 20, '#b9f15d', 850);
    text(`${spares.length} ULD${spares.length === 1 ? '' : 'S'}`, spareX + spareWidth - 22, 183, 14, '#8fa39c', 700, 'right');
    spares.forEach((uld, index) => drawBarcodeUld(uld, spareX + 18, 210 + index * 118, spareWidth - 36, 106));

    const png = await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG creation failed')), 'image/png'));
    await showPngExport({
      blob: png,
      title: 'Barcode layout ready',
      filename: `bagroom-barcode-layout-${new Date().toISOString().slice(0, 10)}.png`,
      toastMessage: 'Barcode layout ready'
    });
  } catch (error) {
    toast('Could not create barcode layout');
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

document.querySelectorAll('.nav-button').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.nav-button,.page').forEach((node) => node.classList.remove('active'));
  button.classList.add('active'); $(`#${button.dataset.page}-page`).classList.add('active');
}));

$('#import-ulds').addEventListener('click', () => {
  const sections = { spare: [] }; let section = 'spare';
  for (const raw of $('#uld-import').value.split(/\r?\n/)) {
    const line = raw.trim().toUpperCase(); if (!line) continue;
    const heading = line.match(/^(?:ROW|CHUTE)\s*([1-3])\s*:?$/);
    if (heading) { section = `row-${heading[1]}`; sections[section] ||= []; continue; }
    if (/^SPARES?\s*:?$/.test(line)) { section = 'spare'; continue; }
    sections[section] ||= []; sections[section].push(normalizeUldNumber(line));
  }
  const numbers = [...new Set(Object.values(sections).flat())];
  if (!numbers.length) return toast('Paste at least one ULD number');
  const existing = new Map(state.ulds.map((uld) => [normalizeUldNumber(uld.number), uld]));
  const nextUlds = numbers.map((number) => {
    const current = existing.get(number);
    if (current) {
      current.number = number;
      current.t2t = canBeT2T(current) && current.t2t;
      return current;
    }
    return { id: `${number}-${Date.now()}-${Math.random().toString(16).slice(2)}`, number, commodity: '', t2t: false };
  });
  const validIds = new Set(nextUlds.map((uld) => uld.id));
  slots.forEach((slot) => { if (!validIds.has(state.assignments[slot])) state.assignments[slot] = null; });
  state.ulds = nextUlds;
  if (Object.keys(sections).some((key) => key.startsWith('row-'))) {
    slots.forEach((slot) => { state.assignments[slot] = null; });
    for (let row = 1; row <= 3; row++) (sections[`row-${row}`] || []).slice(0, 4).forEach((number, position) => {
      state.assignments[`slot-${(row - 1) * 4 + position + 1}`] = nextUlds.find((uld) => uld.number === number)?.id || null;
    });
  }
  render(); save(`${numbers.length} ULDs imported`);
  $('#import-note').textContent = `${numbers.length} unique ULDs ready`;
});

$('#save-chutes').addEventListener('click', () => {
  const names = [...document.querySelectorAll('.chute-name-input')].map((input) => input.value.trim().toUpperCase());
  const invalid = names.find((name) => name && !/^MU\d{3}$/.test(name));
  if (invalid) return toast(`${invalid} must use the MU### format`);
  const duplicates = names.filter(Boolean).some((name, index) => names.indexOf(name) !== index);
  if (duplicates) return toast('Each chute must have a unique MU number');
  state.chuteNames = names;
  renderBoard(); renderRoster(); save('Chute names saved');
  $('#chute-note').textContent = `${names.filter(Boolean).length} of 3 chutes named`;
});

$('#reset-chutes').addEventListener('click', () => {
  state.chuteNames = ['', '', ''];
  render(); save('Chute names reset');
  $('#chute-note').textContent = 'Chute names cleared';
});

$('#reset-ulds').addEventListener('click', () => {
  state.ulds = [];
  slots.forEach((slot) => { state.assignments[slot] = null; });
  selectedUld = null;
  $('#uld-import').value = '';
  render(); save('Imported ULDs reset');
  $('#import-note').textContent = 'All imported ULDs cleared';
});

$('#save-requirements').addEventListener('click', () => {
  const parsed = parseRequirements();
  if (!parsed) return;
  state.requirements = parsed;
  $('#requirements-input').value = parsed.map((item) => `${item.quantity} ${item.commodity}${item.t2t ? ' T2T' : ''}`).join('\n');
  save('Commodity requirements saved');
  $('#requirements-note').textContent = `${parsed.length} requirement lines saved`;
});

$('#reset-requirements').addEventListener('click', () => {
  state.requirements = [];
  $('#requirements-input').value = '';
  save('Commodity requirements reset');
  $('#requirements-note').textContent = 'Commodity requirements cleared';
});

$('#auto-assign').addEventListener('click', autoAssignFromRequirements);

$('#reset-uld-details').addEventListener('click', () => {
  state.ulds.forEach((uld) => { uld.commodity = ''; uld.t2t = false; });
  render(); save('ULD details reset');
});

$('#uld-search').addEventListener('input', renderRoster);
$('#cancel-move').addEventListener('click', () => { selectedUld = null; renderBoard(); });
$('#export-barcodes').addEventListener('click', exportBarcodeSheet);
$('#export-photo').addEventListener('click', exportFloorPhoto);

function cleanupExportPreview() {
  if (exportPngUrl) URL.revokeObjectURL(exportPngUrl);
  exportPngUrl = null;
  exportPngBlob = null;
  exportPngTitle = 'Bagroom Export';
  exportPngFilename = 'bagroom-export.png';
  $('#export-title').textContent = 'Export ready';
  $('#export-preview').removeAttribute('src');
  $('#save-export').removeAttribute('href');
  $('#share-export').hidden = true;
}

function closeExport() {
  const dialog = $('#export-dialog');
  if (typeof dialog.close === 'function' && dialog.open) {
    dialog.close();
  } else {
    dialog.removeAttribute('open');
    cleanupExportPreview();
  }
}

$('#close-export').addEventListener('click', closeExport);
$('#cancel-export').addEventListener('click', closeExport);
$('#export-dialog').addEventListener('click', (event) => { if (event.target === $('#export-dialog')) closeExport(); });
$('#export-dialog').addEventListener('close', cleanupExportPreview);
$('#share-export').addEventListener('click', async () => {
  if (!exportPngBlob) return toast('Create the export again');
  const file = new File([exportPngBlob], exportPngFilename, { type: 'image/png' });
  try {
    await navigator.share({ title: exportPngTitle, files: [file] });
  } catch (error) {
    if (error.name !== 'AbortError') toast('Sharing failed — use Download PNG');
  }
});
$('#commodity-options').innerHTML = [...specialCommodities, ...standardCommodities].map((code) => `<option value="${code}"></option>`).join('');
$('#today').textContent = new Intl.DateTimeFormat([], { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
load().catch(() => { $('#save-status').textContent = 'Connection error'; toast('Could not load tracker data'); });
