const STORAGE_KEY = 'courses-session';
const CATALOG_KEY = 'courses-catalogue';
const WARN_RATIO = 0.75;
const DIGITS_ONLY = '0123456789,.€/kgKGlL';
const $ = (id) => document.getElementById(id);

let session = readStorage(STORAGE_KEY, null);
let catalog = readStorage(CATALOG_KEY, {});
let selectedForBasket = new Set();
let worker = null;
let sheetState = { category: 'autre', categoryChosen: false, plannedKey: null };

// --- Montants (toujours en centimes pour éviter les erreurs d'arrondi) ---

function parseAmount(text) {
  const match = String(text).trim().replace(/\s*€$/, '').match(/^(\d{1,5})(?:[.,](\d{1,2}))?$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 100 + parseInt((match[2] || '0').padEnd(2, '0'), 10);
}

// Texte du scan Apple : accepte « 2€49 », « 2 49 », « Prix : 2,49 € » et un seul montant.
// « 4,98 €/kg » ou deux prix sont refusés plutôt que devinés.
function parseScannedAmount(text) {
  const exact = parseAmount(text);
  if (exact !== null) return exact;
  const match = String(text).trim().match(/^[^\d]*(\d{1,3})\s*[,.€ ]\s*(\d{2})\s*(?:€|EUR)?$/i);
  return match ? parseInt(match[1], 10) * 100 + parseInt(match[2], 10) : null;
}

function formatAmount(cents) {
  return (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function categoryOf(id) {
  return CATEGORIES.find((category) => category.id === id) || CATEGORIES[CATEGORIES.length - 1];
}

// --- Stockage sur le téléphone ---

function readStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    // Stockage indisponible : l'appli reste utilisable jusqu'à sa fermeture.
  }
}

const saveSession = () => writeStorage(STORAGE_KEY, session);
const saveCatalog = () => writeStorage(CATALOG_KEY, catalog);

// --- Petits constructeurs d'interface ---

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function removeButton(label, onClick) {
  const button = el('button', 'remove', '✕');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

// --- Écran de préparation : articles connus et dernier prix ---

function renderSetup() {
  const entries = Object.entries(catalog)
    .sort(([, a], [, b]) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  $('prepare').hidden = entries.length === 0;

  $('catalog').replaceChildren(...entries.map(([key, entry]) => {
    const row = el('li', 'catalog-row');
    const toggle = el('button', 'catalog-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-pressed', String(selectedForBasket.has(key)));
    toggle.append(
      el('span', 'group-icon', categoryOf(entry.category).icon),
      el('span', 'label', entry.name),
      el('span', '', formatAmount(entry.cents)),
    );
    toggle.addEventListener('click', () => {
      if (selectedForBasket.has(key)) selectedForBasket.delete(key);
      else selectedForBasket.add(key);
      renderSetup();
    });
    const remove = removeButton(`Oublier ${entry.name}`, () => {
      delete catalog[key];
      selectedForBasket.delete(key);
      saveCatalog();
      renderSetup();
    });
    row.append(toggle, remove);
    return row;
  }));
  renderEstimate();
}

function renderEstimate() {
  const total = [...selectedForBasket].reduce((sum, key) => sum + catalog[key].cents, 0);
  const budget = parseAmount($('budget-input').value);
  let text = selectedForBasket.size ? `Panier estimé : ${formatAmount(total)}` : '';
  if (text && budget) {
    text += total > budget
      ? ` — ${formatAmount(total - budget)} au-dessus du budget`
      : ` — il resterait ${formatAmount(budget - total)}`;
  }
  $('estimate').textContent = text;
}

// --- Écran des courses ---

function render() {
  $('setup').hidden = Boolean(session);
  $('shop').hidden = !session;
  if (!session) {
    renderSetup();
    return;
  }

  const spent = session.items.reduce((sum, item) => sum + item.cents * item.quantity, 0);
  const left = session.budget - spent;
  const ratio = session.budget > 0 ? spent / session.budget : 1;
  const plannedTotal = session.planned.reduce((sum, item) => sum + item.cents, 0);

  $('status').dataset.level = left < 0 ? 'over' : ratio >= WARN_RATIO ? 'warn' : 'ok';
  $('remaining-label').textContent = left < 0 ? 'Budget dépassé de' : 'Il te reste';
  $('remaining').textContent = formatAmount(Math.abs(left));
  $('spent').textContent = `${formatAmount(spent)} sur ${formatAmount(session.budget)}`
    + (plannedTotal ? ` · encore ~${formatAmount(plannedTotal)} prévus` : '');

  $('planned-section').hidden = session.planned.length === 0;
  $('planned').replaceChildren(...session.planned.map(renderPlanned));

  const groups = CATEGORIES
    .map((category) => ({ category, items: session.items.filter((item) => categoryOf(item.category) === category) }))
    .filter((group) => group.items.length);
  $('cart-title').hidden = groups.length === 0;
  $('items').replaceChildren(...groups.map(renderGroup));
}

function renderPlanned(item) {
  const row = el('li', 'catalog-row');
  const button = el('button', 'catalog-toggle');
  button.type = 'button';
  button.append(
    el('span', 'group-icon', categoryOf(item.category).icon),
    el('span', 'label', item.name),
    el('span', '', `~${formatAmount(item.cents)}`),
  );
  button.addEventListener('click', () => openSheet({
    title: 'Vérifie le prix en rayon',
    name: item.name,
    prices: [{ cents: item.cents, last: true }],
    plannedKey: item.key,
  }));
  const remove = removeButton(`Retirer ${item.name} de la liste`, () => {
    session.planned = session.planned.filter((other) => other.key !== item.key);
    saveSession();
    render();
  });
  row.append(button, remove);
  return row;
}

function renderGroup({ category, items }) {
  const group = el('li', 'group');
  const title = el('div', 'group-title');
  const total = items.reduce((sum, item) => sum + item.cents * item.quantity, 0);
  title.append(
    el('span', 'group-icon', category.icon),
    el('span', 'group-name', category.name),
    el('span', '', formatAmount(total)),
  );

  const rows = el('ul');
  rows.replaceChildren(...items.slice().reverse().map((item) => {
    const row = el('li', 'item');
    const amount = item.quantity > 1
      ? `${item.quantity} × ${formatAmount(item.cents)}`
      : formatAmount(item.cents);
    row.append(
      el('span', 'label', item.name ? `${item.name} — ${amount}` : amount),
      removeButton(`Supprimer ${item.name || amount}`, () => {
        session.items = session.items.filter((other) => other.id !== item.id);
        saveSession();
        render();
      }),
    );
    return row;
  }));

  group.append(title, rows);
  return group;
}

// --- Caméra ---

async function startCamera() {
  const video = $('video');
  if (video.srcObject && video.srcObject.active) return;
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    await video.play();
    $('camera-message').hidden = true;
    $('scan').hidden = false;
    $('photo-label').hidden = true;
  } catch {
    $('camera-message').textContent = 'Caméra en direct indisponible. Utilise le bouton photo.';
    $('camera-message').hidden = false;
    $('scan').hidden = true;
    $('photo-label').hidden = false;
  }
}

function stopCamera() {
  const video = $('video');
  if (video.srcObject) video.srcObject.getTracks().forEach((track) => track.stop());
  video.srcObject = null;
}

// --- Lecture de l'étiquette, entièrement sur le téléphone ---

async function loadOcr() {
  const base = new URL('vendor/', location.href).href;
  worker = await Tesseract.createWorker('fra', 1, {
    workerPath: base + 'worker.min.js',
    corePath: base,
    langPath: base.slice(0, -1),
    gzip: true,
    workerBlobURL: false,
  });
  await worker.setParameters({ tessedit_pageseg_mode: '11' });
  $('scan').disabled = false;
  $('scan').textContent = 'Scanner le prix';
}

// Ne garde que la zone du cadre, agrandie et en niveaux de gris contrastés.
function prepareImage(source, width, height, crop, invert) {
  const sx = width * crop.x;
  const sy = height * crop.y;
  const sw = width * crop.w;
  const sh = height * crop.h;
  const scale = Math.min(2, 1400 / sw);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    pixels[i] = gray;
    if (gray < min) min = gray;
    if (gray > max) max = gray;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < pixels.length; i += 4) {
    const value = ((pixels[i] - min) * 255) / range;
    const out = invert ? 255 - value : value;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = out;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

async function recognizeWords(canvas, whitelist) {
  await worker.setParameters({ tessedit_char_whitelist: whitelist });
  const { data } = await worker.recognize(canvas);
  return (data.words || []).map((word) => ({ text: word.text, confidence: word.confidence, ...word.bbox }));
}

async function readLabel(source, width, height, crop) {
  // Première lecture : le texte complet, pour le nom et le prix.
  const words = await recognizeWords(prepareImage(source, width, height, crop, false), '');
  const name = extractName(words);
  const readings = [parsePrices(words)];

  // Lectures réservées aux chiffres, sur une image nettoyée (reflets, trame d'écran, promos).
  for (const invert of [false, true]) {
    const canvas = binarize(prepareImage(source, width, height, crop, false), invert);
    readings.push(parsePrices(await recognizeWords(canvas, DIGITS_ONLY)));
    if (isConfident(mergeReadings(readings))) break;
  }
  if (!mergeReadings(readings).length) {
    const inverted = prepareImage(source, width, height, crop, true);
    readings.push(parsePrices(await recognizeWords(inverted, '')));
  }
  return { prices: mergeReadings(readings), name };
}

// Seuil local : chaque pixel est comparé à son voisinage, ce qui efface reflets et ombres.
function binarize(canvas, invert) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const pixels = image.data;

  // Image intégrale : calcule la moyenne de n'importe quel rectangle en temps constant.
  const stride = width + 1;
  const sums = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += pixels[(y * width + x) * 4];
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
    }
  }
  const mean = (x0, y0, x1, y1) => (sums[y1 * stride + x1] - sums[y0 * stride + x1]
    - sums[y1 * stride + x0] + sums[y0 * stride + x0]) / ((x1 - x0) * (y1 - y0));

  const smooth = 2; // efface la trame de pixels d'un écran
  const window = Math.max(15, Math.round(width / 10));
  const out = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const local = mean(Math.max(0, x - smooth), Math.max(0, y - smooth),
        Math.min(width, x + smooth + 1), Math.min(height, y + smooth + 1));
      const area = mean(Math.max(0, x - window), Math.max(0, y - window),
        Math.min(width, x + window + 1), Math.min(height, y + window + 1));
      const dark = local < area * 0.9;
      out[y * width + x] = dark === invert ? 255 : 0;
    }
  }
  for (let i = 0; i < out.length; i++) {
    pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = out[i];
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// Correspondance entre le cadre affiché et l'image réelle (object-fit: cover).
function frameCrop() {
  const video = $('video');
  const box = video.getBoundingClientRect();
  const frame = $('frame').getBoundingClientRect();
  const cover = Math.max(box.width / video.videoWidth, box.height / video.videoHeight);
  const shownW = box.width / (cover * video.videoWidth);
  const shownH = box.height / (cover * video.videoHeight);
  return {
    x: (1 - shownW) / 2 + ((frame.left - box.left) / box.width) * shownW,
    y: (1 - shownH) / 2 + ((frame.top - box.top) / box.height) * shownH,
    w: (frame.width / box.width) * shownW,
    h: (frame.height / box.height) * shownH,
  };
}

async function runScan(read) {
  const button = $('scan');
  button.disabled = true;
  button.textContent = 'Lecture…';
  let result = { prices: [], name: '' };
  try {
    result = await read();
  } catch (error) {
    console.error(error);
  }
  button.disabled = false;
  button.textContent = 'Scanner le prix';

  // Prix illisible mais article connu : son dernier prix devient une proposition.
  const known = findInCatalog(catalog, result.name);
  const prices = result.prices.length || !known
    ? result.prices
    : [{ cents: known.entry.cents, last: true }];
  openSheet({
    title: prices.length ? 'Vérifie le prix' : 'Prix non lu. Réessaie ou saisis-le.',
    name: known ? known.entry.name : result.name,
    prices,
  });
}

// --- Fenêtre de validation ---

function openSheet({ title, name = '', prices = [], manual = false, plannedKey = null }) {
  sheetState = { category: 'autre', categoryChosen: false, plannedKey };
  $('sheet-title').textContent = title;
  $('quick').hidden = !manual;
  $('price-input').value = '';
  $('apple-hint').hidden = true;
  $('price-error').hidden = true;
  $('name-input').value = name;

  $('known-names').replaceChildren(...Object.values(catalog).map((entry) => {
    const option = document.createElement('option');
    option.value = entry.name;
    return option;
  }));

  $('choices').replaceChildren(...prices.slice(0, 4).map((price, index) => {
    const choice = el('button', '', formatAmount(price.cents));
    choice.type = 'button';
    const note = price.last ? 'dernier prix connu'
      : price.unit ? 'prix au kilo/litre ?'
        : price.unsure ? 'à vérifier' : '';
    if (note) choice.append(el('small', '', note));
    choice.addEventListener('click', () => selectChoice(choice, price.cents));
    if (index === 0 && (price.last || isConfident(prices))) queueMicrotask(() => selectChoice(choice, price.cents));
    return choice;
  }));

  updateFromName();
  $('sheet').showModal();
}

function selectChoice(choice, cents) {
  for (const other of $('choices').children) other.setAttribute('aria-pressed', 'false');
  choice.setAttribute('aria-pressed', 'true');
  $('price-input').value = (cents / 100).toFixed(2).replace('.', ',');
  updateLastPrice();
}

// Le souvenir de l'article passe avant les mots-clés ; un choix manuel passe avant tout.
function updateFromName() {
  if (!sheetState.categoryChosen) {
    const name = $('name-input').value;
    const known = findInCatalog(catalog, name);
    sheetState.category = known ? known.entry.category : suggestCategory(name);
  }
  renderCategories();
  updateLastPrice();
}

function updateLastPrice() {
  const known = findInCatalog(catalog, $('name-input').value);
  const hint = $('last-price');
  hint.hidden = !known;
  if (!known) return;
  const date = new Date(known.entry.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  let text = `Dernier prix : ${formatAmount(known.entry.cents)} (${date})`;
  const current = parseScannedAmount($('price-input').value);
  if (current && current !== known.entry.cents) {
    const diff = current - known.entry.cents;
    text += ` — ${diff > 0 ? '+' : '−'}${formatAmount(Math.abs(diff))}`;
  }
  hint.textContent = text;
}

function renderCategories() {
  const selected = sheetState.category;
  $('category-label').textContent = `${sheetState.categoryChosen ? 'Catégorie' : 'Catégorie proposée'} : ${categoryOf(selected).name}`;
  $('categories').replaceChildren(...CATEGORIES.map((category) => {
    const button = el('button', '', category.icon);
    button.type = 'button';
    button.setAttribute('aria-label', category.name);
    button.setAttribute('aria-pressed', String(category.id === selected));
    button.addEventListener('click', () => {
      sheetState.category = category.id;
      sheetState.categoryChosen = true;
      renderCategories();
    });
    return button;
  }));
}

function addItem(quantity) {
  const cents = parseScannedAmount($('price-input').value);
  $('price-error').hidden = Boolean(cents);
  if (!cents) {
    $('price-input').focus();
    return;
  }
  const name = $('name-input').value.trim();
  const category = sheetState.category;
  session.items.push({ id: Date.now() + Math.random(), cents, quantity, category, name });

  if (name) {
    const known = findInCatalog(catalog, name);
    const key = known ? known.key : normalizeName(name);
    if (key) catalog[key] = { name, cents, category, date: new Date().toISOString() };
    saveCatalog();
  }
  if (sheetState.plannedKey) {
    session.planned = session.planned.filter((item) => item.key !== sheetState.plannedKey);
  }
  saveSession();
  render();
  $('sheet').close();
}

// --- Événements ---

$('budget-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const budget = parseAmount($('budget-input').value);
  if (!budget) {
    $('budget-input').focus();
    return;
  }
  const planned = [...selectedForBasket].map((key) => ({ key, ...catalog[key] }));
  session = { budget, items: [], planned };
  selectedForBasket = new Set();
  saveSession();
  render();
  startCamera();
});
$('budget-input').addEventListener('input', renderEstimate);

$('scan').addEventListener('click', () => {
  const video = $('video');
  if (!video.videoWidth) return;
  runScan(() => readLabel(video, video.videoWidth, video.videoHeight, frameCrop()));
});

$('photo').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (!worker) {
    openSheet({ title: 'Lecture pas encore prête. Saisis le prix.', manual: true });
    return;
  }
  runScan(async () => {
    const bitmap = await createImageBitmap(file);
    return readLabel(bitmap, bitmap.width, bitmap.height, { x: 0, y: 0, w: 1, h: 1 });
  });
});

