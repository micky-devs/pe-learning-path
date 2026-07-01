import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const organizationName = "micky-devs";
const repositoryName = "pe-learning-path";

const config: Config = {
  title: "PE Learning Path",
  tagline: "An interactive learning platform for AWS",
  favicon: "img/logo.svg",

  future: {
    v4: true,
    faster: true,
  },

  url: `https://${organizationName}.github.io`,
  baseUrl: `/${repositoryName}/`,

  organizationName,
  trailingSlash: false,

  onBrokenLinks: "throw",

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  themes: ["@docusaurus/theme-mermaid"],

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          path: "../../docs",
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl: `https://github.com/${organizationName}/${repositoryName}/tree/main/docs/`,
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: "PE Learning Path",
      logo: {
        alt: "PE Learning Path Logo",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "doc",
          docId: "getting-started",
          position: "left",
          label: "Getting Started",
        },
        {
          type: "docSidebar",
          sidebarId: "awsSidebar",
          position: "left",
          label: "AWS",
        },
        {
          href: `https://github.com/${organizationName}`,
          label: "GitHub",
          position: "right",
        },
      ],
    },

    // footer: {
    //   style: "dark",
    //   links: [
    //     {
    //       title: "AWS",
    //       items: [
    //         {
    //           label: "Getting Started",
    //           to: "/",
    //         },
    //       ],
    //     },
    //     {
    //       title: "More",
    //       items: [
    //         {
    //           label: "GitHub",
    //           href: `https://github.com/${organizationName}`,
    //         },
    //       ],
    //     },
    //   ],
    //   copyright: `Copyright © ${new Date().getFullYear()} PE Learning Path.`,
    // },

  prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json", "hcl"],
    },
  } satisfies Preset.ThemeConfig,

  plugins: [
    [
      "@docusaurus/plugin-client-redirects",
      {
        redirects: [
          { from: ["/getting-started"], to: "/" },
        ],
      },
    ],
  ],
};

export default config;
