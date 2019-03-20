import REGL from 'regl';

export interface Color {
  color: string;
  offset: number;
  label?: string;
}

export interface SentinelValue extends Color {
  label: string;
}

export interface Dictionary<T> {
  [index: string]: T;
}

export type Pair<T> = [T, T];

export interface TileCoordinates {
  x: number;
  y: number;
  z: number;
}

export interface TextureCoordinates {
  x: number;
  y: number;
}

// [topLeft, bottomRight]
export type TextureBounds = [TextureCoordinates, TextureCoordinates];

export interface WebGLColorStop {
  color: REGL.Vec4;
  offset: number;
}

export interface TileElement extends HTMLCanvasElement {
  pixelData?: Uint8Array;
}

export interface TileEvent {
  tile: HTMLImageElement;
  coords: TileCoordinates;
}

// the data structure represented by Leaflet.GridLayer's `_tiles` property
export interface TileCache {
  [key: string]: GridLayerTile;
}

// data structure used by the tile layer for preloading tiles
export interface PreloadTileCache {
  url: string;
  tiles: TileDatum[];
}

export interface GridLayerTile {
  active?: boolean;
  current: boolean;
  loaded?: Date;
  retain?: boolean;
  coords: TileCoordinates;
  el: TileElement;
}

export interface TileDatum {
  coords: TileCoordinates;
  pixelData: Uint8Array;
}

export namespace DrawCommon {
  export interface Props {
    canvasSize: Pair<number>;
    canvasCoordinates: REGL.Vec2;
  }
  export interface Uniforms {
    nodataValue: number;
    littleEndian: boolean;
    transformMatrix: REGL.Mat4;
  }
  export interface Attributes {
    position: REGL.Vec2[];
  }
}

export namespace DrawTile {
  export interface Props extends DrawCommon.Props {
    colorScale: WebGLColorStop[];
    sentinelValues: WebGLColorStop[];
    texture: REGL.Texture2D;
    textureBounds: TextureBounds;
  }
  export interface Uniforms extends DrawCommon.Uniforms {
    // ...colorScale struct array properties
    colorScaleLength: number;
    sentinelValuesLength: number;
    texture: REGL.Texture2D;
  }
  export interface Attributes extends DrawCommon.Attributes {
    texCoord: REGL.Vec2[];
  }
}

export namespace DrawTileInterpolateValue {
  export interface Props extends DrawCommon.Props {
    colorScale: WebGLColorStop[];
    sentinelValues: WebGLColorStop[];
    textureA: REGL.Texture2D;
    textureB: REGL.Texture2D;
    textureBoundsA: TextureBounds;
    textureBoundsB: TextureBounds;
    interpolationFraction: number;
  }
  export interface Uniforms extends DrawCommon.Uniforms {
    // ...colorScale struct array properties
    colorScaleLength: number;
    sentinelValuesLength: number;
    textureA: REGL.Texture2D;
    textureB: REGL.Texture2D;
    interpolationFraction: number;
  }
  export interface Attributes extends DrawCommon.Attributes {
    texCoordA: REGL.Vec2[];
    texCoordB: REGL.Vec2[];
  }
}

export namespace DrawTileInterpolateColor {
  export interface Props extends DrawCommon.Props {
    colorScaleA: WebGLColorStop[];
    colorScaleB: WebGLColorStop[];
    sentinelValuesA: WebGLColorStop[];
    sentinelValuesB: WebGLColorStop[];
    textureA: REGL.Texture2D;
    textureB: REGL.Texture2D;
    textureBoundsA: TextureBounds;
    textureBoundsB: TextureBounds;
    interpolationFraction: number;
  }
  export interface Uniforms extends DrawCommon.Uniforms {
    // colorScale properties
    colorScaleLengthA: number;
    colorScaleLengthB: number;
    sentinelValuesLengthA: number;
    sentinelValuesLengthB: number;
    textureA: REGL.Texture2D;
    textureB: REGL.Texture2D;
    interpolationFraction: number;
  }
  export interface Attributes extends DrawCommon.Attributes {
    texCoordA: REGL.Vec2[];
    texCoordB: REGL.Vec2[];
  }
}
