/**
 * Tests for graph type utilities
 * 
 * These are pure functions with no side effects - ideal for unit testing.
 */

import { describe, it, expect } from 'vitest';
import { arePortsCompatible, generateId } from '../types';

describe('arePortsCompatible', () => {
  describe('exact type matching', () => {
    it('returns true when types match exactly', () => {
      expect(arePortsCompatible('image', 'image')).toBe(true);
      expect(arePortsCompatible('string', 'string')).toBe(true);
      expect(arePortsCompatible('number', 'number')).toBe(true);
      expect(arePortsCompatible('tensor', 'tensor')).toBe(true);
    });

    it('returns false when types differ', () => {
      expect(arePortsCompatible('image', 'string')).toBe(false);
      expect(arePortsCompatible('string', 'image')).toBe(false);
      expect(arePortsCompatible('number', 'tensor')).toBe(false);
      expect(arePortsCompatible('tensor', 'number')).toBe(false);
    });
  });

  describe('any type compatibility', () => {
    it('returns true when input type is "any"', () => {
      expect(arePortsCompatible('image', 'any')).toBe(true);
      expect(arePortsCompatible('string', 'any')).toBe(true);
      expect(arePortsCompatible('number', 'any')).toBe(true);
      expect(arePortsCompatible('tensor', 'any')).toBe(true);
    });

    it('returns true when output type is "any"', () => {
      expect(arePortsCompatible('any', 'image')).toBe(true);
      expect(arePortsCompatible('any', 'string')).toBe(true);
      expect(arePortsCompatible('any', 'number')).toBe(true);
      expect(arePortsCompatible('any', 'tensor')).toBe(true);
    });

    it('returns true when both types are "any"', () => {
      expect(arePortsCompatible('any', 'any')).toBe(true);
    });
  });
});

describe('generateId', () => {
  it('generates non-empty strings', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('generates unique IDs across many calls', () => {
    const ids = new Set<string>();
    const count = 1000;
    
    for (let i = 0; i < count; i++) {
      ids.add(generateId());
    }
    
    // All IDs should be unique
    expect(ids.size).toBe(count);
  });

  it('generates IDs in expected format (timestamp-random)', () => {
    const id = generateId();
    
    // Format should be: base36timestamp-base36random
    // e.g., "m1abc123-xyz789a"
    expect(id).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });

  it('generates IDs quickly (performance check)', () => {
    const start = performance.now();
    const count = 10000;
    
    for (let i = 0; i < count; i++) {
      generateId();
    }
    
    const elapsed = performance.now() - start;
    
    // Should generate 10,000 IDs in under 100ms
    expect(elapsed).toBeLessThan(100);
  });
});
