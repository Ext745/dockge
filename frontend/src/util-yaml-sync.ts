import { Document, isMap, isScalar, isSeq, Pair, Scalar, YAMLMap, YAMLSeq } from "yaml";
export { detectIndent } from "../../common/yaml-indent";

type JSONValue = null | boolean | number | string | JSONValue[] | { [key : string] : JSONValue };

/**
 * A plain-data copy with no undefined values or shared references, for comparing before/after an edit.
 * @param value Value
 * @returns Its JSON round trip
 */
export function toPlainJSON(value : unknown) : JSONValue | undefined {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

const isObject = (v : unknown) : v is Record<string, JSONValue> => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a : unknown, b : unknown) => JSON.stringify(a) === JSON.stringify(b);
const keyOf = (pair : Pair) => String(isScalar(pair.key) ? pair.key.value : pair.key);

/**
 * Apply the difference between two plain-data versions of a document to the parsed YAML, in place.
 * Nodes that didn't change are left exactly as parsed (quotes, flow lists, "key:" nulls, comments), a
 * changed scalar keeps its quote style, and only keys that were in `before` are ever deleted.
 *
 * Used for edits made through Dockge's form editors, so they no longer re-serialize the whole file.
 * @param doc Parsed document; `before` must be its `toJS()` (as plain JSON)
 * @param before Data before the edit
 * @param after Data after the edit
 * @returns void
 */
export function applyJSONChanges(doc : Document, before : unknown, after : unknown) : void {
    doc.contents = sync(doc, doc.contents, before, after) as Document["contents"];
}

function sync(doc : Document, node : unknown, before : unknown, after : unknown) : unknown {
    if (same(before, after) && node !== undefined) {
        return node;
    }

    if (isObject(before) && isObject(after) && isMap(node)) {
        const map = node as YAMLMap;
        map.items = map.items.filter((pair) => {
            const key = keyOf(pair);
            return !(key in before) || key in after;
        });
        for (const key of Object.keys(after)) {
            const pair = map.items.find((p) => keyOf(p) === key);
            if (!pair) {
                map.items.push(doc.createPair(key, after[key]));
            } else if (key in before) {
                pair.value = sync(doc, pair.value, before[key], after[key]);
            }
        }
        return map;
    }

    if (Array.isArray(before) && Array.isArray(after) && isSeq(node)) {
        const seq = node as YAMLSeq;
        seq.items.length = Math.min(seq.items.length, after.length);
        for (let i = 0; i < after.length; i++) {
            if (i < seq.items.length && i < before.length) {
                seq.items[i] = sync(doc, seq.items[i], before[i], after[i]);
            } else {
                // A new list item quotes like the one before it ("8080:80" lists stay quoted)
                const created = doc.createNode(after[i]);
                const previous = seq.items[i - 1];
                if (isScalar(created) && isScalar(previous) && typeof after[i] === "string") {
                    created.type = previous.type;
                }
                seq.items[i] = created;
            }
        }
        return seq;
    }

    if (isScalar(node) && (after === null || typeof after !== "object")) {
        // A form's new, empty item can only be written as "" - once it has a value, those quotes
        // weren't the user's choice
        if (before === "" && (node.type === Scalar.QUOTE_DOUBLE || node.type === Scalar.QUOTE_SINGLE)) {
            node.type = undefined;
        }
        node.value = after;
        return node;
    }

    // Type changed (e.g. "data:" becoming a map), or a node the diff can't walk (an alias): replace it,
    // keeping a collection's flow/block style
    const created = doc.createNode(after);
    if ((isMap(node) || isSeq(node)) && (isMap(created) || isSeq(created))) {
        created.flow = node.flow;
    }
    return created;
}
