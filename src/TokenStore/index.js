// Dependencies:
import fs from "fs/promises";  // For loading/updating persisnt data store

// Class for storing token
export default class TokenStore {

    // Instance Fields;
    filename;                       // Where persistent data is stored
    storeData = {};                 // Loaded data from store
    queueWrite = Promise.resolve(); // Use promise to queue updates to store

    // CONSTUCTOR :: STRING -> this 
    constructor(filename) {
        this.filename = filename;
    }

    /**
     * 
     *  Properties 
     * 
     */

    // SETTER :: access_token
    set access_token(val) {
        if (val != null) {
            this.storeData.access_token = val;
        }
    }

    // GETTER :: access_token
    get access_token() {
        return this.storeData.access_token;
    }

    // SETTER :: refresh_token
    set refresh_token(val) {
        if (val != null) {
            this.storeData.refresh_token = val;
        }
    }

    // GETTER :: refresh_token
    get refresh_token() {
        return  this.storeData.refresh_token;
    }

    // SETTER :: expires_at
    // NOTE: Stores WHEN THE TOKEN EXPIRES and not HOW LONG THE TOKEN IS VALID FOR:
    set expires_at(val) {
        if (val != null) {
            this.storeData.expires_at = Date.now() + val * 1000;
        }
    }

    // GETTER :: expires_at
    get expires_at() {
        return this.storeData.expires_at;
    }

    // SETTER :: scope
    set scope(val) {
        if (val != null) {
            this.storeData.scope = val;
        }
    }
    // GETTER :: scope
    get scope() {
        return this.storeData.scope;
    }
  
    /**
     * 
     *  Instance Methods
     * 
     */

    // :: VOID -> PROMISE(this)
    // Loads data from store:
    async loadStore() {
        try {
            const fileData = await fs.readFile(this.filename, "utf8");
            this.storeData = fileData.length > 0 ? JSON.parse(fileData) : {};
        } catch (err) {
            if (err.code !== "ENOENT") {
                throw err;
            }
            this.storeData = {};
        }
        return this;
    }

    // :: VOID -> PROMISE(VOID);
    // Writes data to store:
    async saveStore() {

        this.queueWrite = this.queueWrite.then(async () => {

            // Set temp file name and convert store data to STRING:
            const tmpPath = `${this.filename}.tmp`;
            const json = JSON.stringify(this.storeData, null, 2);

            // Write JSON to file:
            await fs.writeFile(tmpPath, json, "utf8");

            // Overwrite existing file by renaming temp file:
            await fs.rename(tmpPath, this.filename); 

        });

        return this.queueWrite;

    }


    // :: {access_token:STRING, refresh_token:STRING, expire_in:INT, scope:[STRING]} -> PROMISE(VOID)
    // Sets all propertes and writes to file:
    async updateStore({access_token, refresh_token, expires_in, scope}) {
        this.access_token = access_token;
        this.refresh_token = refresh_token;
        this.expires_at = expires_in;
        this.scope = scope;
        await this.saveStore();
    }

    // :: VOID -> BOOL
    // Returns TRUE if token is expired, otherwise returns FALSE
    isExpired(offset) {
        return Date.now() > this.expires_at - (offset ?? 0);
    }

    /**
     * 
     *  Static Methods 
     * 
     */

    // Static Factory Method :: STRING -> PROMISE(tokenStore)
    // NOTE: Initializes instance AND loads store from file:
    static init(filename) {
        const tokenStore = new TokenStore(filename);
        return tokenStore.loadStore();
    }


}