import { defineConfig } from 'vitepress'

// The docs site is published under the project Pages subpath:
// https://ramazankara.github.io/pocketstack/docs/
export default defineConfig({
  title: 'PocketStack',
  description:
    'Add one GitHub Action for static previews of browser-compatible Docker Compose pull requests.',
  base: '/pocketstack/docs/',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,
  // Strict: the build fails on broken internal links.
  ignoreDeadLinks: false,
  themeConfig: {
    nav: [
      { text: 'PR previews', link: '/guide/pr-previews' },
      { text: 'Compatibility', link: '/adapters/' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Convert', link: '/convert/' },
      { text: 'Deploy', link: '/deploy/hosting' },
      { text: 'Reference', link: '/reference/architecture' },
      {
        text: 'Try it',
        items: [
          { text: 'Studio', link: 'https://ramazankara.github.io/pocketstack/studio/' },
          { text: 'Demos', link: 'https://ramazankara.github.io/pocketstack/demos/' },
        ],
      },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'Pull request previews', link: '/guide/pr-previews' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'CLI reference', link: '/guide/cli' },
            { text: 'Concepts & glossary', link: '/guide/concepts' },
            { text: 'Troubleshooting', link: '/guide/troubleshooting' },
          ],
        },
      ],
      '/adapters/': [
        {
          text: 'Adapters',
          items: [
            { text: 'Overview & matrix', link: '/adapters/' },
            { text: 'Labels', link: '/adapters/labels' },
            { text: 'Static web', link: '/adapters/static-web' },
            { text: 'Frontend', link: '/adapters/frontend' },
            { text: 'Mock HTTP', link: '/adapters/mock-http' },
            { text: 'SQLite', link: '/adapters/sqlite' },
            { text: 'Postgres (PGlite)', link: '/adapters/postgres-pglite' },
            { text: 'WASI', link: '/adapters/wasi' },
          ],
        },
      ],
      '/convert/': [
        { text: 'Convert', items: [{ text: 'Conversion guide', link: '/convert/' }] },
      ],
      '/deploy/': [
        {
          text: 'Deploy',
          items: [
            { text: 'Hosting & headers', link: '/deploy/hosting' },
            { text: 'Website integration', link: '/deploy/website-integration' },
            { text: 'Manifest reference', link: '/deploy/manifest' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Architecture', link: '/reference/architecture' },
            { text: 'Service URLs', link: '/reference/service-urls' },
          ],
        },
      ],
      '/contribute/': [
        {
          text: 'Contributing',
          items: [
            { text: 'Development setup', link: '/contribute/' },
            { text: 'Releasing', link: '/contribute/releasing' },
            { text: 'Browser testing', link: '/contribute/browser-testing' },
          ],
        },
      ],
      '/release-notes/': [
        { text: 'Release notes', link: '/release-notes/' },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/ramazankara/pocketstack' },
    ],
    search: { provider: 'local' },
    editLink: {
      pattern: 'https://github.com/ramazankara/pocketstack/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    footer: {
      message: 'Compose PR in. Static preview out—only when every service is browser-compatible.',
      copyright: 'MIT © Ramazan Kara',
    },
  },
})
