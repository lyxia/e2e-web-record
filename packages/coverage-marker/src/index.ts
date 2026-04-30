import path from 'path';
import type { PluginObj, PluginPass, types as BabelTypes } from '@babel/core';
import type { Binding } from '@babel/traverse';

type ImportMap = Map<string, { importedName: string; binding: Binding | undefined }>;

interface CoverageMarkerOptions {
  targetPackages?: string[];
}

interface CoverageMarkerState extends PluginPass {
  importedComponents: ImportMap;
  wrappedNodes: WeakSet<BabelTypes.JSXElement>;
  hasRuntimeImport: boolean;
  runtimeLocalName: string;
  needsRuntimeImport: boolean;
  opts: CoverageMarkerOptions;
}

const runtimeSource = '@odc/coverage-marker/runtime';
const runtimeName = '__CoverageMark';

function jsxIdentifierName(name: BabelTypes.JSXElement['openingElement']['name']) {
  return name.type === 'JSXIdentifier' ? name.name : undefined;
}

function jsxRootIdentifierName(name: BabelTypes.JSXElement['openingElement']['name']): string | undefined {
  if (name.type === 'JSXIdentifier') {
    return name.name;
  }

  if (name.type === 'JSXMemberExpression') {
    return jsxMemberRootIdentifierName(name.object);
  }

  return undefined;
}

function jsxMemberRootIdentifierName(
  object: BabelTypes.JSXMemberExpression['object'],
): string | undefined {
  if (object.type === 'JSXIdentifier') {
    return object.name;
  }

  if (object.type === 'JSXMemberExpression') {
    return jsxMemberRootIdentifierName(object.object);
  }

  return undefined;
}

function isCoverageMarkElement(node: BabelTypes.JSXElement, runtimeLocalName: string) {
  return jsxIdentifierName(node.openingElement.name) === runtimeLocalName;
}

export default function coverageMarkerPlugin({
  types: t,
}: {
  types: typeof BabelTypes;
}): PluginObj<CoverageMarkerState> {
  return {
    name: 'coverage-marker',
    pre() {
      this.importedComponents = new Map();
      this.wrappedNodes = new WeakSet();
      this.hasRuntimeImport = false;
      this.runtimeLocalName = runtimeName;
      this.needsRuntimeImport = false;
    },
    visitor: {
      Program: {
        enter(programPath, state) {
          state.importedComponents = new Map();
          state.hasRuntimeImport = false;
          state.runtimeLocalName = runtimeName;
          state.needsRuntimeImport = false;

          const targetPackages = state.opts.targetPackages ?? [];
          for (const statementPath of programPath.get('body')) {
            if (!statementPath.isImportDeclaration()) {
              continue;
            }

            const source = statementPath.node.source.value;
            if (source === runtimeSource) {
              for (const specifier of statementPath.node.specifiers) {
                if (
                  t.isImportSpecifier(specifier) &&
                  t.isIdentifier(specifier.imported, { name: runtimeName }) &&
                  t.isIdentifier(specifier.local)
                ) {
                  state.hasRuntimeImport = true;
                  state.runtimeLocalName = specifier.local.name;
                  break;
                }
              }
              continue;
            }

            if (
              targetPackages.length === 0 ||
              !targetPackages.includes(source) ||
              statementPath.node.importKind === 'type'
            ) {
              continue;
            }

            for (const specifier of statementPath.node.specifiers) {
              if (t.isImportDefaultSpecifier(specifier) && t.isIdentifier(specifier.local)) {
                state.importedComponents.set(specifier.local.name, {
                  importedName: 'default',
                  binding: statementPath.scope.getBinding(specifier.local.name),
                });
                continue;
              }

              if (t.isImportNamespaceSpecifier(specifier) && t.isIdentifier(specifier.local)) {
                state.importedComponents.set(specifier.local.name, {
                  importedName: '*',
                  binding: statementPath.scope.getBinding(specifier.local.name),
                });
                continue;
              }

              if (
                !t.isImportSpecifier(specifier) ||
                specifier.importKind === 'type' ||
                !t.isIdentifier(specifier.local)
              ) {
                continue;
              }

              const importedName = t.isIdentifier(specifier.imported)
                ? specifier.imported.name
                : specifier.imported.value;
              state.importedComponents.set(specifier.local.name, {
                importedName,
                binding: statementPath.scope.getBinding(specifier.local.name),
              });
            }
          }
        },
        exit(programPath, state) {
          if (!state.needsRuntimeImport || state.hasRuntimeImport) {
            return;
          }

          programPath.unshiftContainer(
            'body',
            t.importDeclaration(
              [
                t.importSpecifier(
                  t.identifier(runtimeName),
                  t.identifier(runtimeName),
                ),
              ],
              t.stringLiteral(runtimeSource),
            ),
          );
        },
      },
      JSXElement(jsxPath, state) {
        if (state.wrappedNodes.has(jsxPath.node)) {
          return;
        }

        const elementName = jsxRootIdentifierName(jsxPath.node.openingElement.name);
        if (!elementName || elementName === state.runtimeLocalName) {
          return;
        }

        const parent = jsxPath.parentPath;
        if (parent.isJSXElement() && isCoverageMarkElement(parent.node, state.runtimeLocalName)) {
          return;
        }

        const importedComponent = state.importedComponents.get(elementName);
        if (!importedComponent) {
          return;
        }

        if (jsxPath.scope.getBinding(elementName) !== importedComponent.binding) {
          return;
        }

        const filename = state.filename ?? '';
        const cwd = state.cwd ?? process.cwd();
        const relativeFilename = path.relative(cwd, filename).split(path.sep).join('/');
        const line = jsxPath.node.loc?.start.line ?? 0;
        const column = (jsxPath.node.loc?.start.column ?? 0) + 1;
        const id = `${relativeFilename}#${importedComponent.importedName}#L${line}#C${column}`;
        const original = jsxPath.node;

        state.wrappedNodes.add(original);
        state.needsRuntimeImport = true;
        jsxPath.replaceWith(
          t.jsxElement(
            t.jsxOpeningElement(
              t.jsxIdentifier(state.runtimeLocalName),
              [
                t.jsxAttribute(
                  t.jsxIdentifier('id'),
                  t.stringLiteral(id),
                ),
              ],
              false,
            ),
            t.jsxClosingElement(t.jsxIdentifier(state.runtimeLocalName)),
            [original],
            false,
          ),
        );
      },
    },
  };
}
