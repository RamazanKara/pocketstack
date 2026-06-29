import { defineConfig } from 'vitepress'

// The docs site is published under the project Pages subpath:
// https://ramazankara.github.io/pocketstack/docs/
export default defineConfig({
  title: 'PocketStack',
  description:
    'Turn browser-compatible Docker Compose projects into static, browser-native demos.',
  base: '/pocketstack/docs/',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,
  // Strict: the build fails on broken internal links.
  ignoreDeadLinks: false,
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Adapters', link: '/adapters/' },
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
      message: 'Browser-native demos. No hidden server, no runner, no Docker at demo time.',
      copyright: 'MIT © Ramazan Kara',
    },
  },
})
