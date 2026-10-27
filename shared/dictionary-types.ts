import type {
	AnyJsExpression,
	AnyTsType,
	AnyTsTypeMember,
	SemanticModel,
	TsInterfaceDeclaration,
	TsReferenceType
} from '@biomejs/runtime/plugin';
import {
	boundTypeParameter,
	EMPTY_ENVIRONMENT,
	expandAlias,
	hasVisibleTypeBinding,
	type TypeEnvironment,
	typeArguments,
	typeReferenceName,
	visibleTypeAlias
} from './type-alias-resolution.ts';

const BUILT_INS = new Set(['Record', 'Readonly', 'Partial', 'Required', 'Pick', 'Omit', 'PropertyKey', 'NonNullable']);
const TRANSPARENT_WRAPPERS = new Set(['Readonly', 'Partial', 'Required', 'NonNullable']);

type UnsafeDictionaryValue = 'any' | 'empty-object' | 'object' | 'union' | 'unknown';

export type WideningTargetKind = 'anonymous object' | 'generic container' | 'object' | 'open dictionary' | 'unknown';

function isBuiltIn(name: string, use: TsReferenceType, model: SemanticModel): boolean {
	return BUILT_INS.has(name) && !hasVisibleTypeBinding(use, model);
}

function isTransparentWrapper(name: string, use: TsReferenceType, model: SemanticModel): boolean {
	return TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, use, model);
}

function unwrapTransparentType(type: AnyTsType): AnyTsType {
	let current = type;
	while (
		(current.kind === 'TS_PARENTHESIZED_TYPE' ||
			(current.kind === 'TS_TYPE_OPERATOR_TYPE' && current.operatorToken === 'readonly')) &&
		current.ty !== undefined
	) {
		current = current.ty;
	}
	return current;
}

function isEffectivelyEmptyMember(member: AnyTsTypeMember): boolean {
	return (
		member.kind === 'TS_PROPERTY_SIGNATURE_TYPE_MEMBER' &&
		member.optionalToken !== undefined &&
		member.typeAnnotation?.ty !== undefined &&
		unwrapTransparentType(member.typeAnnotation.ty).kind === 'TS_NEVER_TYPE'
	);
}

function isEffectivelyEmptyMembers(members: readonly AnyTsTypeMember[]): boolean {
	return members.every(isEffectivelyEmptyMember);
}

/** Every declaration merged into the interface a reference resolves to, or undefined for non-interfaces. */
function interfaceDeclarations(
	type: TsReferenceType,
	model: SemanticModel
): readonly TsInterfaceDeclaration[] | undefined {
	if (type.name?.kind !== 'JS_REFERENCE_IDENTIFIER') return undefined;
	const declaration = model.binding(type.name)?.syntax().parent;
	if (declaration?.kind !== 'TS_INTERFACE_DECLARATION') return undefined;
	const name = declaration.id?.text;
	let container = declaration.parent;
	if (container?.kind === 'JS_EXPORT') container = container.parent;
	return (container?.children() ?? []).flatMap((statement) => {
		const candidate = statement.kind === 'JS_EXPORT' ? statement.exportClause : statement;
		return candidate?.kind === 'TS_INTERFACE_DECLARATION' && candidate.id?.text === name ? [candidate] : [];
	});
}

function isEffectivelyEmptyInterface(declarations: readonly TsInterfaceDeclaration[]): boolean {
	const [declaration] = declarations;
	return (
		declarations.length === 1 &&
		declaration !== undefined &&
		declaration.extendsClause === undefined &&
		isEffectivelyEmptyMembers(declaration.members)
	);
}

