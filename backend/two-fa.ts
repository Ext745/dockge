import crypto from "crypto";
// @ts-ignore — notp has no type declarations
import notp from "notp";

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
    let result = "";
    let bits = 0;
    let value = 0;
    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            result += BASE32_CHARS[(value >>> (bits - 5)) & 0x1f];
            bits -= 5;
        }
    }
    if (bits > 0) {
        result += BASE32_CHARS[(value << (5 - bits)) & 0x1f];
    }
    return result;
}

export function base32Decode(encoded: string): Buffer {
    const cleaned = encoded.replace(/=+$/, "").toUpperCase();
    let bits = 0;
    let value = 0;
    const bytes: number[] = [];
    for (const char of cleaned) {
        const idx = BASE32_CHARS.indexOf(char);
        if (idx === -1) {
            continue;
        }
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}

export const twoFAVerifyOptions = {
    window: 1,
    time: 30,
};

export function generateTwoFASecret(username: string): { secret: string; uri: string } {
    const buffer = crypto.randomBytes(20);
    const secret = base32Encode(buffer);
    const uri = `otpauth://totp/Dockge:${encodeURIComponent(username)}?secret=${secret}&issuer=Dockge`;
    return { secret,
        uri };
}

export function verifyTwoFAToken(token: string, base32Secret: string): boolean {
    const key = base32Decode(base32Secret);
    const result = notp.totp.verify(token, key, twoFAVerifyOptions);
    return result != null;
}
