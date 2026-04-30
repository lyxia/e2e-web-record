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
      ImportDeclaration(importPath, state) {
        const source = importPath.node.source.value;
        if (source === runtimeSource) {
          for (const specifier of importPath.node.specifiers) {
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
          return;
        }

        const targetPackages = state.opts.targetPackages ?? [];
        if (
          targetPackages.length === 0 ||
          !targetPackages.includes(source) ||
          importPath.node.importKind === 'type'
        ) {
          return;
        }

        for (const specifier of importPath.node.specifiers) {
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
            binding: importPath.scope.getBinding(specifier.local.name),
          });
        }
      },
      JSXElement(jsxPath, state) {
        if (state.wrappedNodes.has(jsxPath.node)) {
          return;
        }

        const elementName = jsxIdentifierName(jsxPath.node.openingElement.name);
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
        const relativeFilename = path.relative(cwd, filename);
        const line = jsxPath.node.loc?.start.line ?? 0;
        const id = `${relativeFilename}#${importedComponent.importedName}#L${line}`;
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
      Program: {
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
    },
  };
}
