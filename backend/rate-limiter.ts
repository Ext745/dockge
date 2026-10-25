// "limit" is bugged in Typescript, use "limiter-es6-compat" instead
// See https://github.com/jhurliman/node-rate-limiter/issues/80
import { RateLimiter, RateLimiterOpts } from "limiter-es6-compat";
import { log } from "./log";

export interface KumaRateLimiterOpts extends RateLimiterOpts {
    errorMessage : string;
}

export type KumaRateLimiterCallback = (err : object) => void;

class KumaRateLimiter {

    errorMessage : string;
    rateLimiter : RateLimiter;

    /**
     * @param {object} config Rate limiter configuration object
     */
    constructor(config : KumaRateLimiterOpts) {
        this.errorMessage = config.errorMessage;
        this.rateLimiter = new RateLimiter(config);
    }

    /**
     * Callback for pass
     * @callback passCB
     * @param {object} err Too many requests
     */

    /**
     * Should the request be passed through
     * @param callback Callback function to call with decision
     * @param {number} num Number of tokens to remove
     * @returns {Promise<boolean>} Should the request be allowed?
     */
    async pass(callback : KumaRateLimiterCallback, num = 1) {
        const remainingRequests = await this.removeTokens(num);
        log.info("rate-limit", "remaining requests: " + remainingRequests);
        if (remainingRequests < 0) {
            if (callback) {
                callback({
                    ok: false,
                    msg: this.errorMessage,
                });
            }
            return false;
        }
        return true;
    }

    /**
     * Remove a given number of tokens
     * @param {number} num Number of tokens to remove
     * @returns {Promise<number>} Number of remaining tokens
     */
    async removeTokens(num = 1) {
        return await this.rateLimiter.removeTokens(num);
    }
}

/**
 * A separate KumaRateLimiter for each key (e.g. client IP address)
 */
class KeyedRateLimiter {

    config : KumaRateLimiterOpts;
    limiters : Map<string, { limiter : KumaRateLimiter, lastUsed : number }> = new Map();

    /**
     * @param {object} config Configuration of each key's rate limiter
     */
    constructor(config : KumaRateLimiterOpts) {
        this.config = config;
    }

    /**
     * Should the request of this key be passed through
     * @param key Key, e.g. the client IP address
     * @param callback Callback function to call with decision
     * @returns {Promise<boolean>} Should the request be allowed?
     */
    async pass(key : string, callback : KumaRateLimiterCallback) {
        const now = Date.now();

        // Forget keys idle for an hour, so the map does not grow forever
        for (const [ oldKey, entry ] of this.limiters) {
            if (now - entry.lastUsed > 60 * 60 * 1000) {
                this.limiters.delete(oldKey);
            }
        }

        let entry = this.limiters.get(key);
        if (!entry) {
            entry = {
                limiter: new KumaRateLimiter(this.config),
                lastUsed: now,
            };
            this.limiters.set(key, entry);
        }
        entry.lastUsed = now;
        return await entry.limiter.pass(callback);
    }
}

// Each client address first, then all clients together. A refused attempt
// must not use a token of the global limit, or one client locks out everyone
export const loginRateLimiter = new KeyedRateLimiter({
    tokensPerInterval: 10,
    interval: "minute",
    fireImmediately: true,
    errorMessage: "Too frequently, try again later."
});

export const loginGlobalRateLimiter = new KumaRateLimiter({
    tokensPerInterval: 30,
    interval: "minute",
    fireImmediately: true,
    errorMessage: "Too frequently, try again later."
});

export const apiRateLimiter = new KumaRateLimiter({
    tokensPerInterval: 60,
    interval: "minute",
    fireImmediately: true,
    errorMessage: "Too frequently, try again later."
});

export const twoFaRateLimiter = new KumaRateLimiter({
    tokensPerInterval: 30,
    interval: "minute",
    fireImmediately: true,
    errorMessage: "Too frequently, try again later."
});
