import type {
	AnyJsAstNode,
	AnyJsExpression,
	AnyTsType,
	JsVariableDeclarator,
	SemanticModel
} from '@biomejs/runtime/plugin';
import {defineRule, registerDiagnostic, semantic} from '@biomejs/runtime/plugin';

type BroadTypeKind = 'top' | 'object' | 'record';

type KnownValueEvidence = {
	readonly type: AnyTsType | null;
};

/**
 * Where a node sits in the tree: child indices from the root plus the key of its nearest enclosing function. Biome
 * nodes have no identity or positions, so both are rebuilt from the ancestor chain. A child is located among its
 * siblings by kind and text; textually identical siblings resolve to the first one.
 */
type TreePosition = {
	readonly path: readonly number[];
	readonly boundary: string;
};

const FUNCTION_BOUNDARY_KINDS = new Set<string>([
	'JS_ARROW_FUNCTION_EXPRESSION',
	'JS_FUNCTION_DECLARATION',
	'JS_FUNCTION_EXPORT_DEFAULT_DECLARATION',
	'JS_FUNCTION_EXPRESSION',
	'TS_DECLARE_FUNCTION_DECLARATION',
	'TS_DECLARE_FUNCTION_EXPORT_DEFAULT_DECLARATION'
]);

// ESTree models these members as a key plus a function value; the key and modifiers sit outside that function.
const METHOD_BOUNDARY_KINDS = new Set<string>([
	'JS_CONSTRUCTOR_CLASS_MEMBER',
	'JS_GETTER_CLASS_MEMBER',
	'JS_GETTER_OBJECT_MEMBER',
	'JS_METHOD_CLASS_MEMBER',
	'JS_METHOD_OBJECT_MEMBER',
	'JS_SETTER_CLASS_MEMBER',
	'JS_SETTER_OBJECT_MEMBER',
	'TS_CONSTRUCTOR_SIGNATURE_CLASS_MEMBER',
	'TS_GETTER_SIGNATURE_CLASS_MEMBER',
	'TS_METHOD_SIGNATURE_CLASS_MEMBER',
	'TS_SETTER_SIGNATURE_CLASS_MEMBER'
]);

const BROAD_KEY_KINDS = new Set<string>(['TS_STRING_TYPE', 'TS_NUMBER_TYPE', 'TS_SYMBOL_TYPE']);

const KNOWN_VALUE_KINDS = new Set<string>([
	'JS_ARRAY_EXPRESSION',
	'JS_ARROW_FUNCTION_EXPRESSION',
	'JS_BIGINT_LITERAL_EXPRESSION',
	'JS_BOOLEAN_LITERAL_EXPRESSION',
	'JS_CLASS_EXPRESSION',
	'JS_FUNCTION_EXPRESSION',
	'JS_NEW_EXPRESSION',
	'JS_NULL_LITERAL_EXPRESSION',
	'JS_NUMBER_LITERAL_EXPRESSION',
	'JS_OBJECT_EXPRESSION',
	'JS_REGEX_LITERAL_EXPRESSION',
	'JS_STRING_LITERAL_EXPRESSION'
]);

function isFunctionBoundary(node: AnyJsAstNode, child: AnyJsAstNode): boolean {
	if (FUNCTION_BOUNDARY_KINDS.has(node.kind)) return true;
	return (
		METHOD_BOUNDARY_KINDS.has(node.kind) &&
		child.kind !== 'JS_COMPUTED_MEMBER_NAME' &&
		!child.kind.endsWith('_MODIFIER_LIST')
	);
}

function treePosition(node: AnyJsAstNode): TreePosition {
	const chain = [...node.ancestors()].reverse();
	chain.push(node);
	const path: number[] = [];
	for (let index = 0; index < chain.length - 1; index++) {
		const child = chain[index + 1];
		path.push(
			chain[index].children().findIndex((sibling) => sibling.kind === child.kind && sibling.text === child.text)
		);
	}
	let boundaryDepth = 0;
	for (let index = chain.length - 2; index > 0; index--) {
		if (isFunctionBoundary(chain[index], chain[index + 1])) {
			boundaryDepth = index;
			break;
		}
	}
	return {path, boundary: path.slice(0, boundaryDepth).join('.')};
}

