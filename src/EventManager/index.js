// Dependencies:
import WebSocket from "ws";                         // Handles WebSocket connections:
import EventQueue from "../EventQueue/index.js";    // Handles message from web socket connection;

// Handles Events dispatched from a WebSocket connection:
export default class EventManager extends EventQueue {

    /**
     * 
     *  Staitc Fields 
     * 
     */

    static WS_URL = "wss://eventsub.wss.twitch.tv/ws";                      // Twitch's WebSocket we are connecting to:
    static SUB_URL = "https://api.twitch.tv/helix/eventsub/subscriptions";   // Endpoint for creating a subscription with
    static WS_STATES = {                                                    // "State" of WebSocket connection
        "STOPPED":0,                                                        // WebSocket connection IS NOT recieving messages
        "ACTIVE":1,                                                         // WebSocket connection IS recieving message
        "CONNECTING":2,                                                     // WebSocket connection is currently being established
    }

    /**
     * 
     * Instace Fields 
     * 
     */

    wsConnection;       // Stores WebSocket connection
    connectionState;    // "State" of connection
    keepAlive;          // Keep Alive timeout value we send to Twitch
    keepAliveOffset;    // keepalive + offset determines when to rety a connection
    retryDelay;         // How long to wait before trying to reconnect
    maxRetry = 0;       // Number of times to try and reconnect before throwing exception
    
    clientID;           // Twitch API OAuth Client ID
    tokenStore;        // TokenStore instance for managing access tokens
    oauthManager;      // OAuthManager instance for refreshing tokens
    userID;             // Twitch User ID               
    broadcasterID;      // Twithc User ID of a broadcaster (i.e. the streamer we detecting events for)
    subscriptionTypes;  // Array of subscription objects {version:NUMBER, type:STRING} we are creating after a websocket connection has successfully been created
    notificationManager; // NotificationManager instance for routing notifications to handlers


    /**
     * 
     *  CONSTRUCTOR
     * 
     */

    // CONSTRUCTOR :: {keepAlive:NUMBER, keepAliveOffSet:NUMBER, maxRetry:NUMBER, retryDelay:NUMBER, queueDelay:NUMBER, queueMax:NUMBER, clientID:STRING, tokenStore:TokenStore, oauthManager:OAuthManager, userID:STRING, broadcasterID:STRING, subscriptionTypes:[{version:NUMBER, type:STRING}], notificationManager:NotificationManager|VOID} -> this
    constructor(config = {}) {
        super(config.queueDelay, config.queueMax);
        this.keepAlive = config.keepAlive ?? 30
        this.keepAliveOffset = config.keepAliveOffset ?? 500
        this.retryDelay = config.retryDelay ?? 500;
        this.maxRetry = config.maxRetry ?? 10
        this.connectionState = EventManager.WS_STATES.STOPPED;
        this.clientID = config.clientID;
        this.tokenStore = config.tokenStore;
        this.oauthManager = config.oauthManager;
        this.userID = config.userID;
        this.broadcasterID = config.broadcasterID
        this.subscriptionTypes = config.subscriptionTypes;
        this.notificationManager = config.notificationManager;
        this.start();   // Start Queue
    }

    // :: VOID -> PROMISE(VOID)
    // Starts queue and connects to web socket server:
    async launch() {

        // Start queue:
        super.start();

        // Connect to web socket server:
        await this.send("CONNECT");

    }


    /**
     * 
     *  Lookups (GETTERs without SETTER) 
     * 
     */

    // GETTER :: VOID -> NUMBER
    // Determines how long is to long since last recieved message:
    get timeout() {
        return (this.keepAlive * 1000) + this.keepAliveOffset;
    }

    // :: GETTER :: VOID -> STING
    // Returns URL we are make WebSocket connection to:
    get url() {
        return EventManager.WS_URL + "?keepalive_timeout_seconds=" + this.keepAlive;
    }

    // GETTER :: VOID -> STRING|VOID
    // Returns current access token from tokenStore:
    get accessToken() {
        return this.tokenStore?.access_token;
    }

    /**
     * 
     *  Instance Methods 
     * 
     */

