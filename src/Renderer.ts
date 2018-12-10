import * as L from 'leaflet';
import {
  chunk,
  flatMap,
  zipWith,
} from 'lodash-es';
import REGL from 'regl';

import { CLEAR_COLOR } from './constants';
import * as commands from './regl-commands';
import TextureManager from './TextureManager';
import {
  DrawTile,
  DrawTileInterpolateColor,
  DrawTileInterpolateValue,
  Pair,
  TileCoordinates,
  TileDatum,
} from './types';
import * as util from './util';

import {
  Color,
  SentinelValue,
} from './types';

export default class Renderer {
  canvas: HTMLCanvasElement;
  regl: REGL.Regl;
  textureManager: TextureManager;
  tileSize: number;

  // Regl draw commands.
  drawTile: REGL.DrawCommand<REGL.DefaultContext, DrawTile.Props>;
  drawTileInterpolateColor: REGL.DrawCommand<REGL.DefaultContext, DrawTileInterpolateColor.Props>;
  drawTileInterpolateValue: REGL.DrawCommand<REGL.DefaultContext, DrawTileInterpolateValue.Props>;

  constructor(tileSize: number, nodataValue: number) {
    const canvas = L.DomUtil.create('canvas') as HTMLCanvasElement;
    const regl = REGL(canvas);
    const commonDrawConfig = commands.getCommonDrawConfiguration(tileSize, nodataValue);

    // Assign object "instance" properties.
    Object.assign(this, {
      canvas,
      regl,
      tileSize,
      textureManager: new TextureManager(regl, tileSize),
      drawTile: commands.createDrawTileCommand(regl, commonDrawConfig),
      drawTileInterpolateColor: commands.createDrawTileInterpolateColorCommand(regl, commonDrawConfig),
      drawTileInterpolateValue: commands.createDrawTileInterpolateValueCommand(regl, commonDrawConfig),
    });
  }

  renderTile(
    { coords, pixelData }: TileDatum,
    colorScale: Color[],
    sentinelValues: SentinelValue[],
  ): Pair<number> {
    const {
      regl,
      textureManager,
      tileSize,
    } = this;
    // Set canvas size.
    this.setCanvasSize(tileSize, tileSize);
    // Add image to the texture and retrieve its texture coordinates.
    const textureBounds = textureManager.addTile(coords, pixelData);

    // Render.
    regl.clear({ color: CLEAR_COLOR });
    this.drawTile({
      colorScale: util.convertColorScale(colorScale),
      sentinelValues: util.convertColorScale(sentinelValues),
      canvasSize: [tileSize, tileSize],
      canvasCoordinates: [0, 0],
      textureBounds,
      texture: textureManager.texture,
    });

    // Since the tile will fill the whole canvas, the offset is simply [0, 0].
    return [0, 0];
  }

  renderTiles(
    tiles: TileDatum[],
    colorScale: Color[],
    sentinelValues: SentinelValue[],
  ): Array<Pair<number>> {
    const {
      regl,
      textureManager,
    } = this;

    // Compute required canvas dimensions, then resize the canvas.
    const [canvasWidth, canvasHeight] = this.computeRequiredCanvasDimensions(tiles.length);
    this.setCanvasSize(canvasWidth, canvasHeight);

    // Compute the coordinates at which each tile will be rendered in the canvas.
    const canvasCoordinates = this.getCanvasCoordinates(canvasWidth, canvasHeight, tiles.length);

    type TileWithCanvasCoords = TileDatum & { canvasCoords: Pair<number> };

    // Form an array combining each tile datum with the coordinates at which it will be rendered.
    const tilesWithCanvasCoordinates = zipWith<TileDatum | Pair<number>, TileWithCanvasCoords>(
      tiles,
      canvasCoordinates,
      (tile: TileDatum, canvasCoords: Pair<number>) => ({
        ...tile,
        canvasCoords,
      }),
    );

    // Clear existing tiles from cache.
    textureManager.clearTiles();
    // Clear the canvas.
    regl.clear({ color: CLEAR_COLOR });

    // Split the tiles array into chunks the size of the texture capacity. If we need to render more
    // tiles than will fit in the texture, we have to render in batches.
    const chunks = chunk(tilesWithCanvasCoordinates, textureManager.tileCapacity);

    // Render chunk by chunk.
    for (const chunk of chunks) {
      // Add tiles.
      const textureBounds = chunk.map(
        ({ coords, pixelData }) => textureManager.addTile(coords, pixelData),
      );

      // Render each tile.
      this.drawTile(chunk.map(({ canvasCoords }, index) => ({
        colorScale: util.convertColorScale(colorScale),
        sentinelValues: util.convertColorScale(sentinelValues),
        canvasSize: [canvasWidth, canvasHeight] as Pair<number>,
        canvasCoordinates: canvasCoords,
        textureBounds: textureBounds[index],
        texture: textureManager.texture,
      })));
    }

    return canvasCoordinates;
  }

