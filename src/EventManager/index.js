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
    static SUB_URL = "https://api.twitch.tv/helix/eventsub/subscriptions"   // Endpoint for creating a subscription with
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
    accessToken;        // Twitch API OAuth User Access Token
    userID;             // Twitch User ID               
    broadcasterID;      // Twithc User ID of a broadcaster (i.e. the streamer we detecting events for)
    subscriptionTypes;  // Array of subscription we are creating after a websocket connection has successfully been created


    /**
     * 
     *  CONSTRUCTOR
     * 
     */

    // CONSTRUCTOR :: {keepAlive:NUMBER, keepAliveOffSet:NUMBER, maxRetry:NUMBER, retryDelay:NUMBER, queueDelay:NUMBER, queueMax:NUMBER, clientID:STRING, accessToken:STRING, userID:STRING, broadcasterID:STRING, subscriptionTypes:[STRING]} -> this
    constructor(config = {}) {
        super(config.queueDelay, config.queueMax);
        this.keepAlive = config.keepAlive ?? 30
        this.keepAliveOffset = config.keepAliveOffset ?? 500
        this.retryDelay = config.retryDelay ?? 500;
        this.maxRetry = config.maxRetry ?? 10
        this.connectionState = EventManager.WS_STATES.STOPPED;
        this.clientID = config.clientID;
        this.accessToken = config.accessToken;
        this.userID = config.userID;
        this.broadcasterID = config.broadcasterID
        this.subscriptionTypes = config.subscriptionTypes;
        this.start();   // Start Queue
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
                    console.log(payload);
                break;
    
                // TODO: Handle Chat Commands:
                case "NOTIFICATION":
                    console.log(payload);
                break;

                case "REVOCATION":
                    console.log(payload);
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
            // The idle check is only considered with trying to reconnect after an existing connection has timed out for whatever reason:
            if (this.wsConnection?.readyState !== WebSocket.OPEN) return;

            // Check to see if it's been long enough to try and reconnect:
            if (idleFor > this.timeout) {
                this.wsConnection?.terminate();
                this.wsConnection = null;
                this.connectionState = EventManager.WS_STATES.STOPPED;
                this.send("RECONNECT", {"attempts":0});
            }
        } catch(err) {
            // Handle and error with "onError":
            this.onError("ON IDLE", err);
        }
    }

    // OVERRIDE :: STRING, ERROR -> PROMISE(VOID) 
    async onError(type, err) {
        console.error(err)
        console.error(`Occured Where: ${type}`);
    }


    // :: OVERRIDE :: STRING, * -> PROMISE(VOID)
    send(type, payload) {
        return super.send({type, payload});
    }

    // :: {url:STRING, attemps:NUMBER} -> PROMISE(VOID)
    // Establishs WebSockect connection:
    connect(config = {}) {


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
            console.log(`${new Date()} OPEN CONNECTION`)
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
                        this.send("SESSION_WELCOME", {
                            "oldConnection":config.oldConnection,
                            "sessionID": msg.payload.session.id,
                            "createSubs":config.createSubs ?? true
                        });
                    break;

                    case "session_keepalive":
                        this.send("SESSION_KEEPALIVE");
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

        // Abort operation if we are already "connecting":
        if (this.connectionState === EventManager.WS_STATES.CONNECTING) return;

        // Get attempts from config:
        const attempts = Number.isFinite(config.attempts) ? config.attempts : 0;

        // Check if we have met maximum number of attempts:
        if (attempts >= this.maxRetry) {

            // Propagate error to queue:
            this.onError("RECONNECT", new Error("Maximum Number Of Reconnection Retries Reached!"))     

            // Abort operation:
            return;

        }

        // Otherwise update state:
        this.connectionState = EventManager.WS_STATES.CONNECTING;

        // Attempt to reconnect using delay:
        setTimeout(() => {
            config.attempts = attempts + 1
            this.send("CONNECT", config);
        }, this.retryDelay);
       
    }

    // :: STRING -> PROMISE(VOID)
    // "Renews" existing connection when Twitch forces a session reconnect:
    // NOTE: This is so we can repurpose an existing event subscription with a new WebSocket sconnection:
    renew(url) {

        // Store old connection to terminate after we've established a new connection:
        const oldConnection = this.wsConnection;
        
        // Attempt new connection:
        this.send("CONNECT", {url, oldConnection, createSubs:false, attempts:0})

    }

    // :: {sessionID:STRING, oldConnection:WEBSOCKET|VOID, createSubs:BOOL|VOID} -> PROMISE(VOID)
    // Updates state, starts queue, and creates subscription for every stored subscription type:
    async startSession({sessionID, oldConnection, createSubs}) {

        // Update state:
        this.connectionState = EventManager.WS_STATES.ACTIVE;
        
        // Terminate old conection if included:
        oldConnection?.terminate();
        
        // Create subscriptions using session ID:
        if (createSubs) {
            return this.createSubscriptions(sessionID);
        }
    
    }

    // :: STRING -> PROMISE([VOID])
    // Create subscriptions for all stored subscription types using the given session ID:
    async createSubscriptions(sessionID) {
              
        // Make requests for each subscription type we need to create:
        const subscriptions = this.subscriptionTypes.map((subscriptionType) =>{
            return this.createSubscription(sessionID, subscriptionType);
        });

        // Return promise of those requests:
        return Promise.all(subscriptions);
        
    }

    // :: STRING -> PROMISE(VOID)
    // Makes request to create subscription for recieving notfications with:
    async createSubscription(sessionID, subscriptionType) {

         const res = await fetch(EventManager.SUB_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.accessToken}`,
                "Client-Id": this.clientID,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
            type: subscriptionType,
            version: "1",
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
            throw new Error(`EventSub subscription failed (${res.status}): ${text}`);
        }

        return res.json();
        
    }

    /**
     * 
     *  Static Methods 
     * 
     */

    // Static Factory Method :: {keepAlive:NUMBER, keepAliveOffSet:NUMBER, maxRetry:NUMBER, retryDelay:NUMBER, queueDelay:NUMBER, queueMax:NUMBER, clientID:STRING, accessToken:STRING, userID:STRING, broadcasterID:STRING, subscriptionTypes:[STRING]} -> EventManager
    static init(config) {
        return new EventManager(config);
    }

}