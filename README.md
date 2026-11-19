# Bruxelles — jours de sortie des sacs

Interactive map of Brussels showing, street by street, when to put out your
garbage bags (Bruxelles-Propreté collection schedule). Search a street or tap
it on the map to see the schedule per bag type.

**Live map:** enable GitHub Pages on this repo (Settings → Pages → deploy from
`main`, root) and it will be served at `https://<user>.github.io/<repo>/`.

## How it works

| Part | What it is |
|---|---|
| `index.html` | page shell |
| `css/style.css` | app styles (light + dark via `prefers-color-scheme`) |
| `js/app.js` | Leaflet map, street rendering (canvas), search, detail panel |
| `data/index.json` | small manifest: map bounds, day colors, stats, list of commune files |
| `data/communes/*.json` | the dataset split per commune (19 files, 0.2–3.4 MB): per-segment geometry + collection days + schedule text + sacs verts dates |
| `vendor/` | Leaflet 1.9.4, vendored (no CDN dependency) |
| `harvester/` | Python script(s) that query the Recycle! API (api.fostplus.be) used by recycleapp.be to (re)build the dataset |

The basemap tries CARTO tiles first and falls back to plain OpenStreetMap if
they are blocked (ad blockers commonly block cartocdn.com).

## Data

Schedules come from the Recycle! platform (Fost Plus), the same source
recycleapp.be uses. Street geometries are matched OpenStreetMap/UrbIS street
axes. Schedules change rarely; regenerate the `data/` files with the
harvester a few times a year.

Data schema (abridged — `index.json` holds everything except `features`, which live in the per-commune files):

```json
{
  "bounds": [[lat, lon], [lat, lon]],
  "days_seen": ["lundi", "..."],
  "day_color_light": {"lundi": "#..."},
  "day_color_dark":  {"lundi": "#..."},
  "stats": {"matched": 0, "total": 0, "communes": 19, "split": 0},
  "communes": [{"name": "Anderlecht", "file": "communes/anderlecht.json", "streets": 508}],
  "features": [
    {
      "name": "Boulevard Louis Mettewie",
      "commune": "Anderlecht",
      "segments": [
        {
          "geometry": [[lat, lon], ...],
          "days": ["lundi", "jeudi"],
          "desc": {"lundi": "Lundi, sortez vos sacs BLANC, BLEU entre 18:00 et 20:00 ..."},
          "sacs_verts": ["2026-03-02", "..."],
          "has_data": true
        }
      ]
    }
  ]
}
```

## Run locally

Any static server works (opening `index.html` directly also works in most
browsers, but `fetch` of the JSON may be blocked from `file://`):

```
python -m http.server
# → http://localhost:8000
```

## Rebuilding the data

See `harvester/`. The API needs no account; the `x-secret` header value ships
inside recycleapp.be's own JavaScript (see comments in the script). Please be
gentle: cache, throttle, and refresh only a few times a year.
