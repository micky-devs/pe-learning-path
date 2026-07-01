import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  awsSidebar: [
    {
      type: "doc",
      id: "aws/intro"
    },
    {
      type: "category",
      label: "AWS Fundamentals",
      items: [
        "aws/overview",
        {
          id: 'aws/basic-networking',
          type: "doc",
          label: "Basic Networking"
        },
        {
          id: 'aws/basic-ec2',
          type: "doc",
          label: "Basic EC2"
        }
      ],
    },
  ],
};

export default sidebars;