$('manual').addEventListener('click', () => openSheet({ title: 'Quel montant ?', manual: true }));
$('name-input').addEventListener('input', updateFromName);
$('price-input').addEventListener('input', updateLastPrice);
$('apple-scan').addEventListener('click', () => {
  for (const choice of $('choices').children) choice.setAttribute('aria-pressed', 'false');
  $('price-input').value = '';
  $('price-error').hidden = true;
  $('apple-hint').hidden = false;
  updateLastPrice();
  $('price-input').focus();
});
$('cancel').addEventListener('click', () => $('sheet').close());
// Le scan Apple peut interrompre la caméra de l'appli.
$('sheet').addEventListener('close', () => {
  const video = $('video');
  if (!session) return;
  if (video.srcObject && video.srcObject.active) video.play().catch(() => startCamera());
  else startCamera();
});
$('quantity').addEventListener('click', (event) => {
  const qty = event.target.dataset.qty;
  if (qty) addItem(parseInt(qty, 10));
});
$('qty-other').addEventListener('click', () => {
  const answer = parseInt(prompt('Combien ?', '4'), 10);
  if (answer >= 1 && answer <= 99) addItem(answer);
});
$('sheet-form').addEventListener('submit', (event) => {
  event.preventDefault();
  addItem(1);
});
$('quick').addEventListener('click', (event) => {
  const euros = event.target.dataset.euros;
  if (euros) {
    $('price-input').value = euros;
    updateLastPrice();
  }
});

$('finish').addEventListener('click', () => {
  if (!confirm('Terminer ces courses ? Les derniers prix restent enregistrés.')) return;
  session = null;
  saveSession();
  stopCamera();
  $('budget-input').value = '';
  render();
});

// iOS coupe la caméra quand l'appli passe en arrière-plan.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera();
  else if (session) startCamera();
});

// --- Démarrage ---

if (session && !session.planned) session.planned = [];
render();
if (session) startCamera();
loadOcr().catch((error) => {
  console.error(error);
  $('scan').textContent = 'Lecture indisponible';
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(console.error);
}
