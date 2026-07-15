import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export interface WebMapHouse {
  id: string;
  lat: number | null;
  lng: number | null;
  status?: string | null;
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
  onSelectHouse: (id: string) => void;
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
// PinStatus -> web PIN_STATUS_CONFIG (color, gradientFrom, gradientTo, icon)
var CFG={
  closed_won:{color:'#22C55E',from:'#4ADE80',to:'#16A34A',icon:'<polyline points="20 6 9 17 4 12"/>'},
  follow_up:{color:'#06B6D4',from:'#22D3EE',to:'#0891B2',icon:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'},
  appointment:{color:'#6B7280',from:'#9CA3AF',to:'#4B5563',icon:'<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'},
  no_answer:{color:'#EAB308',from:'#FDE047',to:'#CA8A04',icon:'<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5"/>'},
  rejected:{color:'#EF4444',from:'#F87171',to:'#DC2626',icon:'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'},
  other:{color:'#9CA3AF',from:'#D1D5DB',to:'#6B7280',icon:'<circle cx="12" cy="12" r="1.5"/>'}
};
// DB status -> PinStatus (mirror of STATUS_MAP in src/pages/D2DMap.tsx)
var SMAP={
  sale:'closed_won',sold:'closed_won',closed_won:'closed_won',
  lead:'follow_up',follow_up:'follow_up',callback:'follow_up',
  no_answer:'no_answer',
  not_interested:'rejected',do_not_knock:'rejected',rejected:'rejected',
  quote_sent:'appointment',appointment:'appointment',
  unknown:'other',new:'other',knocked:'other',note:'other',revisit:'other',other:'other'
};
function bucketFor(s){return SMAP[s]||'other';}
function cfgFor(s){return CFG[bucketFor(s)]||CFG.other;}
function makeMarker(s){var c=cfgFor(s);var el=document.createElement('div');
el.style.cssText='box-sizing:border-box;width:28px;height:28px;border-radius:50%;border:2px solid rgba(255,255,255,0.92);display:flex;align-items:center;justify-content:center;line-height:0;box-shadow:0 0 8px '+c.color+'66,0 2px 6px rgba(0,0,0,0.4);cursor:pointer;background:linear-gradient(135deg,'+c.from+','+c.to+')';
el.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">'+c.icon+'</svg>';return el;}`;

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
  { center, houses, zones = [], reps = [], showReps = true, showZones = true, visibleStatuses, onSelectHouse, onPlace, onZoneDrawn, onCenterChange, onSelectionChange, onDrawCount },
  ref,
) {
  const webRef = useRef<WebView>(null);
  const [webReady, setWebReady] = useState(false);
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
  }));

  const html = useMemo(() => {
    return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link href="https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.css" rel="stylesheet" />
<script src="https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.js"></script>
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
var map=new mapboxgl.Map({container:'map',style:'mapbox://styles/mapbox/streets-v12',center:[${center.lng},${center.lat}],zoom:16});
var meEl=document.createElement('div');meEl.className='me';meEl.innerHTML='<div class="p"></div><div class="c"></div>';
var meMarker=new mapboxgl.Marker({element:meEl,anchor:'center'}).setLngLat([${center.lng},${center.lat}]).addTo(map);

var placing=false, drawing=false, pts=[];
window._startPlace=function(){placing=true;map.getCanvas().style.cursor='crosshair';};
window._stopPlace=function(){placing=false;map.getCanvas().style.cursor='';};
window._flyTo=function(lng,lat,z){map.flyTo({center:[lng,lat],zoom:z||17,duration:800});};
window._updateMe=function(lng,lat){meMarker.setLngLat([lng,lat]);};
function ensureDraw(){
  if(map.getSource('draw'))return;
  map.addSource('draw',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:'draw-fill',type:'fill',source:'draw',paint:{'fill-color':'#2563EB','fill-opacity':0.25}});
  map.addLayer({id:'draw-line',type:'line',source:'draw',paint:{'line-color':'#2563EB','line-width':3}});
  map.addSource('drawpts',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:'draw-pts',type:'circle',source:'drawpts',paint:{'circle-radius':6,'circle-color':'#fff','circle-stroke-color':'#2563EB','circle-stroke-width':3}});
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
  if(map.getLayer('houses-hit')){var f=map.queryRenderedFeatures(e.point,{layers:['houses-hit']});if(f&&f.length){houseTapped(f[0].properties.id);}}
});

// --- Houses: web-look gradient markers + invisible tap layer, filterable ---
var allHouses=[];
var houseMarkers=[]; // {id, bucket, marker}
var visibleBuckets={closed_won:1,follow_up:1,appointment:1,no_answer:1,rejected:1,other:1};
function applyHouseVisibility(){
  houseMarkers.forEach(function(h){h.marker.getElement().style.display=visibleBuckets[h.bucket]?'':'none';});
  var feats=allHouses.filter(function(h){return h.lat!=null&&h.lng!=null&&visibleBuckets[bucketFor(h.status)];})
    .map(function(h){return {type:'Feature',properties:{id:h.id},geometry:{type:'Point',coordinates:[h.lng,h.lat]}};});
  if(map.getSource('houses'))map.getSource('houses').setData({type:'FeatureCollection',features:feats});
}
window._setFilters=function(list){
  visibleBuckets={};(list||[]).forEach(function(k){visibleBuckets[k]=1;});
  applyHouseVisibility();
};
window._setHouses=function(arr){
  allHouses=arr||[];
  houseMarkers.forEach(function(h){h.marker.remove();});houseMarkers=[];
  selected={};postSel();
  allHouses.forEach(function(h){
    if(h.lat==null||h.lng==null)return;
    var el=makeMarker(h.status);
    el.addEventListener('click',function(ev){ev.stopPropagation();ev.preventDefault();houseTapped(h.id);});
    var m=new mapboxgl.Marker(el).setLngLat([h.lng,h.lat]).addTo(map);
    houseMarkers.push({id:h.id,bucket:bucketFor(h.status),marker:m});
  });
  applyHouseVisibility();
};

// --- Zones ---
var zonesVisible=true;
window._setZones=function(zs){
  var fc={type:'FeatureCollection',features:(zs||[]).filter(function(z){return z.polygon_geojson;})
    .map(function(z){return {type:'Feature',properties:{color:z.color||'#6366f1'},geometry:z.polygon_geojson};})};
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
  var color='#6366f1';
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
  label.style.cssText='margin-top:3px;background:rgba(0,0,0,0.75);border:1px solid rgba(255,255,255,0.1);border-radius:7px;padding:1px 7px;white-space:nowrap;font-family:system-ui;font-size:9px;font-weight:700;color:white;';
  label.textContent=name;
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

map.on('load',function(){
  map.addSource('zones',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:'zones-fill',type:'fill',source:'zones',paint:{'fill-color':['get','color'],'fill-opacity':0.18}});
  map.addLayer({id:'zones-line',type:'line',source:'zones',paint:{'line-color':['get','color'],'line-width':2}});
  map.addSource('houses',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:'houses-hit',type:'circle',source:'houses',paint:{'circle-radius':18,'circle-opacity':0.01,'circle-color':'#000'}});
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
    inject(visibleStatuses ? `window._setFilters(${JSON.stringify(visibleStatuses)})` : 'window._setFilters(["closed_won","follow_up","appointment","no_answer","rejected","other"])');
  }, [webReady, visibleStatuses]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'ready') setWebReady(true);
      else if (msg.type === 'house' && msg.id) onSelectHouse(msg.id);
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
