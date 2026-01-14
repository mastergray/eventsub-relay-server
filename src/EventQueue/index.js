// Asynchornous queue for handling WebSocket messages we can operate on:
export default class EventQueue {

    /**
     * 
     *  Static Fields 
     * 
     */

    static MODES = {   // Possible "states" of queue
        "STOPPED":0,   // Queue IS NOT currently recieving messages
        "ACTIVE":1     // Queu IS recieving message
    }

    /**
     * 
     *  Instance Fields
     * 
     */

    queue = [];     // Stores messages in 
    queueHead = 0;  // Current index of message to read from queue
    queueDelay;     // How often messages are read from queue
    queueMax;       // Maximum number of messages in queue
    queueTimer;     // Stores timeout used when reading messages from queue
    lastActive;     // Timestamp for when last message was added to queue
    idleSince;      // Timestampe for how long queue has been idle for 
    mode;           // Current state of queue
    onMessage;      // Function that operates on a recieved message
    onError;        // Function that operation on a queue error
    onIdle;         // Function that operates on queue when no messages are available

    /**
     *
     *
     *  CONSTRUCTOR  
     * 
     */

    // CONSTRUCTOR :: {queueDelay:NUMER|VOID, queueMax:NUMBER|VOID, onMessage:(msg, eventQueue) -> PROMISE(VOID)|VOID, onError:(err, eventQueue) -> PROMISE(VOID)|VOID, onIdle:(eventQueue) -> PROMISE(VOID)|VOID} -> this
    constructor({queueDelay, queueMax, onMessage, onError, onIdle}) {
        
        // Set polices (or there defaults): 
        this.queueDelay = queueDelay ?? 250;
        this.queueMax = queueMax ?? 1000;

        // Set handlers (or there defaults):
        this.onMessage = typeof(onMessage) === "function" ? onMessage : async (msg, eventQueue) => console.log(msg)
        this.onError = typeof(onError) === "function" ? onError : async (err, eventQueue) => console.error(err);
        this.onIdle = typeof(onIdle) === "function" ? onIdle : async (eventQueue) => console.log(eventQueue.idleSince);

        // Set default "mode":
        this.mode = EventQueue.MODES.STOPPED;
    
    }

    /**
     * 
     *  Lookup (GETTERs without SETTERs:) 
     * 
     */

    // GETT :: VOID -> NUMBER
    // Number of messages in queue:
    get size() {
        return this.queue.length - this.queueHead;
    }

    /**
     * 
     *  Instance Methods 
     * 
     */

    // :: VOID -> VOID
    // Starts queue:
    start() {
        if (this.mode !== EventQueue.MODES.ACTIVE) {
            this.mode = EventQueue.MODES.ACTIVE;    // Updates mode
            this.tick();                            // Initiates first "tick" of the "queueTimer"
        }
    }

    // :: VOID -> VOID
    // Stops queue:
    stop() {
         if (this.mode !== EventQueue.MODES.STOPPED) {
            this.mode = EventQueue.MODES.STOPPED;
            this.idleSince = null;
            this.lastActive = null;
            clearTimeout(this.queueTimer);
            this.queueTimer = null
        }
    }

    // :: JSON -> PROMISE(BOOL)
    // Adds message to queue:
    async send(msg) {

        // Ensure queue can recieve messages:
        if (this.mode === EventQueue.MODES.ACTIVE) {

            // Update last active when message is recieved:
            this.lastActive = Date.now();
        
            // Check if queue can still recieve messages:
            if ((this.queue.length - this.queueHead) >= this.queueMax) {
                await this.onError(new Error("Queue overflow"), this);
                return;
            }

            // Otherwise add new message to queue:
            this.queue.push(msg);

            // Message sent:
            return true;

        } 

        // No Message sent:
        return false;
        
    }

    // :: VOID -> VOID
    // Iterates the "queue timer" each time the queue has been processed:
    tick() {

        // Only  if queueTImer hasn't been set - this prevents multiple timeouts from being started:
        if (!this.queueTimer) {

            // Create new timer "tick":
             this.queueTimer = setTimeout(async () => {
                
                try {
                    
                    // Clear timer to prevent multiple timers befrom being set:
                    this.queueTimer = null;

                    // Ensure queue is actually active before processing:
                    if (this.mode === EventQueue.MODES.ACTIVE) {
                        await this.process();
                    } 

                } catch (err) {

                    // Handle errors:
                    await this.onError(err, this)
                } 

                // Initiate next tick if queue is still active:
                if (this.mode === EventQueue.MODES.ACTIVE) {
                     this.tick();
                }
            
            }, this.queueDelay);

        }
       
    }

    // :: VOID -> PROMISE(VOID)
    // Handles queue processing while queue is ACTIVE:
    // NOTE: Error is handled by "tick" method:
    // NOTE: No need to check MODE since process is only called by tick, and tick already checks mode
    async process() {

        // Number of messages determines if queue is idle or not:
        if (this.size > 0) {

            // Queue no longer idle:
            this.idleSince = null;

            // Handle mesages in queue:
            // NOTE: This is to "drain" all messages so we can read more than once message per "tick" of the queue timer:
            while (this.mode === EventQueue.MODES.ACTIVE && this.queueHead < this.queue.length) {
                const msg = this.queue[this.queueHead++];
                await this.onMessage(msg, this);
            }

            // Reset head to read next batch of messages on next "tick" of queue timer:
            this.queueHead = 0;
            this.queue = [];

        } else {
        
            // Handle idle queue:
            if (this.idleSince == null) this.idleSince = Date.now();
            await this.onIdle(this);
        }

    }

    /**
     * 
     *  Static Methods 
     * 
     */

    // Static Factory Method :: {queueDelay:NUMER|VOID, queueMax:NUMBER|VOID, onMessage:(msg, eventQueue) -> PROMISE(VOID)|VOID, onError:(err, eventQueue) -> PROMISE(VOID)|VOID, onIdle:(eventQueue) -> PROMISE(VOID)|VOID} -> eventQueue
    static init(config) {
        return new EventQueue(config ?? {});
    }

}