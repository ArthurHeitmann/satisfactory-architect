# Satisfactory Factory Manager - Architecture Analysis for Multi-User Collaboration

## Executive Summary

This document provides a comprehensive analysis of the current architecture of the Satisfactory Factory Manager web application, with a focus on understanding how data flows and is manipulated in preparation for implementing real-time multi-user collaboration features.

**Key Finding:** The codebase already has numerous `// TODO sync` comments scattered throughout, indicating the developer had considered synchronization needs. This is an excellent starting point.

---

## 1. Architecture Overview

### 1.1 Technology Stack
- **Framework:** SvelteKit (Svelte 5) with TypeScript
- **State Management:** Svelte 5's new runes system (`$state`, `$derived`, `$effect`)
- **Persistence:** LocalStorage (browser-based)
- **Styling:** SCSS
- **Build Tool:** Vite

### 1.2 Core Application Structure

```
AppState (Root)
├── IdGen (Shared ID generator)
├── Multiple Pages (GraphPage[])
│   ├── GraphView (viewport/camera state)
│   ├── Nodes (SvelteMap<Id, GraphNode>)
│   ├── Edges (SvelteMap<Id, GraphEdge>)
│   ├── StateHistory (undo/redo)
│   └── Selection state
└── Current Page reference
```

---

## 2. Data Model Deep Dive

### 2.1 Core Entities

#### **AppState** (`src/lib/datamodel/AppState.svelte.ts`)
- **Root of the entire application state**
- Contains:
  - `idGen`: Central ID generator (number-based, sequential)
  - `pages`: Array of GraphPage objects
  - `currentPageId`: Active page ID
- **Already marked for sync**: `idGen` and `pages` have `// TODO sync` comments
- **Auto-saves to localStorage** with 1.5s debouncing
- **Serialization**: Full JSON serialization via `toJSON()`/`fromJSON()`

#### **GraphPage** (`src/lib/datamodel/GraphPage.svelte.ts`)
- Represents a factory/page
- Contains:
  - `id`, `name`, `icon` (all marked `// TODO sync`)
  - `nodes`: SvelteMap of GraphNode instances (marked `// TODO sync`)
  - `edges`: SvelteMap of GraphEdge instances (marked `// TODO sync`)
  - `view`: GraphView (camera position, scale, grid snap)
  - `selectedNodes`/`selectedEdges`: User's current selection (local state)
  - `history`: StateHistory for undo/redo (local state)
  - `toolMode`: Current tool selection (local state)

#### **GraphNode** (`src/lib/datamodel/GraphNode.svelte.ts`)
- Multiple node types: production, resource-joint, splitter, merger, text-note
- Properties (all marked `// TODO sync`):
  - `position`: Vector2D (x, y coordinates)
  - `edges`: SvelteSet of connected edge IDs
  - `parentNode`: ID of parent (for nested nodes like resource joints)
  - `children`: SvelteSet of child node IDs
  - `properties`: Type-specific properties
  - `size`: Width/height
- **Special consideration**: `jointDragType` has comment `// TODO syncing (TODO distinguish between users)`

#### **GraphEdge** (`src/lib/datamodel/GraphEdge.svelte.ts`)
- Represents connections between nodes
- Properties (all marked `// TODO sync`):
  - `type`: Edge type
  - `startNodeId`, `endNodeId`: Connected nodes
  - `properties`: Display settings (curved, straight, etc.)
- Contains many `$derived` computed properties for rendering

### 2.2 ID Generation System

**Critical for collaboration:** The `IdGen` class uses sequential numeric IDs converted to strings.

```typescript
class IdGen {
  private currentId: number;
  nextId(): Id { return `${this.currentId++}`; }
}
```

**Problem:** Multiple users generating IDs simultaneously will create conflicts.

**Note:** The `IdMapper` class exists for copy/paste operations - it remaps IDs to avoid conflicts.

---

## 3. State Management & Reactivity

### 3.1 Svelte 5 Runes

The application uses Svelte 5's fine-grained reactivity:
- `$state()`: Creates reactive state
- `$derived()`: Computed values that auto-update
- `$effect()`: Side effects that run when dependencies change

