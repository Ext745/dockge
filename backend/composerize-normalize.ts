/**
 * composerize's tokenizer only strips quotes that wrap a whole argument.
 * Quotes in the middle of an argument are kept as literal characters, so
 *   --sysctl net.ipv4.ping_group_range="0 2147483647"
 * becomes the sysctl value `"0 2147483647"` (quotes included), which runc
 * rejects with "invalid argument". The same happens for --label, --log-opt,
 * --add-host, --ulimit, --tmpfs, etc.
 *
 * Fix: tokenize the command the way a POSIX shell would, then re-quote each
 * token as a whole so composerize receives the value the shell would have
 * passed to `docker run`.
 */

/** Split a shell command line into arguments (POSIX-style quoting rules). */
export function shellSplit(input: string): string[] {
    const tokens: string[] = [];
    let cur = "";
    let inToken = false;
    let i = 0;

    while (i < input.length) {
        const ch = input[i];

        if (ch === "\\") {
            const next = input[i + 1];
            if (next === "\n") {
                i += 2; // line continuation
                continue;
            }
            if (next === "\r" && input[i + 2] === "\n") {
                i += 3;
                continue;
            }
            if (next !== undefined) {
                cur += next;
                inToken = true;
                i += 2;
                continue;
            }
            i++;
            continue;
        }

        if (ch === "'") {
            const end = input.indexOf("'", i + 1);
            if (end === -1) {
                throw new Error("Unterminated single quote in docker run command");
            }
            cur += input.slice(i + 1, end);
            inToken = true;
            i = end + 1;
            continue;
        }

        if (ch === "\"") {
            i++;
            let closed = false;
            while (i < input.length) {
                const c = input[i];
                if (c === "\"") {
                    closed = true;
                    i++;
                    break;
                }
                if (c === "\\" && i + 1 < input.length) {
                    const n = input[i + 1];
                    if (n === "\"" || n === "\\" || n === "$" || n === "`") {
                        cur += n;
                        i += 2;
                        continue;
                    }
                    if (n === "\n") {
                        i += 2;
                        continue;
                    }
                }
                cur += c;
                i++;
            }
            if (!closed) {
                throw new Error("Unterminated double quote in docker run command");
            }
            inToken = true;
            continue;
        }

        if (/\s/.test(ch)) {
            if (inToken) {
                tokens.push(cur);
                cur = "";
                inToken = false;
            }
            i++;
            continue;
        }

        cur += ch;
        inToken = true;
        i++;
    }

    if (inToken) {
        tokens.push(cur);
    }
    return tokens;
}

/** Quote one argument so composerize's tokenizer reads it back verbatim. */
function quoteForComposerize(token: string): string {
    if (token !== "" && !/[\s"'\\]/.test(token)) {
        return token;
    }
    if (!token.includes("'")) {
        return `'${token}'`;
    }
    if (!token.includes("\"")) {
        return `"${token}"`;
    }
    // Contains both quote types: escape double quotes inside a double-quoted token.
    return `"${token.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

/** Re-serialize a docker run command so every argument is quoted as a whole. */
export function normalizeDockerRunCommand(command: string): string {
    return shellSplit(command).map(quoteForComposerize).join(" ");
}

/** Drop the "name: <your project name>" placeholder line composerize emits. */
export function stripComposerizeName(composeTemplate: string): string {
    return composeTemplate
        .split("\n")
        .filter((line) => !/^name:\s*<your project name>\s*$/.test(line))
        .join("\n");
}
