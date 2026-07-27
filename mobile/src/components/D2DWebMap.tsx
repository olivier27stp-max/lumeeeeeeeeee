import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export interface WebMapHouse {
  id: string;
  lat: number | null;
  lng: number | null;
  status?: string | null;
  /** Last note, shown as a 📝 label above the pin when showNotes is on */
  note?: string | null;
}

export interface WebMapZone {
  id: string;
  name: string;
  color?: string | null;
  polygon_geojson: any;
}

export interface WebMapRep {
  user_id: string;
  user_name: string | null;
  latitude: number;
  longitude: number;
  tracking_status: string;
  team_name?: string | null;
  team_color?: string | null;
}

export interface D2DWebMapHandle {
  startPlace: () => void;
  stopPlace: () => void;
  startZoneDraw: () => void;
  finishZoneDraw: () => void;
  cancelZoneDraw: () => void;
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  updateMe: (lat: number, lng: number) => void;
  setSelectMode: (on: boolean) => void;
  clearSelection: () => void;
  /** White outline on the pin being visited by the filter panel's pin-nav (null clears) */
  navHighlight: (id: string | null) => void;
  /** Web's compass box: reset bearing/pitch north-up */
  resetNorth: () => void;
}

interface Props {
  center: { lat: number; lng: number };
  houses: WebMapHouse[];
  zones?: WebMapZone[];
  /** Live rep positions (like the web's liveReps) — updated in place, no reload */
  reps?: WebMapRep[];
  showReps?: boolean;
  showZones?: boolean;
  /** Visible pin buckets (web PinStatus keys); undefined = all visible */
  visibleStatuses?: string[];
  /** Show 📝 note labels under pins (web's "Afficher notes" toggle) */
  showNotes?: boolean;
  /** Base map style — 'streets' (web default) or 'satellite' (toolbar toggle) */
  mapStyle?: 'streets' | 'satellite';
  /** Opening zoom (web: 17 with a cached GPS fix, else lower) */
  initialZoom?: number;
  onSelectHouse: (id: string) => void;
  /** Tap on a zone polygon (empty map area) — opens the zone panel, like the web */
  onZoneTap?: (id: string) => void;
  onPlace?: (lat: number, lng: number) => void;
  onZoneDrawn?: (coordinates: [number, number][]) => void;
  onCenterChange?: (lat: number, lng: number) => void;
  /** Selected pin ids while in select mode (web's rectangle-select, tap-based) */
  onSelectionChange?: (ids: string[]) => void;
  /** Number of corners tapped so far while drawing a zone */
  onDrawCount?: (count: number) => void;
}

const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

