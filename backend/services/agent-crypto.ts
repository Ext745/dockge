import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const ENCRYPTED_PREFIX = "enc:";

let _encryptionKey: string | null = null;

export function setAgentEncryptionKey(key: string) {
    _encryptionKey = key;
}

function getKeyBuffer(): Buffer {
    if (!_encryptionKey) {
        throw new Error("Agent encryption key not set");
    }
    return crypto.createHash("sha256").update(_encryptionKey).digest();
}

export function encryptCredential(plaintext: string): string {
    if (!plaintext) {
        return plaintext;
    }
    const key = getKeyBuffer();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();
    return ENCRYPTED_PREFIX + iv.toString("hex") + ":" + authTag.toString("hex") + ":" + encrypted;
}

export function decryptCredential(ciphertext: string): string {
    if (!ciphertext || !ciphertext.startsWith(ENCRYPTED_PREFIX)) {
        return ciphertext;
    }
    const data = ciphertext.substring(ENCRYPTED_PREFIX.length);
    const parts = data.split(":");
    if (parts.length !== 3) {
        return ciphertext;
    }
    const [ivHex, authTagHex, encrypted] = parts;
    const key = getKeyBuffer();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}

export function encryptCredentialWithKey(plaintext: string, key: string): string {
    if (!plaintext) {
        return plaintext;
    }
    const keyBuffer = crypto.createHash("sha256").update(key).digest();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();
    return ENCRYPTED_PREFIX + iv.toString("hex") + ":" + authTag.toString("hex") + ":" + encrypted;
}