function unsafeDirectValue(
	type: AnyTsType,
	model: SemanticModel,
	environment: TypeEnvironment
): UnsafeDictionaryValue | undefined {
	const unwrapped = unwrapTransparentType(type);
	if (unwrapped.kind === 'TS_UNKNOWN_TYPE') return 'unknown';
	if (unwrapped.kind === 'TS_ANY_TYPE') return 'any';
	if (unwrapped.kind === 'TS_NON_PRIMITIVE_TYPE') return 'object';
	if (unwrapped.kind === 'TS_OBJECT_TYPE' && isEffectivelyEmptyMembers(unwrapped.members)) return 'empty-object';
	if (unwrapped.kind === 'TS_UNION_TYPE') {
		return unwrapped.types.some((member) => unsafeDirectValue(member, model, environment) !== undefined)
			? 'union'
			: undefined;
	}
	if (unwrapped.kind === 'TS_INTERSECTION_TYPE') {
		const unsafeMembers = unwrapped.types.map((member) => unsafeDirectValue(member, model, environment));
		if (unsafeMembers.includes('any')) return 'any';
		return unsafeMembers.every((member) => member !== undefined) ? unsafeMembers[0] : undefined;
	}
	if (unwrapped.kind !== 'TS_REFERENCE_TYPE') return undefined;
	const name = typeReferenceName(unwrapped);
	if (name === undefined) return undefined;
	if (isTransparentWrapper(name, unwrapped, model)) {
		const wrapped = typeArguments(unwrapped)[0];
		return wrapped === undefined ? undefined : unsafeDirectValue(wrapped, model, environment);
	}
	const bound = boundTypeParameter(unwrapped, model, environment);
	if (bound !== undefined) return unsafeDirectValue(bound.type, model, bound.environment);
	const interfaces = interfaceDeclarations(unwrapped, model);
	if (interfaces !== undefined) return isEffectivelyEmptyInterface(interfaces) ? 'empty-object' : undefined;
	const expanded = expandAlias(unwrapped, model, environment);
	return expanded === undefined ? undefined : unsafeDirectValue(expanded.type, model, expanded.environment);
}

/** Classify a dictionary's direct value type as an unsafe escape hatch, or undefined when it is concrete. */
export function classifyUnsafeDictionaryValue(
	valueType: AnyTsType,
	model: SemanticModel
): UnsafeDictionaryValue | undefined {
	return unsafeDirectValue(valueType, model, EMPTY_ENVIRONMENT);
}

/** Classify an explicit target type that discards evidence about a value assigned to it. */
export function classifyWideningTarget(type: AnyTsType, model: SemanticModel): WideningTargetKind | undefined {
	const unwrapped = unwrapTransparentType(type);
	if (unwrapped.kind === 'TS_UNKNOWN_TYPE') return 'unknown';
	if (unwrapped.kind === 'TS_NON_PRIMITIVE_TYPE') return 'object';
	if (unwrapped.kind === 'TS_OBJECT_TYPE') {
		if (unwrapped.members.some((member) => member.kind === 'TS_INDEX_SIGNATURE_TYPE_MEMBER')) return 'open dictionary';
		return unwrapped.members.length > 0 ? 'anonymous object' : undefined;
	}
	if (unwrapped.kind === 'TS_MAPPED_TYPE') return 'open dictionary';
	if (unwrapped.kind !== 'TS_REFERENCE_TYPE') return undefined;
	const name = typeReferenceName(unwrapped);
	if (name === undefined) return undefined;
	if (isTransparentWrapper(name, unwrapped, model)) {
		const wrapped = typeArguments(unwrapped)[0];
		return wrapped === undefined ? undefined : classifyWideningTarget(wrapped, model);
	}
	if (name === 'Record' && isBuiltIn(name, unwrapped, model)) {
		return hasBroadRecordKey(unwrapped, model, EMPTY_ENVIRONMENT) ? 'open dictionary' : undefined;
	}
	const expanded = expandAlias(unwrapped, model, EMPTY_ENVIRONMENT);
	if (expanded === undefined) return undefined;
	const resolved = classifyAliasBroadTarget(expanded.type, model, expanded.environment);
	if (expanded.environment.substitutions.size === 0) return resolved;
	return resolved === 'open dictionary' ? 'generic container' : undefined;
}

function hasBroadRecordKey(type: TsReferenceType, model: SemanticModel, environment: TypeEnvironment): boolean {
	const key = typeArguments(type)[0];
	return key === undefined || isBroadMappedKey(key, model, environment);
}

