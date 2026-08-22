# Publishing `@ararahq/mcp`

`@ararahq/mcp` is the canonical npm distribution starting at v5. The former
unscoped `ararahq-mcp` package remains frozen on v4 so existing installations do
not break silently.

## Bootstrap the scoped package once

Trusted Publishing can only be configured after a package exists. An owner of the
`ararahq` npm organization must perform the first publication interactively:

```bash
npm login
npm whoami
npm ci
npm run check
npm publish --access public
```

The expected first version is `@ararahq/mcp@5.0.0`.

## Configure tokenless releases

On the npm package settings page, add a GitHub Actions Trusted Publisher with:

- Organization: `ararahq`
- Repository: `mcp`
- Workflow filename: `npm-publish.yml`
- Environment: empty
- Allowed action: `npm publish`

The workflow `.github/workflows/npm-publish.yml` uses GitHub OIDC and has no npm
token. Run it manually from the Actions tab for each approved release.

## Verify

```bash
npm view @ararahq/mcp version
npx -y @ararahq/mcp --version
```

Only after the scoped package is published and verified should maintainers
deprecate the old distribution:

```bash
npm deprecate "ararahq-mcp@*" "Moved to @ararahq/mcp. Install with npx -y @ararahq/mcp."
```

Deprecation is a separate, explicit operation. Do not unpublish the legacy
package.
