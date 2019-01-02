var bounds = [
  [37.5422237953776, 51.4153947924142],
  [-46.9810436586275, -25.3587574757147],
];

// Show this many places after the decimal when displaying pixel value.
var VALUE_DISPLAY_PRECISION = 1;

// Create the Leaflet map.
var map = L.map('map').fitBounds(bounds);

// Create layers and add to the map.

// base layer (without labels)
L.tileLayer('https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://carto.com/attribution">CARTO</a>',
}).addTo(map);

// tile layer showing data
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
  onmousemove: updateValueDisplay,
}).addTo(map);

// label layer
L.tileLayer('https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_only_labels/{z}/{x}/{y}.png').addTo(map);

function getTileURLByYear(year) {
  var base = 'https://vizhub.healthdata.org/lbd/api/v1/themes/under5/schemas/mortality/map/raster/{z}/{x}/{y}.png';
  var querystring = L.Util.template('age_group=under5&location_id=1&measure=mortality&stat=mean&year={year}', {
    year: year,
  });
  return base + '?' + querystring;
}

// custom Leaflet control that allows user to set the year
var YearControl = L.Control.extend({
  onAdd: function() {
    return createRangeSlider('year-control', 'Year', [2000, 2015], 5, 2000, update);
  },
});

// custom Leaflet control to display a title for the visualization
var TitleControl = L.Control.extend({
  onAdd: function() {
    var title = L.DomUtil.create('h1', 'title');
    title.textContent = 'Local Burden of Disease – Under-5 Mortality';
    return title;
  },
});

// custom Leaflet control to display the value of the pixel under the cursor
var ValueDisplayControl = L.Control.extend({
  onAdd: function() {
    var element = L.DomUtil.create('p', 'value-display');
    // Element should be hidden initially.
    element.style.display = 'none';
    return element;
  },
  updateText: function(text) {
    var element = this.getContainer();
    if (!text) {
      // Hide the element if there's no text to display.
      element.style.display = 'none';
    } else {
      // Otherwise show the element and reset its text.
      element.style.display = 'block';
      element.textContent = text;
    }
  },
});

// Instantiate the controls and add them to the map.
new YearControl({ position: 'bottomleft' }).addTo(map);
new TitleControl({ position: 'topright' }).addTo(map);
var valueDisplay = new ValueDisplayControl({ position: 'topright' }).addTo(map);

// function to update the map when the year slider is moved
function update(year) {
  tileLayer.updateOptions({
    url: getTileURLByYear(year),
  });
}

// function to update the value display when the mouse hovers over pixels
function updateValueDisplay(mouseEvent) {
  var pixelValue = mouseEvent.pixelValue;
  // if no-data pixel, pixelValue will be `undefined`
  var text = pixelValue === undefined ? '' : 'Value: ' + pixelValue.toFixed(VALUE_DISPLAY_PRECISION);
  valueDisplay.updateText(text);
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