**Key insight:** Changes to nested objects/arrays are automatically tracked by Svelte 5.

### 3.2 State Change Tracking

**Globals** (`src/lib/datamodel/globals.svelte.ts`):
```typescript
let stateChangeBlockers = 0;  // TODO sync
function trackStateChanges(): boolean {
  return stateChangeBlockers === 0;
}
```

Used to temporarily disable:
- History recording
- LocalStorage saves
- During complex operations (marked with `blockStateChanges()`/`unblockStateChanges()`)

**Implication:** This mechanism will need to distinguish between local changes and remote changes.

### 3.3 History System (Undo/Redo)

**StateHistory** (`src/lib/datamodel/StateHistory.svelte.ts`):
- Debounced state snapshots (500ms)
- Stores full serialized state
- Manages undo/redo stack
- Uses `$state.snapshot()` to capture state

**Challenge:** Undo/redo in multi-user environments is complex:
1. Should undo only affect local changes?
2. How to handle conflicts between local undo and remote changes?
3. History divergence between users

---

## 4. Data Persistence & Serialization

### 4.1 LocalStorage Strategy

**Current flow:**
1. User makes changes
2. After 1.5s debounce, `AppState.saveToLocalStorage()` is called
3. Full state serialized to JSON
4. Stored in `localStorage["preferences"]["app-state"]`

**Serialization methods:**
- Every entity has `toJSON()` and `fromJSON()` methods
- Uses `$state.snapshot()` to get plain objects
- `applyJson()` method updates existing objects (used for state restoration)

### 4.2 Copy/Paste System

**Clipboard format:**
```json
{
  "type": "factory-data",
  "version": 1,
  "nodes": [...],
  "edges": [...]
}
```

**ID remapping:** The `IdMapper` ensures pasted content gets new IDs.

**Implication:** Similar approach needed for syncing - operations need to be ID-independent or include mapping.

---

## 5. User Interactions & Event Flow

### 5.1 User Input Architecture

**UserEvents.svelte** component:
- Centralized drag/zoom/click handling
- Converts browser events to semantic events (DragEvent, CursorEvent)
- Supports mouse, touch, and keyboard
- Each interactive element wraps its content with UserEvents

**Typical interaction flow:**
1. User clicks/drags on SVG canvas or node
2. UserEvents captures raw event
3. Converts to semantic event (onClick, onDrag, etc.)
4. PageView or NodeView handles event
5. Updates GraphPage/GraphNode state directly
6. Svelte reactivity updates UI

### 5.2 Direct Mutation Pattern

**Key observation:** The codebase uses **direct mutation** of state objects:
```typescript
node.position.x = newX;  // Direct mutation
page.nodes.set(id, node);  // Direct map mutation
edge.properties.displayType = "curved";  // Direct property change
```

**Why this matters:** 
- No centralized action/reducer pattern
- Mutations happen throughout the codebase
- Need to intercept all mutation points for sync

### 5.3 Major Mutation Operations

**Page-level operations** (in GraphPage.svelte.ts):
- `addNodes()`, `removeNode()`, `addEdge()`, `removeEdge()`
- `moveSelectedNodes()`, `moveNode()`
- `copyOrCutSelection()`, `insertJson()` (paste)
- `makeNewNode()` (factory method)
- `connectResourceJoints()`

**Node-level operations** (in GraphNode.svelte.ts):
- `move()` - updates position
- `onJointCountChanged()` - resizes node
- `updateExternalFactoryJoints()` - adds/removes joints
- `reorderRecipeJoints()` - rearranges child nodes

**Edge-level operations** (in GraphEdge.svelte.ts):
- `connectNode()` - changes start/end connections

**AppState-level operations** (in AppState.svelte.ts):
- `addPage()`, `removePage()`, `swapPages()`
- `setCurrentPage()`
- `duplicatePage()`

---

## 6. Computed Values & Side Effects

### 6.1 Throughput Calculator

