import { babelParse } from '@vue/compiler-sfc'

// Inspect the shipped renderer code, not just public file presence. A copied file
// still breaks under file:// if a Vue binding points at /coast-inspiration.webp.
export function rootAssetBindings(source, publicPaths) {
  const files = new Set(publicPaths.map(name => `/${name.replaceAll('\\', '/')}`))
  const ast = babelParse(source, { sourceType: 'module' })
  const taintedNames = new Set()
  const taintedProperties = new Set()
  const failures = []
  function walk(node, visit) {
    if (!node || typeof node !== 'object') return
    if (typeof node.type === 'string') visit(node)
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra'].includes(key)) continue
      if (Array.isArray(value)) for (const item of value) walk(item, visit)
      else if (value && typeof value === 'object') walk(value, visit)
    }
  }
  const propertyName = node => node?.type === 'Identifier' ? node.name : node?.type === 'StringLiteral' ? node.value : undefined
  function containsRoot(node) {
    let result = false
    walk(node, child => { if (child.type === 'StringLiteral' && files.has(child.value)) result = true })
    return result
  }
  walk(ast, node => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && containsRoot(node.init)) taintedNames.add(node.id.name)
    if (node.type === 'ObjectProperty' && containsRoot(node.value)) taintedProperties.add(propertyName(node.key))
  })
  function unsafe(node) {
    if (!node) return false
    if (node.type === 'StringLiteral') return files.has(node.value)
    // Resolvers are covered separately by real component file-URL rendering.
    if (node.type === 'CallExpression' || node.type === 'NewExpression') return false
    if (node.type === 'Identifier') return taintedNames.has(node.name)
    if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
      return taintedProperties.has(propertyName(node.property)) || (node.object.type === 'Identifier' && taintedNames.has(node.object.name))
    }
    if (node.type === 'ConditionalExpression') return unsafe(node.consequent) || unsafe(node.alternate)
    if (node.type === 'LogicalExpression' || node.type === 'BinaryExpression') return unsafe(node.left) || unsafe(node.right)
    if (node.type === 'TemplateLiteral') return node.expressions.some(unsafe) || node.quasis.some(part => files.has(part.value.cooked))
    if (node.type === 'ArrayExpression') return node.elements.some(unsafe)
    return false
  }
  walk(ast, node => {
    if (node.type === 'ObjectProperty' && ['src', 'poster', 'srcset', 'srcSet'].includes(propertyName(node.key)) && unsafe(node.value)) {
      failures.push({ line: node.loc?.start.line, expression: source.slice(node.value.start, node.value.end) })
    }
  })
  return failures
}
