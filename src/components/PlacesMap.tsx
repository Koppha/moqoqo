import { useEffect, useMemo, useRef } from 'react'
import { StyleSheet } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import type { Place } from '../../shared/api'
import { PLACE_LOOK, type Here } from '../lib/places'

// OpenStreetMap through Leaflet in a web view: no map key or billing account. The places and the phone's position go
// in with injectJavaScript; a tap on a place comes back as a message.

const HTML = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#map{height:100%;margin:0}.leaflet-container{font:13px sans-serif}</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map = L.map('map', { zoomControl: false }).setView([-29.315, 27.485], 13);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
var layer = L.layerGroup().addTo(map), me = null, fitted = false;
function post(m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
window.setData = function (d) {
  layer.clearLayers();
  d.places.forEach(function (p) {
    L.circleMarker([p.lat, p.lng], { radius: 10, color: '#fff', weight: 2, fillColor: p.color, fillOpacity: 1 })
      .on('click', function () { post({ type: 'open', id: p.id }); })
      .bindTooltip(p.name, { direction: 'top', offset: [0, -8] }).addTo(layer);
  });
  if (d.here) {
    if (!me) me = L.circleMarker([d.here.lat, d.here.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2563EB', fillOpacity: 1 }).addTo(map);
    else me.setLatLng([d.here.lat, d.here.lng]);
  }
  if (!fitted && d.places.length) {
    fitted = true;
    // With the phone's position: the person and their 3 nearest places, so pins show however far away they are.
    var pts = d.places.map(function (p) { return [p.lat, p.lng]; });
    if (d.here) {
      var h = [d.here.lat, d.here.lng], dist = function (a) { return Math.pow(a[0] - h[0], 2) + Math.pow((a[1] - h[1]) * Math.cos(h[0] * Math.PI / 180), 2); };
      pts = pts.sort(function (a, b) { return dist(a) - dist(b); }).slice(0, 3).concat([h]);
    }
    map.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 15 });
  }
};
post({ type: 'ready' });
</script></body></html>`

export function PlacesMap({ places, here, onOpen }: { places: Place[]; here: Here | null; onOpen: (p: Place) => void }) {
  const web = useRef<WebView>(null)
  const ready = useRef(false)
  const data = useMemo(
    () => JSON.stringify({ here, places: places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, color: PLACE_LOOK[p.kind].color })) }),
    [places, here],
  )
  const send = () => web.current?.injectJavaScript(`window.setData(${data}); true;`)
  useEffect(() => {
    if (ready.current) send()
    // Resend whenever the places or the position change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const onMessage = (e: WebViewMessageEvent) => {
    const m = JSON.parse(e.nativeEvent.data) as { type: 'ready' } | { type: 'open'; id: string }
    if (m.type === 'ready') {
      ready.current = true
      send()
    } else {
      const p = places.find((x) => x.id === m.id)
      if (p) onOpen(p)
    }
  }

  return <WebView ref={web} source={{ html: HTML }} originWhitelist={['*']} onMessage={onMessage} style={s.map} javaScriptEnabled />
}

const s = StyleSheet.create({ map: { flex: 1, borderRadius: 16, overflow: 'hidden' } })
