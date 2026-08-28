import { Knex } from "knex";
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const ENCRYPTED_PREFIX = "enc:";

function encryptWithKey(plaintext: string, jwtSecret: string): string {
    if (!plaintext) {
        return plaintext;
    }
    const key = crypto.createHash("sha256").update(jwtSecret).digest();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();
    return ENCRYPTED_PREFIX + iv.toString("hex") + ":" + authTag.toString("hex") + ":" + encrypted;
}

export async function up(knex: Knex): Promise<void> {
    const row = await knex("setting").where("key", "jwtSecret").first();
    if (!row) {
        return;
    }

    const jwtSecret = row.value;
    const agents = await knex("agent").select("*");

    for (const agent of agents) {
        if (agent.password && !agent.password.startsWith(ENCRYPTED_PREFIX)) {
            const encryptedPassword = encryptWithKey(agent.password, jwtSecret);
            await knex("agent").where("id", agent.id).update({ password: encryptedPassword });
        }
    }
}

export async function down(knex: Knex): Promise<void> {
    // Intentionally empty — cannot safely reverse encryption without the key at migration time.
    // The decryptCredential function handles both encrypted and plaintext values gracefully.
}
