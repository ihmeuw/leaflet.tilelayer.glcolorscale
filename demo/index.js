var bounds = [
  [37.5422237953776, 51.4153947924142],
  [-46.9810436586275, -25.3587574757147],
];

var map = L.map('map').fitBounds(bounds);

// Create base layer (without labels).
L.tileLayer('https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://carto.com/attribution">CARTO</a>',
}).addTo(map);

// Create the tile layer.
var tileLayer = new L.TileLayer.GLColorScale({
  url: getTileURLByYear(2000),
  colorScale: [
    {color: "rgb(132, 54, 168)", offset: 0},
    {color: "rgb(132, 54, 168)", label: "≤ 25", offset: 25},
    {color: "rgb(222, 100, 175)", offset: 25.00001},
    {color: "rgb(255, 255, 191)", label: "50", offset: 50},
    {color: "rgb(194, 4, 36)", label: "≥ 200", offset: 200},
  ],
  nodataValue: -999999,
  bounds: bounds,
  maxNativeZoom: 5,
  noWrap: true,
  attribution: '<a href="http://www.healthdata.org/data-visualization/lbd-U5M">IHME</a>',
}).addTo(map);

// Create label layer.
L.tileLayer('https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_only_labels/{z}/{x}/{y}.png').addTo(map);

function getTileURLByYear(year) {
  var base = 'https://vizhub.healthdata.org/lbd/api/v1/themes/under5/schemas/mortality/map/raster/{z}/{x}/{y}.png';
  var querystring = L.Util.template('age_group=under5&location_id=1&measure=mortality&stat=mean&year={year}', {
    year: year,
  });
  return base + '?' + querystring;
}

// Create a custom Leaflet control to set the year.
var YearControl = L.Control.extend({
  onAdd: function() {
    return createRangeSlider('year-control', 'Year', [2000, 2015], 5, 2000, update);
  },
});

// Instantiate the control and add it to the map.
new YearControl({ position: 'bottomleft' }).addTo(map);

var TitleControl = L.Control.extend({
  onAdd: function() {
    var title = L.DomUtil.create('h1', 'title');
    title.textContent = 'Local Burden of Disease – Under-5 Mortality';
    return title;
  },
});

new TitleControl({
  position: 'topright',
}).addTo(map);

// Function to update the map when the year slider is moved.
function update(year) {
  tileLayer.updateOptions({
    url: getTileURLByYear(year),
  });
}

function createRangeSlider(containerID, label, range, step, defaultValue, changeCallback) {
  var name = containerID + '-input';
  var container = createElementWithAttributes('div', { id: containerID });
  var labelElement = createElementWithAttributes('label', { for: name });
  labelElement.textContent = label + ': ' + defaultValue;
  var inputElement = createElementWithAttributes('input', {
    type: 'range',
    id: name,
    min: range[0],
    max: range[1],
    step: step,
    value: defaultValue,
  });
  inputElement.addEventListener('change', function() {
    // Update the label using the new value.
    labelElement.textContent = label + ': ' + inputElement.value;
    changeCallback(inputElement.valueAsNumber);
  });
  container.appendChild(labelElement);
  container.appendChild(inputElement);
  return container;
}

function createElementWithAttributes(tagName, attributeMap) {
  var element = document.createElement(tagName);
  var keys = Object.keys(attributeMap);
  for (var i = 0; i < keys.length; ++i) {
    var name = keys[i];
    var value = attributeMap[name];
    if (typeof value != 'boolean' || value) {
      element.setAttribute(name, value);
    }
  }
  return element;
}
