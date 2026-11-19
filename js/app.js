// Bruxelles — jours de sortie des sacs
// Data is loaded at runtime from data/collectes.json (built by harvester/).

let DATA = null;

async function boot() {
  const loader = document.createElement('div');
  loader.id = 'data-loader';
  loader.textContent = 'Chargement des données\u2026';
  loader.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
    'background:rgba(30,30,28,0.85);color:#fff;padding:10px 20px;border-radius:10px;' +
    'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:0.9rem;z-index:7000;';
  document.getElementById('map-wrap').appendChild(loader);
  try {
    const res = await fetch('data/index.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    DATA = await res.json();
    DATA.features = [];
    addFeatures = main();
    await loadCommunes(loader);
    loader.remove();
  } catch (err) {
    loader.textContent = 'Impossible de charger les données (' + err.message + ')';
    loader.style.background = '#e34948';
  }
}

let addFeatures = null; // set by main(): draws a commune's streets and indexes them for search

async function loadCommunes(loader) {
  let done = 0;
  const total = DATA.communes.length;
  loader.textContent = 'Chargement des communes… 0/' + total;
  await Promise.all(DATA.communes.map(async (c) => {
    try {
      const res = await fetch('data/' + c.file);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const payload = await res.json();
      DATA.features.push(...payload.features);
      addFeatures(payload.features);
    } catch (err) {
      console.error('Commune ' + c.name + ':', err);
    } finally {
      done++;
      loader.textContent = 'Chargement des communes… ' + done + '/' + total;
    }
  }));
}

function main() {

function isDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// Tile providers to try in order — keyless only (CARTO now demands an API
// key, and Esri's grey canvases have no street names and stop at z16, so
// they go blurry zoomed in). OpenStreetMap standard tiles have street
// names, are sharp to z19 and need no key; in dark mode the same tiles are
// recoloured with a CSS invert filter (darkFilter → .dark-tiles in
// style.css). OSM France is the fallback (different domain, also z20, in
// case tile.openstreetmap.org is blocked); if that fails too, show a clear
// message instead of silently tiling broken-image icons.
const TILE_SOURCES = [
  {
    light: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    dark: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    darkFilter: true,
    maxNativeZoom: 19,
    subdomains: 'abc',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    light: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
    dark: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
    darkFilter: true,
    maxNativeZoom: 20,
    subdomains: 'abc',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | OSM France',
  },
];

// Canvas renderer: this map draws thousands of polylines across all of
// Brussels, and the default SVG renderer chokes at that scale.
const map = L.map('map', { zoomControl: true, minZoom: 11, maxZoom: 19, renderer: L.canvas() });
const bounds = L.latLngBounds(DATA.bounds);
map.fitBounds(bounds, { padding: [20, 20] });

let tileLayer = null;
let tileSourceIndex = 0;
let tileLoadCount = 0;
let tileErrorCount = 0;
let tileFallbackTimer = null;

function showBasemapWarning() {
  const div = document.createElement('div');
  div.style.cssText = 'position:absolute;left:50%;top:16px;transform:translateX(-50%);' +
    'background:#e34948;color:#fff;padding:8px 16px;border-radius:8px;font-size:0.82rem;' +
    'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;z-index:6000;max-width:90%;' +
    'text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.25);';
  div.textContent = "Impossible de charger le fond de carte — vérifiez votre connexion internet ou désactivez un bloqueur de publicités pour cette page (les rues et horaires restent utilisables).";
  document.getElementById('map-wrap').appendChild(div);
}

function buildTileLayer() {
  const src = TILE_SOURCES[tileSourceIndex];
  const url = isDark() ? src.dark : src.light;
  const layer = L.tileLayer(url, {
    attribution: src.attribution,
    subdomains: src.subdomains || 'abc',
    maxZoom: 20,
    maxNativeZoom: src.maxNativeZoom || 19,
    className: (isDark() && src.darkFilter) ? 'dark-tiles' : '',
  });
  tileLoadCount = 0;
  tileErrorCount = 0;
  layer.on('tileload', () => { tileLoadCount++; });
  layer.on('tileerror', () => {
    tileErrorCount++;
    // give it a moment to see if *any* tile succeeds before giving up on this source
    clearTimeout(tileFallbackTimer);
    tileFallbackTimer = setTimeout(() => {
      if (tileLoadCount === 0 && tileErrorCount >= 4) {
        if (tileSourceIndex < TILE_SOURCES.length - 1) {
          tileSourceIndex++;
          swapTiles();
        } else {
          showBasemapWarning();
        }
      }
    }, 2500);
  });
  return layer;
}

function swapTiles() {
  if (tileLayer) map.removeLayer(tileLayer);
  tileLayer = buildTileLayer().addTo(map);
}
swapTiles();

const streetLayer = L.layerGroup().addTo(map);
const layersByKey = {};
const featuresByKey = new Map(); // filled commune by commune as data arrives

// --- detail panel: tap/click a street to see its schedule. Bottom sheet on
// narrow screens, small floating card on wide ones (see CSS) — the hover
// tooltip alone isn't usable on touch devices, so this is the primary way
// to read a street's schedule everywhere.
const detailPanel = document.getElementById('detail-panel');
const detailName = document.getElementById('detail-name');
const detailCommune = document.getElementById('detail-commune');
const detailBody = document.getElementById('detail-body');
const detailClose = document.getElementById('detail-close');
let selectedLine = null;

function formatSacsVerts(dates) {
  return (dates || []).slice(0, 4).map(d => {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' });
  }).join(', ');
}

function buildDetailBody(seg) {
  const colors = isDark() ? DATA.day_color_dark : DATA.day_color_light;
  if (!seg.has_data) {
    return '<div class="detail-empty">Pas encore de données pour ce tronçon.</div>';
  }
  let html = '';
  for (const d of seg.days) {
    const color = colors[d] || 'var(--unmatched)';
    html += `<div class="detail-row"><span class="dot" style="background:${color}"></span>` +
      `<div><div class="day">${d}</div><div class="txt">${seg.desc[d]}</div></div></div>`;
  }
  if (seg.sacs_verts && seg.sacs_verts.length) {
    html += `<div class="detail-sacs"><strong>Sacs verts :</strong> ${formatSacsVerts(seg.sacs_verts)}…</div>`;
  }
  return html;
}

function closeDetail() {
  detailPanel.classList.remove('open');
  if (selectedLine) {
    selectedLine.line.setStyle({ weight: selectedLine.hasData ? 4 : 2 });
    selectedLine = null;
  }
}

function openDetail(f, seg, line) {
  if (selectedLine && selectedLine.line !== line) {
    selectedLine.line.setStyle({ weight: selectedLine.hasData ? 4 : 2 });
  }
  selectedLine = { line, hasData: seg.has_data };
  line.setStyle({ weight: seg.has_data ? 7 : 3.5 });
  detailName.textContent = f.name;
  detailCommune.textContent = f.commune;
  detailBody.innerHTML = buildDetailBody(seg);
  detailPanel.classList.add('open');
}

detailClose.addEventListener('click', closeDetail);

function drawStreets() {
  streetLayer.clearLayers();
  const colors = isDark() ? DATA.day_color_dark : DATA.day_color_light;
  for (const f of DATA.features) drawFeature(f, colors);
}

function drawFeature(f, colors) {
    const group = [];
    for (const seg of f.segments) {
      const color = seg.has_data ? (colors[seg.days[0]] || 'var(--unmatched)') : null;
      const line = L.polyline(seg.geometry, {
        color: color || (isDark() ? '#55544c' : '#b9b8b0'),
        weight: seg.has_data ? 4 : 2,
        opacity: seg.has_data ? 0.9 : 0.55,
        dashArray: seg.has_data ? null : '3 4',
        lineCap: 'round',
        lineJoin: 'round',
      });
      if (seg.has_data) {
        line.bindTooltip(f.name, { sticky: true, className: 'street-tooltip' });
      }
      line.on('mouseover', function () { if (!selectedLine || selectedLine.line !== line) this.setStyle({ weight: seg.has_data ? 7 : 3.5 }); });
      line.on('mouseout', function () { if (!selectedLine || selectedLine.line !== line) this.setStyle({ weight: seg.has_data ? 4 : 2 }); });
      line.on('click', (e) => { L.DomEvent.stop(e); openDetail(f, seg, line); });
      line.addTo(streetLayer);
      group.push({ line, hasData: seg.has_data, seg });
    }
    layersByKey[f.name + '||' + f.commune] = group;
}

function buildLegend() {
  const Legend = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function () {
      const div = L.DomUtil.create('div', 'legend');
      const colors = isDark() ? DATA.day_color_dark : DATA.day_color_light;
      let html = '<div><strong>Jour de sortie des sacs</strong></div>';
      for (const day of DATA.days_seen) {
        html += `<div class="swatch"><i style="background:${colors[day]}"></i>${day}</div>`;
      }
      html += `<div class="swatch"><i style="background:${isDark() ? '#55544c' : '#b9b8b0'}"></i>pas encore récolté</div>`;
      html += `<div class="stats">${DATA.stats.matched} / ${DATA.stats.total} rues · ${DATA.stats.communes} communes<br/>${DATA.stats.split} rues avec plusieurs horaires</div>`;
      div.innerHTML = html;
      L.DomEvent.disableClickPropagation(div);
      return div;
    },
  });
  return new Legend();
}

