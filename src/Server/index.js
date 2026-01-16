// Dependencies:
import express from "express";              // Implements server
import cookieParser from "cookie-parser";   // Handles cookies
import os from "os";                        // For reading IP address from network interface
import EventManager from "../EventManager/index.js";  // For managing EventSub WebSocket connections
import EventQueue from "../EventQueue/index.js";  // For accessing EventQueue.MODES

// Initializes Express Server from config :: {PORT}, oAuthManger, tokenStore, eventManager -> VOID
export default (config, oauthManager, tokenStore, eventManager) => {

    // Destructure config and initalize instance:
    const {PORT} = config ?? {PORT:3000};
    const app = express();

    /**
     * 
     *  Middleware
     * 
     */

    // For recieving JSON body parameters:
    app.use(express.json());

    // For working with cookies:
    app.use(cookieParser());

    /**
     * 
     * Routes
     * 
     */

    // GET :: Main "status" route:
    app.get("/", (req, res, next) => {
        res.json({"status":"live"});
    });


    // GET :: Redirect to Twitch authorization endpoint:
    app.get("/auth", (req, res, next) => {
        
        // Generate unique value for nounce "state":
        const state = oauthManager.generateState();

        // Store state in cookie:
        res.cookie("oauth_state", state, {
            httpOnly: true,
            sameSite: "lax",
            secure: false,          // true if https
            maxAge: 5 * 60 * 1000,  // 5 min
            path: "/callback",
        });

        // Get URL for authorization endpoint and redirect to that endpoint:
        const url = oauthManager.getAuthorizationURL(state); 
        res.redirect(url);

    });

    // GET :: Exchanges authorization code for tokens:
    app.get("/callback", async (req, res, next) => {

        // Get query parameters and "state" from cookie:
        const { code, state } = req.query;
        const cookieState = req.cookies.oauth_state;

        // Alwayss clear cookie to ensure it's one-time use:
        res.clearCookie("oauth_state", { path: "/callback" });

        // Reject if there is no code set:
        if (!code) {
            return res.status(400).send("Missing authorization code");
        }

        // Reject if codes don't match:
        if (!state || !cookieState || state !== cookieState) {
            return res.status(400).send("Invalid OAuth state");
        }

        try {
            
            // Exchange code for tokens:
            const token = await oauthManager.exchangeCodeForToken(code);

            // Persist tokens:
            await tokenStore.updateStore({
                access_token: token.access_token,
                refresh_token: token.refresh_token,
                expires_in: token.expires_in,
                scope: token.scope,
            });

            // Update message:
            console.log("Tokens updated!")

            // Redirect away from callback (never leave code in URL):
            res.redirect("/");
        
        } catch (err) {

            // Handle any errors:
            console.error("OAuth callback failed:", err);
            res.status(500).send("OAuth authorization failed");
        
        }

    })

    // GET :: Start EventManager monitoring:
    app.get("/monitor", async (req, res, next) => {
        try {
            const currentState = eventManager.connectionState;
            
            if (currentState === EventManager.WS_STATES.ACTIVE) {
                return res.json({
                    status: "already_monitoring",
                    connectionState: "ACTIVE"
                });
            }
            
            if (currentState === EventManager.WS_STATES.CONNECTING) {
                return res.json({
                    status: "already_connecting",
                    connectionState: "CONNECTING",
                    message: "Connection is already in progress, please wait"
                });
            }
            
            await eventManager.launch();
            res.json({
                status: "monitoring_started",
                connectionState: "CONNECTING"
            });
        } catch (err) {
            console.error("Failed to start monitoring:", err);
            res.status(500).json({
                status: "error",
                error: err.message
            });
        }
    });

    // GET :: Get EventManager status:
    app.get("/monitor/status", (req, res, next) => {
        const states = EventManager.WS_STATES;
        const stateNames = Object.keys(states).find(key => states[key] === eventManager.connectionState);
        
        res.json({
            connectionState: stateNames || "UNKNOWN",
            hasConnection: !!eventManager.wsConnection,
            queueMode: eventManager.mode === EventQueue.MODES.ACTIVE ? "ACTIVE" : "STOPPED"
        });
    });

    /**
     * 
     *  Startup 
     * 
     */

    const server = app.listen(PORT, () => {
        console.log(`Server listening on:\n\n\t http://localhost:${PORT}\n\t http://${getLocalIP()}:${PORT}\n`);
    });

}

/**
 * 
 * Support Functions 
 * 
 */


// :: VOID -> STRING
// Retuns locap IP address of host this server is running from:
function getLocalIP() {
  
    // Get interfaces to read IP address from:
    const nets = os.networkInterfaces();

    // Return first used IP:
    for (const addrs of Object.values(nets)) {
        for (const a of addrs ?? []) {
            const family = typeof a.family === "string" ? a.family : `IPv${a.family}`;
            if (family === "IPv4" && !a.internal) {
            return a.address;
            }
        }
    }

    // Otherwise ONLY return "localhost" if no IPs are found for whatever reason:
    return "localhost";

}