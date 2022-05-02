import { Node } from "constructs"

const allContext = JSON.parse(process.env.CDK_CONTEXT_JSON ?? "{}")

// Globs all kvp from context of the form "namespace:key": "value"
// and flattens it to an object of the form "key": "value"
export const getContextByNamespace = (ns: string): any => {
  const result: any = {}
  const prefix = `${ns}:`
  for (const [key, value] of Object.entries(allContext)) {
    if(key.startsWith(prefix)){
      const flattenedKey =  key.substring(prefix.length)
      result[flattenedKey] = value
    }
  }
  return result
}

export const getRequiredContext = (node: Node, key: string) => {
  const value = node.tryGetContext(key)
  if(value === undefined || value === null) {
    throw new Error(`Context key '${key}' is required.`)
  }
  return value
}

export type TypeHint = { [key: string]: 'csv' | 'boolean' }

/**
 * Maps context key value pairs within a namespace to typed props. If a set of defaults are given
 * it will initially populate the props with these defaults, and overwrite the defaults with values
 * from context. If provided type hints, it will use these to determine how to deserialize the value.
 * Ex: to deserialize comma separated values to Array<string>, boolean strings to boolean, etc. If not
 * specified, the default conversion of `any` to the prop type will occur.
 */
export const mapContextToProps = <T> (ns: string, defaults?: Partial<T>, typeHints?: TypeHint): T => {
  const types = typeHints ?? {}
  type keyTypes = keyof T
  const result: any = defaults ?? {}
  const prefix = `${ns}:`
  for (const [key, value] of Object.entries(allContext)) {
    if(key.startsWith(prefix)){
      const flattenedKey = key.substring(prefix.length)
      const k: keyTypes = <keyTypes>flattenedKey
      const v = value as T[keyTypes]
      const typeHint = types[flattenedKey]
      switch(typeHint){
        case 'csv':
          {
            const valueArray = (<string>value).split(',')
            result[k] = valueArray.map(v => v.trim())
          }
          break
        case 'boolean':
          result[k] = (<string>value).toLowerCase() == 'true' ? true : false
          break
        default:
          result[k] = value
          break
      }
    }
  }
  return result as T
}
