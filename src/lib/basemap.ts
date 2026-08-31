// Raster basemap tiles for the Leaflet maps (CRM map, dispatch, insights, replay).
// CARTO's free basemaps now watermark every tile with "API KEY REQUIRED", so we
// serve Mapbox Static Tiles with the existing VITE_MAPBOX_TOKEN and fall back to
// plain OpenStreetMap tiles when the token is missing.
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

const OSM_FALLBACK = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const MAPBOX_ATTR =
  '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const mapboxTiles = (styleId: string) =>
  `https://api.mapbox.com/styles/v1/mapbox/${styleId}/tiles/256/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`;

// Colorful street map (replaces CARTO Voyager).
export const BASEMAP_STREETS = MAPBOX_TOKEN ? mapboxTiles('streets-v12') : OSM_FALLBACK;
// Muted light/dark basemaps (replace CARTO light_all / dark_all).
export const BASEMAP_LIGHT = MAPBOX_TOKEN ? mapboxTiles('light-v11') : OSM_FALLBACK;
export const BASEMAP_DARK = MAPBOX_TOKEN ? mapboxTiles('dark-v11') : OSM_FALLBACK;
export const BASEMAP_ATTR = MAPBOX_TOKEN ? MAPBOX_ATTR : OSM_ATTR;
