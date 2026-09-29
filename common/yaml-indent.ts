/**
 * The indentation width a YAML text uses: the smallest indent of any content line, 2 if none.
 * @param text YAML
 * @returns Spaces per level
 */
export function detectIndent(text : string) : number {
    let smallest = 0;
    for (const match of text.matchAll(/^( +)[^ #\n]/gm)) {
        const width = match[1].length;
        if (smallest === 0 || width < smallest) {
            smallest = width;
        }
    }
    return smallest > 0 && smallest <= 8 ? smallest : 2;
}
