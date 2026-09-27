## Can I create a pull request for Dockge?

Issues aren't enabled on this fork, so there's no place to discuss a change before you make it. For changes to Dockge itself, contribute upstream to [darthrater78/dockge](https://github.com/darthrater78/dockge) or [louislam/dockge](https://github.com/louislam/dockge), and they'll reach this fork on the next sync. Pull requests here are reviewed as time allows; keep them small and focused on this fork's own features.

Here are some references:

### ✅ Usually accepted:
- Bug fix
- Security fix
- Adding new language files (see [these instructions](https://github.com/Ext745/dockge/blob/master/frontend/src/lang/README.md))
- Adding new language keys: `$t("...")`

### ⚠️ Likely to be declined here (take them upstream instead):
- Large pull requests
- New features that aren't specific to this fork

### ❌ Won't be merged:
- A dedicated PR for translating existing languages (see [these instructions](https://github.com/Ext745/dockge/blob/master/frontend/src/lang/README.md))
- Do not pass the auto-test
- Any breaking changes
- Duplicated pull requests
- Buggy
- UI/UX is not close to Dockge
- Modifications or deletions of existing logic without a valid reason.
- Adding functions that is completely out of scope
- Converting existing code into other programming languages
- Unnecessarily large code changes that are hard to review and cause conflicts with other PRs.

The above cases may not cover all possible situations.

The maintainer of this fork (@Ext745) has the final say. A pull request that doesn't fit the project may be declined, no matter how much time went into it, so keep pull requests here small.

Also, please don't rush or ask for an ETA: every pull request has to be understood, checked for breaking changes and kept in line with the project's direction, especially large ones.

## Project Styles

I personally do not like something that requires so many configurations before you can finally start the app.

- Settings should be configurable in the frontend. Environment variables are discouraged, unless it is related to startup such as `DOCKGE_STACKS_DIR`
- Easy to use
- The web UI styling should be consistent and nice
- No native build dependency

## Coding Styles

- 4 spaces indentation
- Follow `.editorconfig`
- Follow ESLint
- Methods and functions should be documented with JSDoc

## Name Conventions

- Javascript/Typescript: camelCaseType
- SQLite: snake_case (Underscore)
- CSS/SCSS: kebab-case (Dash)

## Tools

- [`Node.js`](https://nodejs.org/) >= 22.14.0
- [`git`](https://git-scm.com/)
- IDE that supports [`ESLint`](https://eslint.org/) and EditorConfig (I am using [`IntelliJ IDEA`](https://www.jetbrains.com/idea/))
- A SQLite GUI tool (f.ex. [`SQLite Expert Personal`](https://www.sqliteexpert.com/download.html) or [`DBeaver Community`](https://dbeaver.io/download/))

## Install Dependencies for Development

```bash
npm install
```

## Dev Server

```
npm run dev:frontend
npm run dev:backend
```

## Backend Dev Server

It binds to `0.0.0.0:5001` by default.

It is mainly a socket.io app + express.js.

## Frontend Dev Server

It binds to `0.0.0.0:5000` by default. The frontend dev server is used for development only.

For production, it is not used. It will be compiled to `frontend-dist` directory instead.

You can use Vue.js devtools Chrome extension for debugging.

### Build the frontend

```bash
npm run build
```

## Database Migration

TODO

## Dependencies

Both frontend and backend share the same package.json. However, the frontend dependencies are eventually not used in the production environment, because it is usually also baked into dist files. So:

- Frontend dependencies = "devDependencies"
    - Examples: vue, chart.js
- Backend dependencies = "dependencies"
    - Examples: socket.io, sqlite3
- Development dependencies = "devDependencies"
    - Examples: eslint, sass

### Update Dependencies

Should only be done by the maintainer.

```bash
npm update
````

It should update the patch release version only.

Patch release = the third digit ([Semantic Versioning](https://semver.org/))

If for security / bug / other reasons, a library must be updated, breaking changes need to be checked by the person proposing the change.

## Translations

Please add **all** the strings which are translatable to `src/lang/en.json` (If translation keys are omitted, they can not be translated).

**Don't include any other languages in your initial Pull-Request** (even if this is your mother tongue), to avoid merge-conflicts between weblate and `master`.  
The translations can then (after merging a PR into `master`) be translated by awesome people donating their language skills.

If you want to help by translating Dockge into your language, please see the [translation guide](https://github.com/Ext745/dockge/blob/master/frontend/src/lang/README.md).

## Spelling & Grammar

Feel free to correct the grammar in the documentation or code.
