import { parseSync } from 'oxc-parser'

/**
 * What a route module exports, as far as the mirror needs to know: which
 * names exist, and for the route segment config, the literal each is set to.
 */
export interface ModuleExports {
  /** Value exports by name, `default` included. Type-only exports are not here. */
  names: Set<string>
  /**
   * Source text of `export const name = <literal>` initializers. Next.js reads
   * route segment config by static analysis, so the mirror has to repeat the
   * literal rather than re-export the binding.
   */
  literals: Map<string, string>
  /** The module has an `export * from`, so `names` is incomplete. */
  exportsAll: boolean
  /** The directive prologue - `'use client'` and friends. */
  directives: string[]
}

type Node = Record<string, any>

// Plain `.js` parses as JSX: JSX in `.js` is routine in Next.js apps and JSX is
// a syntactic superset of JS. `.ts` is the opposite - JSX there is ambiguous
// with type assertions - so only `.tsx` gets it.
const LANGS: Record<string, 'ts' | 'tsx' | 'js' | 'jsx'> = {
  ts: 'ts',
  mts: 'ts',
  cts: 'ts',
  tsx: 'tsx',
  js: 'jsx',
  jsx: 'jsx',
  mjs: 'jsx',
  cjs: 'jsx',
}

/** `export { a as b }` may spell either name as a string literal. */
function exportName(node: Node): string {
  return node.type === 'Identifier' ? node.name : String(node.value)
}

/**
 * Whether an initializer is something Next's static analysis will accept as
 * route segment config: a literal, or a structure built only of literals.
 */
function isLiteral(node: Node): boolean {
  switch (node.type) {
    case 'Literal':
      return true
    case 'TemplateLiteral':
      return node.expressions.length === 0
    case 'UnaryExpression':
      return (
        (node.operator === '-' || node.operator === '+') &&
        isLiteral(node.argument)
      )
    case 'ArrayExpression':
      return node.elements.every(
        (element: Node | null) => element !== null && isLiteral(element),
      )
    case 'ObjectExpression':
      return node.properties.every(
        (property: Node) =>
          property.type === 'Property' &&
          !property.computed &&
          property.kind === 'init' &&
          isLiteral(property.value),
      )
    // `'force-static' as const` is still a literal to Next.
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
      return isLiteral(node.expression)
    default:
      return false
  }
}

export function analyzeModule(source: string, filename: string): ModuleExports {
  const extension = filename.split('.').pop() ?? 'tsx'
  const parsed = parseSync(filename, source, {
    sourceType: 'module',
    lang: LANGS[extension] ?? 'tsx',
  })
  if (parsed.errors.length > 0) {
    throw new Error(`${filename}: ${parsed.errors[0]!.message}`)
  }

  const result: ModuleExports = {
    names: new Set(),
    literals: new Map(),
    exportsAll: false,
    directives: [],
  }

  const body = (parsed.program as Node).body as Node[]

  for (const statement of body) {
    if (statement.type === 'ExpressionStatement' && statement.directive) {
      result.directives.push(statement.directive)
      continue
    }

    if (statement.type === 'ExportDefaultDeclaration') {
      result.names.add('default')
      continue
    }

    if (statement.type === 'ExportAllDeclaration') {
      if (statement.exportKind !== 'type') result.exportsAll = true
      continue
    }

    if (statement.type !== 'ExportNamedDeclaration') continue
    if (statement.exportKind === 'type') continue

    const declaration = statement.declaration as Node | null
    if (declaration) {
      switch (declaration.type) {
        case 'FunctionDeclaration':
        case 'ClassDeclaration':
        case 'TSEnumDeclaration':
          result.names.add(declaration.id.name)
          break
        case 'VariableDeclaration':
          for (const declarator of declaration.declarations as Node[]) {
            if (declarator.id.type !== 'Identifier') continue
            const name: string = declarator.id.name
            result.names.add(name)
            const init = declarator.init as Node | null
            if (init && isLiteral(init)) {
              result.literals.set(name, source.slice(init.start, init.end))
            }
          }
          break
        default:
          break
      }
    }

    for (const specifier of (statement.specifiers ?? []) as Node[]) {
      if (specifier.exportKind === 'type') continue
      result.names.add(exportName(specifier.exported))
    }
  }

  return result
}
