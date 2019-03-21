import REGL from 'regl';

import { WebGLColorStop } from './types';

export const SCALE_MAX_LENGTH = 16;
export const SENTINEL_MAX_LENGTH = 16;
export const CLEAR_COLOR: REGL.Vec4 = [0, 0, 0, 0];
export const DEFAULT_COLOR_STOP: WebGLColorStop = {
  color: CLEAR_COLOR,
  offset: 0,
};
