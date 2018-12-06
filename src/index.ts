import * as L from 'leaflet';
import isUndefined from 'lodash-es/isUndefined';
import mapValues from 'lodash-es/mapValues';
import noop from 'lodash-es/noop';
import pickBy from 'lodash-es/pickBy';
import values from 'lodash-es/values';
import zipWith from 'lodash-es/zipWith';

import './index.css';

import Renderer from './Renderer';
import {
  GridLayerTile,
  Pair,
  PreloadTileCache,
  TileCache,
  TileCoordinates,
  TileDatum,
  TileElement,
  TileEvent,
} from './types';
import * as util from './util';

import {
  Color,
  SentinelValue,
} from './types';

// Augment Leaflet definitions to include some helpful "private" methods.
declare module 'leaflet' {
  interface TileLayer {
    _getSubdomain(tilepoint: TileCoordinates): string;
    _getZoomForUrl(): number;
  }

  interface GridLayer {
    _tileZoom: number;
    _globalTileRange: L.Bounds;
    _pruneTiles(): void;
  }
}

const BYTES_PER_WORD = 4; // four bytes in a 32-bit float
const littleEndian = util.machineIsLittleEndian();

export interface MouseEvent extends L.LeafletMouseEvent {
  pixelValue?: number | SentinelValue;
}

interface EventsObject {
  [name: string]: (event: L.LeafletEvent) => void;
}

export interface Options extends L.GridLayerOptions {
  url: string;
  colorScale: Color[];
  sentinelValues?: SentinelValue[];
  nodataValue: number;
  preloadUrl?: string;
  transitions?: boolean;
  transitionTimeMs?: number;

  onload?: (event: { url: string }) => void;

  onclick?: (event: MouseEvent) => void;
  ondblclick?: (event: MouseEvent) => void;
  onmousedown?: (event: MouseEvent) => void;
  onmouseup?: (event: MouseEvent) => void;
  onmouseover?: (event: MouseEvent) => void;
  onmouseout?: (event: MouseEvent) => void;
  onmousemove?: (event: MouseEvent) => void;
  oncontextmenu?: (event: MouseEvent) => void;

  // from TileLayerOptions
  minZoom?: number;
  maxZoom?: number;
  maxNativeZoom?: number;
  minNativeZoom?: number;
  subdomains?: string[];
  errorTileUrl?: string;
  zoomOffset?: number;
  tms?: boolean;
  zoomReverse?: boolean;
  detectRetina?: boolean;
  crossOrigin?: boolean;
}

export const DEFAULT_OPTIONS = {
  sentinelValues: [],
  transitions: true,
  transitionTimeMs: 800,

  // @option subdomains: String|String[] = 'abc'
  // Subdomains of the tile service. Can be passed in the form of one string (where each letter is
  // a subdomain name) or an array of strings.
  subdomains: ['a', 'b', 'c'],

  // @option minZoom: Number = 0
  // The minimum zoom level down to which this layer will be displayed (inclusive).
  minZoom: 0,

  // @option maxZoom: Number = 18
  // The maximum zoom level up to which this layer will be displayed (inclusive).
  maxZoom: 18,

  // @option errorTileUrl: String = ''
  // URL to the tile image to show in place of the tile that failed to load.
  errorTileUrl: '',

  // @option zoomOffset: Number = 0
  // The zoom number used in tile URLs will be offset with this value.
  zoomOffset: 0,

  // @option tms: Boolean = false
  // If `true`, inverses Y axis numbering for tiles (turn this on for
  // [TMS](https://en.wikipedia.org/wiki/Tile_Map_Service) services).
  tms: false,

  // @option zoomReverse: Boolean = false
  // If set to true, the zoom number used in tile URLs will be reversed (`maxZoom - zoom` instead of `zoom`)
  zoomReverse: false,

  // @option detectRetina: Boolean = false
  // If `true` and user is on a retina display, it will request four tiles of half the specified
  // size and a bigger zoom level in place of one to utilize the high resolution.
  detectRetina: false,

  // @option crossOrigin: Boolean = false
  // If true, all tiles will have their crossOrigin attribute set to ''. This is needed if you want
  // to access tile pixel data.
  crossOrigin: false,
};