function isBroadMappedKey(type: AnyTsType, model: SemanticModel, environment: TypeEnvironment): boolean {
	const unwrapped = unwrapTransparentType(type);
	if (
		unwrapped.kind === 'TS_STRING_TYPE' ||
		unwrapped.kind === 'TS_NUMBER_TYPE' ||
		unwrapped.kind === 'TS_SYMBOL_TYPE'
	) {
		return true;
	}
	if (unwrapped.kind === 'TS_UNION_TYPE') {
		return unwrapped.types.some((member) => isBroadMappedKey(member, model, environment));
	}
	if (unwrapped.kind !== 'TS_REFERENCE_TYPE') return false;
	const name = typeReferenceName(unwrapped);
	if (name === undefined) return false;
	const bound = boundTypeParameter(unwrapped, model, environment);
	if (bound !== undefined) return isBroadMappedKey(bound.type, model, bound.environment);
	if (name === 'PropertyKey' && isBuiltIn(name, unwrapped, model)) return true;
	if ((visibleTypeAlias(unwrapped, model)?.typeParameters?.items.length ?? 0) > 0) return false;
	const expanded = expandAlias(unwrapped, model, environment);
	return expanded !== undefined && isBroadMappedKey(expanded.type, model, expanded.environment);
}

function classifyAliasBroadTarget(
	type: AnyTsType,
	model: SemanticModel,
	environment: TypeEnvironment
): WideningTargetKind | undefined {
	const unwrapped = unwrapTransparentType(type);
	if (unwrapped.kind === 'TS_UNKNOWN_TYPE') return 'unknown';
	if (unwrapped.kind === 'TS_NON_PRIMITIVE_TYPE') return 'object';
	if (unwrapped.kind === 'TS_OBJECT_TYPE') {
		return unwrapped.members.some((member) => member.kind === 'TS_INDEX_SIGNATURE_TYPE_MEMBER')
			? 'open dictionary'
			: undefined;
	}
	if (unwrapped.kind === 'TS_MAPPED_TYPE') {
		return unwrapped.keysType !== undefined && isBroadMappedKey(unwrapped.keysType, model, environment)
			? 'open dictionary'
			: undefined;
	}
	if (unwrapped.kind !== 'TS_REFERENCE_TYPE') return undefined;
	const name = typeReferenceName(unwrapped);
	if (name === undefined) return undefined;
	const bound = boundTypeParameter(unwrapped, model, environment);
	if (bound !== undefined) return classifyAliasBroadTarget(bound.type, model, bound.environment);
	if (isTransparentWrapper(name, unwrapped, model)) {
		const wrapped = typeArguments(unwrapped)[0];
		return wrapped === undefined ? undefined : classifyAliasBroadTarget(wrapped, model, environment);
	}
	if (name === 'Record' && isBuiltIn(name, unwrapped, model)) {
		return hasBroadRecordKey(unwrapped, model, environment) ? 'open dictionary' : undefined;
	}
	const expanded = expandAlias(unwrapped, model, environment);
	return expanded === undefined ? undefined : classifyAliasBroadTarget(expanded.type, model, expanded.environment);
}

/** Strip parentheses and type-level wrappers that do not change the runtime value. */
export function unwrapExpression(expression: AnyJsExpression): AnyJsExpression {
	let current = expression;
	while (
		(current.kind === 'JS_PARENTHESIZED_EXPRESSION' ||
			current.kind === 'TS_AS_EXPRESSION' ||
			current.kind === 'TS_SATISFIES_EXPRESSION' ||
			current.kind === 'TS_TYPE_ASSERTION_EXPRESSION' ||
			current.kind === 'TS_NON_NULL_ASSERTION_EXPRESSION') &&
		current.expression !== undefined
	) {
		current = current.expression;
	}
	return current;
}

/** Whether an expression syntactically establishes its own type (literal, object, array, function, class, `new`, ...). */
export function isKnownEvidenceExpression(expression: AnyJsExpression): boolean {
	const current = unwrapExpression(expression);
	switch (current.kind) {
		case 'JS_ARRAY_EXPRESSION':
		case 'JS_ARROW_FUNCTION_EXPRESSION':
		case 'JS_BIGINT_LITERAL_EXPRESSION':
		case 'JS_BOOLEAN_LITERAL_EXPRESSION':
		case 'JS_CLASS_EXPRESSION':
		case 'JS_FUNCTION_EXPRESSION':
		case 'JS_NEW_EXPRESSION':
		case 'JS_NULL_LITERAL_EXPRESSION':
		case 'JS_NUMBER_LITERAL_EXPRESSION':
		case 'JS_OBJECT_EXPRESSION':
		case 'JS_REGEX_LITERAL_EXPRESSION':
		case 'JS_STRING_LITERAL_EXPRESSION':
		case 'JS_UNARY_EXPRESSION':
			return true;
		case 'JS_TEMPLATE_EXPRESSION':
			return current.tag === undefined;
		default:
			return false;
	}
}