  async renderTilesWithTransition(
    oldTiles: TileDatum[],
    newTiles: TileDatum[],
    colorScale: Color[],
    sentinelValues: SentinelValue[],
    transitionDurationMs: number,
    onFrameRendered: (canvasCoordinates: Array<Pair<number>>) => void,
  ) {
    const {
      regl,
      textureManager,
      tileSize,
    } = this;

    // Compute required canvas dimensions, then resize the canvas.
    const canvasSize = this.computeRequiredCanvasDimensions(oldTiles.length);
    const [canvasWidth, canvasHeight] = canvasSize;
    this.setCanvasSize(canvasWidth, canvasHeight);

    // Compute the coordinates at which each tile will be rendered in the canvas.
    const canvasCoordinates = this.getCanvasCoordinates(canvasWidth, canvasHeight, oldTiles.length);

    interface TilesWithCanvasCoords {
      canvasCoords: Pair<number>;
      coords: TileCoordinates;
      oldPixelData: Uint8Array;
      newPixelData: Uint8Array;
    }

    // Form an array combining each tile datum with the coordinates at which it will be rendered.
    const tilesWithCanvasCoordinates = zipWith<TileDatum | Pair<number>, TilesWithCanvasCoords>(
      oldTiles,
      newTiles,
      canvasCoordinates,
      (oldTile: TileDatum, newTile: TileDatum, canvasCoords: Pair<number>) => ({
        coords: oldTile.coords,
        oldPixelData: oldTile.pixelData,
        newPixelData: newTile.pixelData,
        canvasCoords,
      }),
    );

    // Create a new TextureManager to hold the new data. After the transition, this will replace the
    // Renderer's stored TextureManager.
    const newTextureManager = new TextureManager(regl, tileSize);

    // Convert the color scale and sentinel values to the form expected by WebGL.
    const webGLColorScale = util.convertColorScale(colorScale);
    const webGLSentinelValues = util.convertColorScale(sentinelValues);

    // Record the starting time.
    const transitionStart = regl.now();

    const renderFrame = (interpolationFraction: number) => {
      // Split the tiles array into chunks the size of the texture capacity. If we need to render more
      // tiles than will fit in the texture, we have to render in batches.
      const chunks = chunk(tilesWithCanvasCoordinates, textureManager.tileCapacity);

      // Clear the canvas.
      regl.clear({ color: CLEAR_COLOR });

      // Render chunk by chunk.
      for (const chunk of chunks) {
        // Add tiles.
        const oldTextureBounds = chunk.map(
          ({ coords, oldPixelData }) => textureManager.addTile(coords, oldPixelData),
        );
        const newTextureBounds = chunk.map(
          ({ coords, newPixelData }) => newTextureManager.addTile(coords, newPixelData),
        );

        // Render each tile.
        this.drawTileInterpolateValue(chunk.map(({ canvasCoords }, index) => ({
          colorScale: webGLColorScale,
          sentinelValues: webGLSentinelValues,
          canvasSize,
          canvasCoordinates: canvasCoords,
          textureA: textureManager.texture,
          textureB: newTextureManager.texture,
          textureBoundsA: oldTextureBounds[index],
          textureBoundsB: newTextureBounds[index],
          interpolationFraction,
        })));
      }

      // Invoke the callback with the canvas coordinates of the rendered tiles.
      onFrameRendered(canvasCoordinates);
    };

    const animationHandle = regl.frame(({ time }) => {
      const elapsedTimeMs = (time - transitionStart) * 1000;
      const interpolationFraction = elapsedTimeMs / transitionDurationMs;
      renderFrame(interpolationFraction);
    });

    await util.Timer(transitionDurationMs);
    animationHandle.cancel();

    // Render again, in case previous frames didn't make it all the way to interpolationFraction 1.0.
    renderFrame(1);

    // Clean up the old TextureManager and replace it with the new one.
    this.textureManager.destroy();
    this.textureManager = newTextureManager;
  }

