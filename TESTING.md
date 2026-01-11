# Testing Guide

This document explains the testing infrastructure for Generative Design Studio, how tests fit into the development process, and how to run them.

## Table of Contents

- [Quick Start](#quick-start)
- [Testing Philosophy](#testing-philosophy)
- [Test Structure](#test-structure)
- [Running Tests](#running-tests)
- [Writing Tests](#writing-tests)
- [Test Categories](#test-categories)
- [Mocking Strategies](#mocking-strategies)
- [CI/CD Integration](#cicd-integration)
- [Coverage](#coverage)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

```bash
# Install dependencies (if not already done)
npm install

# Run tests in watch mode (recommended during development)
npm test

# Run tests once (for CI)
npm run test:run

# Run with coverage report
npm run test:coverage

# Run with visual UI
npm run test:ui
```

---

## Testing Philosophy

### Why We Test

1. **Confidence** — Tests verify that code works as expected
2. **Regression Prevention** — Tests catch bugs when code changes
3. **Documentation** — Tests show how code is meant to be used
4. **Design Feedback** — Hard-to-test code often indicates design issues

### What We Test

| Priority | What | Why |
|----------|------|-----|
| 🔴 High | Pure functions (types, geometry) | Easy to test, high value |
| 🔴 High | State management (store) | Core functionality |
| 🔴 High | Execution engine | Critical path |
| 🟡 Medium | API clients | Integration points |
| 🟢 Low | UI components | Expensive to test, covered by E2E |

### What We Don't Test

- **External libraries** — Trust that Yjs, Svelte, etc. work
- **Trivial code** — Simple getters/setters without logic
- **Framework behavior** — Browser APIs, WebGPU internals

---

## Test Structure

Tests are co-located with source code in `__tests__` directories:

```
src/lib/
├── graph/
│   ├── __tests__/
│   │   ├── types.test.ts      # Pure function tests
│   │   └── store.test.ts      # State management tests
│   ├── types.ts
│   └── store.svelte.ts
├── canvas/
│   ├── __tests__/
│   │   └── ports.test.ts      # Geometry calculation tests
│   └── ports.ts
├── orchestration/
│   ├── __tests__/
│   │   └── execution.test.ts  # DAG execution tests
│   └── execution.ts
└── inference/
    ├── __tests__/
    │   └── api-client.test.ts # API client tests
    └── api-client.ts
```

### Why Co-location?

- **Discoverability** — Tests are next to the code they test
- **Maintenance** — Move a file, tests move with it
- **Ownership** — Clear which tests belong to which module

---

## Running Tests

### Commands

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `npm test` | Watch mode | During development |
| `npm run test:run` | Single run | CI/CD, pre-commit |
| `npm run test:coverage` | With coverage | Periodic check |
| `npm run test:ui` | Visual UI | Debugging, exploration |

### Filtering Tests

```bash
# Run specific test file
npm test -- src/lib/graph/__tests__/types.test.ts

# Run tests matching pattern
npm test -- -t "arePortsCompatible"

# Run tests in specific directory
npm test -- src/lib/graph/
```

### Watch Mode Features

In watch mode, press:
- `a` — Run all tests
- `f` — Run only failed tests
- `p` — Filter by filename
- `t` — Filter by test name
- `q` — Quit

---

## Writing Tests

### Basic Test Structure

```typescript
import { describe, it, expect } from 'vitest';

describe('functionName', () => {
  it('does something specific', () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = functionName(input);
    
    // Assert
    expect(result).toBe('expected');
  });
});
```

### Testing Async Code

```typescript
it('handles async operations', async () => {
  const result = await asyncFunction();
  expect(result).toBeDefined();
});
```

### Testing Errors

```typescript
it('throws error for invalid input', () => {
  expect(() => riskyFunction(null)).toThrow('Invalid input');
});

// For async errors
it('rejects with error', async () => {
  await expect(asyncRiskyFunction()).rejects.toThrow('Failed');
});
```

### Test Isolation

Each test should be independent. Use `beforeEach` to reset state:

```typescript
describe('graphStore', () => {
  beforeEach(async () => {
    vi.resetModules(); // Reset module cache
  });
  
  it('test 1', async () => {
    const { graphStore } = await import('../store.svelte');
    // Fresh store for each test
  });
});
```

---

## Test Categories

### 1. Unit Tests

Test individual functions in isolation.

```typescript
// src/lib/graph/__tests__/types.test.ts
describe('arePortsCompatible', () => {
  it('returns true for matching types', () => {
    expect(arePortsCompatible('image', 'image')).toBe(true);
  });
});
```

### 2. Integration Tests

Test how modules work together.

```typescript
// src/lib/orchestration/__tests__/execution.test.ts
describe('ExecutionEngine', () => {
  it('executes connected nodes in order', async () => {
    const { graphStore } = await import('../../graph/store.svelte');
    const { executionEngine } = await import('../execution');
    
    // Create nodes and edges
    const imageId = graphStore.addNode('image', 0, 0, { imageUrl: '/test.png' });
    const modelId = graphStore.addNode('model', 200, 0, { positive_prompt: 'test' });
    graphStore.addEdge(imageId, 'image', modelId, 'image');
    
    // Execute and verify
    const result = await executionEngine.execute();
    expect(result.success).toBe(true);
  });
});
```

### 3. Component Tests (Future)

Test Svelte components with `@testing-library/svelte`:

```typescript
import { render, screen } from '@testing-library/svelte';
import Button from './Button.svelte';

it('renders button text', () => {
  render(Button, { props: { label: 'Click me' } });
  expect(screen.getByText('Click me')).toBeInTheDocument();
});
```

---

## Mocking Strategies

### Module Mocks

Mock entire modules with `vi.mock()`:

```typescript
// Mock before importing the module that uses it
vi.mock('../../inference/manager', () => ({
  inferenceManager: {
    runImg2Img: vi.fn().mockResolvedValue({
      imageUrl: 'data:image/png;base64,test',
      timeTaken: 1000,
    }),
  },
}));
```

### Function Spies

Spy on existing functions:

```typescript
const spy = vi.spyOn(graphStore, 'updateNode');
await executionEngine.execute();
expect(spy).toHaveBeenCalledWith(nodeId, expect.objectContaining({ status: 'running' }));
```

### Fetch Mocking

Global fetch is mocked in `setup.ts`. Override per test:

```typescript
const mockFetch = vi.mocked(global.fetch);

it('handles API response', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ data: 'test' }),
  } as Response);
  
  const result = await apiCall();
  expect(result.data).toBe('test');
});
```

### Timer Mocking

For code using `setTimeout` or `setInterval`:

```typescript
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it('calls callback after delay', () => {
  const callback = vi.fn();
  delayedFunction(callback, 1000);
  
  vi.advanceTimersByTime(1000);
  
  expect(callback).toHaveBeenCalled();
});
```

---

## CI/CD Integration

### GitHub Actions Example

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Type check
        run: npm run check
      
      - name: Run tests
        run: npm run test:run
      
      - name: Build
        run: npm run build
```

### Pre-commit Hook (Optional)

Using [husky](https://typicode.github.io/husky/):

```bash
npm install -D husky
npx husky init
echo "npm run test:run" > .husky/pre-commit
```

---

## Coverage

### Generating Reports

```bash
npm run test:coverage
```

This generates:
- Terminal summary
- HTML report in `coverage/index.html`

### Coverage Thresholds

Configured in `vitest.config.ts`:

```typescript
coverage: {
  thresholds: {
    statements: 20,  // Start modest
    branches: 20,
    functions: 20,
    lines: 20,
  },
}
```

### Target Coverage

| Module | Target | Notes |
|--------|--------|-------|
| `graph/types.ts` | 100% | Pure functions |
| `canvas/ports.ts` | 90% | Geometry math |
| `graph/store.svelte.ts` | 80% | State management |
| `orchestration/execution.ts` | 70% | Complex logic |
| `inference/*` | 60% | Many edge cases |

Increase thresholds as coverage improves.

---

## Troubleshooting

### "Cannot find module" Errors

```bash
# Reset module cache
vi.resetModules();
```

### Tests Affecting Each Other

Use `beforeEach` to reset state:

```typescript
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
});
```

### Svelte 5 Runes Issues

The store uses Svelte 5 runes (`$state`). If tests fail with rune errors:

1. Ensure `svelte` plugin is in `vitest.config.ts`
2. Use dynamic imports: `const { graphStore } = await import('../store.svelte');`

### WebGPU/Canvas Errors

Canvas APIs are mocked in `setup.ts`. If tests fail:

```typescript
// Add mock in your test file if needed
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockContext);
```

### Fetch Not Mocked

All fetch calls should be mocked. If you see real network requests:

```typescript
// Check that your test is mocking fetch
const mockFetch = vi.mocked(global.fetch);
mockFetch.mockResolvedValueOnce({ ... });
```

### Slow Tests

1. Use `happy-dom` (configured by default) instead of `jsdom`
2. Mock network calls
3. Use `vi.useFakeTimers()` for time-dependent tests
4. Run subset with `-t "pattern"`

---

## Development Workflow

### Adding a New Feature

1. **Write failing test** for the expected behavior
2. **Implement the feature** to make test pass
3. **Refactor** if needed (tests ensure nothing breaks)
4. **Run full suite** before committing

### Fixing a Bug

1. **Write test that reproduces** the bug
2. **Fix the bug** — test should now pass
3. **Test prevents regression** in the future

### Refactoring

1. **Ensure tests pass** before refactoring
2. **Make changes**
3. **Run tests** — any failures indicate broken behavior
4. **Tests are your safety net**

---

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library](https://testing-library.com/)
- [Effective Testing Practices](https://kentcdodds.com/blog/write-tests)
