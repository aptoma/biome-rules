import type {
	AnyJsAstNode,
	AnyJsCallArgument,
	AnyJsExpression,
	AnyJsParameter,
	AnyTsReturnType,
	AnyTsType,
	Binding,
	JsVariableDeclarator,
	SemanticModel
} from '@biomejs/runtime/plugin';
import {defineRule, registerDiagnostic, semantic} from '@biomejs/runtime/plugin';
import {
	classifyUnsafeDictionaryValue,
	classifyWideningTarget,
	isKnownEvidenceExpression,
	unwrapExpression,
	type WideningTargetKind
} from '../shared/dictionary-types.ts';
import {
	asFunctionParameter,
	containsUnknownType,
	functionParameterBindingName,
	functionParameterType,
	functionReturnType,
	typePredicateParameterName
} from '../shared/function-parameters.ts';

const FUNCTION_BOUNDARY_KINDS: ReadonlySet<string> = new Set([
	'JS_ARROW_FUNCTION_EXPRESSION',
	'JS_CONSTRUCTOR_CLASS_MEMBER',
	'JS_FUNCTION_DECLARATION',
	'JS_FUNCTION_EXPORT_DEFAULT_DECLARATION',
	'JS_FUNCTION_EXPRESSION',
	'JS_GETTER_CLASS_MEMBER',
	'JS_GETTER_OBJECT_MEMBER',
	'JS_METHOD_CLASS_MEMBER',
	'JS_METHOD_OBJECT_MEMBER',
	'JS_SETTER_CLASS_MEMBER',
	'JS_SETTER_OBJECT_MEMBER'
]);

function bindingOf(expression: AnyJsExpression, model: SemanticModel): Binding | undefined {
	const unwrapped = unwrapExpression(expression);
	return unwrapped.kind === 'JS_IDENTIFIER_EXPRESSION' && unwrapped.name !== undefined
		? model.binding(unwrapped.name)
		: undefined;
}

function variableDeclarator(binding: Binding): JsVariableDeclarator | undefined {
	const declarator = binding.syntax().parent;
	return declarator?.kind === 'JS_VARIABLE_DECLARATOR' ? declarator : undefined;
}

/** The initializer of a `const` binding that is never reassigned. */
function stableConstInitializer(binding: Binding): AnyJsExpression | undefined {
	const declarator = variableDeclarator(binding);
	const declaration = declarator?.parent?.parent;
	if (declaration?.kind !== 'JS_VARIABLE_DECLARATION' || declaration.kindToken !== 'const') return undefined;
	return binding.allWrites().length === 0 ? declarator?.initializer?.expression : undefined;
}

function variableAnnotationType(declarator: JsVariableDeclarator): AnyTsType | undefined {
	const annotation = declarator.variableAnnotation;
	return annotation?.kind === 'TS_DEFINITE_VARIABLE_ANNOTATION' ? annotation.typeAnnotation?.ty : annotation?.ty;
}

/** Visited bindings are tracked by declarator source because nodes have no stable identity. */
function hasKnownEvidence(
	expression: AnyJsExpression,
	model: SemanticModel,
	visited: ReadonlySet<string> = new Set()
): boolean {
	if (isKnownEvidenceExpression(expression)) return true;
	const binding = bindingOf(expression, model);
	const key = binding === undefined ? undefined : variableDeclarator(binding)?.text;
	const initializer = binding === undefined ? undefined : stableConstInitializer(binding);
	if (key === undefined || initializer === undefined || visited.has(key)) return false;
	return hasKnownEvidence(initializer, model, new Set(visited).add(key));
}

function functionParameters(node: AnyJsAstNode): readonly AnyJsParameter[] | undefined {
	switch (node.kind) {
		case 'JS_ARROW_FUNCTION_EXPRESSION':
		case 'JS_FUNCTION_DECLARATION':
		case 'JS_FUNCTION_EXPORT_DEFAULT_DECLARATION':
		case 'JS_FUNCTION_EXPRESSION':
		case 'TS_DECLARE_FUNCTION_DECLARATION':
			return node.parameters?.kind === 'JS_PARAMETERS' ? node.parameters.items : undefined;
		default:
			return undefined;
	}
}

