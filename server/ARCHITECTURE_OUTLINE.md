# Server Architecture Outline

## Overview

Framework-independent collaboration server for Satisfactory Factory Manager.
Uses Deno runtime but core logic is testable and modular.

## File Structure

```
server/
├── src/
│   ├── main.ts              # Deno WebSocket server entry point
│   ├── messages.ts          # WebSocket message interfaces & types
│   ├── messaging.ts         # Message routing between rooms and WebSockets
│   ├── persistence.ts       # SQLite database operations
│   ├── client.ts            # Client connection state and messaging
│   ├── room.ts              # Room management and coordination
│   ├── command_buffer.ts    # Command buffering and batching
│   ├── compression.ts       # JSON compression utilities
│   └── core.ts              # Core server logic (framework-independent)
├── tests/
└── deno.json
```

## Core Classes & Interfaces

### `messages.ts` - Message Protocol

- `ClientMessage` union type (create_room, join_room, command_batch, heartbeat,
  upload_state)
- `ServerMessage` union type (welcome, room_joined, command_batch,
  heartbeat_response, etc.)
- `Command` interface for collaborative operations
- Version compatibility types

### `messaging.ts` - Message Router

- `MessageRouter` class: Routes messages between WebSockets and rooms
- `WebSocketAdapter` interface: Abstracts WebSocket implementation
- Message validation and error handling

### `client.ts` - Client State

- `CollaborationClient` class: Represents connected client
- Client state (ID, cursor, heartbeat, version)
- Message sending/receiving interface
- Connection lifecycle management

### `room.ts` - Room Management

- `CollaborationRoom` class: Manages room state and clients
- Client join/leave operations
- ID generation coordination
- State synchronization

### `command_buffer.ts` - Command Processing

- `CommandBuffer` class: Buffers and batches commands
- Command deduplication and ordering
- Configurable buffer timing (50ms server buffer)

### `persistence.ts` - Data Storage

- `DatabaseManager` class: SQLite operations
- Room state snapshots
- Command history (optional)
- Schema management

### `compression.ts` - Utilities

- `compressJSON()` / `decompressJSON()` functions
- LZ4 compression for state data
- Size threshold logic

### `core.ts` - Server Logic

- `CollaborationServer` class: Framework-independent core
- Orchestrates all components
- Testable business logic
- Configuration management

### `main.ts` - Deno Entry Point

- WebSocket server setup
- HTTP upgrade handling
- CLI argument processing
- Deno-specific adapter implementation

## Key Design Decisions

1. **Framework Independence**: Core logic in `core.ts` doesn't depend on
   Deno/WebSocket APIs
2. **Testability**: All classes accept dependencies via constructor injection
3. **Message Routing**: Clear separation between transport (WebSocket) and
   business logic
4. **State Management**: Room holds authoritative state, clients hold local
   cache
5. **Error Handling**: Structured errors with codes for client handling
6. **Configuration**: Environment variables and CLI args for deployment
   flexibility

## Data Flow

```
WebSocket → MessageRouter → Room → CommandBuffer → Persistence
    ↑                                      ↓
    └─────── Client ←── Room State ←───────┘
```

## Testing Strategy

- Unit tests for each class with mocked dependencies
- Integration tests with in-memory SQLite
- Message protocol validation tests
- Command buffer timing tests
- Room state consistency tests