// Pins identical to the web (src/components/map-d2d/lead-pin.ts): the stored DB
// HouseStatus is mapped to one of the web's 6 PinStatus buckets via the SAME
// STATUS_MAP as src/pages/D2DMap.tsx, then rendered with the SAME gradient,
// icon, colour, border and glow. Keep these two files in sync.
const COLOR_JS = `
// PinStatus -> web PIN_STATUS_CONFIG (lead-pin.ts on current main): 7 statuses,
// recentered 14px-in-28px glyphs (kept at the same 50% ratio in our 34px pins).
var CFG={
  closed_won:{color:'#22C55E',from:'#4ADE80',to:'#16A34A',icon:'<polyline points="20 6.5 9 17.5 4 12.5"/>'},
  lead:{color:'#A855F7',from:'#C084FC',to:'#9333EA',icon:'<circle cx="12" cy="12" r="7"/><line x1="12" y1="2" x2="12" y2="5.5"/><line x1="12" y1="18.5" x2="12" y2="22"/><line x1="2" y1="12" x2="5.5" y2="12"/><line x1="18.5" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="1" fill="#fff" stroke="none"/>'},
  follow_up:{color:'#06B6D4',from:'#22D3EE',to:'#0891B2',icon:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'},
  appointment:{color:'#6B7280',from:'#9CA3AF',to:'#4B5563',icon:'<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'},
  no_answer:{color:'#EAB308',from:'#FDE047',to:'#CA8A04',icon:'<path d="M8.32 7.78a3.9 3.9 0 0 1 7.58 1.3c0 2.6-3.9 3.9-3.9 3.9"/><circle cx="12.1" cy="18.2" r=".5"/>'},
  rejected:{color:'#EF4444',from:'#F87171',to:'#DC2626',icon:'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'},
  other:{color:'#F97316',from:'#FB923C',to:'#EA580C',icon:'<circle cx="12" cy="12" r="4.5" fill="#fff" stroke="none"/>'}
};
// DB status -> PinStatus (mirror of STATUS_MAP in src/pages/D2DMap.tsx, current main)
var SMAP={
  sale:'closed_won',sold:'closed_won',closed_won:'closed_won',
  lead:'lead',
  follow_up:'follow_up',callback:'follow_up',
  no_answer:'no_answer',
  not_interested:'rejected',do_not_knock:'rejected',rejected:'rejected',
  quote_sent:'appointment',appointment:'appointment',
  unknown:'other',new:'other',knocked:'other',note:'other',revisit:'other',other:'other'
};
var ALLB=['closed_won','lead','follow_up','appointment','no_answer','rejected','other'];
function bucketFor(s){return SMAP[s]||'other';}
function cfgFor(s){return CFG[bucketFor(s)]||CFG.other;}
// Phone-sized: the web's 28px pin reads tiny on a phone screen — 34px circle
// with a 17px icon keeps the web's exact 50% icon/circle ratio but stays tappable.
function makeMarker(s){var c=cfgFor(s);var el=document.createElement('div');
el.style.cssText='box-sizing:border-box;width:34px;height:34px;border-radius:50%;border:2.5px solid rgba(255,255,255,0.92);display:flex;align-items:center;justify-content:center;line-height:0;box-shadow:0 0 8px '+c.color+'66,0 2px 6px rgba(0,0,0,0.4);cursor:pointer;background:linear-gradient(135deg,'+c.from+','+c.to+')';
el.innerHTML='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">'+c.icon+'</svg>';return el;}`;

/**
 * Mapbox GL JS (streets-v12, light — same style as the deployed web map) in a
 * WebView. No plugins.
 * - choose a status, then TAP the map to place a pin (place mode)
 * - tap a pin → onSelectHouse (recolor)
 * - draw zones by tapping corners, finish from a native button
 * Data (houses, zones, live reps, filters) is pushed via injectJavaScript after
 * the map is ready, so updates never reload the WebView.
 */