    // OVERRIDE :: JSON -> PROMISE(VOID) 
    async onMessage(msg) {
        try {
            // Destructure message:
            const {type, payload} = msg;

            // Handle message by "type":
            switch (type) {

                case "CONNECT":
                    this.connect(payload);
                break;

                case "RECONNECT":
                     this.reconnect(payload);
                break;

                case "SESSION_WELCOME":
                    await this.startSession(payload);
                break;

                case "SESSION_RECONNECT":
                    this.renew(payload);
                break;

                case "SESSION_KEEPALIVE":
                    // Keepalive received - no action needed, just resets idle timer
                break;
    
                case "NOTIFICATION":
                    if (this.notificationManager) {
                        await this.notificationManager.handle(payload);
                    } else {
                        console.log(`[EventManager] NOTIFICATION received:`, JSON.stringify(payload, null, 2));
                    }
                    break;

                case "REVOCATION":
                    console.log(`[EventManager] REVOCATION received:`, JSON.stringify(payload, null, 2));
                    break;

            }
 
        } catch (err) {

            // Propagate error to queue:
            this.onError("ON_MESSAGE", err);

        }

    } 

    // OVERRIDE :: idleFor -> PROMISE(VOID)
    async onIdle(idleFor) {
  
        try {
            // Capture reference to avoid race condition
            const ws = this.wsConnection;
            
            // The idle check is only considered with trying to reconnect after an existing connection has timed out for whatever reason:
            if (ws?.readyState !== WebSocket.OPEN) return;

            // Don't terminate if we're currently connecting (might be a renewal)
            if (this.connectionState === EventManager.WS_STATES.CONNECTING) return;

            // Check to see if it's been long enough to try and reconnect:
            if (idleFor > this.timeout) {
                // Only terminate if this is still the active connection and we're not in a renewal
                if (this.wsConnection === ws && this.connectionState === EventManager.WS_STATES.ACTIVE) {
                    ws.terminate();
                    this.wsConnection = null;
                    this.connectionState = EventManager.WS_STATES.STOPPED;
                    this.send("RECONNECT", {"attempts":0});
                }
            }
        } catch(err) {
            // Handle and error with "onError":
            this.onError("ON IDLE", err);
        }
    }

    // OVERRIDE :: STRING, ERROR -> PROMISE(VOID) 
    async onError(type, err) {
        // Handle calls from EventQueue (single Error param) vs EventManager (type, err)
        if (type instanceof Error) {
            // Called from EventQueue - type is actually the error
            console.error(type);
            console.error(`Occured Where: QUEUE`);
            super.onError(type);
        } else {
            // Called from EventManager - normal (type, err) signature
            console.error(err)
            console.error(`Occured Where: ${type}`);
            super.onError(err);
        }
    }


    // :: OVERRIDE :: STRING, * -> PROMISE(VOID)
    send(type, payload) {
        return super.send({type, payload});
    }

