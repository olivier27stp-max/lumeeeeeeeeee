import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
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

export interface D2DWebMapHandle {
  startPlace: () => void;
  stopPlace: () => void;
  startZoneDraw: () => void;
  finishZoneDraw: () => void;
  cancelZoneDraw: () => void;
}

interface Props {
  center: { lat: number; lng: number };
  houses: WebMapHouse[];
  zones?: WebMapZone[];
  onSelectHouse: (id: string) => void;
  onPlace?: (lat: number, lng: number) => void;
  onZoneDrawn?: (coordinates: [number, number][]) => void;
  onCenterChange?: (lat: number, lng: number) => void;
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
function cfgFor(s){return CFG[SMAP[s]||'other']||CFG.other;}
function makeMarker(s){var c=cfgFor(s);var el=document.createElement('div');
el.style.cssText='box-sizing:border-box;width:28px;height:28px;border-radius:50%;border:2px solid rgba(255,255,255,0.92);display:flex;align-items:center;justify-content:center;line-height:0;box-shadow:0 0 8px '+c.color+'66,0 2px 6px rgba(0,0,0,0.4);cursor:pointer;background:linear-gradient(135deg,'+c.from+','+c.to+')';
el.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">'+c.icon+'</svg>';return el;}`;

/**
 * Mapbox GL JS (satellite-streets) in a WebView — like the web map. No plugins.
 * - choose a status, then TAP the map to place a pin (place mode)
 * - tap a pin → onSelectHouse (recolor)
 * - draw zones by tapping corners, finish from a native button
 */
const D2DWebMap = forwardRef<D2DWebMapHandle, Props>(function D2DWebMap(
  { center, houses, zones = [], onSelectHouse, onPlace, onZoneDrawn, onCenterChange },
  ref,
) {
  const webRef = useRef<WebView>(null);
  const inject = (js: string) => webRef.current?.injectJavaScript(js + ';true;');

  useImperativeHandle(ref, () => ({
    startPlace: () => inject('window._startPlace&&window._startPlace()'),
    stopPlace: () => inject('window._stopPlace&&window._stopPlace()'),
    startZoneDraw: () => inject('window._startDraw&&window._startDraw()'),
    finishZoneDraw: () => inject('window._finishDraw&&window._finishDraw()'),
    cancelZoneDraw: () => inject('window._cancelDraw&&window._cancelDraw()'),
  }));

  const html = useMemo(() => {
    const pts = JSON.stringify(houses.filter((h) => h.lat != null && h.lng != null));
    const zjs = JSON.stringify(zones.filter((z) => z.polygon_geojson));

    return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link href="https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.css" rel="stylesheet" />
<script src="https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.js"></script>
<style>html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#111}
.me{width:16px;height:16px;border-radius:50%;background:#2563EB;border:3px solid #fff;box-shadow:0 0 0 4px rgba(37,99,235,.3)}
.hp{width:22px;height:22px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.6)}
.mapboxgl-ctrl{display:none!important}</style>
</head><body><div id="map"></div><script>
mapboxgl.accessToken='${TOKEN}';
function post(o){try{window.ReactNativeWebView.postMessage(JSON.stringify(o))}catch(e){}}
${COLOR_JS}
var map=new mapboxgl.Map({container:'map',style:'mapbox://styles/mapbox/satellite-streets-v12',center:[${center.lng},${center.lat}],zoom:16});
var me=document.createElement('div');me.className='me';new mapboxgl.Marker(me).setLngLat([${center.lng},${center.lat}]).addTo(map);
var houses=${pts};
var zones=${zjs};

var placing=false, drawing=false, pts=[];
window._startPlace=function(){placing=true;map.getCanvas().style.cursor='crosshair';};
window._stopPlace=function(){placing=false;map.getCanvas().style.cursor='';};
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
window._startDraw=function(){drawing=true;pts=[];map.getCanvas().style.cursor='crosshair';updateDraw();};
window._finishDraw=function(){if(drawing&&pts.length>=3){post({type:'zone',coordinates:pts.slice()});}drawing=false;pts=[];map.getCanvas().style.cursor='';updateDraw();};
window._cancelDraw=function(){drawing=false;pts=[];map.getCanvas().style.cursor='';updateDraw();};
map.on('click',function(e){
  if(placing){post({type:'place',lat:e.lngLat.lat,lng:e.lngLat.lng});return;}
  if(drawing){pts.push([e.lngLat.lng,e.lngLat.lat]);updateDraw();return;}
  if(map.getLayer('houses-hit')){var f=map.queryRenderedFeatures(e.point,{layers:['houses-hit']});if(f&&f.length){post({type:'house',id:f[0].properties.id});}}
});

map.on('load',function(){
  var fc={type:'FeatureCollection',features:zones.map(function(z){return {type:'Feature',properties:{color:z.color||'#6366f1'},geometry:z.polygon_geojson};})};
  map.addSource('zones',{type:'geojson',data:fc});
  map.addLayer({id:'zones-fill',type:'fill',source:'zones',paint:{'fill-color':['get','color'],'fill-opacity':0.18}});
  map.addLayer({id:'zones-line',type:'line',source:'zones',paint:{'line-color':['get','color'],'line-width':2}});
  // Web look: gradient+icon DOM markers (pointer-events:none) ...
  houses.forEach(function(h){var el=makeMarker(h.status);el.addEventListener('click',function(ev){ev.stopPropagation();ev.preventDefault();post({type:'house',id:h.id});});new mapboxgl.Marker(el).setLngLat([h.lng,h.lat]).addTo(map);});
  // ... plus an invisible circle layer on top that captures the taps reliably.
  var hfc={type:'FeatureCollection',features:houses.map(function(h){return {type:'Feature',properties:{id:h.id},geometry:{type:'Point',coordinates:[h.lng,h.lat]}};})};
  map.addSource('houses',{type:'geojson',data:hfc});
  map.addLayer({id:'houses-hit',type:'circle',source:'houses',paint:{'circle-radius':18,'circle-opacity':0.01,'circle-color':'#000'}});
  post({type:'ready'});
});
map.on('moveend',function(){var c=map.getCenter();post({type:'center',lat:c.lat,lng:c.lng});});
</script></body></html>`;
  }, [center.lat, center.lng, houses, zones]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'house' && msg.id) onSelectHouse(msg.id);
      else if (msg.type === 'place') onPlace?.(msg.lat, msg.lng);
      else if (msg.type === 'center') onCenterChange?.(msg.lat, msg.lng);
      else if (msg.type === 'zone' && Array.isArray(msg.coordinates)) onZoneDrawn?.(msg.coordinates);
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
        style={{ flex: 1, backgroundColor: '#111' }}
      />
    </View>
  );
});

export default D2DWebMap;
