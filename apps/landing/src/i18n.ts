/** The site is English-only. */
export type Lang = 'en'

/** Widen literal types so EN and ZH copies share one structural type. */
type DeepWiden<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends readonly (infer U)[]
        ? readonly DeepWiden<U>[]
        : T extends object
          ? { [K in keyof T]: DeepWiden<T[K]> }
          : T

export const t = {
  en: {
    nav: {
      features: 'Features',
      quickstart: 'Quick start',
      download: 'Download',
      faq: 'FAQ',
      github: 'View on GitHub',
      docs: 'Docs',
    },
    hero: {
      badge: 'Open source · MIT · Developer preview',
      titleA: 'Greeneek, ready',
      titleB: 'the moment you install.',
      sub: 'Greeneek Desktop turns the open-source gnk agent harness into a ready-to-use local app — every capability a plugin, every model your own.',
      download: 'Download',
      currentDevice: 'Current device',
      viewGithub: 'View on GitHub',
      orRun: 'or run instantly with',
      runsLocal: 'Runs 100% locally · your keys never leave your machine',
      providers: 'Works with every major model provider',
      providersList: ['OpenAI', 'Anthropic', 'Google', 'Groq', 'Mistral', 'xAI', 'OpenRouter', 'Azure'],
    },
    screenshot: {
      caption: 'Greeneek workspace — sessions, agent chat and diff review in one window',
    },
    features: {
      eyebrow: 'Core capabilities',
      title: 'Two things, done to the extreme.',
      sub: 'Any model. Zero setup. The whole harness, one install away.',
      items: [
        {
          title: 'One-click install & run',
          desc: 'Installing is the entire deployment. The app launches the local harness, manages its port and process lifecycle, and opens straight into the full interface. Data lives outside the install directory — upgrades never lose settings or sessions.',
        },
        {
          title: 'Bring your own models',
          desc: 'OpenAI, Anthropic, Google and 35+ other routes — activated by your own API key. This project operates no inference service and bundles no provider. Models are yours, not ours.',
        },
        {
          title: 'Everything is a plugin',
          desc: 'Built on a Cordis-powered plugin architecture. Tools, skills, presets — every capability is a plugin you can add, remove or write yourself. Share yours with the gnk-plugin topic.',
        },
        {
          title: 'Sessions & tracing',
          desc: 'Durable session persistence, automatic titles and full telemetry. Headless runs, an automation ACP server, plus TypeScript and Python SDKs — everything is traceable and reproducible.',
        },
      ],
    },
    steps: {
      eyebrow: 'Quick start',
      title: 'Three steps to your first session.',
      sub: 'No Node. No CLI. No account. Just your API key and an idea.',
      items: [
        {
          step: '01',
          title: 'Install',
          desc: 'Download the installer for your platform — or run npx and use the web UI in your browser.',
        },
        {
          step: '02',
          title: 'Pick a provider',
          desc: 'On first launch, choose a model provider and paste your API key under Settings → Models.',
        },
        {
          step: '03',
          title: 'Start working',
          desc: 'Land directly in the full Greeneek interface — create a session and let the agent get to work.',
        },
      ],
      runFromNpm: 'Run from npm',
      installNode: 'Install Node.js, then:',
      servesAt: 'Starts the Web UI at http://127.0.0.1:3080 by default and opens it in your browser.',
      copy: 'Copy',
      copied: 'Copied!',
    },
    download: {
      eyebrow: 'Download',
      title: 'Choose your platform.',
      sub: 'Download links always point to the latest desktop-v* release on GitHub.',
      latest: 'Latest release',
      windows: 'Windows',
      windowsArch: 'x64',
      installer: 'Installer · .exe',
      portable: 'Portable · .zip',
      linux: 'Linux',
      linuxArch: 'x64',
      deb: 'Debian / Ubuntu · .deb',
      appimage: 'AppImage',
      any: 'Any platform',
      anyDesc: 'macOS, Windows or Linux — run the Web GUI straight from npm.',
      get: 'Download',
      run: 'Run npx',
      allReleases: 'All releases & checksums',
    },
    star: {
      title: 'Give us a star?',
      sub: 'Greeneek is open source — a star is the best way to support it.',
      cta: 'Star on GitHub',
      later: 'Maybe later',
      stars: 'GitHub stars',
    },
    faq: {
      eyebrow: 'FAQ',
      title: 'Common questions.',
      items: [
        {
          q: 'What is Greeneek?',
          a: 'Greeneek is an open-source agent harness (gnk) built on an everything-is-a-plugin architecture and powered by Cordis. The Desktop app wraps the same local Web GUI into an installable application — no Node.js or command line required.',
        },
        {
          q: 'Is it free and open source?',
          a: 'Yes. Greeneek is released under the MIT license. The desktop releases are free to download from GitHub Releases. Third-party dependencies keep their own licenses, disclosed in THIRD_PARTY_NOTICES.md.',
        },
        {
          q: 'Which platforms are supported?',
          a: 'Windows x64 (installer and portable), Linux x64 (.deb and AppImage), and any platform with Node.js via npx @greeneek/gnk web. The app boots the same local Web GUI and self-updates from future releases.',
        },
        {
          q: 'Do I need an API key?',
          a: 'Greeneek operates no inference service and bundles no model provider — every model route is activated by your own API key. Add it under Settings → Models, or set the matching environment variable such as OPENAI_API_KEY.',
        },
        {
          q: 'Is this an official model vendor product?',
          a: 'No. Greeneek Desktop is a community desktop wrapper around the Greeneek open-source harness. It is not affiliated with any model provider; providers and models are subject to their own upstream licenses and trademark policies.',
        },
        {
          q: 'How stable is it?',
          a: 'Greeneek is in developer preview and iterating rapidly — there will be compatibility-breaking changes. Review the safety notice in the repository before running it in production settings.',
        },
      ],
    },
    footer: {
      tagline: "The surgeon's toolkit for AI agents. Everything is a plugin.",
      product: 'Product',
      resources: 'Resources',
      community: 'Community',
      docs: 'User guide',
      devDocs: 'Development',
      releases: 'Releases',
      issues: 'Issues',
      plugins: 'gnk-plugin topic',
      license: 'License',
      disclaimer:
        'Greeneek Desktop is an independent community desktop wrapper, not affiliated with any model provider. Models are activated by your own API key and remain subject to their upstream licenses and trademark policies.',
      rights: '© 2026 Greeneek · MIT License',
      preview: 'Developer preview — builds are unsigned; SmartScreen / Gatekeeper may warn.',
    },
  },
} as const

export type SiteCopy = DeepWiden<(typeof t)['en']>

/** English-only site copy. */
export const copy: SiteCopy = t.en
