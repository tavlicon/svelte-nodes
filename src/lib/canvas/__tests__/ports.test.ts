/**
 * Tests for port position calculations and hit testing
 * 
 * These tests verify the geometry calculations used for:
 * - Port positioning on nodes
 * - Hit testing for mouse interactions
 * - Bezier curve control points for connections
 */

import { describe, it, expect } from 'vitest';
import { 
  getPortPositions, 
  getPortPosition, 
  hitTestPort,
  findNearestPort,
  getBezierControlPoints,
  PORT_HANDLE_RADIUS,
  PORT_HIT_RADIUS,
} from '../ports';
import type { NodeInstance } from '../../graph/types';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a test node with sensible defaults
 */
function createTestNode(overrides: Partial<NodeInstance> = {}): NodeInstance {
  return {
    id: 'test-node-1',
    type: 'image', // Has 0 inputs, 1 output (image)
    x: 100,
    y: 100,
    width: 200,
    height: 200,
    params: {},
    status: 'idle',
    ...overrides,
  };
}

/**
 * Calculate distance between two points
 */
function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

// =============================================================================
// getPortPositions Tests
// =============================================================================

describe('getPortPositions', () => {
  it('returns empty array for unknown node type', () => {
    const node = createTestNode({ type: 'nonexistent-type' });
    const positions = getPortPositions(node);
    
    expect(positions).toEqual([]);
  });

  it('returns correct position for image node (1 output)', () => {
    const node = createTestNode({ 
      type: 'image', 
      x: 100, 
      y: 100, 
      width: 200, 
      height: 200 
    });
    const positions = getPortPositions(node);
    
    // Image node has 1 output port
    expect(positions).toHaveLength(1);
    
    const output = positions[0];
    expect(output.nodeId).toBe('test-node-1');
    expect(output.portId).toBe('image');
    expect(output.isOutput).toBe(true);
    expect(output.type).toBe('image');
    
    // Output should be on right edge, vertically centered
    expect(output.x).toBe(300); // x + width
    expect(output.y).toBe(200); // y + height/2 (centered for single port)
  });

  it('returns correct positions for model node (1 input, 1 output)', () => {
    const node = createTestNode({ 
      id: 'model-node',
      type: 'model', 
      x: 0, 
      y: 0, 
      width: 200, 
      height: 300 
    });
    const positions = getPortPositions(node);
    
    const inputs = positions.filter(p => !p.isOutput);
    const outputs = positions.filter(p => p.isOutput);
    
    expect(inputs).toHaveLength(1);
    expect(outputs).toHaveLength(1);
    
    // Input on left edge
    expect(inputs[0].x).toBe(0);
    expect(inputs[0].y).toBe(150); // Centered
    
    // Output on right edge
    expect(outputs[0].x).toBe(200);
    expect(outputs[0].y).toBe(150); // Centered
  });

  it('distributes multiple ports evenly', () => {
    // Output node has 1 input and 1 output, both named 'image'
    const node = createTestNode({ 
      type: 'output', 
      x: 0, 
      y: 0, 
      width: 200, 
      height: 300 
    });
    const positions = getPortPositions(node);
    
    // Output node has both input and output
    expect(positions.length).toBeGreaterThanOrEqual(1);
    
    // All ports should be within node bounds (vertically)
    for (const port of positions) {
      expect(port.y).toBeGreaterThanOrEqual(0);
      expect(port.y).toBeLessThanOrEqual(300);
    }
  });
});

// =============================================================================
// getPortPosition Tests
// =============================================================================

