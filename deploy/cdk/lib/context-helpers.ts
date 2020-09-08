import { ConstructNode } from "@aws-cdk/core"

const allContext = JSON.parse(process.env.CDK_CONTEXT_JSON ?? "{}")

// Globs all kvp from context of the form "namespace:key": "value"
// and flattens it to an object of the form "key": "value"
export const getContextByNamespace = (ns: string): any => {
  const result: any = {}
  const prefix = `${ns}:`
  for (const [key, value] of Object.entries(allContext)) {
    if(key.startsWith(prefix)){
      const flattenedKey =  key.substr(prefix.length)
      result[flattenedKey] = value
    }
  }
  return result
}

export const getRequiredContext = (node: ConstructNode, key: string) => {
  const value = node.tryGetContext(key)
  if(value === undefined || value === null) {
    throw new Error(`Context key '${key}' is required.`)
  }
  return value
}
