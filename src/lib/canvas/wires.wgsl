// Wire/connection rendering shader with bezier curves

struct CameraUniform {
    viewProj: mat4x4f,
    viewport: vec4f,
}

struct WireInstance {
    p0: vec2f, // Start point
    p1: vec2f, // Control point 1
    p2: vec2f, // Control point 2
    p3: vec2f, // End point
    color: vec4f,
}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) localPos: vec2f,
    @location(1) @interpolate(flat) wireIdx: u32,
}

@group(0) @binding(0) var<uniform> camera: CameraUniform;
@group(0) @binding(1) var<storage, read> wires: array<WireInstance>;

// Cubic bezier evaluation
fn bezier(t: f32, p0: vec2f, p1: vec2f, p2: vec2f, p3: vec2f) -> vec2f {
    let t2 = t * t;
    let t3 = t2 * t;
    let mt = 1.0 - t;
    let mt2 = mt * mt;
    let mt3 = mt2 * mt;
    
    return p0 * mt3 + p1 * 3.0 * mt2 * t + p2 * 3.0 * mt * t2 + p3 * t3;
}

// Bezier derivative for tangent
fn bezierDerivative(t: f32, p0: vec2f, p1: vec2f, p2: vec2f, p3: vec2f) -> vec2f {
    let t2 = t * t;
    let mt = 1.0 - t;
    let mt2 = mt * mt;
    
    return (p1 - p0) * 3.0 * mt2 + (p2 - p1) * 6.0 * mt * t + (p3 - p2) * 3.0 * t2;
}

@vertex
fn vs_main(
    @location(0) quadPos: vec2f,
    @builtin(instance_index) instanceIdx: u32
) -> VertexOutput {
    let wire = wires[instanceIdx];
    
    // Calculate bounding box for the bezier curve
    let minX = min(min(wire.p0.x, wire.p1.x), min(wire.p2.x, wire.p3.x));
    let maxX = max(max(wire.p0.x, wire.p1.x), max(wire.p2.x, wire.p3.x));
    let minY = min(min(wire.p0.y, wire.p1.y), min(wire.p2.y, wire.p3.y));
    let maxY = max(max(wire.p0.y, wire.p1.y), max(wire.p2.y, wire.p3.y));
    
    // Add padding for anti-aliasing
    let padding = 8.0;
    let boundsMin = vec2f(minX - padding, minY - padding);
    let boundsMax = vec2f(maxX + padding, maxY + padding);
    let boundsSize = boundsMax - boundsMin;
    
    // Transform quad to bounding box
    let worldPos = boundsMin + quadPos * boundsSize;
    let clipPos = camera.viewProj * vec4f(worldPos, 0.0, 1.0);
    
    var out: VertexOutput;
    out.position = clipPos;
    out.localPos = worldPos;
    out.wireIdx = instanceIdx;
    
    return out;
}

// Distance from point to line segment
fn distToSegment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
    let ab = b - a;
    let ap = p - a;
    let t = clamp(dot(ap, ab) / max(dot(ab, ab), 0.0001), 0.0, 1.0);
    return length(p - (a + t * ab));
}

// Distance from point to cubic bezier curve (approximate using line segments)
fn distToBezier(p: vec2f, p0: vec2f, p1: vec2f, p2: vec2f, p3: vec2f) -> f32 {
    var minDist = 1e10;
    
    // Sample the curve and check distance to line segments between samples
    let samples = 48;
    var prevPoint = p0;
    
    for (var i = 1; i <= samples; i++) {
        let t = f32(i) / f32(samples);
        let curvePoint = bezier(t, p0, p1, p2, p3);
        
        // Distance to segment between previous and current point
        let segDist = distToSegment(p, prevPoint, curvePoint);
        minDist = min(minDist, segDist);
        
        prevPoint = curvePoint;
    }
    
    return minDist;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    let wire = wires[in.wireIdx];
    
    // Calculate distance to bezier curve
    let dist = distToBezier(in.localPos, wire.p0, wire.p1, wire.p2, wire.p3);
    
    // Wire thickness - slightly thicker for better visibility
    let thickness = 3.0;
    
    // Anti-aliased edge with softer transition
    let aa = 2.0;
    let alpha = 1.0 - smoothstep(thickness - aa, thickness + aa, dist);
    
    if (alpha < 0.01) {
        discard;
    }
    
    // Subtle glow effect
    let glowAlpha = exp(-dist * 0.1) * 0.2;
    let totalAlpha = max(alpha, glowAlpha);
    
    // Color with glow
    var color = wire.color.rgb;
    if (alpha < 0.5) {
        color = color * 0.6; // Slightly brighter glow
    }
    
    return vec4f(color, totalAlpha * wire.color.a);
}