describe('getPortPosition', () => {
  it('returns position for existing output port', () => {
    const node = createTestNode({ type: 'image' });
    const pos = getPortPosition(node, 'image', true);
    
    expect(pos).not.toBeNull();
    expect(pos?.x).toBe(300); // Right edge
    expect(pos?.y).toBe(200); // Centered
  });

  it('returns null for non-existent port', () => {
    const node = createTestNode({ type: 'image' });
    
    expect(getPortPosition(node, 'nonexistent', true)).toBeNull();
    expect(getPortPosition(node, 'nonexistent', false)).toBeNull();
  });

  it('distinguishes between input and output with same portId', () => {
    // Output node has both input and output named 'image'
    const node = createTestNode({ type: 'output', width: 200 });
    
    const inputPos = getPortPosition(node, 'image', false);
    const outputPos = getPortPosition(node, 'image', true);
    
    expect(inputPos).not.toBeNull();
    expect(outputPos).not.toBeNull();
    
    // Input should be on left (x = node.x = 100)
    expect(inputPos?.x).toBe(100);
    
    // Output should be on right (x = node.x + width = 300)
    expect(outputPos?.x).toBe(300);
  });

  it('returns null for unknown node type', () => {
    const node = createTestNode({ type: 'unknown' });
    
    expect(getPortPosition(node, 'anything', true)).toBeNull();
    expect(getPortPosition(node, 'anything', false)).toBeNull();
  });
});

// =============================================================================
// hitTestPort Tests
// =============================================================================

describe('hitTestPort', () => {
  it('detects hit on port center', () => {
    const node = createTestNode({ type: 'image', x: 100, y: 100, width: 200, height: 200 });
    // Port is at (300, 200)
    
    const hit = hitTestPort(300, 200, node);
    
    expect(hit).not.toBeNull();
    expect(hit?.portId).toBe('image');
    expect(hit?.isOutput).toBe(true);
  });

  it('detects hit within default radius', () => {
    const node = createTestNode({ type: 'image', x: 100, y: 100, width: 200, height: 200 });
    // Port is at (300, 200), default hit radius is 12
    
    // 10px away - should hit
    expect(hitTestPort(310, 200, node)).not.toBeNull();
    expect(hitTestPort(300, 210, node)).not.toBeNull();
    expect(hitTestPort(290, 200, node)).not.toBeNull();
    expect(hitTestPort(300, 190, node)).not.toBeNull();
  });

  it('returns null outside hit radius', () => {
    const node = createTestNode({ type: 'image', x: 100, y: 100, width: 200, height: 200 });
    // Port is at (300, 200)
    
    // 20px away - should miss (default radius is 12)
    expect(hitTestPort(320, 200, node)).toBeNull();
    expect(hitTestPort(300, 220, node)).toBeNull();
    expect(hitTestPort(280, 200, node)).toBeNull();
  });

  it('respects custom hit radius', () => {
    const node = createTestNode({ type: 'image', x: 100, y: 100, width: 200, height: 200 });
    
    // 15px away
    const x = 315;
    const y = 200;
    
    // With default radius (12) - miss
    expect(hitTestPort(x, y, node, 12)).toBeNull();
    
    // With larger radius (20) - hit
    expect(hitTestPort(x, y, node, 20)).not.toBeNull();
  });

  it('returns null for node with no ports', () => {
    const node = createTestNode({ type: 'unknown-type' });
    
    // Click anywhere
    expect(hitTestPort(100, 100, node)).toBeNull();
    expect(hitTestPort(200, 200, node)).toBeNull();
  });
});

// =============================================================================
// findNearestPort Tests
// =============================================================================

