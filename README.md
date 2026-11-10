# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Deploy

`npm run deploy` serves the app at https://throughline.drewmathieson.com (the workers.dev address keeps working).
The Google OAuth client must list `https://throughline.drewmathieson.com/api/auth/callback` as an authorised redirect URI.

## Who can sign in

Sign-in is open to any Google account unless `ALLOWED_EMAILS` is set: a comma-separated list of Google emails, `npx wrangler secret put ALLOWED_EMAILS` in production and `ALLOWED_EMAILS=` in `.dev.vars` locally. Accounts on `OWNER_EMAILS` are always allowed. Someone taken off the list is stopped at their next sign-in; a session they already hold runs on.
