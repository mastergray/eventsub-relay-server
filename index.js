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

// Helper function:
// Makes request to vSeq visualization server using commands from chat:
async function vSeqRequest (command, value) {
    try {

        // Send Request:r
        const res = await fetch(config.vSeqURL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                type: "vseq-runner",
                command,
                value
            })
        });

        // HTTP-level failure (4xx / 5xx)
        if (!res.ok) {
            const text = await res.text(); // don’t assume JSON on errors
            throw new Error(`HTTP ${res.status}: ${text}`);
        }

        // Application-level success
        const data = await res.json();
        return data;

    } catch (err) {
        // Only console out error if anything goes wrong:
        console.error(err);
    }

}

// START PROCESS \\
(async () => {

    // Load token store:
    const tokenStore = await TokenStore.init(config.tokenStore);

    // Initialize OAuthManager:
    const oauthManger = new OAuthManager(config);

    // Create and configure NotificationManager:
    const notificationManager = new NotificationManager()

        /** 
         * 
         *  Test Notifcation handlers: 
         * 
         */


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

        /**
         * 
         *  Chat Commands 
         * 
         */

        // !load 1|2|3|4 :: Loads specific config
        // If value not valid config ID - ignores command:
        .registerCommand("load", async ([configID], username) => {
            console.log(`[NotificationManager] User ${username} requested load config: ${configID}`);

            // Available configs:
            const configs = [
                "twitch2",
                "z-static-wave",
                "z-square-mesh",
                "z-learning",
                "z-red-grid-alt"
            ]

            // Parse configID as integer (params come as strings):
            const configIndex = parseInt(configID, 10) - 1;

            // Get config by config ID (validate index is in range):
            if (configIndex >= 0 && configIndex < configs.length) {
                const selectedConfig = configs[configIndex];
                await vSeqRequest("loadConfig", selectedConfig);
            } else {
                console.log(`[NotificationManager] Invalid config ID: ${configID}`);
            }
        })

        // !clear :: Clears canvas
        .registerCommand("clear", async ([configID], username) => {
            await vSeqRequest("clearCanvas");
        })

        // !bg HEX :: set background color with valid hex code:
        // NOTE: If value is not valid hex code, ignores commands:
        .registerCommand("bg", async ([color], username) => {
            const HEX_RGB_REGEX = /^#[0-9a-fA-F]{6}$/;
            if (HEX_RGB_REGEX.test(color)) {
                 await vSeqRequest("setCanvasBackground", {color});
            }
        })

        // !speed ::Sets speed of all beams using the given INT (from 0 to 1000)
        // NOTE: If value is not valid INT, ignores command:
        .registerCommand("speed", async ([speed], username) => {
            // Parse speed as integer (params come as strings):
            const speedValue = parseInt(speed, 10);
            if (!isNaN(speedValue) && speedValue >= 0 && speedValue <= 1000) {
                await vSeqRequest("setBeamSpeed", {speed: speedValue});
            }
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

    // Graceful shutdown handlers:
    const shutdown = async (signal) => {
        console.log(`\n[Server] Received ${signal}, shutting down gracefully...`);
        try {
            await eventManager.shutdown();
            console.log("[Server] EventManager shut down successfully");
            process.exit(0);
        } catch (err) {
            console.error("[Server] Error during shutdown:", err);
            process.exit(1);
        }
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

})();