**throughputsCalculator.ts:**
- Runs automatically via `$effect()` whenever page changes
- Calculates item flow rates through the factory network
- Push/pull throughput propagation algorithm
- **Temporarily blocks state tracking** during calculation

**Implication:** Expensive computation that runs on every change. May need optimization for real-time sync.

### 6.2 Derived Properties

Many properties are `$derived` from other state:
- Edge path calculations (start/end points, control points)
- Node absolute positions (considering parent hierarchy)
- UI state (selected, highlighted, etc.)

**Good news:** These don't need to be synced - they're automatically recomputed from base state.

---

## 7. Component Architecture

### 7.1 Component Hierarchy

```
+page.svelte
└── AppStateView.svelte (creates AppState)
    ├── OverlayLayer (modals, context menus)
    ├── PagesBar (page tabs)
    └── PageView (main canvas)
        ├── PropertiesToolbar
        ├── ToolModeSelector
        ├── UserEvents (input handling)
        └── SVG Canvas
            ├── EdgeView (for each edge)
            └── NodeView (for each node)
                ├── ProductionNodeView
                ├── ResourceJointNodeView
                ├── SplitterMergerNodeView
                └── TextNoteNodeView
```

### 7.2 Context & Props Flow

**Contexts:**
- `app-state`: Root AppState instance
- `overlay-layer-event-stream`: For showing modals/overlays

**Props flow:**
- `PageContext` = `{ appState, page }` - passed to nodes/edges
- Each node/edge gets its context in constructor
- Components read state via props or context

---

## 8. Challenges for Multi-User Collaboration

### 8.1 ID Generation Conflicts

**Problem:** Sequential numeric IDs will collide when multiple users create objects simultaneously.

**Solutions:**
- Use UUID/ULID for new objects
- Prefix IDs with user ID (e.g., `user1-123`)
- Server-side ID allocation
- Hybrid: client-generated temporary IDs, server confirms/remaps

### 8.2 Concurrent Mutations

**Problem:** Two users moving the same node, editing the same property, etc.

**Examples:**
- User A moves node to (100, 200)
- User B moves same node to (150, 250)
- Both changes arrive out of order

**Solutions:**
- Operational Transformation (OT)
- Conflict-free Replicated Data Types (CRDTs)
- Last-write-wins with timestamps
- Lock-based editing (pessimistic)
- Per-property versioning

### 8.3 Direct Mutation Pattern

**Problem:** Hundreds of direct property assignments scattered throughout codebase.

**Solutions:**
- Proxy-based change detection (wrap state objects)
- Svelte runes already track changes - can we hook into that?
- Refactor to centralized action dispatch
- Transaction/batch API

### 8.4 Undo/Redo in Multi-User Context

**Problem:** Undo is local history - doesn't account for concurrent changes.

**Solutions:**
- Per-user undo stacks
- Disable undo in collaborative mode
- Undo only locally-made changes
- Transform undo operations based on remote changes (complex)

### 8.5 Selection & Ephemeral State

**Problem:** User selections, drag state, highlighted nodes are local.

**Questions:**
- Should other users see selections? (cursors, selection highlights)
- How to show who's editing what?
- Prevent concurrent editing of same object?

### 8.6 Derived/Computed Properties

**Problem:** Many `$derived` properties depend on state.

**Good news:** Don't need to sync these - they recompute automatically.

**Concern:** Performance with many derived properties updating on every remote change.

### 8.7 Parent-Child Relationships

**Problem:** Nodes can be children of other nodes (resource joints inside production nodes).

**Challenges:**
- Moving parent should move children
- Deleting parent should delete children
- Complex hierarchical updates
- Need transaction semantics (all-or-nothing)

### 8.8 Copy/Paste & ID Remapping

**Problem:** Current copy/paste remaps IDs to avoid conflicts.

**Question:** In collaborative mode, should copied items get new IDs or preserve references?

### 8.9 LocalStorage vs Server

**Problem:** Currently everything is local.

**Need:**
- WebSocket or Server-Sent Events for real-time updates
- REST API for initial load / save
- Offline support / conflict resolution
- Session management / authentication

### 8.10 Throughput Calculator