export class GLTileLayerComponent extends L.GridLayer {
  options: Options;

  protected _map: L.Map;
  protected _renderer: Renderer;
  protected _preloadTileCache?: PreloadTileCache;
  protected _tiles: TileCache;

  protected _getSubdomain: typeof L.TileLayer.prototype._getSubdomain;
  protected _getZoomForUrl: typeof L.TileLayer.prototype._getZoomForUrl;

  constructor(options: Options) {
    super(options);

    L.Util.setOptions(this, options);

    const {
      nodataValue,
      preloadUrl,
    } = options;

    const tileSize: number = this._tileSizeAsNumber();
    const renderer = new Renderer(tileSize, nodataValue);

    Object.assign(this, {
      // Set instance properties.
      _renderer: renderer,
      _preloadTileCache: undefined,
      // Mix in helper methods from L.TileLayer.
      _getSubdomain: L.TileLayer.prototype._getSubdomain,
      _getZoomForUrl: L.TileLayer.prototype._getZoomForUrl,
    });

    this._maybePreload(preloadUrl);

    // Listen for 'tileunload' event to remove the tile from the texture.
    this.on('tileunload', this._onTileRemove.bind(this));
  }

  /**
   * The GLTileLayerComponent exposes a declarative interface. Changes should be triggered by
   * calling this method to update the options. Figuring out how to reconcile the layer's current
   * state with the updated options is the responsibility of the component. Unlike many other
   * Leaflet components, no other public methods are provided for imperatively changing the
   * component's state.
   */
  updateOptions(prevOptions: Options, nextOptions: Options) {
    L.Util.setOptions(this, nextOptions);
    this._maybePreload(nextOptions.preloadUrl);
    if (prevOptions.url !== nextOptions.url) {
      this.options.transitions
      ? this._updateTilesWithTransitions(prevOptions)
      : this._updateTiles();
    }
  }

  /**
   * We need to register all mouse event handlers on the Leaflet Map component. `Leaflet.Layer`
   * does this automatically for any handlers returned from the optional method `getEvents`.
   *
   * We enhance the `MouseEvent` object Leaflet provides to these handlers with an additional
   * property containing the value of the pixel under the cursor.
   */
  getEvents() {
    const {
      onclick: click,
      ondblclick: dblclick,
      onmousedown: mousedown,
      onmouseup: mouseup,
      onmouseover: mouseover,
      onmouseout: mouseout,
      onmousemove: mousemove,
      oncontextmenu: contextmenu,
    } = this.options;
    // Only include handlers that aren't undefined.
    const definedHandlers = pickBy({
      click,
      dblclick,
      mousedown,
      mouseup,
      mouseover,
      mouseout,
      mousemove,
      contextmenu,
    }, handler => !isUndefined(handler));
    // Combine events defined on this "class" with events defined on the parent GridLayer.
    return {
      // Include events from GridLayer.
      ...(L.GridLayer.prototype.getEvents as () => EventsObject).call(this),
      // Wrap each handler to provide property `pixelValue` on the event object.
      ...mapValues(definedHandlers, val => val && this._wrapMouseEventHandler(val)),
    };
  }

  /**
   * From Leaflet.TileLayer; modified to accept a `url` parameter to allow preloading from a
   * URL other than `this.options.url`.
   */
  getTileUrl(coords: TileCoordinates, url: string) {
    const data: any = {
      r: L.Browser.retina ? '@2x' : '',
      s: this._getSubdomain(coords),
      x: coords.x,
      y: coords.y,
      z: this._getZoomForUrl(),
    };
    if (this._map && !((this._map.options as L.MapOptions).crs as L.CRS).infinite) {
      const invertedY = (this._globalTileRange.max as L.Point).y - coords.y;
      if (this.options.tms) {
        data.y = invertedY;
      }
      data['-y'] = invertedY;
    }

    return L.Util.template(url, L.Util.extend(data, this.options));
  }

