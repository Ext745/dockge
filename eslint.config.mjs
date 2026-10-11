// ESLint flat config. The rules are the ones .eslintrc.cjs had before ESLint 10;
// formatting rules moved from ESLint core to @stylistic, under the same options.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";
import jsdoc from "eslint-plugin-jsdoc";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";

export default [
    {
        ignores: [ "node_modules/**", "frontend-dist/**", "dist/**", "data/**", "stacks/**" ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    ...pluginVue.configs["flat/recommended"],
    {
        files: [ "**/*.ts", "**/*.vue" ],
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                parser: tseslint.parser,
                sourceType: "module",
            },
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        plugins: {
            "@stylistic": stylistic,
            jsdoc,
        },
        rules: {
            "yoda": "error",
            "camelcase": [ "warn", {
                "properties": "never",
                "ignoreImports": true
            }],
            "no-unused-vars": [ "warn", {
                "args": "none"
            }],
            "curly": "error",
            "no-var": "error",
            "no-constant-condition": [ "error", {
                "checkLoops": false,
            }],
            "no-extra-boolean-cast": "off",
            "no-unneeded-ternary": "error",
            "no-empty": [ "error", {
                "allowEmptyCatch": true
            }],
            "no-control-regex": "off",
            "one-var": [ "error", "never" ],
            "prefer-const": "off",

            "@stylistic/linebreak-style": [ "error", "unix" ],
            "@stylistic/indent": [
                "error",
                4,
                {
                    ignoredNodes: [ "TemplateLiteral" ],
                    SwitchCase: 1,
                },
            ],
            "@stylistic/quotes": [ "error", "double" ],
            "@stylistic/semi": "error",
            "@stylistic/no-multi-spaces": [ "error", {
                ignoreEOLComments: true,
            }],
            "@stylistic/array-bracket-spacing": [ "warn", "always", {
                "singleValue": true,
                "objectsInArrays": false,
                "arraysInArrays": false
            }],
            "@stylistic/space-before-function-paren": [ "error", {
                "anonymous": "always",
                "named": "never",
                "asyncArrow": "always"
            }],
            "@stylistic/object-curly-spacing": [ "error", "always" ],
            "@stylistic/object-property-newline": [ "error", {
                "allowAllPropertiesOnSameLine": true,
            }],
            "@stylistic/comma-spacing": "error",
            "@stylistic/brace-style": "error",
            // Typed class/interface members ("name : Type") were never checked by the core rule
            "@stylistic/key-spacing": [ "warn", {
                ignoredNodes: [ "ClassBody", "TSInterfaceBody", "TSTypeLiteral" ],
            }],
            "@stylistic/keyword-spacing": "warn",
            "@stylistic/space-infix-ops": "error",
            "@stylistic/arrow-spacing": "warn",
            "@stylistic/no-trailing-spaces": "error",
            "@stylistic/space-before-blocks": "warn",
            "@stylistic/no-multiple-empty-lines": [ "warn", {
                "max": 1,
                "maxBOF": 0,
            }],
            "@stylistic/lines-between-class-members": [ "warn", "always", {
                exceptAfterSingleLine: true,
            }],
            "@stylistic/array-bracket-newline": [ "error", "consistent" ],
            "@stylistic/eol-last": [ "error", "always" ],
            "@stylistic/comma-dangle": [ "warn", "only-multiline" ],
            "@stylistic/max-statements-per-line": [ "error", { "max": 1 }],

            "vue/html-indent": [ "error", 4 ], // default: 2
            "vue/max-attributes-per-line": "off",
            "vue/singleline-html-element-content-newline": "off",
            "vue/html-self-closing": "off",
            "vue/require-component-is": "off",      // not allow is="style" https://github.com/vuejs/eslint-plugin-vue/issues/462#issuecomment-430234675
            "vue/attribute-hyphenation": "off",     // This change noNL to "no-n-l" unexpectedly
            "vue/multi-word-component-names": "off",

            "@typescript-eslint/ban-ts-comment": "off",
            "@typescript-eslint/no-unused-vars": [ "warn", {
                "args": "none"
            }],
        },
    },
];