**Problem:** Runs on every state change, blocks state tracking.

**Concern:** 
- Will run for every remote change
- Could cause performance issues
- May need to debounce/throttle
- Consider incremental recalculation

### 8.11 StateHistory Snapshots

**Problem:** Takes full state snapshot every 500ms.

**Concern:**
- Large serialization overhead
- May not work well with frequent remote updates
- History could become huge in collaborative session

### 8.12 Transaction Boundaries

**Problem:** Some operations are multi-step:
- Creating production node creates parent + multiple child joints
- Connecting nodes updates both nodes + edge
- Pasting creates multiple nodes + edges

**Need:** Atomic operations that succeed/fail as a unit.

---

## 9. Existing Sync Markers

The codebase already has 18 `// TODO sync` comments marking state that needs synchronization:

**AppState:**
- `idGen`
- `pages` array

**GraphPage:**
- `name`, `icon`
- `nodes` map
- `edges` map

**GraphNode:**
- `position`
- `edges` set
- `parentNode`
- `children` set
- `properties`
- `size`
- `jointDragType` (with special note about user distinction)

**GraphEdge:**
- `type`
- `startNodeId`, `endNodeId`
- `properties`

**Globals:**
- `stateChangeBlockers`

---

## 10. Potential Strategies for Implementation

### 10.1 Operational Transformation (OT) Approach

**Concept:** Transform operations based on concurrent operations.

**Pros:**
- Well-established theory
- Can preserve user intent
- Good for text editing (proven)

**Cons:**
- Complex to implement for complex data structures
- Need OT functions for every operation type
- Error-prone

### 10.2 CRDT Approach

**Concept:** Use data structures designed for merging (LWW-Register, Observed-Remove Set, etc.)

**Pros:**
- Strong eventual consistency guarantees
- No central coordination needed
- Handles offline/online transitions well

**Cons:**
- May need to restructure data model
- Some operations difficult to express as CRDTs
- Library support varies (Automerge, Yjs)

**Integration:**
- Could wrap Svelte state with CRDT library
- Yjs has good TypeScript support
- Automerge designed for complex documents

### 10.3 Event Sourcing + CQRS

**Concept:** Store all changes as events, replay to build state.

**Pros:**
- Clear audit trail
- Easy to implement undo/redo
- Natural fit for real-time sync

**Cons:**
- Need to define event schema for all operations
- Event replay can be slow for large histories
- Need event compaction/snapshotting

**Approach:**
```typescript
type Event = 
  | { type: "node.move", nodeId: Id, position: Vector2D, timestamp: number, userId: string }
  | { type: "node.create", node: GraphNode, timestamp: number, userId: string }
  | { type: "node.delete", nodeId: Id, timestamp: number, userId: string }
  // ... etc
```

### 10.4 Hybrid: Shared State + Optimistic Updates

**Concept:** 
1. Server is source of truth
2. Clients make optimistic local changes
3. Broadcast changes to other clients
4. Handle conflicts when server responds

**Pros:**
- Feels responsive (optimistic)
- Server can validate/reject changes
- Easier to implement than OT/CRDT

**Cons:**
- Need conflict resolution strategy
- UI flickering if operation rejected
- Complexity in rollback logic

### 10.5 Simple Lock-Based Approach

**Concept:** User must "check out" objects before editing.

**Pros:**
- Simple to implement
- No conflicts possible
- Clear ownership model

**Cons:**
- Poor user experience (waiting for locks)
- Lock contention issues
- Dead locks if user disconnects

**Hybrid variant:**
- Soft locks (warnings) + hard locks (block edits)
- Automatic lock release on idle
- Lock stealing after timeout

---

## 11. Recommendations

### 11.1 Phased Implementation

**Phase 1: Read-Only Collaboration**
- Multiple users can view same factory
- Show other users' cursors/viewports
- No concurrent editing yet
- Simplest to implement, high value

**Phase 2: Last-Write-Wins (Simple Sync)**
- Allow concurrent editing
- Use timestamps to resolve conflicts
- Accept that some changes may be lost
- Good starting point to learn

