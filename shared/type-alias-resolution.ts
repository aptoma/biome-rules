import type {AnyTsType, SemanticModel, TsReferenceType, TsTypeAliasDeclaration} from '@biomejs/runtime/plugin';

/** Where a type is evaluated: the alias type parameters in scope and the aliases being expanded (cycle guard). */
export type TypeEnvironment = {
	readonly substitutions: ReadonlyMap<string, BoundType>;
	readonly resolving: ReadonlySet<string>;
};

/** A type together with the environment it was written in. */
export type BoundType = {
	readonly type: AnyTsType;
	readonly environment: TypeEnvironment;
};

export const EMPTY_ENVIRONMENT: TypeEnvironment = {substitutions: new Map(), resolving: new Set()};

export type ResolvedTypeMatcher = (type: AnyTsType, matches: (child: AnyTsType) => boolean) => boolean;

/** The simple identifier naming a type reference, or undefined for qualified names. */
export function typeReferenceName(type: TsReferenceType): string | undefined {
	return type.name?.kind === 'JS_REFERENCE_IDENTIFIER' ? type.name.valueToken : undefined;
}

/** The explicit type arguments of a reference (`Foo<A, B>` -> `[A, B]`). */
export function typeArguments(type: TsReferenceType): readonly AnyTsType[] {
	return type.typeArguments?.tsTypeArgumentList ?? [];
}

/**
 * Resolve the nearest visible alias for a reference. Biome's semantic model applies lexical scoping, forward
 * references, and shadowing by type parameters, mapped-type keys, and `infer` binders.
 */
export function visibleTypeAlias(type: TsReferenceType, model: SemanticModel): TsTypeAliasDeclaration | undefined {
	if (type.name?.kind !== 'JS_REFERENCE_IDENTIFIER') return undefined;
	const declaration = model.binding(type.name)?.syntax().parent;
	return declaration?.kind === 'TS_TYPE_ALIAS_DECLARATION' ? declaration : undefined;
}

/** Return whether any local type-space declaration (alias, interface, import, type parameter, ...) shadows this name. */
export function hasVisibleTypeBinding(type: TsReferenceType, model: SemanticModel): boolean {
	return type.name?.kind === 'JS_REFERENCE_IDENTIFIER' && model.binding(type.name) !== undefined;
}

/** Nodes have no stable identity, so aliases being resolved are tracked by their declaration source. */
function aliasKey(alias: TsTypeAliasDeclaration): string {
	return alias.text;
}

/** Whether a reference binds to a type alias's type parameter, rather than an `infer`, mapped-type, or function one. */
function isAliasTypeParameter(reference: TsReferenceType, model: SemanticModel): boolean {
	if (reference.name?.kind !== 'JS_REFERENCE_IDENTIFIER') return false;
	const parameters = model
		.binding(reference.name)
		?.syntax()
		.ancestors()
		.find((node) => node.kind === 'TS_TYPE_PARAMETERS');
	return parameters?.parent?.kind === 'TS_TYPE_ALIAS_DECLARATION';
}

/** The argument bound to a reference that names a type parameter of the alias being expanded. */
export function boundTypeParameter(
	reference: TsReferenceType,
	model: SemanticModel,
	environment: TypeEnvironment
): BoundType | undefined {
	const name = typeReferenceName(reference);
	if (name === undefined || typeArguments(reference).length > 0) return undefined;
	const bound = environment.substitutions.get(name);
	return bound !== undefined && isAliasTypeParameter(reference, model) ? bound : undefined;
}

/**
 * Expand a reference to a visible alias by one step. Explicit arguments keep the caller's environment; defaults see
 * the alias's earlier parameters. The body sees only the alias's own parameters, so names cannot leak across scopes.
 */
export function expandAlias(
	reference: TsReferenceType,
	model: SemanticModel,
	environment: TypeEnvironment
): BoundType | undefined {
	const alias = visibleTypeAlias(reference, model);
	if (alias?.ty === undefined || environment.resolving.has(aliasKey(alias))) return undefined;
	const resolving = new Set(environment.resolving).add(aliasKey(alias));
	const arguments_ = typeArguments(reference);
	const substitutions = new Map<string, BoundType>();
	for (const [index, parameter] of (alias.typeParameters?.items ?? []).entries()) {
		const name = parameter.name?.identToken;
		if (name === undefined) return undefined;
		const explicitArgument = arguments_[index];
		const fallback = parameter.default?.ty;
		if (explicitArgument !== undefined) {
			substitutions.set(name, {type: explicitArgument, environment});
		} else if (fallback !== undefined) {
			substitutions.set(name, {type: fallback, environment: {substitutions: new Map(substitutions), resolving}});
		} else {
			return undefined;
		}
	}
	return {type: alias.ty, environment: {substitutions, resolving}};
}

/** Match a type after resolving visible aliases and substituting their type parameters. */
export function resolvedTypeMatches(type: AnyTsType, model: SemanticModel, matcher: ResolvedTypeMatcher): boolean {
	const evaluate = (current: AnyTsType, environment: TypeEnvironment): boolean => {
		if (current.kind === 'TS_REFERENCE_TYPE') {
			const next = boundTypeParameter(current, model, environment) ?? expandAlias(current, model, environment);
			if (next !== undefined) return evaluate(next.type, next.environment);
		}
		return matcher(current, (child) => evaluate(child, environment));
	};

	return evaluate(type, EMPTY_ENVIRONMENT);
}
