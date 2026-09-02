import { R } from "redbean-node";

export interface VersionSyncHistoryEntry {
    id: number;
    stackName: string;
    endpoint: string;
    service: string;
    oldImage: string;
    newImage: string;
    composePath: string;
    isRevert: boolean;
    createdAt: string;
}

export interface GetSyncHistoryOptions {
    limit?: number;
    offset?: number;
    stackName?: string;
    service?: string;
    endpoint?: string;
}

export class VersionSyncHistoryService {

    static async recordSync(
        stackName: string,
        endpoint: string,
        service: string,
        oldImage: string,
        newImage: string,
        composePath: string,
        isRevert: boolean = false,
    ): Promise<void> {
        await R.exec(
            `INSERT INTO version_sync_history (stack_name, endpoint, service, old_image, new_image, compose_path, is_revert, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [ stackName, endpoint, service, oldImage, newImage, composePath, isRevert ? 1 : 0, new Date().toISOString() ]
        );
    }

    static async getHistory(options: GetSyncHistoryOptions = {}): Promise<{ entries: VersionSyncHistoryEntry[]; total: number }> {
        const limit = options.limit ?? 50;
        const offset = options.offset ?? 0;
        const conditions: string[] = [];
        const params: (string | number)[] = [];

        if (options.stackName) {
            conditions.push("stack_name = ?");
            params.push(options.stackName);
        }
        if (options.service) {
            conditions.push("service = ?");
            params.push(options.service);
        }
        if (options.endpoint !== undefined) {
            conditions.push("endpoint = ?");
            params.push(options.endpoint);
        }

        const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

        const totalRow = await R.getRow(`SELECT COUNT(*) as cnt FROM version_sync_history ${where}`, params);
        const total = totalRow?.cnt ?? 0;

        const rows = await R.getAll(
            `SELECT * FROM version_sync_history ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
            [ ...params, limit, offset ]
        );

        const entries: VersionSyncHistoryEntry[] = rows.map((row: Record<string, unknown>) => ({
            id: row.id as number,
            stackName: row.stack_name as string,
            endpoint: row.endpoint as string,
            service: row.service as string,
            oldImage: row.old_image as string,
            newImage: row.new_image as string,
            composePath: row.compose_path as string,
            isRevert: !!(row.is_revert),
            createdAt: row.created_at as string,
        }));

        return { entries,
            total };
    }

    static async getRevertableEntries(stackName?: string, service?: string): Promise<VersionSyncHistoryEntry[]> {
        const conditions: string[] = [];
        const params: (string | number)[] = [];

        if (stackName) {
            conditions.push("stack_name = ?");
            params.push(stackName);
        }
        if (service) {
            conditions.push("service = ?");
            params.push(service);
        }

        const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

        const rows = await R.getAll(
            `SELECT * FROM version_sync_history ${where} ORDER BY id DESC`,
            params
        );

        const latestByKey = new Map<string, VersionSyncHistoryEntry>();
        for (const row of rows) {
            const key = `${row.stack_name}::${row.service}`;
            if (!latestByKey.has(key)) {
                const entry: VersionSyncHistoryEntry = {
                    id: row.id as number,
                    stackName: row.stack_name as string,
                    endpoint: row.endpoint as string,
                    service: row.service as string,
                    oldImage: row.old_image as string,
                    newImage: row.new_image as string,
                    composePath: row.compose_path as string,
                    isRevert: !!(row.is_revert),
                    createdAt: row.created_at as string,
                };
                if (!entry.isRevert) {
                    latestByKey.set(key, entry);
                }
            }
        }

        return Array.from(latestByKey.values());
    }

    static async cleanupOldEntries(retentionDays: number = 90): Promise<number> {
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
        const before = await R.getRow("SELECT COUNT(*) as cnt FROM version_sync_history WHERE created_at < ?", [ cutoff ]);
        await R.exec("DELETE FROM version_sync_history WHERE created_at < ?", [ cutoff ]);
        return before?.cnt ?? 0;
    }
}
