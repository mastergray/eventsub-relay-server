// Dependencies:
import startServer from "./src/Server/index.js";        // "starts" the server...
import fs from "fs";                                    // Loads the config
import { parse } from "jsonc-parser";                   // Parses config into JSON
import OAuthManager from "./src/OAuthManager/index.js"; // For handling OAuth call
import TokenStore from "./src/TokenStore/index.js";     // For storing OAuth tokens
import EventManager from "./src/EventManager/index.js"; // For managing EventSub WebSocket connections

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

    // Initialize EventManager:
    const eventManager = EventManager.init({
        clientID: config.client_id,
        tokenStore: tokenStore,
        oauthManager: oauthManger,
        userID: config.userID,
        broadcasterID: config.userID, // or config.broadcasterID if added
        subscriptionTypes: config.subscriptionTypes ?? [],
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