  /**
   * This function is called by the underlying Leaflet.GridLayer when it creates a new tile. This
   * occurs (a) when the layer first loads and (b) when panning or zooming the map.
   */
  createTile(coords: TileCoordinates, done: (error: Error | null, tile: HTMLElement) => void): TileElement {
    const {
      colorScale,
      sentinelValues = [],
      tileSize,
      url,
    } = this.options;

    // Create a <canvas> element to contain the rendered image.
    const tileCanvas = L.DomUtil.create('canvas') as TileElement;
    // Configure the element.
    Object.assign(tileCanvas, {
      className: 'gl-tilelayer-tile',
      width: tileSize,
      height: tileSize,
    });

    // Retrieve and decode Float-32 PNG.
    this._fetchTileData(coords, url).then((pixelData) => {
      // Render in `renderer`'s WebGL context.
      const [sourceX, sourceY] = this._renderer.renderTile(
        { coords, pixelData },
        colorScale,
        sentinelValues,
      );

      // Copy pixel data to a property on tile canvas element (for later retrieval).
      tileCanvas.pixelData = pixelData;

      // Copy contents to tileCanvas.
      this._copyToTileCanvas(tileCanvas, sourceX, sourceY);
      done(null, tileCanvas);
    });

    return tileCanvas;
  }

  /**
   * Handler function for Leaflet.GridLayer's 'tileunload' event.
   */
  protected _onTileRemove({ coords, tile }: TileEvent) {
    // for https://github.com/Leaflet/Leaflet/issues/137
    if (!L.Browser.android) {
      tile.onload = noop;
    }
    this._renderer.removeTile(coords);
  }

  /**
   * Redraw all active tiles.
   */
  protected async _updateTiles() {
    const activeTiles: GridLayerTile[] = this._getActiveTiles();

    // Fetch data from the new URL.
    const tilesData: TileDatum[] = await this._getTilesData(activeTiles);

    const { colorScale, sentinelValues = [] } = this.options;

    // Render using the new data.
    const canvasCoordinates = this._renderer.renderTiles(
      tilesData,
      colorScale,
      sentinelValues,
    );

    // Update tiles.
    canvasCoordinates.forEach(([sourceX, sourceY], index) => {
      // Copy rendered pixels to the tile canvas.
      const tile = activeTiles[index];
      this._copyToTileCanvas(tile.el, sourceX, sourceY);

      // Copy new pixel data.
      tile.el.pixelData = tilesData[index].pixelData;
    });
  }

  /**
   * Redraw all active tiles, animating the transition over a time interval specified in
   * `options.transitionTimeMs`.
   */
  protected async _updateTilesWithTransitions(prevOptions: Options) {
    const activeTiles: GridLayerTile[] = this._getActiveTiles();

    const oldTilesData: TileDatum[] = activeTiles.map(({ coords, el }) => ({
      coords,
      pixelData: el.pixelData as Uint8Array,
    }));

    // Fetch data from the new URL.
    const newTilesData: TileDatum[] = await this._getTilesData(activeTiles);

    // Copy new pixel data to tiles.
    activeTiles.forEach((tile, index) => {
      tile.el.pixelData = newTilesData[index].pixelData;
    });

    const {
      colorScale: newColorScale,
      sentinelValues: newSentinelValues = [],
      transitionTimeMs,
    } = this.options;
    const {
      colorScale: oldColorScale,
      sentinelValues: oldSentinelValues = [],
    } = prevOptions;

    // This function will be passed to the Renderer, which will call it after rendering a frame
    // in its offscreen <canvas>.
    const onFrameRendered = (canvasCoordinates: Array<Pair<number>>) => {
      canvasCoordinates.forEach(([sourceX, sourceY], index) => {
        // Copy rendered pixels to the tile <canvas>.
        const tile = activeTiles[index];
        this._copyToTileCanvas(tile.el, sourceX, sourceY);
      });
    };

    // Renderer hooks the render calls to requestAnimationFrame, calling `onFrameRendered` after each is drawn.
    if (newColorScale === oldColorScale) {
      this._renderer.renderTilesWithTransition(
        oldTilesData,
        newTilesData,
        newColorScale,
        newSentinelValues,
        transitionTimeMs as number,
        onFrameRendered,
      );
    } else {
      this._renderer.renderTilesWithTransitionAndNewColorScale(
        oldTilesData,
        newTilesData,
        oldColorScale,
        newColorScale,
        oldSentinelValues,
        newSentinelValues,
        transitionTimeMs as number,
        onFrameRendered,
      );
    }
  }

