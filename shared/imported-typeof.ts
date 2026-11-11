import type {
	AnyJsAstNode,
	AnyTsName,
	JsDeclarationKind,
	JsReferenceIdentifier,
	SemanticModel,
	TsReferenceType,
	TsTypeofType
} from '@biomejs/runtime/plugin';
import {hasVisibleTypeBinding, typeReferenceName} from './type-alias-resolution.ts';

/** The leftmost identifier of a name: `ns` in `ns.fn.inner`. */
function rootIdentifier(name: AnyTsName | undefined) {
	let current = name;
	while (current?.kind === 'TS_QUALIFIED_NAME') current = current.left;
	return current;
}

const TYPE_ONLY_DECLARATIONS: ReadonlySet<JsDeclarationKind> = new Set(['generic', 'interface', 'type']);

/**
 * Whether a nested scope declares a value with this name. Biome resolves a `typeof` operand in type space first,
 * so an import (which binds both spaces) wins over a nearer value-only declaration that TypeScript would pick.
 */
function isShadowedByLocalValue(identifier: JsReferenceIdentifier, model: SemanticModel): boolean {
	const name = identifier.valueToken;
	if (name === undefined) return false;
	return (model.scope(identifier)?.ancestors() ?? []).some((scope) => {
		const binding = scope.isGlobalScope() ? undefined : scope.getBinding(name);
		return binding !== undefined && !TYPE_ONLY_DECLARATIONS.has(binding.declarationKind());
	});
}

/** Whether `typeof X` (or `typeof ns.x`) queries a value bound by an import in this module. */
export function isImportedTypeof(type: TsTypeofType, model: SemanticModel): boolean {
	const root = rootIdentifier(type.expressionName);
	if (root?.kind !== 'JS_REFERENCE_IDENTIFIER') return false;
	return model.binding(root)?.isImported() === true && !isShadowedByLocalValue(root, model);
}

/** Whether a node is or contains a `typeof` query of an imported value. */
export function containsImportedTypeof(node: AnyJsAstNode, model: SemanticModel): boolean {
	if (node.kind === 'TS_TYPEOF_TYPE' && isImportedTypeof(node, model)) return true;
	return node.children().some((child) => containsImportedTypeof(child, model));
}

/** The name of a reference to one of the given global utility types, unless a local declaration shadows it. */
export function globalUtilityName(type: TsReferenceType, model: SemanticModel, utilities: ReadonlySet<string>) {
	const name = typeReferenceName(type);
	return name !== undefined && utilities.has(name) && !hasVisibleTypeBinding(type, model) ? name : undefined;
}