/** Whether `node` starts after `other` ends: it follows it in document order and is not nested inside it. */
function isAfter(node: TreePosition, other: TreePosition): boolean {
	for (let index = 0; index < Math.min(node.path.length, other.path.length); index++) {
		if (node.path[index] !== other.path[index]) return node.path[index] > other.path[index];
	}
	return false;
}

function unwrapExpressionParentheses(expression: AnyJsExpression): AnyJsExpression | undefined {
	let current: AnyJsExpression | undefined = expression;
	while (current?.kind === 'JS_PARENTHESIZED_EXPRESSION') current = current.expression;
	return current;
}

function unwrapTypeParentheses(type: AnyTsType): AnyTsType | undefined {
	let current: AnyTsType | undefined = type;
	while (current?.kind === 'TS_PARENTHESIZED_TYPE') current = current.ty;
	return current;
}

function typeReferenceName(type: AnyTsType): string | null {
	return type.kind === 'TS_REFERENCE_TYPE' && type.name?.kind === 'JS_REFERENCE_IDENTIFIER' ? type.name.text : null;
}

function typeArguments(type: AnyTsType): readonly AnyTsType[] {
	return type.kind === 'TS_REFERENCE_TYPE' ? (type.typeArguments?.tsTypeArgumentList ?? []) : [];
}

function isUnknownOrAnyType(type: AnyTsType | undefined): boolean {
	const unwrapped = type === undefined ? undefined : unwrapTypeParentheses(type);
	return unwrapped?.kind === 'TS_UNKNOWN_TYPE' || unwrapped?.kind === 'TS_ANY_TYPE';
}

function isBroadRecordKeyType(type: AnyTsType | undefined): boolean {
	const unwrapped = type === undefined ? undefined : unwrapTypeParentheses(type);
	if (unwrapped === undefined) return false;
	if (BROAD_KEY_KINDS.has(unwrapped.kind)) return true;
	if (unwrapped.kind === 'TS_UNION_TYPE') return unwrapped.types.every(isBroadRecordKeyType);
	return typeReferenceName(unwrapped) === 'PropertyKey';
}

function isBroadRecordType(type: AnyTsType): boolean {
	const unwrapped = unwrapTypeParentheses(type);
	if (unwrapped === undefined) return false;

	if (unwrapped.kind === 'TS_REFERENCE_TYPE') {
		const parameters = typeArguments(unwrapped);
		if (typeReferenceName(unwrapped) === 'Readonly') {
			return parameters.length > 0 && isBroadRecordType(parameters[0]);
		}
		if (typeReferenceName(unwrapped) !== 'Record') return false;
		return parameters.length === 2 && isBroadRecordKeyType(parameters[0]) && isUnknownOrAnyType(parameters[1]);
	}

	if (unwrapped.kind !== 'TS_OBJECT_TYPE' || unwrapped.members.length !== 1) return false;
	const [member] = unwrapped.members;
	return (
		member.kind === 'TS_INDEX_SIGNATURE_TYPE_MEMBER' &&
		isBroadRecordKeyType(member.parameter?.typeAnnotation?.ty) &&
		isUnknownOrAnyType(member.typeAnnotation?.ty)
	);
}

function broadTypeKind(type: AnyTsType): BroadTypeKind | null {
	const unwrapped = unwrapTypeParentheses(type);
	if (unwrapped === undefined) return null;
	if (unwrapped.kind === 'TS_UNKNOWN_TYPE' || unwrapped.kind === 'TS_ANY_TYPE') return 'top';
	if (unwrapped.kind === 'TS_NON_PRIMITIVE_TYPE') return 'object';
	return isBroadRecordType(unwrapped) ? 'record' : null;
}

function typesHaveSameSyntax(left: AnyTsType | null, right: AnyTsType): boolean {
	const leftText = left === null ? undefined : unwrapTypeParentheses(left)?.text.replaceAll(/\s+/gu, '');
	return leftText !== undefined && leftText === unwrapTypeParentheses(right)?.text.replaceAll(/\s+/gu, '');
}

