import { log } from "./log";
import compareVersions from "compare-versions";
import packageJSON from "../package.json";
import { Settings } from "./settings";

// How much time in ms to wait between update checks
const UPDATE_CHECKER_INTERVAL_MS = 1000 * 60 * 60 * 48;
// This fork's GitHub Releases (louislam's dockge.kuma.pet/version reports the 1.x line, so it would never
// see a 2.x update). Newest first; drafts are never listed without auth.
const CHECK_URL = "https://api.github.com/repos/Ext745/dockge/releases?per_page=30";

class CheckVersion {
    version = packageJSON.version;
    latestVersion? : string;
    interval? : NodeJS.Timeout;

    async startInterval() {
        const check = async () => {
            if (await Settings.get("checkUpdate") === false) {
                return;
            }

            log.debug("update-checker", "Retrieving latest versions");

            try {
                const res = await fetch(CHECK_URL, {
                    headers: {
                        "Accept": "application/vnd.github+json",
                        "User-Agent": "dockge-update-checker",
                    },
                });
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                const releases = await res.json() as { tag_name : string, prerelease : boolean, draft : boolean }[];
                const versionOf = (release? : { tag_name : string }) => release?.tag_name.replace(/^v/, "");
                const data = {
                    slow: versionOf(releases.find(r => !r.draft && !r.prerelease)),
                    beta: versionOf(releases.find(r => !r.draft && r.prerelease)),
                };

                // For debug
                if (process.env.TEST_CHECK_VERSION === "1") {
                    data.slow = "1000.0.0";
                }

                const checkBeta = await Settings.get("checkBeta");

                if (checkBeta && data.beta) {
                    if (!data.slow || compareVersions.compare(data.beta, data.slow, ">")) {
                        this.latestVersion = data.beta;
                        return;
                    }
                }

                if (data.slow) {
                    this.latestVersion = data.slow;
                }

            } catch (_) {
                log.info("update-checker", "Failed to check for new versions");
            }

        };

        await check();
        this.interval = setInterval(check, UPDATE_CHECKER_INTERVAL_MS);
    }
}

const checkVersion = new CheckVersion();
export default checkVersion;