function isLocalFunction(node: AnyJsAstNode): boolean {
	return functionParameters(node) !== undefined;
}

/** Overloaded functions have several declarations; like upstream's single-definition check, skip them. */
function isSingleFunctionDeclaration(declaration: AnyJsAstNode, name: string): boolean {
	let container = declaration.parent;
	if (container?.kind === 'JS_EXPORT') container = container.parent;
	const declarations = (container?.children() ?? []).filter((statement) => {
		const candidate = statement.kind === 'JS_EXPORT' ? statement.exportClause : statement;
		return (
			(candidate?.kind === 'JS_FUNCTION_DECLARATION' || candidate?.kind === 'TS_DECLARE_FUNCTION_DECLARATION') &&
			candidate.id?.text === name
		);
	});
	return declarations.length === 1;
}

/** The same-file function a call targets: an inline function, a function declaration, or a variable initialized with one. */
function localFunctionForCall(callee: AnyJsExpression, model: SemanticModel): AnyJsAstNode | undefined {
	const unwrapped = unwrapExpression(callee);
	if (isLocalFunction(unwrapped)) return unwrapped;
	const binding = bindingOf(unwrapped, model);
	const declaration = binding?.syntax().parent;
	if (binding === undefined || declaration === undefined) return undefined;
	if (declaration.kind === 'JS_VARIABLE_DECLARATOR') {
		const initializer = declaration.initializer?.expression;
		const target = initializer === undefined ? undefined : unwrapExpression(initializer);
		return target !== undefined && isLocalFunction(target) ? target : undefined;
	}
	return isLocalFunction(declaration) && isSingleFunctionDeclaration(declaration, binding.syntax().text)
		? declaration
		: undefined;
}

function hasInformativeType(type: AnyTsReturnType, model: SemanticModel): boolean {
	return (
		type.kind === 'TS_PREDICATE_RETURN_TYPE' ||
		type.kind === 'TS_ASSERTS_RETURN_TYPE' ||
		classifyUnsafeDictionaryValue(type, model) === undefined
	);
}

/** The annotated type of a variable or parameter binding, if any. */
function bindingTypeAnnotation(binding: Binding): AnyTsType | undefined {
	const declaration = binding.syntax().parent;
	if (declaration?.kind === 'JS_VARIABLE_DECLARATOR') return variableAnnotationType(declaration);
	if (declaration?.kind === 'JS_FORMAL_PARAMETER' || declaration?.kind === 'JS_REST_PARAMETER') {
		return functionParameterType(declaration);
	}
	return undefined;
}

function hasKnownCallArgumentEvidence(
	expression: AnyJsExpression,
	model: SemanticModel,
	visited: ReadonlySet<string> = new Set()
): boolean {
	switch (expression.kind) {
		case 'JS_PARENTHESIZED_EXPRESSION':
		case 'TS_NON_NULL_ASSERTION_EXPRESSION':
		case 'TS_SATISFIES_EXPRESSION':
			return expression.expression !== undefined && hasKnownCallArgumentEvidence(expression.expression, model, visited);
		case 'TS_AS_EXPRESSION':
		case 'TS_TYPE_ASSERTION_EXPRESSION':
			return expression.ty !== undefined && hasInformativeType(expression.ty, model);
		case 'JS_CALL_EXPRESSION': {
			const owner = expression.callee === undefined ? undefined : localFunctionForCall(expression.callee, model);
			const returnType = owner === undefined ? undefined : functionReturnType(owner);
			return returnType !== undefined && hasInformativeType(returnType, model);
		}
		case 'JS_IDENTIFIER_EXPRESSION':
			break;
		default:
			return isKnownEvidenceExpression(expression);
	}
	const binding = bindingOf(expression, model);
	if (binding === undefined) return false;
	const annotation = bindingTypeAnnotation(binding);
	if (annotation !== undefined) return hasInformativeType(annotation, model);
	const key = variableDeclarator(binding)?.text;
	const initializer = stableConstInitializer(binding);
	if (key === undefined || initializer === undefined || visited.has(key)) return false;
	return hasKnownCallArgumentEvidence(initializer, model, new Set(visited).add(key));
}

