import { Stack, StackProps } from "@aws-cdk/core"
import { FoundationStack, PipelineFoundationStack } from "./foundation"
import { ContextEnv } from "./context-env"
import { Environment } from "@aws-cdk/cx-api"

export type Stacks = { [key: string]: Stack }