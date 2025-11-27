# Multi-User Collaboration - Implementation Plan

## Overview

This document outlines the concrete implementation plan for adding real-time multi-user collaboration to the Satisfactory Factory Manager. The design prioritizes simplicity and "good enough" functionality over perfect conflict resolution.

---

## Design Principles

1. **Simplicity First**: Reuse existing JSON serialization, avoid complex CRDT/OT algorithms
2. **Last-Write-Wins**: Conflicts are resolved implicitly by timestamp ordering
3. **Command Stream**: Server buffers and broadcasts commands without understanding app logic
4. **TCP Reliability**: WebSocket ensures ordered, reliable delivery
5. **Minimal Server Logic**: Server is a "dumb" relay with persistence

---

## Architecture Overview

```
┌─────────────┐         WebSocket          ┌─────────────┐
│  Client A   │◄──────────────────────────►│             │
│  (Browser)  │                            │   Server    │
└─────────────┘                            │  (Node.js)  │
                                           │             │
┌─────────────┐         WebSocket          │  - Command  │
│  Client B   │◄──────────────────────────►│    Buffer   │
│  (Browser)  │                            │  - SQLite   │
└─────────────┘                            │    DB       │
                                           │             │
┌─────────────┐         WebSocket          │             │
│  Client C   │◄──────────────────────────►│             │
│  (Browser)  │                            │             │
└─────────────┘                            └─────────────┘
```

---

## 1. Command Structure

### 1.1 Core Command Format

```typescript
interface Command {
  // Identification
  commandId: string;           // UUID for deduplication
  clientId: string;            // Source client (assigned by server)
  timestamp: number;           // Client timestamp (for ordering)
  
  // Targeting
  pageId?: Id;                 // Which page (undefined for page-level ops)
  
  // Operation
  type: CommandType;
  payload: CommandPayload;
}

type CommandType = 
  // Page operations
  | "page.add"
  | "page.delete"
  | "page.modify"
  | "page.reorder"
  
  // Object operations
  | "object.add"
  | "object.delete"
  | "object.modify";

interface CommandPayload {
  objectType?: "node" | "edge";  // For object operations
  objectId?: Id;                  // For modify/delete
  data?: any;                     // Full JSON for add/modify
}
```

**Note:** Room ID is not included in commands - the server tracks which WebSocket connection belongs to which room.

---

## 2. Server Architecture

### 2.1 Technology Stack

**Server:**
- Node.js + TypeScript
- `ws` library for WebSocket
- `better-sqlite3` for persistence
- `lz4` or `zstd` for compression (fast compression)

**Project Structure:**
```
server/
├── src/
│   ├── server.ts           # Main WebSocket server
│   ├── room.ts             # Room management
│   ├── commandBuffer.ts    # Command buffering logic
│   ├── storage.ts          # SQLite persistence
│   ├── compression.ts      # JSON compression
│   └── types.ts            # Shared types
├── package.json
└── tsconfig.json
```

### 2.2 Server State Management

The server maintains state that is relevant for coordination and synchronization:

**Server Room State:**
```typescript
interface RoomState {
  roomId: string;
  clients: Map<string, ClientInfo>;
  nextClientId: number;           // For assigning client IDs (u1, u2, u3...)
  highestIdGenSeen: number;       // Highest ID number seen across all clients
  commandBuffer: Command[];
  bufferTimer: NodeJS.Timeout | null;
}

interface ClientInfo {
  clientId: string;
  socket: WebSocket;
  cursor: {x: number, y: number};
  lastHeartbeat: number;
}
```

**Key responsibilities:**
- Track connected clients per room
- Assign unique client IDs
- Synchronize ID generation state
- Buffer and broadcast commands
- Manage client presence (cursors, heartbeats)

### 2.3 Database Schema

```sql
-- Rooms table
CREATE TABLE rooms (
  room_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_updated INTEGER NOT NULL
);

-- Full state snapshots (for quick loading)
CREATE TABLE room_states (
  room_id TEXT PRIMARY KEY,
  state_data BLOB NOT NULL,  -- Compressed JSON
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(room_id)
);

-- Command history (for debugging/auditing)
CREATE TABLE commands (
  command_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  command_type TEXT NOT NULL,
  payload BLOB NOT NULL,  -- Compressed JSON
  FOREIGN KEY (room_id) REFERENCES rooms(room_id)
);

-- Client presence (for heartbeat tracking)
CREATE TABLE client_presence (
  client_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  last_heartbeat INTEGER NOT NULL,
  cursor_x REAL,
  cursor_y REAL,
  FOREIGN KEY (room_id) REFERENCES rooms(room_id)
);
```

