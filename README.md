# eventsub-relay-server

For relaying EventSub notifications from Twitch to some other service

## Architecture Overview

### EventQueue

`EventQueue` is an asynchronous message queue that processes messages sequentially at configurable intervals. It provides a foundation for handling WebSocket messages and other asynchronous events in a controlled, non-blocking manner.

**Key Features:**
- **Sequential Processing**: Messages are processed one at a time in FIFO order
- **Configurable Timing**: `queueDelay` controls how often the queue processes messages
- **Queue Limits**: `queueMax` prevents unbounded memory growth
- **Idle Detection**: Tracks when the queue has been idle and can trigger callbacks
- **Error Handling**: Integrated error handling with `onError` callbacks

**States:**
- `STOPPED`: Queue is not receiving or processing messages
- `ACTIVE`: Queue is actively processing messages

**Abstract Methods** (to be overridden by subclasses):
- `onMessage(msg)`: Called for each message in the queue
- `onIdle(idleFor)`: Called when the queue has been idle for a period
- `onError(err)`: Called when errors occur during processing

### EventManager

`EventManager` extends `EventQueue` and manages WebSocket connections to Twitch's EventSub WebSocket server. It handles the complete lifecycle of EventSub subscriptions, including connection management, automatic token refresh, subscription creation, and event processing.

**Key Features:**
- **WebSocket Connection Management**: Establishes and maintains connections to Twitch EventSub
- **Automatic Token Refresh**: Integrates with `TokenStore` and `OAuthManager` to automatically refresh expired tokens before creating subscriptions
- **Subscription Management**: Automatically creates EventSub subscriptions after establishing a WebSocket session
- **Connection Recovery**: Handles reconnections, session renewals, and error recovery
- **Race Condition Protection**: Guards against concurrent connection attempts and state inconsistencies

**Connection States:**
- `STOPPED`: No active WebSocket connection
- `CONNECTING`: WebSocket connection is being established
- `ACTIVE`: WebSocket connection is active and receiving messages

**Subscription Format:**
Subscriptions are defined as objects with `version` and `type`:
```javascript
{
  version: 1,  // API version for this subscription type
  type: "channel.follow"  // EventSub subscription type
}
```

This allows different subscription types to use different API versions as required by Twitch's API.

**Message Flow:**
1. `launch()` or `send("CONNECT")` initiates connection
2. WebSocket connects and receives `session_welcome` message
3. `startSession()` is called, which creates all configured subscriptions
4. `ensureValidToken()` validates and refreshes tokens if needed
5. Subscriptions are created via Twitch API
6. Events are received over WebSocket and queued for processing
7. `onMessage()` processes each event from the queue

## Notes

- Refresh tokens for confidential apps do not expire
- To get user ID from Twitch API:

```bash
curl -X GET "https://api.twitch.tv/helix/users" \
  -H "Authorization: Bearer YOUR_USER_ACCESS_TOKEN" \
  -H "Client-Id: YOUR_CLIENT_ID"
```

## Testing with Twitch CLI

The Twitch CLI provides a mock WebSocket EventSub server that allows you to test EventManager locally without connecting to production Twitch services.

### Setup

1. **Install Twitch CLI** (if not already installed):
   ```bash
   # macOS
   brew tap twitchdev/twitch-cli
   brew install twitch
   
   # Or download from: https://github.com/twitchdev/twitch-cli/releases
   ```

2. **Configure Twitch CLI**:
   ```bash
   twitch configure
   # Follow prompts to set up your client ID, client secret, etc.
   ```

### Starting the Mock Server

Start the mock WebSocket server (default port 8080):
```bash
twitch event websocket start-server
```

Or customize the port:
```bash
twitch event websocket start-server --port 4666
```

### Testing EventManager

1. **Update Test Configuration**:
   Edit `src/EventManager/test/index.js` to point to the mock server:
   ```javascript
   EventManager.WS_URL = "ws://127.0.0.1:4666/ws";
   EventManager.SUB_URL = "http://127.0.0.1:4666/eventsub/subscriptions";
   ```

2. **Run the Test**:
   ```bash
   node src/EventManager/test/index.js
   ```

3. **Trigger Test Events**:
   Once connected, trigger mock events:
   ```bash
   # Trigger a follow event
   twitch event trigger channel.follow --transport=websocket
   
   # Trigger other events
   twitch event trigger channel.subscribe --transport=websocket
   twitch event trigger channel.cheer --transport=websocket
   ```

### Testing Scenarios

**Test Reconnect Flow:**
```bash
# After connection is established, trigger a reconnect:
twitch event websocket reconnect
```
This tests that EventManager properly handles Twitch's session reconnect flow, preserving the old connection until the new session is established.

**Test Keepalive:**
The mock server automatically sends keepalive messages. Verify that your EventManager properly handles these and resets the idle timer.

**Test Error Handling:**
```bash
# Force close the connection:
twitch event websocket close --session=<session-id> --reason=4001
```
This tests reconnection logic and error recovery.

**Test Subscription Revocation:**
```bash
# Revoke a subscription:
twitch event websocket subscription --status=revoked --subscription=<sub-id>
```
This tests how EventManager handles subscription revocations.

### What to Verify

When testing, verify:
- ✅ Connection establishes successfully
- ✅ `session_welcome` message is received and session ID is stored
- ✅ Subscriptions are created automatically after welcome
- ✅ Token refresh occurs if token is expired
- ✅ Events are received and queued properly
- ✅ Reconnect flow preserves old connection during renewal
- ✅ Keepalive messages reset idle timer
- ✅ Error handling and reconnection work correctly

## Resources

- [Twitch CLI Setup](https://dev.twitch.tv/docs/cli/configure-command/)
- [Twitch CLI WebSocket Events](https://dev.twitch.tv/docs/cli/websocket-event-command/)
- [Twitch EventSub WebSocket Events](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/)