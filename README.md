# Leaflet.TileLayer.GLColorScale

### Custom Leaflet TileLayer using WebGL to colorize floating-point pixels according to a specified color scale

## Features

- GPU rendering
- a small configuration language for describing how to colorize pixels
- (optional) animated per-pixel transitions when changing URL or color scales
- raw (float) pixel value provided to mouse event handlers
- a simple declarative API
- TypeScript definitions

## Accessing the plugin

### With module loader

Install:
```
npm install --save leaflet.tilelayer.glcolorscale
```

Reference as ECMAScript module:
```javascript
import * as L from 'leaflet';
import GLColorScale from 'leaflet.tilelayer.glcolorscale';
```

Or as CommonJS module:
```javascript
const L = require('leaflet');
const GLColorScale = require('leaflet.tilelayer.glcolorscale');
```

### With script tag, fetching from CDN

```html
<!-- Leaflet -->
<script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>
<!-- Leaflet.TileLayer.GlColorScale -->
<script src="https://unpkg.com/leaflet.tilelayer.glcolorscale/dist/bundle.min.js"></script>
```

```javascript
// Leaflet exposed as global variable `L`
// plugin exposed as `L.TileLayer.GLColorScale`
const { GLColorScale } = L.TileLayer;
```

### Usage

```javascript
const map = L.map('map').setView([0, 0], 5);

// Create the tile layer and add it to the map.
// Note that `url` is passed as a property on the `Options` object, not as a separate parameter as in the stock L.TileLayer.
const tileLayer = new GLColorScale({
  url: 'https://{s}.my-tile-url.org/{z}/{x}/{y}.png',
  colorScale: [
    { offset: 0, color: 'rgb(255, 0, 0)', label: 'zero' },
    { offset: 1, color: 'rgb(0, 0, 255)', label: 'one' },
  ],
  nodataValue: -999999,
}).addTo(map);

// ... some time later

// Update the tile layer.
tileLayer.updateOptions({ url: 'https://{s}.my-other-tile-url.org/{z}/{x}/{y}.png' });
```

## A bit of history

