// Dependencies:
import startServer from "./src/Server/index.js";        // "starts" the server...
import fs from "fs";                                    // Loads the config
import { parse } from "jsonc-parser";                   // Parses config into JSON
import OAuthManager from "./src/OAuthManager/index.js"; // For handling OAuth call
import TokenStore from "./src/TokenStore/index.js";     // For storing OAuth tokens
import EventManager from "./src/EventManager/index.js"; // For managing EventSub WebSocket connections
import NotificationManager from "./src/NotificationManager/index.js"; // For routing notifications to handlers

// Get config from command line, load config, and parse config into JSON:
const [filename] = process.argv.slice(2);
const jsonc = fs.readFileSync(filename, "utf8");
const config = parse(jsonc);

// START PROCESS \\
(async () => {

    // Load token store:
    const tokenStore = await TokenStore.init(config.tokenStore);

    // Initialize OAuthManager:
    const oauthManger = new OAuthManager(config);

    // Create and configure NotificationManager:
    const notificationManager = new NotificationManager()
        .register("channel.follow", async (notification) => {
            console.log("[NotificationManager] New follower:", notification.event);
        })
        .register("channel.subscribe", async (notification) => {
            console.log("[NotificationManager] New subscriber:", notification.event);
        })
        .register("channel.cheer", async (notification) => {
            console.log("[NotificationManager] New cheer:", notification.event);
        })
        .registerCommand("help", async (params, username) => {
            console.log(`[NotificationManager] User ${username} requested help: ${params}`);
        })

    // Initialize EventManager:
    const eventManager = EventManager.init({
        clientID: config.client_id,
        tokenStore: tokenStore,
        oauthManager: oauthManger,
        userID: config.userID,
        broadcasterID: config.userID, // or config.broadcasterID if added
        subscriptionTypes: config.subscriptionTypes ?? [],
        notificationManager: notificationManager,
        // Optional: allow config overrides
        keepAlive: config.keepAlive,
        keepAliveOffset: config.keepAliveOffset,
        retryDelay: config.retryDelay,
        maxRetry: config.maxRetry,
        queueDelay: config.queueDelay,
        queueMax: config.queueMax,
    });

    // Lauch server:
    startServer(config, oauthManger, tokenStore, eventManager);

})();