**Phase 3: Conflict-Free Collaboration**
- Implement OT or CRDT
- Handle all conflict scenarios
- Production-ready

### 11.2 Architecture Changes Needed

**1. Introduce Change Detection Layer**
```typescript
class SyncedState<T> {
  private value: T;
  private onChange: (change: Change) => void;
  // Proxy to detect mutations
}
```

**2. Centralized Operation API**
```typescript
class GraphPageOperations {
  moveNode(nodeId: Id, position: Vector2D) {
    // Apply locally + broadcast
  }
}
```

**3. WebSocket Integration**
```typescript
class CollaborationClient {
  connect(roomId: string);
  sendChange(change: Change);
  onRemoteChange(handler: (change: Change) => void);
}
```

**4. User Presence System**
```typescript
interface UserPresence {
  userId: string;
  cursor: Vector2D;
  selection: Id[];
  viewport: { center: Vector2D, scale: number };
}
```

### 11.3 Technology Choices

**Real-time Communication:**
- WebSocket (Socket.io, native WebSocket)
- WebRTC (peer-to-peer option)
- Server-Sent Events (simpler, one-way)

**CRDT Libraries:**
- **Yjs**: Mature, good TypeScript support, works with various backends
- **Automerge**: Clean API, immutable by default
- **Gun.js**: Decentralized option

**Backend:**
- Node.js + Socket.io (simplest)
- Cloudflare Durable Objects (serverless with state)
- Firebase Realtime Database (fully managed)
- Custom WebSocket server with Redis pub/sub

### 11.4 Minimal Viable Collaboration

**Goal:** Get multi-user working with least changes.

**Approach:**
1. **ID Generation**: Switch to UUIDs (`crypto.randomUUID()`)
2. **Change Broadcasting**: Wrap key mutations in functions that broadcast
3. **Simple Sync Protocol**: Send full state diffs
4. **Conflict Resolution**: Last write wins with timestamp
5. **User Presence**: Show cursors and selections

**Where to hook in:**
- Intercept `toJSON()` outputs as change events
- On receiving remote change, call `applyJson()`
- Temporarily disable history during remote updates
- Add user info to all changes

### 11.5 State vs Operations Sync

**Two paradigms:**

**State Sync:**
- Share entire state
- Send snapshots or diffs
- Simple but potentially inefficient
- Example: Send updated `page.asJson` on every change

**Operation Sync:**
- Share user actions/operations
- Each client applies operations locally
- More efficient, better for OT/CRDT
- Example: Send `{ op: "moveNode", nodeId, delta }`

**Recommendation:** Start with state sync (simpler), migrate to operations if needed.

---

## 12. Code Areas Requiring Changes

### 12.1 High Priority (Must Change)

1. **IdGen**: Replace sequential IDs with UUIDs or hybrid approach
2. **GraphPage mutations**: Add change broadcasting to all mutation methods
3. **GraphNode mutations**: Intercept position changes, property updates
4. **GraphEdge mutations**: Track connection changes
5. **AppState**: Handle page add/remove/rename

### 12.2 Medium Priority (Should Change)

1. **StateHistory**: Adapt for concurrent changes
2. **Throughput calculator**: Debounce for remote changes
3. **LocalStorage**: Coordinate with server sync
4. **Copy/paste**: Handle collaborative paste

### 12.3 Low Priority (Nice to Have)

1. **User presence**: Show other users' cursors
2. **Conflict UI**: Visual indicators for conflicts
3. **Version history**: Server-side snapshots
4. **Permissions**: Page sharing, read-only users

---

## 13. Example Integration Patterns

### 13.1 Wrapping Mutations

**Before:**
```typescript
node.position.x = newX;
node.position.y = newY;
```

**After:**
```typescript
class GraphNodeSync extends GraphNode {
  setPosition(x: number, y: number) {
    this.position.x = x;
    this.position.y = y;
    this.broadcastChange({
      type: "node.position",
      nodeId: this.id,
      position: { x, y },
      timestamp: Date.now(),
    });
  }
}
```

### 13.2 Receiving Remote Changes

