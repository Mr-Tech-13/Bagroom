const slots = Array.from({ length: 12 }, (_, i) => `slot-${i + 1}`);
const standardCommodities = Array.from({ length: 4 }, (_, group) =>
  Array.from({ length: 24 }, (_, letter) => `B${group + 1}${String.fromCharCode(65 + letter)}`)
).flat();
const specialCommodities = ['MXT', 'BJ', 'BY', 'B0X', 'BTX'];
let state = { ulds: [], requirements: [], chuteNames: ['', '', ''], assignments: {}, updatedAt: null };
let draggedUld = null;
let selectedUld = null;
let saveTimer;

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
    const response = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
    state = await response.json();
    $('#save-status').textContent = `Saved ${formatTime(state.updatedAt)}`;
    if (message) toast(message);
  }, 180);
}

function formatTime(value) { return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }
function assignedIds() { return new Set(Object.values(state.assignments).filter(Boolean)); }
function spareUlds() { const assigned = assignedIds(); return state.ulds.filter((uld) => !assigned.has(uld.id)); }
function findUld(id) { return state.ulds.find((uld) => uld.id === id); }

function card(uld) {
  return `<div class="uld-card ${selectedUld === uld.id ? 'selected' : ''}" draggable="true" tabindex="0" role="button" aria-label="Move ${escapeHtml(uld.number)}, commodity ${escapeHtml(uld.commodity || 'unassigned')}" data-uld-id="${escapeHtml(uld.id)}">${uld.t2t ? '<span class="t2t">T2T</span>' : ''}<span class="uld-shape" aria-hidden="true"><i></i></span><strong>${escapeHtml(uld.number)}</strong><span class="commodity ${uld.commodity ? '' : 'unset'}"><small>Commodity</small>${escapeHtml(uld.commodity || 'UNASSIGNED')}</span></div>`;
}

function render() {
  renderBoard();
  renderRoster();
  document.querySelectorAll('.chute-name-input').forEach((input) => { input.value = state.chuteNames[Number(input.dataset.chuteIndex)] || ''; });
}

function renderBoard() {
  $('#assignment-grid').innerHTML = Array.from({ length: 3 }, (_, row) => {
    const rowSlots = slots.slice(row * 4, row * 4 + 4).map((slot, position) => {
      const uld = findUld(state.assignments[slot]);
      return `<div class="dropzone" data-slot="${slot}" data-position="P${position + 1}">${uld ? card(uld) : ''}</div>`;
    }).join('');
    const chuteName = state.chuteNames[row];
    return `<div class="chute-band"><h3>Chute ${row + 1}${chuteName ? ` · ${escapeHtml(chuteName)}` : ''}</h3><div class="chute-slots">${rowSlots}</div></div>`;
  }).join('');
  const spare = spareUlds();
  $('#spare-drop').innerHTML = spare.length ? spare.map(card).join('') : '<p class="empty-message">Drop spare ULDs here</p>';
  $('#spare-count').textContent = spare.length;
  $('#move-banner').classList.toggle('show', Boolean(selectedUld));
  if (selectedUld) $('#move-banner span').textContent = `${findUld(selectedUld)?.number || 'ULD'} selected — tap a position or spare parking`;
  const floorCount = assignedIds().size;
  const commodityCount = state.ulds.filter((uld) => uld.commodity).length;
  $('#summary').innerHTML = [
    ['Floor positions', `${floorCount}/12`], ['Spare ULDs', spare.length], ['Commodity set', `${commodityCount}/${state.ulds.length}`], ['T2T marked', state.ulds.filter((uld) => uld.t2t).length]
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
  $('#uld-table').innerHTML = visible.length ? visible.map((uld) => `<tr data-id="${escapeHtml(uld.id)}"><td>${escapeHtml(uld.number)}</td><td><input class="commodity-input" list="commodity-options" value="${escapeHtml(uld.commodity || '')}" placeholder="Select code" maxlength="4"></td><td><label class="switch"><input class="t2t-input" type="checkbox" ${uld.t2t ? 'checked' : ''}><span class="slider"></span></label></td><td>${positionFor(uld.id)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-message">No ULDs found. Import numbers above to begin.</td></tr>';
  bindRosterEvents();
}

function bindRosterEvents() {
  document.querySelectorAll('#uld-table tr[data-id]').forEach((row) => {
    const uld = findUld(row.dataset.id);
    row.querySelector('.commodity-input').addEventListener('change', (event) => {
      const value = event.target.value.trim().toUpperCase();
      if (value && !isCommodity(value)) { event.target.value = uld.commodity || ''; return toast('Use B1A–B4X or a listed special code'); }
      uld.commodity = value; renderBoard(); save('Commodity updated');
    });
    row.querySelector('.t2t-input').addEventListener('change', (event) => { uld.t2t = event.target.checked; renderBoard(); save('T2T status updated'); });
  });
}

function isCommodity(value) { return /^(B[1-4][A-X]|MXT|BJ|BY|B0X|BTX)$/.test(value); }
function toast(message) { const node = $('#toast'); node.textContent = message; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 2200); }

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
    sections[section] ||= []; sections[section].push(line);
  }
  const numbers = [...new Set(Object.values(sections).flat())];
  if (!numbers.length) return toast('Paste at least one ULD number');
  const existing = new Map(state.ulds.map((uld) => [uld.number, uld]));
  const nextUlds = numbers.map((number) => existing.get(number) || { id: `${number}-${Date.now()}-${Math.random().toString(16).slice(2)}`, number, commodity: '', t2t: false });
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
  if (!confirm('Reset all three chute names? ULD assignments will stay in place.')) return;
  state.chuteNames = ['', '', ''];
  render(); save('Chute names reset');
  $('#chute-note').textContent = 'Chute names cleared';
});

$('#reset-ulds').addEventListener('click', () => {
  if (!confirm('Remove every imported ULD and clear all chute assignments?')) return;
  state.ulds = [];
  slots.forEach((slot) => { state.assignments[slot] = null; });
  selectedUld = null;
  $('#uld-import').value = '';
  render(); save('Imported ULDs reset');
  $('#import-note').textContent = 'All imported ULDs cleared';
});

$('#reset-uld-details').addEventListener('click', () => {
  if (!confirm('Clear every ULD commodity and T2T flag? Container numbers and positions will stay in place.')) return;
  state.ulds.forEach((uld) => { uld.commodity = ''; uld.t2t = false; });
  render(); save('ULD details reset');
});

$('#uld-search').addEventListener('input', renderRoster);
$('#cancel-move').addEventListener('click', () => { selectedUld = null; renderBoard(); });
$('#commodity-options').innerHTML = [...specialCommodities, ...standardCommodities].map((code) => `<option value="${code}"></option>`).join('');
$('#today').textContent = new Intl.DateTimeFormat([], { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
load().catch(() => { $('#save-status').textContent = 'Connection error'; toast('Could not load tracker data'); });