function memberName(name: AnyJsAstNode | undefined): string {
	if (name?.kind === 'JS_LITERAL_MEMBER_NAME') return (name.value ?? '').replace(/^(['"])(.*)\1$/s, '$2');
	if (name?.kind === 'JS_PRIVATE_CLASS_MEMBER_NAME') return name.idToken ?? '';
	if (name?.kind === 'JS_COMPUTED_MEMBER_NAME') return name.expression?.text ?? '';
	return name?.text ?? '';
}

function functionName(owner: AnyJsAstNode | undefined): string {
	switch (owner?.kind) {
		case 'JS_ARROW_FUNCTION_EXPRESSION':
		case 'JS_FUNCTION_EXPRESSION': {
			if (owner.kind === 'JS_FUNCTION_EXPRESSION' && owner.id !== undefined) return owner.id.text;
			const declarator = owner.parent?.kind === 'JS_INITIALIZER_CLAUSE' ? owner.parent.parent : undefined;
			return declarator?.kind === 'JS_VARIABLE_DECLARATOR' && declarator.id?.kind === 'JS_IDENTIFIER_BINDING'
				? declarator.id.text
				: 'anonymous function';
		}
		case 'JS_FUNCTION_DECLARATION':
		case 'JS_FUNCTION_EXPORT_DEFAULT_DECLARATION':
		case 'TS_DECLARE_FUNCTION_DECLARATION':
			return owner.id?.text ?? 'anonymous function';
		case 'JS_CONSTRUCTOR_CLASS_MEMBER':
		case 'JS_GETTER_CLASS_MEMBER':
		case 'JS_METHOD_CLASS_MEMBER':
		case 'JS_SETTER_CLASS_MEMBER':
			return memberName(owner.name);
		default:
			return 'anonymous function';
	}
}

function enclosingFunction(node: AnyJsAstNode): AnyJsAstNode | undefined {
	return node.ancestors().find((ancestor) => FUNCTION_BOUNDARY_KINDS.has(ancestor.kind));
}

function hasParentAssertion(node: AnyJsAstNode): boolean {
	let parent = node.parent;
	while (parent?.kind === 'JS_PARENTHESIZED_EXPRESSION') parent = parent.parent;
	return parent?.kind === 'TS_AS_EXPRESSION' || parent?.kind === 'TS_TYPE_ASSERTION_EXPRESSION';
}

function targetOf(type: AnyTsReturnType | undefined, model: SemanticModel): WideningTargetKind | undefined {
	if (type === undefined || type.kind === 'TS_PREDICATE_RETURN_TYPE' || type.kind === 'TS_ASSERTS_RETURN_TYPE') {
		return undefined;
	}
	return classifyWideningTarget(type, model);
}

function report(node: AnyJsAstNode, target: WideningTargetKind, subject: string): void {
	registerDiagnostic(
		node,
		'error',
		`noKnownValueWidening: The explicit ${target} type on ${subject} discards known type evidence. Keep inference, validate with \`satisfies\`, or use a named owner contract.`
	);
}

function reportFlow(
	expression: AnyJsExpression | undefined,
	type: AnyTsReturnType | undefined,
	subject: string,
	model: SemanticModel
): void {
	if (expression === undefined) return;
	const target = targetOf(type, model);
	if (target === undefined) return;
	const unwrapped = unwrapExpression(expression);
	const isEmptyObject = unwrapped.kind === 'JS_OBJECT_EXPRESSION' && unwrapped.members.length === 0;
	// Empty dictionary accumulators are filled later; the annotation is their only contract.
	if ((target === 'open dictionary' || target === 'generic container') && isEmptyObject) return;
	if (!hasKnownEvidence(expression, model)) return;
	report(expression, target, subject);
}

function checkPredicateCall(
	callee: AnyJsExpression,
	arguments_: readonly AnyJsCallArgument[],
	model: SemanticModel
): void {
	const owner = localFunctionForCall(callee, model);
	// A `this` parameter does not consume a call argument.
	const parameters =
		owner === undefined
			? undefined
			: functionParameters(owner)
					?.map(asFunctionParameter)
					.filter((parameter) => parameter?.kind !== 'TS_THIS_PARAMETER');
	const subjectName = owner === undefined ? undefined : typePredicateParameterName(owner);
	if (owner === undefined || parameters === undefined || subjectName === undefined) return;
	const parameterIndex = parameters.findIndex(
		(parameter) => parameter !== undefined && functionParameterBindingName(parameter) === subjectName
	);
	const parameter = parameters[parameterIndex];
	const argument = arguments_[parameterIndex];
	if (parameter === undefined || argument === undefined || argument.kind === 'JS_SPREAD') return;
	const parameterType = functionParameterType(parameter);
	if (parameterType === undefined || !containsUnknownType(parameterType)) return;
	if (!hasKnownCallArgumentEvidence(argument, model)) return;
	report(
		argument,
		'unknown',
		`argument for parameter \`${functionParameterBindingName(parameter)}\` of \`${functionName(owner)}\``
	);
}

/** Detect sound syntactic cases where a known value is explicitly widened and loses evidence. */
export const noKnownValueWidening = defineRule({
	query: semantic(
		'JS_VARIABLE_DECLARATOR',
		'JS_PROPERTY_CLASS_MEMBER',
		'JS_ASSIGNMENT_EXPRESSION',
		'JS_CALL_EXPRESSION',
		'JS_RETURN_STATEMENT',
		'JS_ARROW_FUNCTION_EXPRESSION',
		'TS_AS_EXPRESSION',
		'TS_TYPE_ASSERTION_EXPRESSION'
	),
	run(node, context) {
		const model = context.model;
		switch (node.kind) {
			case 'JS_VARIABLE_DECLARATOR':
				if (node.id?.kind !== 'JS_IDENTIFIER_BINDING') return;
				reportFlow(node.initializer?.expression, variableAnnotationType(node), `binding \`${node.id.text}\``, model);
				return;
			case 'JS_PROPERTY_CLASS_MEMBER': {
				const annotation = node.propertyAnnotation;
				const type = annotation?.kind === 'TS_TYPE_ANNOTATION' ? annotation.ty : annotation?.typeAnnotation?.ty;
				reportFlow(node.value?.expression, type, `property \`${memberName(node.name)}\``, model);
				return;
			}
			case 'JS_ASSIGNMENT_EXPRESSION': {
				if (node.operatorToken !== '=' || node.left?.kind !== 'JS_IDENTIFIER_ASSIGNMENT') return;
				const binding = model.binding(node.left);
				const declarator = binding === undefined ? undefined : variableDeclarator(binding);
				if (declarator?.id?.kind !== 'JS_IDENTIFIER_BINDING') return;
				reportFlow(node.right, variableAnnotationType(declarator), `binding \`${declarator.id.text}\``, model);
				return;
			}
			case 'JS_CALL_EXPRESSION':
				if (node.callee === undefined || node.arguments === undefined) return;
				checkPredicateCall(node.callee, node.arguments.args, model);
				return;
			case 'JS_RETURN_STATEMENT': {
				const owner = enclosingFunction(node);
				const returnType = owner === undefined ? undefined : functionReturnType(owner);
				reportFlow(node.argument, returnType, `return value of \`${functionName(owner)}\``, model);
				return;
			}
			case 'JS_ARROW_FUNCTION_EXPRESSION':
				if (node.body === undefined || node.body.kind === 'JS_FUNCTION_BODY') return;
				reportFlow(node.body, functionReturnType(node), `return value of \`${functionName(node)}\``, model);
				return;
			case 'TS_AS_EXPRESSION':
			case 'TS_TYPE_ASSERTION_EXPRESSION':
				if (hasParentAssertion(node)) return;
				reportFlow(node.expression, node.ty, 'assertion', model);
				return;
		}
	}
});
