import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  learningSidebar: [
    "intro",
    {
      type: "category",
      label: "AWS Fundamentals",
      items: ["aws-fundamentals/overview"],
    },
  ],
};

export default sidebars;
