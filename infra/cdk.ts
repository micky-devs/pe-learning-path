import { App } from "aws-cdk-lib";
import { MainStack } from "./stacks/main";

const app = new App()
new MainStack(app, 'main')