let legendControl = buildLegend().addTo(map);

function refreshTheme() {
  closeDetail();
  swapTiles();
  drawStreets();
  map.removeControl(legendControl);
  legendControl = buildLegend().addTo(map);
}

drawStreets();
map.on('click', () => closeDetail());
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshTheme);

// --- search (across all communes; disambiguated by commune name, accent-insensitive) ---
const searchInput = document.getElementById('search');
const suggestionsBox = document.getElementById('suggestions');

function foldAccents(s) {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

const entries = []; // filled commune by commune as data arrives

function addCommuneFeatures(features) {
  const colors = isDark() ? DATA.day_color_dark : DATA.day_color_light;
  for (const f of features) {
    const key = f.name + '||' + f.commune;
    featuresByKey.set(key, f);
    drawFeature(f, colors);
    entries.push({ name: f.name, commune: f.commune, key, folded: foldAccents(f.name) });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

function showSuggestions(query) {
  const q = foldAccents(query.trim());
  if (!q) { suggestionsBox.style.display = 'none'; return; }
  const matches = entries.filter(e => e.folded.includes(q)).slice(0, 14);
  if (!matches.length) { suggestionsBox.style.display = 'none'; return; }
  suggestionsBox.innerHTML = matches.map(e =>
    `<div data-key="${e.key.replace(/"/g, '&quot;')}"><span>${e.name}</span><span class="commune">${e.commune}</span></div>`
  ).join('');
  suggestionsBox.style.display = 'block';
}

function focusStreet(key) {
  const group = layersByKey[key];
  if (!group || !group.length) return;
  const allBounds = L.latLngBounds(group.flatMap(({ line }) => line.getLatLngs()));
  map.fitBounds(allBounds, { padding: [80, 80], maxZoom: 17 });
  const f = featuresByKey.get(key);
  const chosen = group.find(g => g.hasData) || group[0];
  if (f && chosen) openDetail(f, chosen.seg, chosen.line);
  suggestionsBox.style.display = 'none';
  searchInput.value = key.split('||')[0];
}

searchInput.addEventListener('input', () => showSuggestions(searchInput.value));
searchInput.addEventListener('focus', () => showSuggestions(searchInput.value));
document.addEventListener('click', (e) => {
  if (!e.target.closest('#search-wrap')) suggestionsBox.style.display = 'none';
});
suggestionsBox.addEventListener('click', (e) => {
  const key = e.target.closest('div[data-key]')?.getAttribute('data-key');
  if (key) focusStreet(key);
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const first = suggestionsBox.querySelector('div[data-key]');
    if (first) focusStreet(first.getAttribute('data-key'));
  }
});

return addCommuneFeatures;
} // main

boot();
