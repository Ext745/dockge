import { parseDocument } from "yaml";

export type YAMLFormatResult =
    | { ok : true, text : string, changed : boolean }
    | { ok : false, error : string };

/**
 * Tidy a compose file without changing what it means: tabs used for indentation become spaces (YAML
 * forbids them), indentation becomes 2 spaces, trailing whitespace goes, and the file ends with one
 * newline. Comments, quotes, flow lists and anchors are kept, and long lines are never folded.
 *
 * The result is only returned if it parses to exactly the same data as the input (with its tabs
 * expanded), so formatting can never change what a stack does.
 * @param text compose.yaml (or override) text
 * @returns The formatted text, or why it was left alone
 */
export function formatComposeYAML(text : string) : YAMLFormatResult {
    if (text.trim() === "") {
        return { ok: true,
            text,
            changed: false };
    }

    // One tab of leading indentation = one level (2 spaces). Only leading whitespace is touched:
    // a tab inside a value is data.
    const input = text
        .replace(/\r\n?/g, "\n")
        .replace(/^[ \t]+/gm, (lead) => lead.replace(/\t/g, "  "));

    const doc = parseDocument(input);
    if (doc.errors.length > 0) {
        return { ok: false,
            error: doc.errors[0].message };
    }

    const output = doc.toString({
        indent: 2,
        lineWidth: 0,
        flowCollectionPadding: false,
    });

    const reparsed = parseDocument(output);
    if (reparsed.errors.length > 0 || JSON.stringify(reparsed.toJS()) !== JSON.stringify(doc.toJS())) {
        return { ok: false,
            error: "Formatting would change the file's meaning, so it was left as is." };
    }

    return { ok: true,
        text: output,
        changed: output !== text };
}