### 2.4 Snapshot Persistence

The server persists full application state snapshots periodically to SQLite. Snapshot interval is configurable (default: 30 seconds).

---

## 3. Client Architecture

### 3.1 Collaboration Client

**Key responsibilities:**
- Establish WebSocket connection to server
- Buffer commands for 100ms before sending
- Handle incoming command batches
- Send heartbeat every second with cursor position
- Request/upload initial state

**Message types:**
- `join`: Join a room
- `command_batch`: Batched commands to broadcast
- `heartbeat`: Cursor position + local ID gen state
- `request_state`: Download room state
- `upload_state`: Upload local state to room

### 3.2 Change Detection

Uses Svelte 5's `$effect` to detect changes to application state:

**Page-level changes:**
- Page added/removed (manual detection needed)
- Page properties (name, icon)

**Object-level changes:**
- Nodes/edges added/removed (manual detection needed)
- Node/edge properties (automatic via `$effect` on `asJson`)

**Implementation approach:**
- Each `$effect` checks `isApplyingRemoteChange` flag to avoid feedback loops
- Commands include full JSON representation of modified objects
- Consecutive updates to same object replace older buffered commands

---

## 4. ID Generation Strategy

### 4.1 Server-Assigned Prefix

When client connects, server assigns a unique prefix:

```typescript
// Server side
class ClientSession {
  assignClientId(): string {
    // Simple incremental counter per room
    const nextId = this.room.nextClientNumber++;
    return `u${nextId}`;
  }
}

// Client side
class IdGen {
  private currentId: number;
  private prefix: string = "";
  
  setPrefix(prefix: string): void {
    this.prefix = prefix;
  }
  
  nextId(): Id {
    return `${this.prefix}-${this.currentId++}`;
  }
}
```

### 4.2 ID Synchronization

ID gen state is synchronized through the heartbeat mechanism:

**Client heartbeat includes:**
- Cursor position
- Current local ID counter value

**Server heartbeat response includes:**
- All connected clients' cursors
- Highest ID counter value seen across all clients

**Synchronization:**
- Each client sends its local ID counter in heartbeat
- Server tracks highest value
- Clients update their counter if server's value is higher
- This ensures no ID conflicts across clients

---

## 5. Compression Strategy

### 5.1 Library Choice

**Recommended: LZ4**
- Fast compression/decompression (~500 MB/s)
- Good compression ratio (2-3x typically)
- Native JS implementation available (`lz4js`)

**Alternative: ZSTD**
- Better compression (3-4x)
- Slightly slower
- Good WASM implementations

### 5.2 Implementation

```typescript
// src/lib/collaboration/compression.ts
import LZ4 from "lz4js";

export function compressJSON(obj: any): Uint8Array {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  return LZ4.compress(bytes);
}

export function decompressJSON(compressed: Uint8Array): any {
  const bytes = LZ4.decompress(compressed);
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
}
```

### 5.3 When to Compress

- **Always compress:** Command batches, state snapshots, large payloads (>1KB)
- **Skip compression:** Heartbeats, small messages (<500 bytes)

---

## 6. WebSocket Message Types

All messages exchanged between client and server:

### 6.1 Client → Server Messages

```typescript
type ClientMessage = 
  | CreateRoomMessage
  | JoinRoomMessage
  | CommandBatchMessage
  | HeartbeatMessage
  | UploadStateMessage;

interface CreateRoomMessage {
  type: "create_room";
  dataModelVersion: number;   // Required: client's data model version
}

interface JoinRoomMessage {
  type: "join_room";
  roomId: string;
  dataModelVersion: number;   // Required: client's data model version
  requestDownload: boolean;  // true = download state, false = upload state
}

interface CommandBatchMessage {
  type: "command_batch";
  commands: Command[];
}

interface HeartbeatMessage {
  type: "heartbeat";
  cursor: {x: number, y: number};
  localIdCounter: number;
}

interface UploadStateMessage {
  type: "upload_state";
  stateData: any;  // Compressed AppState JSON
}
```

### 6.2 Server → Client Messages