function isDefinitelyObjectType(type: AnyTsType): boolean {
	const unwrapped = unwrapTypeParentheses(type);
	switch (unwrapped?.kind) {
		case 'TS_ARRAY_TYPE':
		case 'TS_CONSTRUCTOR_TYPE':
		case 'TS_FUNCTION_TYPE':
		case 'TS_MAPPED_TYPE':
		case 'TS_NON_PRIMITIVE_TYPE':
		case 'TS_TUPLE_TYPE':
			return true;
		case 'TS_OBJECT_TYPE':
			return unwrapped.members.length > 0;
		case 'TS_INTERSECTION_TYPE':
			return unwrapped.types.every(isDefinitelyObjectType);
		case 'TS_TYPE_OPERATOR_TYPE':
			return (
				unwrapped.operatorToken === 'readonly' && unwrapped.ty !== undefined && isDefinitelyObjectType(unwrapped.ty)
			);
		default:
			return false;
	}
}

function isDefinitelyNarrowerRecordType(type: AnyTsType): boolean {
	const unwrapped = unwrapTypeParentheses(type);
	if (unwrapped === undefined) return false;
	if (unwrapped.kind === 'TS_OBJECT_TYPE') {
		return unwrapped.members.some((member) => member.kind !== 'TS_INDEX_SIGNATURE_TYPE_MEMBER');
	}

	const parameters = typeArguments(unwrapped);
	if (typeReferenceName(unwrapped) === 'Readonly') {
		return parameters.length > 0 && isDefinitelyNarrowerRecordType(parameters[0]);
	}
	if (typeReferenceName(unwrapped) !== 'Record') return false;
	return parameters.length === 2 && !isUnknownOrAnyType(parameters[1]);
}

function assertionTypeAndExpression(
	expression: AnyJsExpression | undefined
): {readonly type: AnyTsType; readonly expression: AnyJsExpression} | null {
	const unwrapped = expression === undefined ? undefined : unwrapExpressionParentheses(expression);
	if (unwrapped?.kind !== 'TS_AS_EXPRESSION' && unwrapped?.kind !== 'TS_TYPE_ASSERTION_EXPRESSION') return null;
	if (unwrapped.ty === undefined || unwrapped.expression === undefined) return null;
	return {type: unwrapped.ty, expression: unwrapped.expression};
}

function declarationType(declarator: JsVariableDeclarator): AnyTsType | undefined {
	const annotation = declarator.variableAnnotation;
	if (annotation?.kind === 'TS_DEFINITE_VARIABLE_ANNOTATION') return annotation.typeAnnotation?.ty;
	return annotation?.ty;
}

/** The type annotation attached directly to a binding identifier, as ESTree attaches it to the Identifier node. */
function bindingAnnotation(binding: AnyJsAstNode): AnyTsType | undefined {
	const parent = binding.parent;
	if (parent?.kind === 'JS_VARIABLE_DECLARATOR') return declarationType(parent);
	if (parent?.kind === 'JS_FORMAL_PARAMETER' || parent?.kind === 'JS_CATCH_DECLARATION') {
		return parent.typeAnnotation?.ty;
	}
	return undefined;
}

/** The declarator that introduces `binding`, directly or through destructuring patterns. */
function variableDeclarator(binding: AnyJsAstNode): JsVariableDeclarator | null {
	let current = binding.parent;
	while (current !== undefined) {
		if (current.kind === 'JS_VARIABLE_DECLARATOR') return current;
		if (!current.kind.startsWith('JS_OBJECT_BINDING_PATTERN') && !current.kind.startsWith('JS_ARRAY_BINDING_PATTERN')) {
			return null;
		}
		current = current.parent;
	}
	return null;
}

function isConstDeclarator(declarator: JsVariableDeclarator): boolean {
	const declaration = declarator.parent?.parent;
	return declaration?.kind === 'JS_VARIABLE_DECLARATION' && declaration.kindToken === 'const';
}

