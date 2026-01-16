// Handles routing of Twitch EventSub notifications to registered handlers:
export default class NotificationManager {

    /**
     * 
     *  Instance Fields 
     * 
     */

    handlers = {};           // Object storing arrays of handlers keyed by subscription type
    commandHandlers = {};     // Object storing single handler per command name
    onNoHandler;              // Default handler called when no handlers match a notification

    /**
     * 
     *  CONSTRUCTOR
     * 
     */

    // CONSTRUCTOR :: {config:OBJECT|VOID} -> this
    constructor(config = {}) {
        // Future extensibility: config can be used for additional options
    }

    /**
     * 
     *  Instance Methods 
     * 
     */

    // :: STRING, FUNCTION -> this
    // Registers an async handler function for a specific subscription type:
    register(notificationType, fn) {
        // Initialize array if it doesn't exist:
        if (!this.handlers[notificationType]) {
            this.handlers[notificationType] = [];
        }
        
        // Add handler to array:
        this.handlers[notificationType].push(fn);
        
        // Return this for chaining:
        return this;
    }

    // :: STRING, FUNCTION -> this
    // Registers an async handler function for a specific chat command:
    registerCommand(command, fn) {
        // Store single handler per command (overwrites if already exists):
        this.commandHandlers[command] = fn;
        
        // Return this for chaining:
        return this;
    }

    // :: FUNCTION -> this
    // Registers a default handler called when no handlers match a notification:
    onNoHandler(fn) {
        this.onNoHandler = fn;
        
        // Return this for chaining:
        return this;
    }

    // :: OBJECT -> PROMISE(VOID)
    // Processes a notification by finding matching handlers and executing them:
    async handle(notification) {
        try {
            // Extract subscription type:
            const subscriptionType = notification?.subscription?.type;
            
            if (!subscriptionType) {
                // Invalid notification structure - silently skip:
                return;
            }

            // Special handling for "channel.chat.message" notifications:
            if (subscriptionType === "channel.chat.message") {
                // Get message text from notification:
                const messageText = notification?.event?.message?.text || notification?.event?.message_text || "";
                
                // Check if message starts with "!" prefix:
                if (messageText.startsWith("!")) {
                    // Parse command and params:
                    const parts = messageText.slice(1).trim().split(/\s+/);
                    const commandName = parts[0];
                    const params = parts.slice(1); // Empty array if no params
                    
                    // Look up command handler (case-sensitive, exact match):
                    const commandHandler = this.commandHandlers[commandName];
                    
                    if (commandHandler) {
                        // Extract username:
                        const username = notification?.event?.chatter_user_name || "";
                        
                        // Call command handler with (params, username):
                        try {
                            await commandHandler(params, username);
                        } catch (err) {
                            console.error(`[NotificationManager] Command handler error for "${commandName}":`, err);
                        }
                        
                        // STOP HERE - do NOT check generic handlers (prevents double-handling):
                        return;
                    }
                }
                
                // If no command handler matched, fall through to generic handler lookup below:
            }

            // For all notification types (including "channel.chat.message" when no command matched):
            // Look up handlers by subscription type:
            const handlers = this.handlers[subscriptionType];
            
            if (handlers && handlers.length > 0) {
                // Execute all handlers in parallel:
                try {
                    await Promise.all(handlers.map(handler => handler(notification)));
                } catch (err) {
                    console.error(`[NotificationManager] Handler error for "${subscriptionType}":`, err);
                }
            } else {
                // No handlers found - call default handler if registered:
                if (this.onNoHandler) {
                    try {
                        await this.onNoHandler(notification);
                    } catch (err) {
                        console.error(`[NotificationManager] Default handler error:`, err);
                    }
                }
            }
            
        } catch (err) {
            // Log error but don't throw (to prevent breaking EventManager):
            console.error(`[NotificationManager] Error processing notification:`, err);
        }
    }

}