```typescript
class CollaborationSync {
  onRemoteChange(change: Change) {
    blockStateChanges();  // Disable history
    try {
      switch (change.type) {
        case "node.position":
          const node = page.nodes.get(change.nodeId);
          if (node) {
            node.position.x = change.position.x;
            node.position.y = change.position.y;
          }
          break;
        // ... other change types
      }
    } finally {
      unblockStateChanges();
    }
  }
}
```

### 13.3 Using Yjs (CRDT Library)

```typescript
import * as Y from 'yjs';

const ydoc = new Y.Doc();
const yPages = ydoc.getArray('pages');

// Convert GraphPage to Yjs
function pageToYjs(page: GraphPage): Y.Map {
  const yPage = new Y.Map();
  yPage.set('id', page.id);
  yPage.set('name', page.name);
  
  const yNodes = new Y.Map();
  for (const [id, node] of page.nodes) {
    const yNode = new Y.Map();
    yNode.set('position', new Y.Map([['x', node.position.x], ['y', node.position.y]]));
    // ... other properties
    yNodes.set(id, yNode);
  }
  yPage.set('nodes', yNodes);
  
  return yPage;
}

// Listen for changes
ydoc.on('update', (update: Uint8Array) => {
  // Broadcast to other clients
  websocket.send(update);
});

// Receive changes
websocket.on('message', (update: Uint8Array) => {
  Y.applyUpdate(ydoc, update);
});
```

---

## 14. Testing Considerations

### 14.1 Conflict Scenarios to Test

1. **Concurrent node move**: Two users move same node simultaneously
2. **Concurrent delete**: User A deletes node while User B edits it
3. **Parent-child operations**: Moving parent while child is being edited
4. **Edge connection conflicts**: Two users connecting to same resource joint
5. **Property updates**: Concurrent changes to node multiplier
6. **Page operations**: Renaming/deleting pages concurrently
7. **Network partition**: User goes offline, makes changes, comes back online

### 14.2 Test Infrastructure

- Simulate multiple clients in same browser
- Network delay injection
- Out-of-order message delivery
- Client disconnect/reconnect scenarios
- Load testing (many users, large factories)

---

## 15. Performance Considerations

### 15.1 Current Performance Characteristics

- Full state serialization on every save (1.5s debounce)
- Throughput calculation on every change
- Many `$derived` properties recalculate on updates
- Undo history stores full state snapshots

### 15.2 Scalability Concerns

**Per-user:**
- Each remote change triggers recalculations
- Large factories (100+ nodes) may be slow

**Per-session:**
- Broadcast storm with many concurrent users
- Server bandwidth for state sync

**Optimizations:**
- Delta/diff-based sync (only send changes)
- Incremental throughput calculation
- Lazy derived property evaluation
- Connection pooling/batching

---

## 16. Security & Privacy

### 16.1 Authentication & Authorization

**Needed:**
- User identity system
- Session management
- Permission model (owner, editor, viewer)

### 16.2 Data Privacy

**Considerations:**
- Factories may contain trade secrets
- Need encryption for sensitive projects
- Private vs. public sharing modes

### 16.3 Abuse Prevention

- Rate limiting on operations
- Max factory size limits
- Malicious client detection

---

## 17. Conclusion

The codebase is well-structured with clear separation of concerns. The existing `// TODO sync` comments show the developer anticipated this feature. However, the direct mutation pattern and complex derived state present challenges for real-time collaboration.

**Recommended Path Forward:**

1. **Start Simple**: Implement read-only collaboration first
2. **Prototype with Simple Sync**: Use last-write-wins to learn
3. **Evaluate CRDT**: Consider Yjs for production-ready conflict-free editing
4. **Iterate**: Gather user feedback, optimize performance

**Estimated Complexity:**
- Basic read-only: 1-2 weeks
- Simple editable sync: 3-4 weeks  
- Production CRDT-based: 6-8 weeks
- Full feature set: 10-12 weeks

The groundwork is excellent - the JSON serialization, ID system, and modular architecture provide a solid foundation for adding collaboration.