```typescript
type ServerMessage = 
  | WelcomeMessage
  | RoomJoinedMessage
  | CommandBatchMessage
  | HeartbeatResponseMessage
  | StateSnapshotMessage
  | ErrorMessage;

interface WelcomeMessage {
  type: "welcome";
  dataModelVersion: number;   // Required: server's data model version
  availableRooms?: Array<{    // Optional: list of rooms on this server
    roomId: string;
    // Future: clientCount, lastActivity, name, etc.
  }>;
}

interface RoomJoinedMessage {
  type: "room_joined";
  roomId: string;
  clientId: string;
  stateData?: any;  // Compressed AppState JSON (if download requested)
}

interface CommandBatchMessage {
  type: "command_batch";
  commands: Command[];
}

interface HeartbeatResponseMessage {
  type: "heartbeat_response";
  clients: Array<{
    clientId: string;
    cursor: {x: number, y: number};
  }>;
  highestIdCounter: number;
}

interface StateSnapshotMessage {
  type: "state_snapshot";
  stateData: any;  // Compressed AppState JSON
}

interface ErrorMessage {
  type: "error";
  message: string;
  code?: string;  // Optional: error code (e.g., "VERSION_MISMATCH")
}
```

---

## 7. Connection Flow

### 7.1 Initial Connection Process

**Step 1: Client connects to WebSocket**
```
Client                          Server
  |                               |
  |-------- WebSocket open ------>|
  |                               |
```

**Step 2: Server responds with welcome**
```
  |                               |
  |<- welcome (version + rooms) ---|
  |                               |
```

**Step 3: Client creates or joins room (with version check)**

Option A - Create new room:
```
  |                               |
  |- create_room (+ version) ----> |
  |                               |
  |<--- room_joined + IDs --------|  (or error if version mismatch)
  |                               |
  |---- upload_state (data) ----->|
  |                               |
```

Option B - Join existing room (download):
```
  |                               |
  |-- join_room (+ version) ------>|
  |                               |
  |<- room_joined + IDs + data ---|  (or error if version mismatch)
  |                               |
```

Option C - Join existing room (upload):
```
  |                               |
  |-- join_room (+ version) ------>|
  |                               |
  |<-- room_joined + IDs ---------|  (or error if version mismatch)
  |                               |
  |---- upload_state (data) ----->|
  |                               |
```

**Step 4: Heartbeat starts**
```
  |                               |
  |------- heartbeat ------------>|
  |                               |
  |<--- heartbeat_response -------|
  |                               |
```

### 7.2 Join Room Dialog

A UI dialog allows users to:
- **Create new room**: Generate new room ID, upload local state
- **Join existing room**: Enter room ID, download server state
- **Upload to existing room**: Enter room ID, overwrite with local state

**Note:** Initial state conflicts are not a concern - users collaborating are assumed to be coordinating with each other.

---

## 8. Version Compatibility

### 8.1 Data Model Version Check

**Purpose:** Prevent data corruption and unexpected behavior when client and server have incompatible data model versions.

**Implementation:**
- Client includes `dataModelVersion` from `constants.ts` in create/join room messages
- Server includes its `dataModelVersion` in welcome message
- Server compares versions before allowing room operations
- Mismatched versions result in error response with descriptive message

**Version Check Logic:**
```typescript
// Server-side version validation
function validateClientVersion(clientVersion: number, serverVersion: number): boolean {
  return clientVersion === serverVersion;
  // Future: could allow backwards compatibility ranges
}

// Error response for version mismatch
{
  type: "error",
  message: "Data model version mismatch. Client: v2, Server: v1. Please update to the same version.",
  code: "VERSION_MISMATCH"
}
```

**Client Handling:**
- Display user-friendly error message
- Suggest updating client or server to matching version
- Prevent further collaboration attempts until versions match

**Future Enhancement:** Support for compatible version ranges (e.g., server v2 can work with client v1, but not client v3).

---

## 9. Heartbeat System

### 9.1 Heartbeat Flow

**Frequency:** Every 1 second

**Client sends:**
- Cursor position (x, y)
- Current ID gen counter value
- Timestamp

**Server broadcasts:**
- List of all connected clients
- Each client's cursor position
- Highest ID gen counter value seen
- Active client count

**Purpose:**
- Detect disconnected clients
- Synchronize ID generation
- Share cursor positions for user presence
- Provide status updates (number of connected users)

---

## 10. Handling Edge Cases

### 10.1 Node Dragging

**Challenge:** Dragging creates many position updates and blocks state tracking.

**Solution:** Not a primary concern for initial implementation. The existing state blocking mechanism during drag operations prevents excessive command generation. Any modifications will be applied atomically and detected by `$effect` after drag completes.

### 10.2 Reconnection

**Handling:** When WebSocket disconnects, show user a notification popup. User must manually reconnect via UI. No automatic reconnection to prevent data inconsistencies.

---

## 11. Security Model

### 11.1 Room ID as Access Token

