// Import Mapbox as an ESM module (v3: needed for my Standard-based Studio style)
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@3.9.4/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Public access token (pk.); safe to have in the browser and on GitHub
mapboxgl.accessToken =
  'pk.eyJ1IjoiZmVsaWFuZyIsImEiOiJjbXdmOHA0NTYwNDFxMnlwc3dhM3ZzZm11In0.wRz-D-KQl0jmF47QAFf3VA';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/feliang/cmwf9bxy9008s01sm0tws55tj', // my custom style from Mapbox Studio
  center: [-71.09415, 42.36027], // [longitude, latitude], near MIT
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

// The <svg> layered on top of the map, where D3 draws the station circles
const svg = d3.select('#map').select('svg');

// Turn a station's longitude/latitude into pixel x/y on the map as it looks right now.
// map.project() accounts for panning, zooming and rotation for us.
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// ---------- Step 5: time filtering helpers ----------

// Turn minutes since midnight (e.g. 510) into a time like "8:30 AM"
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Turn a Date into minutes since midnight, e.g. 8:30 AM -> 510
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Step 5.4: 1440 "buckets", one per minute of the day. Bucket 510 will hold every
// ride that started (or ended) at 8:30. Filling them once means the slider only
// has to look at ~120 buckets instead of all 260,000 rides each time it moves.
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// All rides in the buckets within 60 minutes of `minute` (-1 = no filter, all rides)
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat(); // flat() merges the 1440 small arrays into one
  }

  // % 1440 wraps around midnight: 30 minutes before 12:10 AM is 11:40 PM
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    // the window crosses midnight, e.g. 11:30 PM -> 1:30 AM: take both ends
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute + 1);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    // + 1 so the last minute is included too (slice stops before its end index)
    return tripsByMinute.slice(minMinute, maxMinute + 1).flat();
  }
}

// Count arrivals/departures per station for one time window (-1 = all day)
function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id, // rides that STARTED at the station
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id, // rides that ENDED at the station
  );

  // Attach the counts to each station. "?? 0" = use 0 if the station had no rides
  return stations.map((station) => {
    let id = station.short_name; // the same id the trips file uses
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// Step 6.1: share of a station's rides that are departures (0 to 1), snapped to
// just three values: 0 = mostly arrivals, 0.5 = balanced, 1 = mostly departures.
// Three clear colors are easier to read than a smooth gradient.
let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

function departureRatio(d) {
  // a station with no rides in the window would divide by 0, so call it balanced
  return d.totalTraffic === 0 ? 0.5 : stationFlow(d.departures / d.totalTraffic);
}

// Tooltip text for one station
function tooltipText(d) {
  return `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`;
}

// Shared style for every bike lane layer, so a tweak here changes both cities
const bikeLaneStyle = {
  'line-color': '#32D400', // bright green
  'line-width': 3,
  'line-opacity': 0.5,
  'line-emissive-strength': 1, // ignore the style's dusk lighting so the green stays bright
};

// Wait until the map has finished loading before adding data to it
map.on('load', async () => {
  // Boston bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: bikeLaneStyle,
  });

  // Cambridge bike lanes
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLaneStyle,
  });

  // Bluebikes stations
  let jsonData;
  try {
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    // no "const" here: we fill in the jsonData declared above, so it still exists after the try block
    jsonData = await d3.json(jsonurl);
    console.log('Loaded JSON Data:', jsonData);
  } catch (error) {
    console.error('Error loading JSON:', error);
    return; // nothing to draw without the stations
  }

  // Step 4.1 + 5.3: every Bluebikes ride in March 2024 (~260,000 rows, so this takes
  // a moment). The second argument runs on each row as it loads: turn the time
  // strings into Dates and drop each ride into its minute bucket (Step 5.4).
  await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    (trip) => {
      // "2024-03-20 08:18:13" -> "2024-03-20T08:18:13", a format every browser reads
      trip.started_at = new Date(trip.started_at.replace(' ', 'T'));
      trip.ended_at = new Date(trip.ended_at.replace(' ', 'T'));

      departuresByMinute[minutesSinceMidnight(trip.started_at)].push(trip);
      arrivalsByMinute[minutesSinceMidnight(trip.ended_at)].push(trip);
      return trip;
    },
  );

  // Step 4.2: arrivals, departures and totalTraffic for each station (all day)
  const stations = computeStationTraffic(jsonData.data.stations);
  console.log('Stations with traffic:', stations);

  // Step 4.3: circle AREA proportional to traffic, so a square-root scale for the radius
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  // One circle per station (positions are set in updatePositions below;
  // colors are in map.css). The key (short_name) tells D3 which circle belongs
  // to which station, so later updates resize the same circles.
  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    // Step 6.1: map.css turns this number into the circle's color
    .style('--departure-ratio', departureRatio)
    // Step 4.4: a <title> inside a circle becomes the browser's hover tooltip
    .each(function (d) {
      d3.select(this).append('title').text(tooltipText(d));
    });

  // Move every circle to where its station is on the map right now
  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  // Place them once now, then again whenever the map moves
  updatePositions();
  map.on('move', updatePositions); // while panning
  map.on('zoom', updatePositions); // while zooming
  map.on('resize', updatePositions); // when the window size changes
  map.on('moveend', updatePositions); // final adjustment after movement ends

  // ---------- Step 5: the time slider ----------
  const timeSlider = document.getElementById('time-slider'); // ids here, no "#"
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  // Redraw the circles for one time window (-1 = all day)
  function updateScatterPlot(timeFilter) {
    const filteredStations = computeStationTraffic(stations, timeFilter);

    // Fewer rides in a 2-hour window, so allow bigger circles while filtering
    timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

    circles
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', departureRatio) // recolor for this time window
      .select('title') // keep the tooltip numbers in sync with the filter
      .text(tooltipText);
  }

  // Runs every time the slider moves
  function updateTimeDisplay() {
    let timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = ''; // no time to show
      anyTimeLabel.style.display = 'block'; // show "(any time)"
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay(); // set the starting text
});
