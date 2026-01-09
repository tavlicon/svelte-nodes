// Node rendering shader with SDF rounded rectangles

struct CameraUniform {
    viewProj: mat4x4f,
    viewport: vec4f, // width, height, zoom, unused
}

struct NodeInstance {
    position: vec2f,
    size: vec2f,
    color: vec4f,
    borderRadius: f32,
    selected: f32,
    status: f32,
    _pad: f32,
}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) localPos: vec2f,
    @location(1) nodeSize: vec2f,
    @location(2) color: vec4f,
    @location(3) borderRadius: f32,
    @location(4) selected: f32,
    @location(5) status: f32,
}

@group(0) @binding(0) var<uniform> camera: CameraUniform;
@group(0) @binding(1) var<storage, read> nodes: array<NodeInstance>;

@vertex
fn vs_main(
    @location(0) quadPos: vec2f,
    @builtin(instance_index) instanceIdx: u32
) -> VertexOutput {
    let node = nodes[instanceIdx];
    
    // Transform quad to node position and size
    let worldPos = node.position + quadPos * node.size;
    let clipPos = camera.viewProj * vec4f(worldPos, 0.0, 1.0);
    
    var out: VertexOutput;
    out.position = clipPos;
    out.localPos = quadPos * node.size; // Position within node (0 to size)
    out.nodeSize = node.size;
    out.color = node.color;
    out.borderRadius = node.borderRadius;
    out.selected = node.selected;
    out.status = node.status;
    
    return out;
}

// Signed distance function for rounded rectangle
fn sdRoundedBox(p: vec2f, b: vec2f, r: f32) -> f32 {
    let q = abs(p) - b + vec2f(r);
    return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    // Center the coordinate system
    let center = in.nodeSize * 0.5;
    let p = in.localPos - center;
    
    // Calculate SDF
    let d = sdRoundedBox(p, center - vec2f(1.0), in.borderRadius);
    
    // Anti-aliased edge
    let aa = fwidth(d) * 1.5;
    let alpha = 1.0 - smoothstep(-aa, aa, d);
    
    // Base color with darkening towards the bottom
    let gradient = 1.0 - in.localPos.y / in.nodeSize.y * 0.15;
    var baseColor = in.color.rgb * gradient;
    
    // Selection glow (white)
    if (in.selected > 0.5) {
        let glowDist = -d;
        let glow = exp(-glowDist * 0.03) * 0.3;
        baseColor = mix(baseColor, vec3f(1.0, 1.0, 1.0), glow);
    }
    
    // Status indicator (top-right corner glow)
    let statusCorner = in.localPos - vec2f(in.nodeSize.x - 12.0, 12.0);
    let statusDist = length(statusCorner);
    
    if (statusDist < 6.0 && in.status > 0.5) {
        var statusColor = vec3f(0.5, 0.5, 0.5); // idle
        
        if (in.status > 0.5 && in.status < 1.5) {
            statusColor = vec3f(0.96, 0.62, 0.04); // pending - yellow
        } else if (in.status > 1.5 && in.status < 2.5) {
            statusColor = vec3f(0.39, 0.4, 0.95); // running - blue
        } else if (in.status > 2.5 && in.status < 3.5) {
            statusColor = vec3f(0.06, 0.73, 0.51); // complete - green
        } else if (in.status > 3.5) {
            statusColor = vec3f(0.94, 0.27, 0.27); // error - red
        }
        
        let statusAlpha = 1.0 - smoothstep(4.0, 6.0, statusDist);
        baseColor = mix(baseColor, statusColor, statusAlpha);
    }
    
    // Border
    var borderWidth = 1.5;
    if (in.selected > 0.5) {
        borderWidth = 2.5;
    }
    let borderDist = abs(d) - borderWidth * 0.5;
    let borderAlpha = 1.0 - smoothstep(-aa, aa, borderDist);
    
    var borderColor = vec3f(1.0, 1.0, 1.0) * 0.15;
    if (in.selected > 0.5) {
        borderColor = vec3f(1.0, 1.0, 1.0); // White border for selected
    }
    
    let finalColor = mix(baseColor, borderColor, borderAlpha * 0.9);
    
    return vec4f(finalColor, alpha * in.color.a);
}