  /**
   * Preload tiles if it makes sense to do so.
   */
  protected _maybePreload(preloadUrl?: string) {
    if (
      // Preload tiles if a preloadUrl is given and...
      preloadUrl && (
        // either the preload cache is empty
        !this._preloadTileCache
        // or its url is out of date.
        || this._preloadTileCache.url !== preloadUrl
      )
    ) {
      this._preloadTiles(preloadUrl);
    }
  }

  /**
   * Load tiles from the given URL and store them in the preload cache.
   */
  protected async _preloadTiles(url: string) {
    const activeTiles: GridLayerTile[] = this._getActiveTiles();
    const tilesData: TileDatum[] = await this._fetchTilesData(activeTiles, url);
    this._preloadTileCache = {
      url,
      tiles: tilesData,
    };
  }

  /**
   * Use Leaflet.GridLayer's _pruneTiles method to clear out any stale tiles, then return the
   * remaining (active) tiles, sorted by z, x, y.
   */
  protected _getActiveTiles(): GridLayerTile[] {
    // Remove inactive tiles from the cache.
    this._pruneTiles();
    // Any tiles remaining are active tiles.
    // We sort them by their tile coordinates (by z, then x, then y) to ensure consistent ordering.
    return values(this._tiles).sort((a, b) => util.compareTileCoordinates(a.coords, b.coords));
  }

  /**
   * Retrieve pixel data for the given tiles, either from the preload cache or from the server.
   */
  protected async _getTilesData(tiles: GridLayerTile[]): Promise<TileDatum[]> {
    const preloadTileCache: PreloadTileCache | undefined = this._preloadTileCache;
    if (
      preloadTileCache
      && this.options.url === preloadTileCache.url
      && util.sameTiles(
        preloadTileCache.tiles.map(({ coords }) => coords),
        tiles.map(({ coords }) => coords),
      )
    ) {
      // Clear the preload cache and return its contents.
      this._preloadTileCache = undefined;
      return Promise.resolve(preloadTileCache.tiles);
    } else {
      return this._fetchTilesData(tiles, this.options.url);
    }
  }

  /**
   * Fetch pixel data for the supplied tiles from the supplied URL.
   */
  protected async _fetchTilesData(tiles: GridLayerTile[], url: string): Promise<TileDatum[]> {
    const pixelData = await Promise.all(tiles.map(({ coords }) => this._fetchTileData(coords, url)));

    // Fire the 'load' event to notify any listeners that the tiles have finished loading.
    this.fire('load', { url });

    return zipWith<GridLayerTile | Uint8Array, TileDatum>(
      tiles,
      pixelData,
      ({ coords }: GridLayerTile, data: Uint8Array) => ({
        coords,
        pixelData: data,
      }),
    );
  }

  /**
   * Fetch pixel data for an individual tile from the given URL.
   */
  protected _fetchTileData(coords: TileCoordinates, url: string): Promise<Uint8Array> {
    return util.fetchPNGData(this.getTileUrl(coords, url), this.options.nodataValue, this._tileSizeAsNumber());
  }

  /**
   * L.GridLayer's `tileSize` option can be either a number or a Point object.
   * For this tile layer, we assume tiles will have equal width and height, so to simplify things
   * we normalize `tileSize` as a number.
   */
  protected _tileSizeAsNumber(): number {
    const { tileSize } = this.options;
    return (
      typeof tileSize === 'number'
      ? tileSize
      : (tileSize as L.Point).x
    );
  }