const D2DWebMap = forwardRef<D2DWebMapHandle, Props>(function D2DWebMap(
  { center, houses, zones = [], reps = [], showReps = true, showZones = true, visibleStatuses, showNotes = false, mapStyle = 'streets', initialZoom = 16, onSelectHouse, onZoneTap, onPlace, onZoneDrawn, onCenterChange, onSelectionChange, onDrawCount },
  ref,
) {
  const webRef = useRef<WebView>(null);
  const [webReady, setWebReady] = useState(false);
  // Only the FIRST value feeds the HTML template — later changes go through
  // _setStyle injection so the WebView never reloads on toggle.
  const initialStyleRef = useRef(mapStyle);
  const inject = (js: string) => webRef.current?.injectJavaScript(js + ';true;');

  useImperativeHandle(ref, () => ({
    startPlace: () => inject('window._startPlace&&window._startPlace()'),
    stopPlace: () => inject('window._stopPlace&&window._stopPlace()'),
    startZoneDraw: () => inject('window._startDraw&&window._startDraw()'),
    finishZoneDraw: () => inject('window._finishDraw&&window._finishDraw()'),
    cancelZoneDraw: () => inject('window._cancelDraw&&window._cancelDraw()'),
    flyTo: (lat, lng, zoom = 17) => inject(`window._flyTo&&window._flyTo(${lng},${lat},${zoom})`),
    updateMe: (lat, lng) => inject(`window._updateMe&&window._updateMe(${lng},${lat})`),
    setSelectMode: (on) => inject(`window._setSelectMode&&window._setSelectMode(${on})`),
    clearSelection: () => inject('window._clearSelection&&window._clearSelection()'),
    navHighlight: (id) => inject(`window._navHl&&window._navHl(${JSON.stringify(id)})`),
    resetNorth: () => inject('window._resetNorth&&window._resetNorth()'),
  }));

  const html = useMemo(() => {
    return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link href="https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.css" rel="stylesheet" />
<script src="https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.js"></script>
<script src="https://unpkg.com/supercluster@8.0.1/dist/supercluster.min.js"></script>
<style>html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#e5e7eb}
.me{position:relative;width:22px;height:22px}
.me .p{position:absolute;inset:0;border-radius:50%;background:rgba(99,102,241,.25);animation:gpsPulse 2s ease-out infinite}
.me .c{position:absolute;left:4px;top:4px;width:14px;height:14px;border-radius:50%;background:#6366f1;border:2.5px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.4)}
.hp{width:22px;height:22px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.6)}
.mapboxgl-ctrl{display:none!important}
@keyframes gpsPulse{0%{transform:scale(.8);opacity:1}100%{transform:scale(2.2);opacity:0}}
@keyframes rep-pulse{0%{transform:scale(.9);opacity:1}100%{transform:scale(1.8);opacity:0}}</style>
</head><body><div id="map"></div><script>
mapboxgl.accessToken='${TOKEN}';
function post(o){try{window.ReactNativeWebView.postMessage(JSON.stringify(o))}catch(e){}}
${COLOR_JS}
// Web parity: streets by default, satellite via the toolbar toggle
var styleName='${initialStyleRef.current}';
function styleUrl(n){return n==='satellite'?'mapbox://styles/mapbox/satellite-streets-v12':'mapbox://styles/mapbox/streets-v12';}
var map=new mapboxgl.Map({container:'map',style:styleUrl(styleName),center:[${center.lng},${center.lat}],zoom:${initialZoom},maxZoom:22,minZoom:1,doubleClickZoom:false});
var meEl=document.createElement('div');meEl.className='me';meEl.innerHTML='<div class="p"></div><div class="c"></div>';
var meMarker=new mapboxgl.Marker({element:meEl,anchor:'center'}).setLngLat([${center.lng},${center.lat}]).addTo(map);

var placing=false, drawing=false, pts=[];
window._startPlace=function(){placing=true;map.getCanvas().style.cursor='crosshair';};
window._stopPlace=function(){placing=false;map.getCanvas().style.cursor='';};
window._flyTo=function(lng,lat,z){map.flyTo({center:[lng,lat],zoom:z||17,duration:800});};
window._resetNorth=function(){map.easeTo({bearing:0,pitch:0,duration:600});};
window._updateMe=function(lng,lat){meMarker.setLngLat([lng,lat]);};
function ensureDraw(){
  if(map.getSource('draw'))return;
  map.addSource('draw',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:'draw-fill',type:'fill',source:'draw',paint:{'fill-color':'#6366f1','fill-opacity':0.12}});
  map.addLayer({id:'draw-line',type:'line',source:'draw',paint:{'line-color':'#6366f1','line-width':3,'line-dasharray':[2,2]}});
  map.addSource('drawpts',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:'draw-pts',type:'circle',source:'drawpts',paint:{'circle-radius':5,'circle-color':'#6366f1','circle-stroke-color':'#fff','circle-stroke-width':2}});
}
function updateDraw(){
  ensureDraw();
  var feat={type:'FeatureCollection',features:[]};
  if(pts.length>=3){feat={type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[pts.concat([pts[0]])]}};}
  else if(pts.length>=2){feat={type:'Feature',properties:{},geometry:{type:'LineString',coordinates:pts}};}
  map.getSource('draw').setData(feat);
  map.getSource('drawpts').setData({type:'FeatureCollection',features:pts.map(function(p){return{type:'Feature',geometry:{type:'Point',coordinates:p},properties:{}}})});
}
window._startDraw=function(){drawing=true;pts=[];map.getCanvas().style.cursor='crosshair';updateDraw();post({type:'drawcount',n:0});};
window._finishDraw=function(){if(drawing&&pts.length>=3){post({type:'zone',coordinates:pts.slice()});}drawing=false;pts=[];map.getCanvas().style.cursor='';updateDraw();};
window._cancelDraw=function(){drawing=false;pts=[];map.getCanvas().style.cursor='';updateDraw();};

// --- Select mode: tap pins to multi-select (web's rectangle select, touch-adapted) ---
var selecting=false, selected={};
function setHl(id,on){
  var rec=null;
  for(var i=0;i<houseMarkers.length;i++){if(houseMarkers[i].id===id){rec=houseMarkers[i];break;}}
  if(!rec)return;
  var el=rec.marker.getElement();
  el.style.outline=on?'2px solid rgba(239,68,68,0.8)':'';
  el.style.outlineOffset=on?'2px':'';
}
function postSel(){post({type:'selection',ids:Object.keys(selected)});}
window._clearSelection=function(){Object.keys(selected).forEach(function(id){setHl(id,false);});selected={};postSel();};
window._setSelectMode=function(b){selecting=!!b;if(!selecting)window._clearSelection();};
function houseTapped(id){
  if(selecting){
    if(selected[id]){delete selected[id];setHl(id,false);}
    else{selected[id]=1;setHl(id,true);}
    postSel();
    return;
  }
  post({type:'house',id:id});
}
map.on('click',function(e){
  if(placing){post({type:'place',lat:e.lngLat.lat,lng:e.lngLat.lng});return;}
  if(drawing){pts.push([e.lngLat.lng,e.lngLat.lat]);updateDraw();post({type:'drawcount',n:pts.length});return;}
  if(map.getLayer('houses-hit')){var f=map.queryRenderedFeatures(e.point,{layers:['houses-hit']});if(f&&f.length){houseTapped(f[0].properties.id);return;}}
  if(!selecting&&zonesVisible&&map.getLayer('zones-fill')){var zf=map.queryRenderedFeatures(e.point,{layers:['zones-fill']});if(zf&&zf.length&&zf[0].properties.id){post({type:'zonetap',id:zf[0].properties.id});}}
});

// --- Houses: web-look gradient markers + invisible tap layer, filterable ---
var allHouses=[];
var houseMarkers=[]; // {id, bucket, marker, noteEl}
var visibleBuckets={};ALLB.forEach(function(k){visibleBuckets[k]=1;});
var notesVisible=false;

// --- Clustering (web's pin-cluster.ts: Supercluster radius 55, maxZoom 16) ---
var clusterIndex=null, clusterMarkers=[], clusteredIds={};
function clSize(n){return n>=500?52:n>=100?46:n>=50?40:n>=10?34:28;}
function clFont(n){return n>=500?13:n>=100?12.5:n>=50?12:n>=10?11.5:11;}
function clLabel(n){return n>99999?Math.round(n/1000)+'k':''+n;}
function rebuildClusterIndex(){
  clusterIndex=null;
  if(typeof Supercluster!=='undefined'){
    clusterIndex=new Supercluster({radius:55,maxZoom:16,minPoints:2});
    clusterIndex.load(allHouses.filter(function(h){return h.lat!=null&&h.lng!=null&&visibleBuckets[bucketFor(h.status)];})
      .map(function(h){return{type:'Feature',properties:{id:h.id},geometry:{type:'Point',coordinates:[h.lng,h.lat]}};}));
  }
  renderClusters();
}
function makeClusterMarker(n,coord,onTap){
  var s=clSize(n);
  var el=document.createElement('div');
  var inner=document.createElement('div');
  inner.style.cssText='width:'+s+'px;height:'+s+'px;border-radius:50%;background:linear-gradient(135deg,#272c3e,#14171f);border:2px solid rgba(255,255,255,0.92);box-shadow:0 2px 6px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif;font-weight:600;color:#fff;font-size:'+clFont(n)+'px;letter-spacing:-0.01em;user-select:none;opacity:0;transform:scale(0.8);transition:opacity 150ms ease-out,transform 150ms ease-out;';
  inner.textContent=clLabel(n);
  el.appendChild(inner);
  el.setAttribute('role','img');
  el.addEventListener('click',function(ev){ev.stopPropagation();ev.preventDefault();onTap();});
  requestAnimationFrame(function(){inner.style.opacity='1';inner.style.transform='scale(1)';});
  var m=new mapboxgl.Marker({element:el}).setLngLat(coord).addTo(map);
  m._inner=inner;
  return m;
}
function removeClusterMarker(m){
  if(m._inner){m._inner.style.opacity='0';m._inner.style.transform='scale(0.85)';}
  setTimeout(function(){m.remove();},180);
}
function renderClusters(){
  clusterMarkers.forEach(removeClusterMarker);clusterMarkers=[];clusteredIds={};
  var visible=allHouses.filter(function(h){return h.lat!=null&&h.lng!=null&&visibleBuckets[bucketFor(h.status)];});
  if(clusterIndex){
    var z=Math.max(0,Math.min(24,Math.floor(map.getZoom())));
    clusterIndex.getClusters([-180,-85,180,85],z).forEach(function(f){
      if(!f.properties.cluster)return;
      var n=f.properties.point_count;
      clusterIndex.getLeaves(f.properties.cluster_id,Infinity).forEach(function(l){clusteredIds[l.properties.id]=1;});
      (function(cid,coord){
        clusterMarkers.push(makeClusterMarker(n,coord,function(){
          var t;try{t=clusterIndex.getClusterExpansionZoom(cid);}catch(e){t=map.getZoom()+2;}
          t=Math.min(Math.max(t,map.getZoom()+0.5),22);
          map.easeTo({center:coord,zoom:t,duration:600});
        }));
      })(f.properties.cluster_id,f.geometry.coordinates);
    });
  }
  // Past maxZoom (or no proximity cluster), pins at STRICTLY identical
  // coordinates still group at any zoom (web pin-cluster.ts 213-223)
  var byXY={};
  visible.forEach(function(h){
    if(clusteredIds[h.id])return;
    var k='xy'+h.lng+','+h.lat;
    (byXY[k]=byXY[k]||[]).push(h);
  });
  Object.keys(byXY).forEach(function(k){
    var grp=byXY[k];
    if(grp.length<2)return;
    grp.forEach(function(h){clusteredIds[h.id]=1;});
    var coord=[grp[0].lng,grp[0].lat];
    clusterMarkers.push(makeClusterMarker(grp.length,coord,function(){
      map.easeTo({center:coord,zoom:Math.min(map.getZoom()+2,22),duration:600});
    }));
  });
  applyHouseVisibility();
}
// Recalc at integer zoom crossings + settle (web: floor(zoom) change, moveend)
var lastZi=null;
map.on('zoom',function(){var zi=Math.floor(map.getZoom());if(zi!==lastZi){lastZi=zi;renderClusters();}});
map.on('zoomend',renderClusters);
// Web: double-click/tap in view mode zooms +0.5 around the tapped point
map.on('dblclick',function(e){
  if(placing||drawing||selecting)return;
  map.easeTo({zoom:map.getZoom()+0.5,around:e.lngLat,duration:350});
});

function applyHouseVisibility(){
  // 'flex', never '' — resetting to '' drops the flex centering (web fix 9df4ebe)
  houseMarkers.forEach(function(h){
    var vis=visibleBuckets[h.bucket]&&!clusteredIds[h.id];
    h.marker.getElement().style.display=vis?'flex':'none';
    if(h.noteEl)h.noteEl.style.display=vis&&notesVisible?'':'none';
  });
  var feats=allHouses.filter(function(h){return h.lat!=null&&h.lng!=null&&visibleBuckets[bucketFor(h.status)]&&!clusteredIds[h.id];})
    .map(function(h){return {type:'Feature',properties:{id:h.id},geometry:{type:'Point',coordinates:[h.lng,h.lat]}};});
  if(map.getSource('houses'))map.getSource('houses').setData({type:'FeatureCollection',features:feats});
}
window._setFilters=function(list){
  visibleBuckets={};(list||[]).forEach(function(k){visibleBuckets[k]=1;});
  rebuildClusterIndex();
};
// 📝 note labels under pins (web's showNotes toggle)
window._showNotes=function(b){notesVisible=!!b;applyHouseVisibility();};
// White outline on the pin currently visited by the pin-nav (web's easeTo highlight)
var navId=null;
function recFor(id){for(var i=0;i<houseMarkers.length;i++){if(houseMarkers[i].id===id)return houseMarkers[i];}return null;}
window._navHl=function(id){
  if(navId){var p=recFor(navId);if(p){p.marker.getElement().style.outline='';p.marker.getElement().style.outlineOffset='';}}
  navId=id||null;
  if(navId){var r=recFor(navId);if(r){var el=r.marker.getElement();el.style.outline='3px solid #fff';el.style.outlineOffset='2px';}}
};
window._setHouses=function(arr){
  allHouses=arr||[];
  houseMarkers.forEach(function(h){h.marker.remove();});houseMarkers=[];
  selected={};postSel();navId=null;
  allHouses.forEach(function(h){
    if(h.lat==null||h.lng==null)return;
    var el=makeMarker(h.status);
    var noteEl=null;
    if(h.note){
      // Web note label (map-container 805-820): under the pin, dark glass, ellipsis
      noteEl=document.createElement('div');
      noteEl.style.cssText='position:absolute;top:37px;left:50%;transform:translateX(-50%);background:rgba(12,12,20,0.88);border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.65);font-family:system-ui;font-size:10px;line-height:1.35;padding:3px 8px;border-radius:6px;white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis;text-align:center;pointer-events:none;'+(notesVisible?'':'display:none;');
      noteEl.textContent='📝 '+h.note;
      el.style.position='relative';
      el.appendChild(noteEl);
    }
    el.addEventListener('click',function(ev){ev.stopPropagation();ev.preventDefault();houseTapped(h.id);});
    var m=new mapboxgl.Marker(el).setLngLat([h.lng,h.lat]).addTo(map);
    houseMarkers.push({id:h.id,bucket:bucketFor(h.status),marker:m,noteEl:noteEl});
  });
  rebuildClusterIndex();
};

// --- Zones ---
var zonesVisible=true, lastZones=[];
window._setZones=function(zs){
  lastZones=zs||[];
  var fc={type:'FeatureCollection',features:lastZones.filter(function(z){return z.polygon_geojson;})
    .map(function(z){return {type:'Feature',properties:{id:z.id,color:z.color||'#6366f1'},geometry:z.polygon_geojson};})};
  if(map.getSource('zones'))map.getSource('zones').setData(fc);
};
window._showZones=function(b){
  zonesVisible=!!b;var v=zonesVisible?'visible':'none';
  if(map.getLayer('zones-fill'))map.setLayoutProperty('zones-fill','visibility',v);
  if(map.getLayer('zones-line'))map.setLayoutProperty('zones-line','visibility',v);
};

// --- Live reps: avatar + pulse + status dot + name label (web look, phone size) ---
var repsData=[], repsVisible=true, repMarkers={};
function repEl(rep){
  var name=rep.user_name||'Rep';
  var color=rep.team_color||'#6366f1';
  var dot=rep.tracking_status==='active'?'#22c55e':'#f59e0b';
  var el=document.createElement('div');
  el.style.cssText='position:relative;display:flex;flex-direction:column;align-items:center;';
  var wrap=document.createElement('div');wrap.style.position='relative';
  var pulse=document.createElement('div');
  pulse.style.cssText='position:absolute;inset:-3px;border-radius:50%;background:'+color+'40;animation:rep-pulse 2s ease-out infinite;';
  var avatar=document.createElement('div');
  avatar.style.cssText='width:32px;height:32px;border-radius:50%;background:'+color+';border:2.5px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-family:system-ui;font-size:13px;font-weight:700;color:white;position:relative;z-index:1;';
  avatar.textContent=name.charAt(0).toUpperCase();
  var badge=document.createElement('div');
  badge.style.cssText='position:absolute;bottom:-1px;right:-1px;width:9px;height:9px;border-radius:50%;background:'+dot+';border:2px solid white;z-index:2;';
  wrap.appendChild(pulse);wrap.appendChild(avatar);wrap.appendChild(badge);
  var label=document.createElement('div');
  label.style.cssText='margin-top:3px;background:rgba(0,0,0,0.75);border:1px solid rgba(255,255,255,0.1);border-radius:7px;padding:1px 7px;white-space:nowrap;font-family:system-ui;font-size:10px;font-weight:700;color:white;text-align:center;';
  label.textContent=name;
  if(rep.team_name||rep.tracking_status){
    var sub=document.createElement('div');
    sub.style.cssText='font-size:8px;font-weight:400;color:rgba(255,255,255,0.5);';
    sub.textContent=(rep.team_name?rep.team_name+' \\u00b7 ':'')+(rep.tracking_status||'');
    label.appendChild(sub);
  }
  el.appendChild(wrap);el.appendChild(label);
  return el;
}
function syncReps(){
  var keep={};
  if(repsVisible){
    repsData.forEach(function(r){
      keep[r.user_id]=1;
      if(repMarkers[r.user_id]){repMarkers[r.user_id].setLngLat([r.longitude,r.latitude]);}
      else{repMarkers[r.user_id]=new mapboxgl.Marker({element:repEl(r),anchor:'bottom'}).setLngLat([r.longitude,r.latitude]).addTo(map);}
    });
  }
  Object.keys(repMarkers).forEach(function(k){if(!keep[k]){repMarkers[k].remove();delete repMarkers[k];}});
}
window._setReps=function(arr){repsData=arr||[];syncReps();};
window._showReps=function(b){repsVisible=!!b;syncReps();};

function setupLayers(){
  if(!map.getSource('zones')){
    map.addSource('zones',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'zones-fill',type:'fill',source:'zones',paint:{'fill-color':['get','color'],'fill-opacity':0.18}});
    map.addLayer({id:'zones-line',type:'line',source:'zones',paint:{'line-color':['get','color'],'line-width':2.5,'line-opacity':0.8}});
    window._showZones(zonesVisible);
  }
  if(!map.getSource('houses')){
    map.addSource('houses',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'houses-hit',type:'circle',source:'houses',paint:{'circle-radius':22,'circle-opacity':0.01,'circle-color':'#000'}});
  }
}
// Plan/satellite toggle: setStyle drops all sources/layers — re-add them once
// the new style loads. DOM markers (pins, clusters, reps) survive on their own.
window._setStyle=function(n){
  if(n===styleName)return;
  styleName=n;
  map.setStyle(styleUrl(n));
  map.once('style.load',function(){
    setupLayers();
    window._setZones(lastZones);
    applyHouseVisibility();
  });
};
map.on('load',function(){
  setupLayers();
  post({type:'ready'});
});
map.on('moveend',function(){var c=map.getCenter();post({type:'center',lat:c.lat,lng:c.lng});});
</script></body></html>`;
  }, [center.lat, center.lng]);

  // A new html (initial GPS fix arrived) reloads the WebView → wait for its 'ready'
  useEffect(() => {
    setWebReady(false);
  }, [html]);

  // Push data into the live map — no WebView reload
  useEffect(() => {
    if (!webReady) return;
    inject(`window._setHouses(${JSON.stringify(houses.filter((h) => h.lat != null && h.lng != null))})`);
  }, [webReady, houses]);
  useEffect(() => {
    if (!webReady) return;
    inject(`window._setZones(${JSON.stringify(zones.filter((z) => z.polygon_geojson))})`);
  }, [webReady, zones]);
  useEffect(() => {
    if (!webReady) return;
    inject(`window._setReps(${JSON.stringify(reps)})`);
  }, [webReady, reps]);
  useEffect(() => {
    if (!webReady) return;
    inject(`window._showReps(${showReps})`);
  }, [webReady, showReps]);
  useEffect(() => {
    if (!webReady) return;
    inject(`window._showZones(${showZones})`);
  }, [webReady, showZones]);
  useEffect(() => {
    if (!webReady) return;
    inject(visibleStatuses ? `window._setFilters(${JSON.stringify(visibleStatuses)})` : 'window._setFilters(["closed_won","lead","follow_up","appointment","no_answer","rejected","other"])');
  }, [webReady, visibleStatuses]);
  useEffect(() => {
    if (!webReady) return;
    inject(`window._showNotes(${showNotes})`);
  }, [webReady, showNotes]);
  useEffect(() => {
    if (!webReady) return;
    inject(`window._setStyle&&window._setStyle(${JSON.stringify(mapStyle)})`);
  }, [webReady, mapStyle]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'ready') setWebReady(true);
      else if (msg.type === 'house' && msg.id) onSelectHouse(msg.id);
      else if (msg.type === 'zonetap' && msg.id) onZoneTap?.(msg.id);
      else if (msg.type === 'place') onPlace?.(msg.lat, msg.lng);
      else if (msg.type === 'center') onCenterChange?.(msg.lat, msg.lng);
      else if (msg.type === 'zone' && Array.isArray(msg.coordinates)) onZoneDrawn?.(msg.coordinates);
      else if (msg.type === 'selection' && Array.isArray(msg.ids)) onSelectionChange?.(msg.ids);
      else if (msg.type === 'drawcount') onDrawCount?.(msg.n ?? 0);
    } catch {
      /* ignore */
    }
  };

  return (
    <View className="flex-1">
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        style={{ flex: 1, backgroundColor: '#e5e7eb' }}
      />
    </View>
  );
});

export default D2DWebMap;