  async renderTilesWithTransitionAndNewColorScale(
    oldTiles: TileDatum[],
    newTiles: TileDatum[],
    oldColorScale: Color[],
    newColorScale: Color[],
    oldSentinelValues: SentinelValue[],
    newSentinelValues: SentinelValue[],
    transitionDurationMs: number,
    onFrameRendered: (canvasCoordinates: Array<Pair<number>>) => void,
  ) {
    const {
      regl,
      textureManager,
      tileSize,
    } = this;

    // Compute required canvas dimensions, then resize the canvas.
    const canvasSize = this.computeRequiredCanvasDimensions(oldTiles.length);
    const [canvasWidth, canvasHeight] = canvasSize;
    this.setCanvasSize(canvasWidth, canvasHeight);

    // Compute the coordinates at which each tile will be rendered in the canvas.
    const canvasCoordinates = this.getCanvasCoordinates(canvasWidth, canvasHeight, oldTiles.length);

    interface TilesWithCanvasCoords {
      canvasCoords: Pair<number>;
      coords: TileCoordinates;
      oldPixelData: Uint8Array;
      newPixelData: Uint8Array;
    }

    // Form an array combining each tile datum with the coordinates at which it will be rendered.
    const tilesWithCanvasCoordinates = zipWith<TileDatum | Pair<number>, TilesWithCanvasCoords>(
      oldTiles,
      newTiles,
      canvasCoordinates,
      (oldTile: TileDatum, newTile: TileDatum, canvasCoords: Pair<number>) => ({
        coords: oldTile.coords,
        oldPixelData: oldTile.pixelData,
        newPixelData: newTile.pixelData,
        canvasCoords,
      }),
    );

    // Create a new TextureManager to hold the new data. After the transition, this will replace the
    // Renderer's stored TextureManager.
    const newTextureManager = new TextureManager(regl, tileSize);

    // Convert the color scales and sentinel values to the form expected by WebGL.
    const colorScaleA = util.convertColorScale(oldColorScale);
    const colorScaleB = util.convertColorScale(newColorScale);
    const sentinelValuesA = util.convertColorScale(oldSentinelValues);
    const sentinelValuesB = util.convertColorScale(newSentinelValues);

    // Record the starting time.
    const transitionStart = regl.now();

    const renderFrame = (interpolationFraction: number) => {
      // Split the tiles array into chunks the size of the texture capacity. If we need to render more
      // tiles than will fit in the texture, we have to render in batches.
      const chunks = chunk(tilesWithCanvasCoordinates, textureManager.tileCapacity);

      // Clear the canvas.
      regl.clear({ color: CLEAR_COLOR });

      // Render chunk by chunk.
      for (const chunk of chunks) {
        // Add tiles.
        const oldTextureBounds = chunk.map(
          ({ coords, oldPixelData }) => textureManager.addTile(coords, oldPixelData),
        );
        const newTextureBounds = chunk.map(
          ({ coords, newPixelData }) => newTextureManager.addTile(coords, newPixelData),
        );

        // Render each tile.
        this.drawTileInterpolateColor(chunk.map(({ canvasCoords }, index) => ({
          colorScaleA,
          colorScaleB,
          sentinelValuesA,
          sentinelValuesB,
          canvasSize,
          canvasCoordinates: canvasCoords,
          textureA: textureManager.texture,
          textureB: newTextureManager.texture,
          textureBoundsA: oldTextureBounds[index],
          textureBoundsB: newTextureBounds[index],
          interpolationFraction,
        })));
      }

      // Invoke the callback with the canvas coordinates of the rendered tiles.
      onFrameRendered(canvasCoordinates);
    };

    const animationHandle = regl.frame(({ time }) => {
      const elapsedTimeMs = (time - transitionStart) * 1000;
      const interpolationFraction = elapsedTimeMs / transitionDurationMs;
      renderFrame(interpolationFraction);
    });

    await util.Timer(transitionDurationMs);
    animationHandle.cancel();

    // Render again, in case previous frames didn't make it all the way to interpolationFraction 1.0.
    renderFrame(1);

    // Clean up the old TextureManager and replace it with the new one.
    this.textureManager.destroy();
    this.textureManager = newTextureManager;
  }

  removeTile(tileCoordinates: TileCoordinates): void {
    this.textureManager.removeTile(tileCoordinates);
  }

  protected setCanvasSize(width: number, height: number): void {
    Object.assign(this.canvas, { width, height });
  }

  protected computeRequiredCanvasDimensions(numTiles: number): Pair<number> {
    const { tileSize } = this;
    const tilesAcross = Math.ceil(Math.sqrt(numTiles));
    const tilesDown = Math.ceil(numTiles / tilesAcross);
    return [tilesAcross * tileSize, tilesDown * tileSize];
  }

  protected getCanvasCoordinates(canvasWidth: number, canvasHeight: number, numTiles: number): Array<Pair<number>> {
    const { tileSize } = this;
    return flatMap(util.range(0, canvasHeight, tileSize), y =>
      util.range(0, canvasWidth, tileSize).map(x => [x, y] as Pair<number>),
    ).slice(0, numTiles);
  }
}