At [IHME](http://www.healthdata.org/) we produce raster datasets showing the geographical distribution of diseases, medical interventions, and other measures. Each pixel represents our best estimate of the value of a given measure, expressed as a floating-point number, at that location. Our researchers wanted to visualize this data using linear color scales, by which each floating-point pixel would be translated to a color. At first we processed these raster tilesets server-side, sending colorized PNG tiles to the web application. Then we discovered we could colorize faster with clientside rendering on the GPU. Having the raw floating-point values available clientside also allowed us to show the pixel values on mouse hover.

## Tile format

We decided to use PNG files as an interchange format for getting our floating-point raster data to the browser, primarily because it seems to be the most common format for raster data on map tile servers. Our approach is similar to the way [DEM](https://en.wikipedia.org/wiki/Digital_elevation_model) tiles often encode non-color values into the RGBA channels (or more abstractly the 32 bits) of each pixel in a PNG file. DEM tiles typically encode 32-bit integers, though, while we encode 32-bit floats, which have a much wider range but uneven resolution throughout that range.

Given access to the binary pixel data, producing these tiles is trivial. We just take a buffer full of 32-bit floats and hand that over to a PNG encoder, which assumes it's getting RGBA pixels. Compression is of course not as good when you abuse the format like this.

We may add support in the future for other tile formats, but for now this component assumes it's getting PNG files encoded with 32-bit floats.

## Updating the component

Rather than providing multiple methods for changing state or behavior as many built-in Leaflet components do, this tile layer has a single method, `updateOptions`. The API is designed to be simple and declarative, like that of a React component. You create a component by passing an `Options` object to the constructor:

```javascript
const tileLayer = new GLColorScale({ /* ... */ });
```

You update a component by passing an `Options` object to `updateOptions`:

```javascript
tileLayer.updateOptions({ /* ... */ });
```

## Options

This TileLayer accepts all the same options as `Leaflet.GridLayer` and `Leaflet.TileLayer`. It also accepts these additional options:

| Option           | Type            | Default   | Description |
| ---------------- | --------------- | --------- | ----------- |
| url              | String          | undefined | tile URL
| nodataValue      | Number          | undefined | pixel value to interpret as no-data
| colorScale       | Color[]         | undefined | array of color stops used for linear interpolation
| sentinelValues   | SentinelValue[] | []        | array of fixed values to be matched exactly
| preloadUrl       | String          | undefined | tile URL to preload in the background
| transitions      | Boolean         | true      | whether to show pixel transitions when changing URL or color scales
| transitionTimeMs | Number          | 800       | duration of pixel transitions, in miliseconds

See [Events and handlers](#events-and-handlers) (below) for a list of callbacks that can be passed as `Options` properties.

### Color scales

Here's an example color scale:

```javascript
const colorScale = [
  { offset: 0, color: 'rgb(255, 0, 0)', label: 'zero' },
  { offset: 1, color: 'rgb(0, 0, 255)', label: 'one' },
];

const tileLayer = new GLColorScale({ colorScale, /* ... */ });
```

This tells the renderer to color pixels with value 0 (or less) red and value 1 (or greater) blue. Pixels with values between 0 and 1 will get a blend of red and blue, because colors are linearly interpolated between each pair of adjacent stops. You can have as few as two or as many as `GLColorScale.COLOR_SCALE_MAX_LENGTH` color stops in a color scale.

### Sentinel values

In addition to linear color scales, it's possible to specify one or more "sentinel values," which map discrete values to colors. The format for specifying sentinel values is the same as that for color stops (except that the `label` property is required for sentinel values but optional for color stops). Let's change the above example just a little:

```javascript
const sentinelValues = [
  { offset: 0, color: 'rgb(255, 0, 0)', label: 'zero' },
  { offset: 1, color: 'rgb(0, 0, 255)', label: 'one' },
];

const tileLayer = new GLColorScale({ sentinelValues, /* ... */ });
```

Now pixels whose values are _exactly_ 0 will be colored red and pixels whose values are _exactly_ 1 will be colored blue. We haven't specified what to do for values other than 0 or 1, so the behavior for such values would be undefined in this case. Sentinel values only match the precise value specified (within a tiny margin of error). The maximum number of sentinel values the component will accept can be accessed via `GLColorScale.SENTINEL_VALUES_MAX_LENGTH`.

### No-data value

Typically with raster tiles, one will want some pixels (e.g. pixels over oceans or other bodies of water) to be fully transparent. We support this behavior with a special kind of sentinel value, called the "no-data value." By encoding a no-data value into your raster tiles for pixels that should be transparent and then specifying this value via the `nodataValue` property of the `Options` object, you can tell the tile layer to render these pixels as fully transparent.

Any valid 32-bit float can be chosen for a sentinel value or the no-data value, but it's wise to choose a value that's well outside the range of expected data values.

### Transitions

This tile layer supports animated transitions when changing either the URL or the color scale! You can specify the transition time (in milliseconds) with the `Options` property `transitionTimeMs`. If you don't want transitions, you can turn them off by setting `{ transitions: false }` in the `Options` object.

## Events and handlers

You can register handler functions for some events by passing them as properties on the `Options` object when the component is created. Note that this is a bit different from the way handlers are registered on typical Leaflet components. The following table shows the mapping of `Options` properties to corresponding events:

| Property      | Event       |
| ------------- | ----------- |
| onload        | load        |
| onclick       | click       |
| ondblclick    | dblclick    |
| onmousedown   | mousedown   |
| onmouseup     | mouseup     |
| onmouseover   | mouseover   |
| onmouseout    | mouseout    |
| onmousemove   | mousemove   |
| oncontextmenu | contextmenu |

This component extends the Event object provided to Leaflet mouse event handlers, adding a property `pixelValue` that represents the value of the pixel under the cursor. This value will be `undefined` if the pixel has the `nodata` value. If the pixel value matches a sentinel value, the `SentinelValue` object will be provided as `pixelValue`. Otherwise, `pixelValue` will match the numerical value of the pixel.

Here's an example of registering a handler for the the `click` event:
```javascript
const tileLayer = new GLColorScale({
  // ...
  onclick: ({ pixelValue }) => {
    if (pixelValue === undefined) {
      // Do nothing for `nodata`.
      return;
    } else if (typeof pixelValue === 'number') {
      // Numerical pixelValue: alert with value
      alert(pixelValue);
    } else {
      // Sentinel value: alert with label
      // If you're not using sentinel values, no need to worry about this case.
      alert(pixelValue.label);
    }
    alert(pixelValue);
  },
});
```

## Preloading tiles

You can optionally preload a tile set in the background by supplying its URL as the `Options` property `preloadUrl`. This behavior facilitates quickly switching to a new tile set when you know in advance what its URL will be, as for instance when scripting your Leaflet visualization. To be notified when the new tile set has finished loading, register a handler on the 'load' event and check that the `url` property on the event object matches your `preloadUrl`. Then you can switch to the new tile set by passing its URL as `Options.url`.

```javascript
const firstUrl = 'https://{s}.my-tile-url.org/{z}/{x}/{y}.png';
const nextUrl = 'https://{s}.my-other-tile-url.org/{z}/{x}/{y}.png';

const tileLayer = new GLColorScale({
  url: firstUrl,
  preloadUrl: nextUrl,

  // ... other options

  // handler for 'load' event, passed Event object with property `url`
  onload: ({ url }) => {
    if (url === firstUrl) {
      alert(`tiles loaded from ${firstUrl}`);
    } else if (url === nextUrl) {
      alert(`tiles loaded from ${nextUrl}`);
    }
  },
}).addTo(map);

// ... some time later, after tiles from `nextUrl` have loaded, we switch to the preloaded tile set
tileLayer.updateOptions({
  url: nextUrl,
  // ... other options
});
```