describe('findNearestPort', () => {
  it('finds nearest output port', () => {
    const nodes = new Map<string, NodeInstance>();
    
    const node1 = createTestNode({ id: 'node1', type: 'image', x: 0, y: 0 });
    const node2 = createTestNode({ id: 'node2', type: 'image', x: 400, y: 0 });
    
    nodes.set('node1', node1);
    nodes.set('node2', node2);
    
    // Search near node1's output (at x=200)
    const nearest = findNearestPort(210, 100, nodes, true);
    
    expect(nearest).not.toBeNull();
    expect(nearest?.nodeId).toBe('node1');
  });

  it('finds nearest input port', () => {
    const nodes = new Map<string, NodeInstance>();
    
    const node = createTestNode({ id: 'model1', type: 'model', x: 100, y: 100 });
    nodes.set('model1', node);
    
    // Search near node's input (at x=100)
    const nearest = findNearestPort(90, 200, nodes, false);
    
    expect(nearest).not.toBeNull();
    expect(nearest?.nodeId).toBe('model1');
    expect(nearest?.isOutput).toBe(false);
  });

  it('returns null when no port within max distance', () => {
    const nodes = new Map<string, NodeInstance>();
    
    const node = createTestNode({ id: 'node1', type: 'image', x: 0, y: 0 });
    nodes.set('node1', node);
    
    // Search far from any port
    const nearest = findNearestPort(1000, 1000, nodes, true, undefined, 30);
    
    expect(nearest).toBeNull();
  });

  it('excludes specified node', () => {
    const nodes = new Map<string, NodeInstance>();
    
    const node1 = createTestNode({ id: 'node1', type: 'image', x: 0, y: 0 });
    const node2 = createTestNode({ id: 'node2', type: 'image', x: 400, y: 0 });
    
    nodes.set('node1', node1);
    nodes.set('node2', node2);
    
    // Search near node1 but exclude it
    const nearest = findNearestPort(200, 100, nodes, true, 'node1', 1000);
    
    // Should find node2 even though node1 is closer
    expect(nearest?.nodeId).toBe('node2');
  });
});

// =============================================================================
// getBezierControlPoints Tests
// =============================================================================

describe('getBezierControlPoints', () => {
  it('returns horizontal control points for horizontal connection', () => {
    const { cp1x, cp1y, cp2x, cp2y } = getBezierControlPoints(0, 100, 200, 100);
    
    // Control points should be at same Y as endpoints (horizontal curve)
    expect(cp1y).toBe(100);
    expect(cp2y).toBe(100);
    
    // First control point should be to the right of start
    expect(cp1x).toBeGreaterThan(0);
    
    // Second control point should be to the left of end
    expect(cp2x).toBeLessThan(200);
  });

  it('handles vertical offset correctly', () => {
    const { cp1x, cp1y, cp2x, cp2y } = getBezierControlPoints(0, 0, 200, 200);
    
    // Control points maintain horizontal exit/entry
    expect(cp1y).toBe(0);   // Same Y as start
    expect(cp2y).toBe(200); // Same Y as end
  });

  it('handles backwards connections (right to left)', () => {
    const { cp1x, cp1y, cp2x, cp2y } = getBezierControlPoints(200, 100, 0, 100);
    
    // Should still produce valid curve
    expect(cp1y).toBe(100);
    expect(cp2y).toBe(100);
    
    // First control point still extends in +X direction from start
    expect(cp1x).toBeGreaterThan(200);
  });

  it('clamps offset for very short connections', () => {
    const short = getBezierControlPoints(0, 0, 20, 0);
    
    // Offset should be at least 50 (the minimum)
    expect(short.cp1x).toBeGreaterThanOrEqual(50);
  });

  it('clamps offset for very long connections', () => {
    const long = getBezierControlPoints(0, 0, 1000, 0);
    
    // Offset should be at most 150 (the maximum)
    // cp1x should be start + offset = 0 + 150 = 150
    expect(long.cp1x).toBeLessThanOrEqual(150);
  });
});

// =============================================================================
// Constants Tests
// =============================================================================

describe('port constants', () => {
  it('exports reasonable PORT_HANDLE_RADIUS', () => {
    expect(PORT_HANDLE_RADIUS).toBeGreaterThan(0);
    expect(PORT_HANDLE_RADIUS).toBeLessThan(20);
  });

  it('exports PORT_HIT_RADIUS larger than PORT_HANDLE_RADIUS', () => {
    // Hit radius should be >= handle radius for good UX
    expect(PORT_HIT_RADIUS).toBeGreaterThanOrEqual(PORT_HANDLE_RADIUS);
  });
});