  /**
   * Copy pixels from the Renderer's (offscreen) <canvas> to a tile's (onscreen) canvas.
   */
  protected _copyToTileCanvas(tile: TileElement, sourceX: number, sourceY: number) {
    const tileSize = this.options.tileSize as number;
    const tileCanvas2DContext = tile.getContext('2d');
    if (tileCanvas2DContext === null) {
      throw new Error('Tile canvas 2D context is null.');
    }
    // Clear the current contents of the canvas. Otherwise, the new image will be composited with
    // the existing image.
    tileCanvas2DContext.clearRect(0, 0, tileSize, tileSize);
    // Copy the image data from the Renderer's canvas to the tile's canvas.
    tileCanvas2DContext.drawImage(
      this._renderer.canvas,
      sourceX, sourceY, tileSize, tileSize, // source canvas offset (x, y) and size (x, y)
      0, 0, tileSize, tileSize,             // destination canvas offset (x, y) and size (x, y)
    );
  }

  /**
   * Wraps a handler for a Leaflet MouseEvent, providing an extra property, `pixelValue`, to the
   * event object.
   */
  protected _wrapMouseEventHandler(handler: (event: MouseEvent) => void): (event: L.LeafletMouseEvent) => void {
    return (event) => {
      const { latlng } = event;
      const pixelCoords: L.Point = this._map.project(latlng, this._tileZoom).floor();
      // Find the tile containing the point.
      const containingTile: GridLayerTile | undefined = this._getTileContainingPoint(pixelCoords);
      // Find position within tile.
      const coordsInTile: L.Point | undefined = containingTile && this._getCoordsInTile(containingTile, pixelCoords);
      // Get pixel value.
      const pixelValue = coordsInTile && this._getPixelValue(containingTile as GridLayerTile, coordsInTile);
      // Call handler with pixel value.
      handler({ ...event, pixelValue });
    };
  }

  /**
   * Get the tile containing the given point (in pixel coordinates) or `undefined` if no tile
   * contains the point.
   */
  protected _getTileContainingPoint(point: L.Point): GridLayerTile | undefined {
    return values(this._tiles).find(tile => {
      return tile.coords.z === this._tileZoom && this._tileBounds(tile).contains(point);
    });
  }

  /**
   * Compute the bounds (in projected pixel coordinates) of the given tile.
   */
  protected _tileBounds(tile: GridLayerTile) {
    const { x, y } = tile.coords;
    const tileSize = this._tileSizeAsNumber();
    const topLeft = L.point(x * tileSize, y * tileSize);
    const bottomRight = L.point(
      topLeft.x + (tileSize - 1),
      topLeft.y + (tileSize - 1),
    );
    return L.bounds(topLeft, bottomRight);
  }

  /**
   * Convert absolute pixel coordinates to pixel coordinates relative to a given tile's upper left
   * corner.
   */
  protected _getCoordsInTile(tile: GridLayerTile, pixelCoords: L.Point): L.Point {
    const { x: tileX, y: tileY } = tile.coords;
    const tileSize = this._tileSizeAsNumber();
    return L.point(
      pixelCoords.x - (tileX * tileSize),
      pixelCoords.y - (tileY * tileSize),
    );
  }

  /**
   * Get the floating-point value of the pixel at the given coordinates in the given tile.
   * Returns `undefined` if the value is equal to `nodataValue`.
   * If the value matches a sentinel value, returns the corresponding `SentinelValue` object.
   */
  protected _getPixelValue(tile: GridLayerTile, coordsInTile: L.Point): number | SentinelValue | undefined {
    const { pixelData } = tile.el;
    if (!pixelData) {
      return undefined;
    }
    const {
      nodataValue,
      sentinelValues,
    } = this.options;
    const tileDataView = new DataView(pixelData.buffer);
    // To find the byte index:
    // (1) get the index of the start of the row in which the pixel is located
    // (2) add to that the column index
    // (3) multiply by the number of bytes used for each pixel
    const byteIndex = (coordsInTile.y * this._tileSizeAsNumber() + coordsInTile.x) * BYTES_PER_WORD;
    const pixelValue = tileDataView.getFloat32(byteIndex, littleEndian);
    // Check for nodata value.
    if (pixelValue === nodataValue) {
      return undefined;
    }
    // Check for sentinel value.
    const sentinel = sentinelValues && sentinelValues.find(({ offset }) => offset === pixelValue);
    // If pixelValue matches no sentinel, just return pixelValue.
    return sentinel || pixelValue;
  }
}