    // :: {url:STRING, attemps:NUMBER} -> PROMISE(VOID)
    // Establishs WebSockect connection:
    connect(config = {}) {

        // Guard against concurrent connection attempts
        // BUT allow Twitch-initiated renewals (indicated by oldConnection in config)
        if (this.connectionState === EventManager.WS_STATES.CONNECTING) {
            if (config.oldConnection) {
                // This is a renewal - allow it but don't terminate the old connection yet
                // The old connection will be terminated in startSession() after new session is established
            } else {
                // Duplicate fresh connection attempt - ignore
                return;
            }
        }

        // Terminate any existing connection before creating new one
        // BUT preserve it if it's the oldConnection we're intentionally keeping alive (renewal scenario)
        if (this.wsConnection && this.wsConnection !== config.oldConnection) {
            this.wsConnection.terminate();
            this.wsConnection = null;
        }

        // Set status to "connecting" until connection is established:
        this.connectionState = EventManager.WS_STATES.CONNECTING;

        // Create new websocket instance using URL:
        const ws = new WebSocket(config.url ?? this.url);
        this.wsConnection = ws;

        /**
         * 
         *  WebSocket Event Handlers 
         * 
         */

        // What to do when WebSocket is first opened:
        ws.on("open", () => {
            console.log(`[EventManager] WebSocket connected`);
        });

        // What to do when a message is recieved from the webSocket:
        ws.on("message", async (data) => {

            // Abort operation if we suspect this websocket is "stale" due to a renewed connection:
            if (this.wsConnection !== ws) return;

            try {

                // Convert WebSocket data into JSON:
                const msg = JSON.parse(data.toString());

                // Get message type from messagae data:
                const type = msg?.metadata?.message_type

                // Propagate message by type:
                switch(type) {

                    case "session_welcome":
                        console.log(`[EventManager] Session welcome received, session ID: ${msg.payload.session.id}`);
                        this.send("SESSION_WELCOME", {
                            "oldConnection":config.oldConnection,
                            "sessionID": msg.payload.session.id,
                            "createSubs":config.createSubs ?? true
                        });
                    break;

                    case "session_keepalive":
                        this.send("SESSION_KEEPALIVE", msg.payload);
                    break;

                    case "session_reconnect":
                        this.send("SESSION_RECONNECT", msg.payload.session.reconnect_url);
                    break;

                    case "notification":
                        this.send("NOTIFICATION", msg.payload);
                    break;

                    case "revocation":
                        this.send("REVOCATION", msg.payload);
                    break;

                    // NOTE: For now - we'll just console out the unknown message type:
                    default:
                        console.error(`Unkown Message Type: ${type}`)
                }

            } catch (err) {

                // Propagage error to queue:
                this.onError("WS_MESSAGE", err);
            
            }

        });

        // What to do when websocket is closed:
        ws.on("close", () => {

            // Abort operation if we suspect this websocket is "stale" due to a renewed connection:
            if (this.wsConnection !== ws) return;

            // Always attempt to reconnect on close regardless of state (this is in case a connection is lost while ACTIVE):
            // NOTE: THis is fine for now because to actually shutdown the connection intentioally - we'd shutdown the service calling EventManager anyway:
            this.connectionState = EventManager.WS_STATES.STOPPED;
            this.wsConnection = null;
            this.send("RECONNECT", config);

        });

        // What to do when wbesocket has an error:
        ws.on("error", (err) => {
            console.error(`[EventManager] WebSocket error:`, err);

            // Abort operation if we suspect this websocket is "stale" due to a renewed connection:
            if (this.wsConnection !== ws) return;

            // Propagate error to queue:
            this.onError("WS_ERROR", err);

            // Any error should "stop" the manager so we can attempt reconnect:
            this.connectionState = EventManager.WS_STATES.STOPPED;

            // Ensure we terminate the websocket connection that through the error:
            ws.terminate();

            // Clean up connection and attempt reconnect:
            this.wsConnection = null;
            this.send("RECONNECT", config);

        });

    }

    // :: {url:STRING|VOID, attempts:NUMBER|VOID} -> PROMISE(VOID)
    // Recursively attempt to re-connect to WebSocket server:
    // NOTE: The promise is rejected if number of connection retries are exceeded:
    reconnect(config = {}) {
        // Abort operation if we are already "connecting" (might be a Twitch renewal):
        if (this.connectionState === EventManager.WS_STATES.CONNECTING) return;
        
        // Abort if we have an active connection (Twitch is handling it):
        if (this.wsConnection?.readyState === WebSocket.OPEN) return;

        // Get attempts from config:
        const attempts = Number.isFinite(config.attempts) ? config.attempts : 0;

        // Check if we have met maximum number of attempts:
        if (attempts >= this.maxRetry) {
            // Propagate error to queue:
            this.onError("RECONNECT", new Error("Maximum Number Of Reconnection Retries Reached!"));

            // Abort operation:
            return;
        }

        // Otherwise update state:
        this.connectionState = EventManager.WS_STATES.CONNECTING;

        // Attempt to reconnect using delay:
        setTimeout(() => {
            // Double-check state hasn't changed during delay (e.g., Twitch renewal started)
            // Only proceed if we're still in CONNECTING state and don't have an active connection
            if (this.connectionState === EventManager.WS_STATES.CONNECTING && 
                this.wsConnection?.readyState !== WebSocket.OPEN) {
                config.attempts = attempts + 1
                this.send("CONNECT", config);
            } else {
                // State changed - likely a Twitch renewal or connection was established
                this.connectionState = this.wsConnection?.readyState === WebSocket.OPEN 
                    ? EventManager.WS_STATES.ACTIVE 
                    : EventManager.WS_STATES.STOPPED;
            }
        }, this.retryDelay);
       
    }

    // :: STRING -> PROMISE(VOID)
    // "Renews" existing connection when Twitch forces a session reconnect:
    // NOTE: This is so we can repurpose an existing event subscription with a new WebSocket sconnection:
    renew(url) {
        // Store old connection to terminate after we've established a new connection:
        // This is a Twitch-initiated renewal - we must preserve the old connection
        // until the new session is established (handled in startSession)
        const oldConnection = this.wsConnection;
        
        // Attempt new connection with oldConnection preserved:
        // connect() will check for oldConnection and allow the renewal to proceed
        this.send("CONNECT", {url, oldConnection, createSubs:false, attempts:0})
    }

