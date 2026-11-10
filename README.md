# St. Louis Sun Glare Map

A single-page web app that scores every road segment for low-sun glare at a chosen date and time, and checks a trip for the stretches where the driver faces the sun.

Status: working prototype. The scoring has not yet been validated against crash records (see Roadmap).

## What it does

- Colours roads by glare risk for any date and time, with a slider to move through the day.
- Shows, for any road, which direction of travel faces the sun and the time windows when it happens.
- Takes typed From and To addresses (in a normal browser), or points tapped on the map.
- Checks a trip from A to B: distance, drive time, minutes driving into glare, and the stretches affected.
- Compares departure times 15 and 30 minutes earlier and later.
- Raises risk near traffic signals, junctions, pedestrian crossings and schools.

## How the score works

1. Sun position (height and compass direction) is calculated for the date, time and location.
2. A direction of travel has glare when the sun is between the horizon and 25° up, and within 30° left or right of straight ahead.
3. Glare score is 1.0 with the sun dead ahead and under 15° up, falling to 0 at the 30° and 25° limits.
4. Risk = glare score x hazard boost: 1.6 at traffic signals, 1.5 at junctions between main roads, 1.4 at crossings and schools, 1.0 elsewhere.
5. Levels: high at 0.6 or more, medium at 0.3 or more, low above 0.05.
6. A trip follows the quickest path on the loaded roads. The sun position is recalculated as the trip progresses.

## Running it

Open `index.html` in a browser. No build step and no server.

- The page opens with a built-in sketch of 24 main St. Louis roads. Their positions are hand-drawn and approximate, for demonstration only.
- "Load real roads for this view" fetches roads, signals, crossings and schools from OpenStreetMap through the Overpass API. This needs a normal browser or a hosted copy such as GitHub Pages.
- "Load a road file" accepts an Overpass JSON export or a GeoJSON file of road lines and hazard points.

## Adding the layer to another map

`glare-layer.js` is a single file with no dependencies. It adds a "Sun glare" overlay to a map a site already has, and loads roads for the visible area from OpenStreetMap.

Leaflet:

```js
var glare = SunGlare.leaflet(L).addTo(map);
L.control.layers(null, { 'Sun glare': glare }).addTo(map);
```

MapLibre GL or Mapbox GL:

```js
var glare = SunGlare.maplibre(map);
map.addControl(glare.control); // a "Sun glare" checkbox
```

Google Maps JavaScript API:

```js
var glare = SunGlare.google(map);
```

Follow the directions a user already asked the map for:

```js
SunGlare.followMapboxDirections(directionsControl, glare); // @mapbox/mapbox-gl-directions
SunGlare.followLeafletRouting(routingControl, glare);      // Leaflet Routing Machine
SunGlare.followGoogleDirections(directionsRenderer, glare);
```

Or hand over any route yourself. It accepts a GeoJSON line, an array of points, or an encoded polyline:

```js
glare.setRoute(route.geometry, { duration: route.duration }); // seconds
glare.clearRoute();
```

In route mode the layer shows glare only along that route, in the direction of travel, with the sun moving as the trip goes on.

Each one returns an object with `setTime(date)` (pass `null` to follow the clock), `setRoads(geojson, hazards)` to supply your own roads, and `refresh()`. `SunGlare.score(roads, date)` returns the affected stretches as GeoJSON without any map.

`demo.html` shows the Leaflet version with a layer switcher and a time slider. Keep it in the same folder as `glare-layer.js`.

Status: the scoring functions (`score`, `scoreRoute`) are tested. The Leaflet, MapLibre and Google adapters and the three directions hook-ups have not been run against live maps yet.

The main page can also export the affected roads for one moment as KML (Google Earth, Google My Maps) or GeoJSON.

## Data

- Roads and hazards: OpenStreetMap contributors, ODbL licence.
- Sun position: standard solar position formulas, calculated in the page.

## Known limits

- Hills, buildings and trees that block the sun are ignored, so the map over-warns in built-up or wooded streets.
- Clouds and wet-road reflection are ignored.
- Road slope is ignored.
- Times are US Central only.
- Trip times use a fixed speed per road class, with no traffic.

## Prior work

- US patent 11112257, "Navigation with sun glare information", covers calculating routes with glare as an input. This project is a portfolio prototype and is not offered for sale.
- SunGlare (iOS app) shows glare times and affected roads.
- "Safety-Aware Route Navigation: Driving with Less Sun Glare", SIGSPATIAL 2024.

## Roadmap

1. Validate against crash records: test whether crashes are more frequent on a segment during its predicted glare windows than outside them.
2. Check predictions against timestamped street-level photos.
3. Remove false alarms using building and terrain heights.
4. Add a cloud-cover feed.