function knownValueEvidence(
	expression: AnyJsExpression,
	model: SemanticModel,
	boundary: string,
	visited: ReadonlySet<string>
): KnownValueEvidence | null {
	const unwrapped = unwrapExpressionParentheses(expression);
	if (unwrapped === undefined) return null;

	const assertion = assertionTypeAndExpression(unwrapped);
	if (assertion !== null) return broadTypeKind(assertion.type) === null ? {type: assertion.type} : null;

	if (KNOWN_VALUE_KINDS.has(unwrapped.kind)) return {type: null};
	if (unwrapped.kind === 'JS_TEMPLATE_EXPRESSION') return unwrapped.tag === undefined ? {type: null} : null;

	if (unwrapped.kind !== 'JS_IDENTIFIER_EXPRESSION' || unwrapped.name === undefined) return null;
	const binding = model.binding(unwrapped.name);
	if (binding === undefined) return null;
	const identifier = binding.syntax();
	const identifierPosition = treePosition(identifier);
	const key = identifierPosition.path.join('.');
	if (visited.has(key)) return null;

	const annotation = bindingAnnotation(identifier);
	if (annotation !== undefined) {
		if (identifierPosition.boundary !== boundary || broadTypeKind(annotation) !== null) return null;
		return {type: annotation};
	}

	const declarator = variableDeclarator(identifier);
	const initializer = declarator?.initializer?.expression;
	if (
		declarator === null ||
		!isConstDeclarator(declarator) ||
		initializer === undefined ||
		binding.allWrites().length > 0 ||
		treePosition(declarator).boundary !== boundary
	) {
		return null;
	}

	return knownValueEvidence(initializer, model, boundary, new Set([...visited, key]));
}

function assertionIsNarrower(broadKind: BroadTypeKind, evidence: KnownValueEvidence, assertedType: AnyTsType): boolean {
	if (broadTypeKind(assertedType) !== null) return false;
	if (broadKind === 'top') return true;
	if (typesHaveSameSyntax(evidence.type, assertedType)) return true;
	if (broadKind === 'object') return isDefinitelyObjectType(assertedType);
	return isDefinitelyNarrowerRecordType(assertedType);
}

/** Detect immutable local bindings that erase a known type and are later asserted back to a narrower type. */
export const noWidenThenAssert = defineRule({
	query: semantic('TS_AS_EXPRESSION', 'TS_TYPE_ASSERTION_EXPRESSION'),
	run(node, context) {
		const assertion = assertionTypeAndExpression(node);
		const expression = assertion === null ? undefined : unwrapExpressionParentheses(assertion.expression);
		if (assertion === null || expression?.kind !== 'JS_IDENTIFIER_EXPRESSION' || expression.name === undefined) return;

		const binding = context.model.binding(expression.name);
		const declarator = binding?.syntax().parent;
		const initializer = declarator?.kind === 'JS_VARIABLE_DECLARATOR' ? declarator.initializer?.expression : undefined;
		if (
			binding === undefined ||
			declarator?.kind !== 'JS_VARIABLE_DECLARATOR' ||
			!isConstDeclarator(declarator) ||
			initializer === undefined ||
			binding.allWrites().length > 0
		) {
			return;
		}

		const declaredType = declarationType(declarator);
		const initializerAssertion = assertionTypeAndExpression(initializer);
		const initializerBroadKind = initializerAssertion === null ? null : broadTypeKind(initializerAssertion.type);
		const broadKind = (declaredType === undefined ? null : broadTypeKind(declaredType)) ?? initializerBroadKind;
		if (broadKind === null) return;

		const declaratorPosition = treePosition(declarator);
		const originalExpression =
			initializerAssertion !== null && initializerBroadKind !== null ? initializerAssertion.expression : initializer;
		const evidence = knownValueEvidence(
			originalExpression,
			context.model,
			declaratorPosition.boundary,
			new Set([treePosition(binding.syntax()).path.join('.')])
		);
		if (evidence === null) return;

		const assertionPosition = treePosition(node);
		if (
			!isAfter(assertionPosition, declaratorPosition) ||
			assertionPosition.boundary !== declaratorPosition.boundary ||
			!assertionIsNarrower(broadKind, evidence, assertion.type)
		) {
			return;
		}

		registerDiagnostic(
			node,
			'error',
			`noWidenThenAssert: Binding "${expression.name.text}" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.`
		);
	}
});
