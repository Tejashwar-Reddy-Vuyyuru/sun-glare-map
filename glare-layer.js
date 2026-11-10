/*!
 * glare-layer.js: a "Sun glare" overlay for web maps.
 * Works with Leaflet, MapLibre GL / Mapbox GL, and the Google Maps JavaScript API.
 * No dependencies. Road data: OpenStreetMap contributors (ODbL).
 *
 * Leaflet:   var glare = SunGlare.leaflet(L).addTo(map);
 *            L.control.layers(null, { 'Sun glare': glare }).addTo(map);
 * MapLibre:  var glare = SunGlare.maplibre(map); map.addControl(glare.control);
 * Google:    var glare = SunGlare.google(map);
 *
 * Every adapter returns an object with setTime(date|null), setRoads(geojson, hazards), refresh(),
 * setRoute(route, { depart, duration }) and clearRoute().
 *
 * Follow the directions a user already asked for:
 *   SunGlare.followMapboxDirections(directionsControl, glare);
 *   SunGlare.followLeafletRouting(routingControl, glare);
 *   SunGlare.followGoogleDirections(directionsRenderer, glare);
 * With no roads given, the layer loads roads for the current view from OpenStreetMap.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SunGlare = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var RAD = Math.PI / 180;
  var COLORS = { high: '#d62828', some: '#f07d12' };
  var DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  var HAZARD = {
    signal: { boost: 0.6, metres: 45, label: 'a traffic signal' },
    crossing: { boost: 0.4, metres: 35, label: 'a pedestrian crossing' },
    school: { boost: 0.4, metres: 150, label: 'a school' }
  };

  // Sun height and compass direction (degrees) for a timestamp and place.
  function sunPosition(ts, lat, lng) {
    var d = ts / 86400000 - 0.5 + 2440588 - 2451545;
    var M = RAD * (357.5291 + 0.98560028 * d);
    var C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    var L = M + C + RAD * 102.9372 + Math.PI, e = RAD * 23.4397;
    var dec = Math.asin(Math.sin(e) * Math.sin(L));
    var ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
    var phi = RAD * lat, H = RAD * (280.16 + 360.9856235 * d) + RAD * lng - ra;
    var az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
    var alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
    return { azimuth: ((az / RAD + 180) % 360 + 360) % 360, altitude: alt / RAD };
  }
  function angleDiff(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  // 0..1 glare for one direction of travel.
  function glareFor(bearing, az, alt) {
    if (alt <= -0.5 || alt >= 25) return 0;
    var d = angleDiff(bearing, az); if (d >= 30) return 0;
    var f = alt < 0 ? 0.6 : (alt <= 15 ? 1 : (25 - alt) / 10);
    return f * (1 - d / 30);
  }
  function bearing(la1, lo1, la2, lo2) {
    var p1 = la1 * RAD, p2 = la2 * RAD, dl = (lo2 - lo1) * RAD;
    return (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / RAD + 360) % 360;
  }
  function metres(la1, lo1, la2, lo2) {
    var y = (la2 - la1) * 111320, x = (lo2 - lo1) * 111320 * Math.cos(la1 * RAD);
    return Math.sqrt(x * x + y * y);
  }
  function heading(b) { return DIRS[Math.round(b / 45) % 8]; }
  function levelOf(s) { return s >= 0.6 ? 3 : s >= 0.3 ? 2 : s > 0.05 ? 1 : 0; }
  function hazardType(p) {
    return p.type && HAZARD[p.type] ? p.type : p.highway === 'traffic_signals' ? 'signal' : p.highway === 'crossing' ? 'crossing' : p.amenity === 'school' ? 'school' : null;
  }

  function booster(hazards) {
    var CELL = 0.003, grid = {}, any = false;
    ((hazards && hazards.features) || []).forEach(function (f) {
      var t = f.geometry && f.geometry.type === 'Point' && hazardType(f.properties || {}); if (!t) return;
      var c = f.geometry.coordinates, k = Math.floor(c[1] / CELL) + ',' + Math.floor(c[0] / CELL);
      (grid[k] || (grid[k] = [])).push({ lat: c[1], lng: c[0], z: HAZARD[t] }); any = true;
    });
    return function (a, b) {
      var best = 0, why = ''; if (!any) return { w: 1, why: '' };
      var n = Math.max(1, Math.ceil(metres(a[1], a[0], b[1], b[0]) / 30));
      for (var i = 0; i <= n; i++) {
        var y = a[1] + (b[1] - a[1]) * i / n, x = a[0] + (b[0] - a[0]) * i / n, gy = Math.floor(y / CELL), gx = Math.floor(x / CELL);
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var cell = grid[(gy + dy) + ',' + (gx + dx)]; if (!cell) continue;
          for (var j = 0; j < cell.length; j++) {
            var h = cell[j]; if (h.z.boost <= best) continue;
            if (metres(y, x, h.lat, h.lng) <= h.z.metres) { best = h.z.boost; why = h.z.label; }
          }
        }
      }
      return { w: 1 + best, why: why };
    };
  }

  // Accepts a GeoJSON LineString (feature or geometry), an array of [lng, lat], an array of
  // {lat, lng} points (Leaflet or Google), or an encoded polyline string. Returns [[lng, lat], ...].
  function toLine(route, precision) {
    if (!route) return [];
    if (typeof route === 'string') {
      var pts = decodePolyline(route, precision || 5);
      if (!precision && pts.some(function (c) { return Math.abs(c[1]) > 90 || Math.abs(c[0]) > 180; })) pts = decodePolyline(route, 6);
      return pts;
    }
    if (route.type === 'Feature') route = route.geometry;
    if (route && route.type === 'LineString') return route.coordinates;
    if (route && route.type === 'MultiLineString') return [].concat.apply([], route.coordinates);
    if (Array.isArray(route)) return route.map(function (c) {
      if (Array.isArray(c)) return c;
      var la = typeof c.lat === 'function' ? c.lat() : c.lat, lo = typeof c.lng === 'function' ? c.lng() : (c.lng !== undefined ? c.lng : c.lon);
      return [lo, la];
    });
    return [];
  }
  function decodePolyline(str, precision) {
    var i = 0, lat = 0, lng = 0, out = [], f = Math.pow(10, precision);
    while (i < str.length) {
      for (var k = 0; k < 2; k++) {
        var shift = 0, result = 0, b;
        do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        var d = (result & 1) ? ~(result >> 1) : (result >> 1);
        if (k === 0) lat += d; else lng += d;
      }
      out.push([lng / f, lat / f]);
    }
    return out;
  }

  /**
   * Score one route in the direction of travel, moving the sun as the trip goes on.
   * route:   see toLine(). depart: Date or timestamp.
   * options: { duration: seconds for the whole trip (default assumes 50 km/h), hazards, precision }
   * Returns a FeatureCollection of the affected stretches (properties: level, heading, from, to, reason)
   * with a `summary`: { km, minutes, glareMinutes, strongMinutes }.
   */
  function scoreRoute(route, depart, options) {
    options = options || {};
    var line = toLine(route, options.precision), boost = booster(options.hazards), total = 0, i;
    for (i = 0; i < line.length - 1; i++) total += metres(line[i][1], line[i][0], line[i + 1][1], line[i + 1][0]);
    var speed = options.duration > 0 && total > 0 ? total / options.duration : 13.9, t = +depart, out = [], cur = null, gl = 0, hi = 0;
    for (i = 0; i < line.length - 1; i++) {
      var a = line[i], b = line[i + 1], len = metres(a[1], a[0], b[1], b[0]); if (!len) continue;
      var dt = len / speed * 1000, sun = sunPosition(t + dt / 2, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2);
      var brg = bearing(a[1], a[0], b[1], b[0]), g = glareFor(brg, sun.azimuth, sun.altitude), bo = g ? boost(a, b) : { w: 1, why: '' }, lv = levelOf(g * bo.w);
      if (lv >= 2) {
        gl += dt; if (lv === 3) hi += dt;
        var hd = heading(brg);
        if (cur && cur.properties.level === lv && cur.properties.heading === hd) { cur.geometry.coordinates.push(b); cur.properties.to = t + dt; if (bo.why && !cur.properties.reason) cur.properties.reason = bo.why; }
        else { cur = { type: 'Feature', properties: { name: '', level: lv, score: g * bo.w, heading: hd, from: t, to: t + dt, reason: bo.why }, geometry: { type: 'LineString', coordinates: [a, b] } }; out.push(cur); }
      } else cur = null;
      t += dt;
    }
    return { type: 'FeatureCollection', features: out, summary: { km: total / 1000, minutes: (t - +depart) / 60000, glareMinutes: gl / 60000, strongMinutes: hi / 60000 } };
  }

  /**
   * Score roads for one moment.
   * roads:   GeoJSON FeatureCollection of LineString / MultiLineString (properties: name, oneway).
   * when:    Date or timestamp.
   * options: { hazards: GeoJSON points, minLevel: 2 }
   * Returns a FeatureCollection of the affected stretches with properties
   * { name, level (2 = some, 3 = strong), score, heading, reason }, plus a `sun` member.
   */
  function score(roads, when, options) {
    options = options || {};
    var minLevel = options.minLevel === undefined ? 2 : options.minLevel;
    var lines = [], la = 0, lo = 0;
    ((roads && roads.features) || []).forEach(function (f) {
      var g = f.geometry; if (!g) return;
      var parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      parts.forEach(function (c) { if (c.length > 1) { lines.push({ c: c, p: f.properties || {} }); la += c[0][1]; lo += c[0][0]; } });
    });
    var empty = { type: 'FeatureCollection', features: [], sun: null };
    if (!lines.length) return empty;
    var sun = sunPosition(+when, la / lines.length, lo / lines.length);
    var boost = booster(options.hazards);
    var out = [];
    lines.forEach(function (l) {
      var one = l.p.oneway === 'yes' || l.p.oneway === true, cur = null;
      for (var i = 0; i < l.c.length - 1; i++) {
        var a = l.c[i], b = l.c[i + 1]; if (a[0] === b[0] && a[1] === b[1]) continue;
        var brg = bearing(a[1], a[0], b[1], b[0]);
        var fwd = glareFor(brg, sun.azimuth, sun.altitude), back = one ? 0 : glareFor((brg + 180) % 360, sun.azimuth, sun.altitude);
        var g = Math.max(fwd, back); if (!g) { cur = null; continue; }
        var bo = boost(a, b), risk = g * bo.w, lv = levelOf(risk), hd = heading(fwd >= back ? brg : (brg + 180) % 360);
        if (lv < minLevel) { cur = null; continue; }
        if (cur && cur.properties.level === lv && cur.properties.heading === hd) {
          cur.geometry.coordinates.push(b); cur.properties.score = Math.max(cur.properties.score, risk);
          if (bo.why && !cur.properties.reason) cur.properties.reason = bo.why;
        } else {
          cur = { type: 'Feature', properties: { name: l.p.name || l.p.ref || '', level: lv, score: risk, heading: hd, reason: bo.why }, geometry: { type: 'LineString', coordinates: [a, b] } };
          out.push(cur);
        }
      }
    });
    return { type: 'FeatureCollection', features: out, sun: sun };
  }

  /** Load roads, signals, crossings and schools for a box [south, west, north, east] from OpenStreetMap. */
  function fetchRoads(box, options) {
    options = options || {};
    var span = Math.max(box[3] - box[1], box[2] - box[0]);
    var cls = span > 0.3 ? 'motorway|trunk|primary|secondary' : span > 0.08 ? 'motorway|trunk|primary|secondary|tertiary' : 'motorway|trunk|primary|secondary|tertiary|unclassified|residential';
    var bb = '(' + box.map(function (v) { return v.toFixed(4); }).join(',') + ')';
    var q = '[out:json][timeout:40];(way[highway~"^(' + cls + ')$"]' + bb + ';node[highway~"^(traffic_signals|crossing)$"]' + bb + ';);out geom;nwr[amenity=school]' + bb + ';out center;';
    var url = (options.endpoint || 'https://overpass-api.de/api/interpreter') + '?data=' + encodeURIComponent(q);
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('OpenStreetMap server answered ' + r.status); return r.json(); }).then(fromOverpass);
  }
  function fromOverpass(json) {
    var roads = [], hazards = [];
    (json.elements || []).forEach(function (e) {
      var t = e.tags || {};
      if (e.type === 'node' && (t.highway === 'traffic_signals' || t.highway === 'crossing')) {
        hazards.push({ type: 'Feature', properties: { type: t.highway === 'crossing' ? 'crossing' : 'signal' }, geometry: { type: 'Point', coordinates: [e.lon, e.lat] } }); return;
      }
      if (t.amenity === 'school') { var c = e.center || e; if (c.lat !== undefined) hazards.push({ type: 'Feature', properties: { type: 'school' }, geometry: { type: 'Point', coordinates: [c.lon, c.lat] } }); return; }
      if (e.type !== 'way' || !e.geometry || !t.highway) return;
      var one = t.oneway === 'yes' || t.junction === 'roundabout' || (t.highway === 'motorway' && t.oneway !== 'no');
      roads.push({ type: 'Feature', properties: { name: t.name || t.ref || '', highway: t.highway, oneway: one ? 'yes' : 'no' }, geometry: { type: 'LineString', coordinates: e.geometry.map(function (g) { return [g.lon, g.lat]; }) } });
    });
    return { roads: { type: 'FeatureCollection', features: roads }, hazards: { type: 'FeatureCollection', features: hazards } };
  }
  function clockText(ts) { var d = new Date(ts), h = d.getHours(), m = d.getMinutes(), ap = h < 12 ? 'am' : 'pm'; h = h % 12 || 12; return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap; }
  function describe(p) {
    var tm = p.from ? '<br>' + clockText(p.from) + ' to ' + clockText(p.to) : '';
    return '<b>' + (p.name || (p.from ? 'On your route' : 'This road')) + '</b><br>' + (p.level === 3 ? 'Sun in your eyes' : 'A little sun in your eyes') + ' driving ' + p.heading + (p.reason ? '.<br>Extra care: ' + p.reason + ' is close by.' : '.') + tm;
  }

  // Shared behaviour: keeps the data, the time and the automatic loading; `host` draws.
  function controller(host, options) {
    options = options || {};
    var st = { time: options.time || null, roads: options.roads || null, hazards: options.hazards || null, auto: !options.roads, timer: null, seq: 0, on: false, route: null };
    function draw() {
      if (st.route) {
        var rc = scoreRoute(st.route.line, st.time || st.route.depart || new Date(), { duration: st.route.duration, hazards: st.hazards });
        host.draw(rc); if (options.onRoute) options.onRoute(rc.summary, rc); return;
      }
      var fc = st.roads ? score(st.roads, st.time || new Date(), { hazards: st.hazards }) : { type: 'FeatureCollection', features: [] };
      host.draw(fc);
    }
    function load() {
      if (!st.on || !st.auto || st.route) return;
      if (host.zoom() < (options.minZoom || 12)) { st.roads = null; draw(); return; }
      var mine = ++st.seq;
      fetchRoads(host.box(), options).then(function (d) { if (mine !== st.seq) return; st.roads = d.roads; st.hazards = d.hazards; draw(); })
        .catch(function (err) { if (options.onError) options.onError(err); });
    }
    return {
      start: function () { st.on = true; if (st.auto) load(); else draw(); if (!st.timer) st.timer = setInterval(function () { if (!st.time) draw(); }, 60000); },
      stop: function () { st.on = false; clearInterval(st.timer); st.timer = null; },
      moved: load,
      api: {
        setTime: function (t) { st.time = t || null; draw(); return this; },
        setRoads: function (r, h) { st.roads = r; st.hazards = h || null; st.auto = !r; if (st.auto) load(); else draw(); return this; },
        refresh: function () { load(); draw(); return this; },
        // Show glare along one route only. opts: { depart: Date, duration: seconds, precision }
        setRoute: function (route, opts) { opts = opts || {}; st.route = { line: toLine(route, opts.precision), depart: opts.depart || null, duration: opts.duration || 0 }; draw(); return this; },
        clearRoute: function () { st.route = null; if (st.auto) load(); else draw(); return this; }
      }
    };
  }

  /** Leaflet: returns a layer. Add it to the map or to L.control.layers as an overlay. */
  function leaflet(L, options) {
    var ctl, Layer = L.LayerGroup.extend({
      onAdd: function (map) { L.LayerGroup.prototype.onAdd.call(this, map); this._glareMap = map; map.on('moveend', ctl.moved); ctl.start(); },
      onRemove: function (map) { map.off('moveend', ctl.moved); ctl.stop(); L.LayerGroup.prototype.onRemove.call(this, map); }
    });
    var layer = new Layer();
    ctl = controller({
      zoom: function () { return layer._glareMap.getZoom(); },
      box: function () { var b = layer._glareMap.getBounds(); return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]; },
      draw: function (fc) {
        layer.clearLayers();
        L.geoJSON(fc, {
          style: function (f) { var hi = f.properties.level === 3; return { color: hi ? COLORS.high : COLORS.some, weight: hi ? 7 : 5, opacity: 0.9, lineCap: 'round' }; },
          onEachFeature: function (f, l) { l.bindPopup(describe(f.properties)); }
        }).addTo(layer);
      }
    }, options);
    layer.setTime = ctl.api.setTime; layer.setRoads = ctl.api.setRoads; layer.refresh = ctl.api.refresh; layer.setRoute = ctl.api.setRoute; layer.clearRoute = ctl.api.clearRoute;
    return layer;
  }

  /** MapLibre GL or Mapbox GL: adds the layer now and returns { control, show, hide, setTime, setRoads, refresh }. */
  function maplibre(map, options) {
    var id = (options && options.id) || 'sun-glare', shown = true;
    function ensure() {
      if (map.getSource(id)) return;
      map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: id, type: 'line', source: id, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['match', ['get', 'level'], 3, COLORS.high, COLORS.some], 'line-width': ['match', ['get', 'level'], 3, 6, 4], 'line-opacity': 0.9 } });
    }
    var ctl = controller({
      zoom: function () { return map.getZoom() + 1; },
      box: function () { var b = map.getBounds(); return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]; },
      draw: function (fc) { ensure(); map.getSource(id).setData({ type: 'FeatureCollection', features: fc.features }); }
    }, options);
    function begin() { ensure(); map.on('moveend', ctl.moved); ctl.start(); }
    if (map.isStyleLoaded && map.isStyleLoaded()) begin(); else map.once('load', begin);
    var api = ctl.api;
    api.show = function () { shown = true; ensure(); map.setLayoutProperty(id, 'visibility', 'visible'); ctl.start(); return api; };
    api.hide = function () { shown = false; if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none'); ctl.stop(); return api; };
    api.control = {
      onAdd: function () {
        var box = document.createElement('div'); box.className = 'maplibregl-ctrl maplibregl-ctrl-group mapboxgl-ctrl mapboxgl-ctrl-group';
        var label = document.createElement('label'); label.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 10px;font:14px sans-serif;cursor:pointer';
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = shown;
        cb.addEventListener('change', function () { if (cb.checked) api.show(); else api.hide(); });
        label.appendChild(cb); label.appendChild(document.createTextNode('Sun glare')); box.appendChild(label); this._box = box; return box;
      },
      onRemove: function () { if (this._box && this._box.parentNode) this._box.parentNode.removeChild(this._box); }
    };
    return api;
  }

  /** Google Maps JavaScript API: returns { show, hide, setTime, setRoads, refresh }. */
  function google(map, options) {
    var g = (options && options.google) || root.google, data = new g.maps.Data(), listener = null;
    data.setStyle(function (f) { var hi = f.getProperty('level') === 3; return { strokeColor: hi ? COLORS.high : COLORS.some, strokeWeight: hi ? 7 : 5, strokeOpacity: 0.9 }; });
    var ctl = controller({
      zoom: function () { return map.getZoom(); },
      box: function () { var b = map.getBounds(), sw = b.getSouthWest(), ne = b.getNorthEast(); return [sw.lat(), sw.lng(), ne.lat(), ne.lng()]; },
      draw: function (fc) { data.forEach(function (f) { data.remove(f); }); data.addGeoJson({ type: 'FeatureCollection', features: fc.features }); }
    }, options);
    var api = ctl.api;
    api.show = function () { data.setMap(map); if (!listener) listener = map.addListener('idle', ctl.moved); ctl.start(); return api; };
    api.hide = function () { data.setMap(null); if (listener) { listener.remove(); listener = null; } ctl.stop(); return api; };
    if (map.getBounds()) api.show(); else g.maps.event.addListenerOnce(map, 'idle', api.show);
    return api;
  }
  var root = typeof self !== 'undefined' ? self : {};

  // Automatic hook-ups: the glare layer follows whatever route the user asks the map for.
  /** Mapbox GL Directions control (@mapbox/mapbox-gl-directions). */
  function followMapboxDirections(directions, glare, options) {
    directions.on('route', function (e) { var r = e && e.route && e.route[0]; if (r) glare.setRoute(r.geometry, { duration: r.duration, precision: options && options.precision }); });
    directions.on('clear', function () { glare.clearRoute(); });
    return glare;
  }
  /** Leaflet Routing Machine control. */
  function followLeafletRouting(control, glare) {
    control.on('routesfound', function (e) { var r = e.routes && e.routes[0]; if (r) glare.setRoute(r.coordinates, { duration: r.summary && r.summary.totalTime }); });
    return glare;
  }
  /** Google Maps DirectionsRenderer. */
  function followGoogleDirections(renderer, glare) {
    renderer.addListener('directions_changed', function () {
      var d = renderer.getDirections(), r = d && d.routes && d.routes[0]; if (!r) { glare.clearRoute(); return; }
      var secs = 0; (r.legs || []).forEach(function (l) { if (l.duration) secs += l.duration.value; });
      glare.setRoute(r.overview_path, { duration: secs });
    });
    return glare;
  }

  return { scoreRoute: scoreRoute, toLine: toLine, followMapboxDirections: followMapboxDirections, followLeafletRouting: followLeafletRouting, followGoogleDirections: followGoogleDirections, score: score, fetchRoads: fetchRoads, fromOverpass: fromOverpass, sunPosition: sunPosition, leaflet: leaflet, maplibre: maplibre, google: google, COLORS: COLORS };
});