```typescript
// Generate cryptographically secure room IDs
function generateRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
// Example: "a3f5d8c9b2e4f1a7c6d9e2f8b5a1c7d3"
```

**Security properties:**
- 128-bit entropy = virtually unguessable
- Knowing room ID grants full access
- No user authentication needed for MVP

**Optional: Add password protection later**

### 11.2 Room Listing (CLI)

Server provides CLI command to list all stored rooms (useful for private/trusted servers):

```bash
node server.js --list-rooms
```

Displays room IDs, creation/update times, and active client count.

**Future enhancement:** Optional room TTL (time-to-live) as CLI argument for auto-cleanup of inactive rooms.

---

## 12. Known Limitations & Future Work

### 12.1 Current Limitations

1. **No conflict resolution UI**: Users won't see who else is editing
2. **Last-write-wins**: Some changes may be lost
3. **No undo in collaborative mode**: Complex to implement correctly
4. **Manual reconnect**: No automatic reconnection after disconnect
5. **No offline editing**: Must be connected to make changes

### 11.2 Future Enhancements

1. **User awareness**
   - Show other users' cursors and names
   - Highlight nodes being edited by others
   - "User X is editing..." notifications

2. **Smarter conflict resolution**
   - Per-property versioning
   - Merge non-conflicting changes
   - Conflict resolution UI

3. **Undo/redo in collaborative mode**
   - Per-user undo stacks
   - Transform undo operations

4. **Better reconnection**
   - Automatic reconnect with exponential backoff
   - Sync missed changes on reconnect
   - Offline queue of changes

5. **Access control**
   - Room passwords
   - Read-only users
   - Role-based permissions

6. **Enhanced persistence**
   - Full history/audit log
   - Point-in-time recovery
   - Export/import project versions

---

## 13. Implementation Notes

### 13.1 Additional Data Structures

**Heartbeat Data:**
```typescript
// Sent by client in heartbeat
interface ClientHeartbeatData {
  cursor: {x: number, y: number};
  localIdCounter: number;
  // Future: selection state, viewport position, etc.
}

// Sent by server in heartbeat response
interface ServerHeartbeatData {
  clients: Array<{
    clientId: string;
    cursor: {x: number, y: number};
    // Future: name, color, last action, etc.
  }>;
  highestIdCounter: number;
  // Future: server stats, room info, etc.
}
```

**Initial Connection Data:**
```typescript
// Server's welcome message (step 2)
interface WelcomeData {
  dataModelVersion: number;   // Required: server's data model version
  availableRooms?: Array<{    // Optional: public room list
    roomId: string;
    // Future: clientCount, lastActivity, name, etc.
  }>;
  serverVersion?: string;
  // Future: server capabilities, limits, etc.
}

// Room creation/join response (step 4)
interface RoomJoinData {
  roomId: string;
  clientId: string;
  stateData?: any;  // Only if download requested
  // Future: room metadata, other connected users, etc.
}
```

---

## 14. Design Decisions Summary

### 14.1 Confirmed Decisions

✅ **Buffer Durations**: 100ms client buffer, 50ms server buffer
✅ **Command Structure**: No room ID in commands (server tracks WebSocket → room mapping)
✅ **ID Synchronization**: Through heartbeat, not separate commands
✅ **Current Page**: Not synchronized (each user can view different pages)
✅ **Server Intelligence**: Server knows client list, ID gen state, heartbeat data
✅ **Initial State Conflicts**: Not a concern (users coordinate externally)
✅ **Room TTL**: Future CLI argument (lower priority)
✅ **Parent-Child**: Not an issue (atomic operations + relative offsets)
✅ **Reconnection**: Manual only, show disconnect notification
✅ **Heartbeat Frequency**: Every 1 second
✅ **Connection Flow**: 4-step process (connect → welcome → join/create → heartbeat)
✅ **Version Compatibility**: Strict version matching required between client and server

### 14.2 Implementation Details

- ID prefix format is an implementation detail (can be determined during coding)
- Room ID should be displayed in UI for sharing
- Compression algorithm: LZ4 recommended (can benchmark both)
- CLI features: `--list-rooms` initially, others as needed
- Error handling: Log and continue (ignore missing objects)
- Version checking: Use `dataModelVersion` from `constants.ts` for compatibility validation

---

## 15. Next Steps

1. **Begin Implementation**: Start with server foundation
2. **Iterate**: Build incrementally, test at each phase
3. **Integration**: Connect client and server components
4. **Testing**: Multi-client scenarios and performance validation
5. **Deploy**: Production server setup

The plan is now finalized and ready for implementation!
