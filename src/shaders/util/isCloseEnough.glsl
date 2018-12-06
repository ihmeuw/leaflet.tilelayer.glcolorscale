const float RELATIVE_TOLERANCE = 0.0001;

bool isCloseEnough(float a, float b) {
  return abs(a - b) < abs(a * RELATIVE_TOLERANCE);
}

#pragma glslify: export(isCloseEnough)
