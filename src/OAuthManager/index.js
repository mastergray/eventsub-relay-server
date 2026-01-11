// Dependencies:
import crypto from "crypto";    // Used to generate "state" value;

// Class for working with OAuth requests
export default class OAuthManager {

    /**
     * 
     *  Static Fields
     *  
     */

    // Where we need to request authorization code from: 
    static REQUEST_AUTHORIZATION_CODE = {
        "url": "https://id.twitch.tv/oauth2/authorize",
        "response_type":"code",     // OAuth response type required by endpoint
        "scope":["user:read:chat"]  // Scopes needed for relay server (so far)
    }

    // Where we need to exchange authorization code for token:
    static REQUEST_TOKEN = {
        "url":"https://id.twitch.tv/oauth2/token",
        "grant_type":"authorization_code"   // OAuth request type required by endpoint for token exchange
    }

    // WHere we need to change refresh token for new tokens:
    static REQUEST_REFRESH = {
          "url":"https://id.twitch.tv/oauth2/token",
          "grant_type":"refresh_token" // OAuth request type required by endpoint for refreshing token
    }

    /**
     * 
     *  Instance Fields 
     * 
     */

    client_id;      // OAuth Client ID
    client_secret;  // OAuth Client Secret
    redirect_uri;   // OAuth Redirect URI

    // CONSTRUCTOR :: {client_id:STRING, client_secret: STRING, redirect_uri:STRING} -> this
    constructor({client_id, client_secret, redirect_uri}) {
        this.client_id = client_id;
        this.client_secret = client_secret;
        this.redirect_uri = redirect_uri;
    }

    /**
     * 
     *  Instance Methods 
     * 
     */

    // :: {client_id:STRING, redirect_URI:STRING, state:STRING} -> STRING
    // Returns URL for requesting authorization code to get a user access token with:
    // NOTE: This is intended to be redirected by the "/auth" route from the server:
    getAuthorizationURL(state) {

        // Destructure static field for authroization code request:
        const {url, response_type, scope} =  OAuthManager.REQUEST_AUTHORIZATION_CODE;

        // Sets params for request:
        const params =  new URLSearchParams({
            client_id:this.client_id,
            redirect_uri:this.redirect_uri,
            state:state,
            response_type:response_type,
            scope: scope.join(' '),
        });

        // Return URL for request:
        return `${url}?${params.toString()}`;

    }

    // :: STRING -> PROMSE({access_token, refresh_token, scope, expires_in, token_type})
    // Makes POST request to exchange the given authorization code for tokens:
    async exchangeCodeForToken(code) {

        // Destructure static field for exchange request:
        const {url, grant_type} =  OAuthManager.REQUEST_TOKEN;

        // Sets body for request:
        const body =  new URLSearchParams({
            "client_id":this.client_id,
            "client_secret":this.client_secret,
            "redirect_uri":this.redirect_uri,
            code, 
            grant_type
        });

        // Send request:
        const res = await fetch(url, {
            "method":"POST",
            "headers":{"Content-Type": "application/x-www-form-urlencoded"},
            body
        });

        // Return payload from request:
        return this.handleTokenResponse(res);
    }

    // :: STRING -> PROMSE({access_token, refresh_token, scope, expires_in, token_type})
    // Exchanges refresh token for updated tokens:
    async refreshAccessToken(refresh_token) {

        // Destructure static field for refresh request:
        const {url, grant_type} =  OAuthManager.REQUEST_REFRESH;

        // Sets body for request:
        const body =  new URLSearchParams({
            "client_id":this.client_id,
            "client_secret":this.client_secret,
            refresh_token, 
            grant_type
        });

        // Send request:
        const res = await fetch(url, {
            "method":"POST",
            "headers":{"Content-Type": "application/x-www-form-urlencoded"},
            body
        });
    
        // Return payload from request:
        return this.handleTokenResponse(res);

    }

    // :: VOID|INT -> STRING
    // Generate a cryptographically safe values to use for "state" value:
    generateState(bytes = 32) {
        return crypto.randomBytes(bytes).toString("base64url");
    }  
    
    // :: OBJECT -> PROMISE(OBJECT)
    // Handles token response from OAuth server:
    async handleTokenResponse(res) {

        // Get text from response:
        const text = await res.text();
        
        // Where to store data as JSON:
        let data;
        
        // Ensure data is valid JSON:
        try {
            data = JSON.parse(text);
        } catch (err) {
            throw new Error(`non-JSON Response (${res.status}): ${text.slice(0, 200)}`);
        }

        // Ensure request hasn't failed:
        if (!res.ok) {
            throw new Error(`Request failed (${res.status}): ${data.message ?? data.error ?? text}`);
        }

        // Return payload:
        return data;

    }

}