    // :: {sessionID:STRING, oldConnection:WEBSOCKET|VOID, createSubs:BOOL|VOID} -> PROMISE(VOID)
    // Updates state, starts queue, and creates subscription for every stored subscription type:
    async startSession({sessionID, oldConnection, createSubs}) {
        console.log(`[EventManager] Session established: ${sessionID}`);

        // Update state:
        this.connectionState = EventManager.WS_STATES.ACTIVE;
        
        // Terminate old conection if included:
        oldConnection?.terminate();
        
        // Create subscriptions using session ID:
        if (createSubs) {
            try {
                await this.createSubscriptions(sessionID);
                console.log(`[EventManager] All subscriptions created successfully`);
            } catch (err) {
                console.error(`[EventManager] Failed to create subscriptions:`, err);
                throw err;
            }
        }
    }

    // :: STRING -> PROMISE([VOID])
    // Create subscriptions for all stored subscription types using the given session ID:
    async createSubscriptions(sessionID) {
        if (!this.subscriptionTypes || this.subscriptionTypes.length === 0) {
            console.warn(`[EventManager] No subscription types configured - no subscriptions will be created`);
            return [];
        }
              
        // Make requests for each subscription type we need to create:
        const subscriptions = this.subscriptionTypes.map((subscription) => {
            return this.createSubscription(sessionID, subscription);
        });

        // Return promise of those requests:
        return Promise.all(subscriptions);
        
    }

    // :: VOID -> PROMISE(VOID)
    // Ensures access token is valid, refreshing if necessary:
    async ensureValidToken() {
        // If we don't have tokenStore/oauthManager, skip validation
        if (!this.tokenStore || !this.oauthManager) {
            return; // Can't validate/refresh without these
        }

        // Check if token is expired (with small buffer, e.g., 60 seconds)
        const bufferMs = 60 * 1000; // Refresh 60 seconds before expiry
        if (this.tokenStore.isExpired(bufferMs)) {
            try {
                // Refresh the token
                const newTokens = await this.oauthManager.refreshAccessToken(
                    this.tokenStore.refresh_token
                );

                // Update token store with new tokens
                await this.tokenStore.updateStore({
                    access_token: newTokens.access_token,
                    refresh_token: newTokens.refresh_token,
                    expires_in: newTokens.expires_in,
                    scope: newTokens.scope,
                });
            } catch (err) {
                // Propagate error - can't create subscriptions without valid token
                throw new Error(`Failed to refresh access token: ${err.message}`);
            }
        }
    }

    // :: STRING, {version:NUMBER, type:STRING} -> PROMISE(VOID)
    // Makes request to create subscription for recieving notfications with:
    async createSubscription(sessionID, subscription) {
        // Ensure token is valid before attempting to create subscription
        await this.ensureValidToken();

        const res = await fetch(EventManager.SUB_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.accessToken}`,
                "Client-Id": this.clientID,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
            type: subscription.type,
            version: String(subscription.version),
            condition: {
                broadcaster_user_id: this.broadcasterID,
                user_id: this.userID,
            },
            transport: {
                method: "websocket",
                session_id: sessionID,
            },
            }),
        });

        if (!res.ok) {
            const text = await res.text();
            console.error(`[EventManager] Subscription creation failed for ${subscription.type}:`, text);
            throw new Error(`EventSub subscription failed (${res.status}): ${text}`);
        }

        const result = await res.json();
        console.log(`[EventManager] Subscription created: ${subscription.type} (ID: ${result.data?.[0]?.id || 'unknown'})`);
        return result;
        
    }

    /**
     * 
     *  Static Methods 
     * 
     */

    // Static Factory Method :: {keepAlive:NUMBER, keepAliveOffSet:NUMBER, maxRetry:NUMBER, retryDelay:NUMBER, queueDelay:NUMBER, queueMax:NUMBER, clientID:STRING, tokenStore:TokenStore, oauthManager:OAuthManager, userID:STRING, broadcasterID:STRING, subscriptionTypes:[{version:NUMBER, type:STRING}]} -> EventManager
    static init(config) {
        return new EventManager(config);
    }

}