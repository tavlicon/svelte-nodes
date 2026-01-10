/**
 * Dot Grid Shader
 * Renders an infinite dot grid that scales with zoom
 */

struct CameraUniform {
  viewProj: mat4x4f,
  viewport: vec4f, // width, height, zoom, padding
}

struct GridConfig {
  dotColor: vec4f, // rgba color for dots
}

@group(0) @binding(0) var<uniform> camera: CameraUniform;
@group(0) @binding(1) var<uniform> gridConfig: GridConfig;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs_main(@location(0) pos: vec2f) -> VertexOutput {
  var out: VertexOutput;
  // Full screen quad: map [0,1] to [-1,1]
  out.position = vec4f(pos.x * 2.0 - 1.0, 1.0 - pos.y * 2.0, 0.0, 1.0);
  out.uv = pos;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  let zoom = camera.viewport.z;
  let viewport = camera.viewport.xy;
  
  // Extract camera from the view-projection matrix
  // Matrix structure (column-major):
  //   [scaleX,      0,    0, 0]
  //   [0,      -scaleY,   0, 0]  
  //   [0,           0,    1, 0]
  //   [translateX, translateY, 0, 1]
  // Where: translateX = camera.x * scaleX - 1, translateY = -camera.y * scaleY + 1
  let scaleX = camera.viewProj[0][0];
  let scaleY = -camera.viewProj[1][1]; // Negate to get positive scale
  let translateX = camera.viewProj[3][0];
  let translateY = camera.viewProj[3][1];
  
  // Recover camera position: camera.x = (translateX + 1) / scaleX
  let cameraX = (translateX + 1.0) / scaleX;
  let cameraY = -(translateY - 1.0) / scaleY;
  
  // Convert screen UV (0-1) to world coordinates (top-left anchored)
  // effectiveZoom = scaleX * viewport.x / 2 = zoom * dpr
  let effectiveZoom = scaleX * viewport.x * 0.5;
  let screenPos = in.uv * viewport; // Screen position in device pixels
  let worldPos = screenPos / effectiveZoom - vec2f(cameraX, cameraY);
  
  // Grid spacing - adjusts based on zoom level
  let baseSpacing = 40.0;
  var spacing = baseSpacing;
  
  // Adjust grid density based on zoom
  if (zoom < 0.3) {
    spacing = baseSpacing * 4.0;
  } else if (zoom < 0.6) {
    spacing = baseSpacing * 2.0;
  } else if (zoom > 2.0) {
    spacing = baseSpacing * 0.5;
  }
  
  // Calculate distance to nearest grid point
  let gridPos = worldPos / spacing;
  let nearest = round(gridPos) * spacing;
  let dist = length(worldPos - nearest);
  
  // Dot size (in world units, scales with zoom)
  let dotRadius = 1.5;
  let smoothness = 0.5;
  
  // Anti-aliased dot
  let alpha = 1.0 - smoothstep(dotRadius - smoothness, dotRadius + smoothness, dist * zoom);
  
  // Dot color from theme
  let dotColor = gridConfig.dotColor.rgb;
  let baseAlpha = gridConfig.dotColor.a;
  
  // Fade dots at extreme zoom levels for cleaner look
  var fadeAlpha = 1.0;
  if (zoom < 0.2) {
    fadeAlpha = smoothstep(0.1, 0.2, zoom);
  }
  
  return vec4f(dotColor, alpha * baseAlpha * fadeAlpha);
}
