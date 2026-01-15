# Node Behavior Specification

This document defines the expected behavior for canvas nodes during execution. These rules are enforced by the execution engine and verified by automated tests.

---

## Execution Rules

### General Principles

1. **Topological Order**: Nodes execute in dependency order (upstream nodes first)
2. **Dirty Tracking**: Only nodes without valid cached output are re-executed
3. **Fail Fast**: Errors stop execution and prevent downstream nodes from running
4. **Skip Disconnected**: Nodes not part of a connected pipeline are ignored

---

## Node Types

### Image Node
| Input | Output | Required Connections |
|-------|--------|---------------------|
| None | `image` (URL) | None |

**Behavior:**
- Always executes (outputs its `imageUrl` parameter)
- No validation required
- Serves as the starting point for pipelines

---

### Prompt Node
| Input | Output | Required Connections |
|-------|--------|---------------------|
| None | `text` (string) | None |

**Behavior:**
- Always executes (outputs its `text` parameter)
- No validation required
- Optional input to model nodes

---

### Model Node (SD 1.5)
| Input | Output | Required Connections |
|-------|--------|---------------------|
| `image` (required) | `image` (URL) | Must have image input |
| `positive_prompt` (optional) | | |
| `negative_prompt` (optional) | | |

**Behavior:**

| Scenario | Behavior | Test Case |
|----------|----------|-----------|
| **Completely disconnected** (0 input edges) | ✅ Silently skipped | `skips completely disconnected model node silently` |
| **Has edges but missing `image` input** | ❌ Error: "No input image connected" | `errors when model has partial connections but missing image` |
| **Properly connected** | ✅ Executes img2img inference | `executes graph without errors for simple pipeline` |
| **Missing prompt** | ❌ Error: "prompt required" | `reports missing prompt error` |

---

### TripoSR Node (3D Reconstruction)
| Input | Output | Required Connections |
|-------|--------|---------------------|
| `image` (required) | `mesh` (GLB URL) | Must have image input |

**Behavior:**

| Scenario | Behavior | Test Case |
|----------|----------|-----------|
| **Completely disconnected** (0 input edges) | ✅ Silently skipped | `skips disconnected triposr node silently` |
| **Has edges but missing `image` input** | ❌ Error: "No input image connected" | (same as model node) |
| **Properly connected** | ✅ Executes 3D reconstruction | — |

---

### Output Node
| Input | Output | Required Connections |
|-------|--------|---------------------|
| `image` (required) | None | Auto-created by model execution |

**Behavior:**
- Auto-created when a model node completes successfully
- Displays the generated image result
- Not user-creatable

---

## Multi-Pipeline Behavior

The canvas supports multiple independent pipelines executing in parallel:

```
Pipeline 1:  Image1 → Model1 → Output1
Pipeline 2:  Image2 → TripoSR → (3D result)
Disconnected: Model3 (ignored)
```

**Rules:**
- Each connected pipeline executes independently
- Disconnected nodes are **completely ignored** (no error, no status change)
- A failure in one pipeline does not affect other pipelines

---

## Status States

| Status | Meaning |
|--------|---------|
| `idle` | Not yet executed or skipped |
| `running` | Currently executing |
| `complete` | Successfully finished with cached output |
| `error` | Failed with error message |

---

## Error Messages

| Error | Cause | Resolution |
|-------|-------|------------|
| "No input image connected. Connect an Image node to the model's image input port." | Model node has connections but no image input | Wire an Image node to the model's image port |
| "No input image connected. Connect an Image node to the TripoSR image input port." | TripoSR node has connections but no image input | Wire an Image node to TripoSR's image port |
| "Positive prompt is required" | Model node has empty prompt | Enter a prompt in the node settings |
| "Backend not available" | Python backend server not running | Start backend with `./backend/start.sh` |

---

## Testing

All node behaviors are verified by automated tests in:
```
src/lib/orchestration/__tests__/execution.test.ts
```

Run tests with:
```bash
npm test                    # Watch mode (during development)
npm run test:run           # Single run (before commit)
npm run test:coverage      # With coverage report
```

See [TESTING.md](../TESTING.md) for full testing documentation.
