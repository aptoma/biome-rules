import type {AnyJsAstNode, AnyJsParameter, AnyTsReturnType, AnyTsType, JsNodeByKind} from '@biomejs/runtime/plugin';

/** Parameter kinds whose annotation describes a function input (ESTree `ParamPattern`). */
export const FUNCTION_PARAMETER_KINDS = ['JS_FORMAL_PARAMETER', 'JS_REST_PARAMETER', 'TS_THIS_PARAMETER'] as const;

type FunctionParameter = JsNodeByKind[(typeof FUNCTION_PARAMETER_KINDS)[number]];

/** Function-like kinds that can carry an explicit return type. */
export const FUNCTION_KINDS = [
	'JS_ARROW_FUNCTION_EXPRESSION',
	'JS_FUNCTION_DECLARATION',
	'JS_FUNCTION_EXPORT_DEFAULT_DECLARATION',
	'JS_FUNCTION_EXPRESSION',
	'JS_GETTER_CLASS_MEMBER',
	'JS_GETTER_OBJECT_MEMBER',
	'JS_METHOD_CLASS_MEMBER',
	'JS_METHOD_OBJECT_MEMBER',
	'TS_CALL_SIGNATURE_TYPE_MEMBER',
	'TS_CONSTRUCT_SIGNATURE_TYPE_MEMBER',
	'TS_CONSTRUCTOR_TYPE',
	'TS_DECLARE_FUNCTION_DECLARATION',
	'TS_DECLARE_FUNCTION_EXPORT_DEFAULT_DECLARATION',
	'TS_FUNCTION_TYPE',
	'TS_GETTER_SIGNATURE_CLASS_MEMBER',
	'TS_GETTER_SIGNATURE_TYPE_MEMBER',
	'TS_METHOD_SIGNATURE_CLASS_MEMBER',
	'TS_METHOD_SIGNATURE_TYPE_MEMBER'
] as const;

/** Return whether a type is or contains TypeScript's absorbing unknown top type. */
export function containsUnknownType(type: AnyTsType): boolean {
	if (type.kind === 'TS_UNKNOWN_TYPE') return true;
	if (type.kind === 'TS_PARENTHESIZED_TYPE') return type.ty !== undefined && containsUnknownType(type.ty);
	return type.kind === 'TS_UNION_TYPE' && type.types.some(containsUnknownType);
}

/** Narrow a parameter list entry, dropping bogus and metavariable nodes. */
export function asFunctionParameter(parameter: AnyJsParameter): FunctionParameter | undefined {
	return parameter.kind === 'JS_BOGUS_PARAMETER' || parameter.kind === 'JS_METAVARIABLE' ? undefined : parameter;
}

/** The type annotated on a function parameter, if any. */
export function functionParameterType(parameter: FunctionParameter): AnyTsType | undefined {
	return parameter.typeAnnotation?.ty;
}

/** Return only a function parameter's local binding, excluding its annotation and default value. */
export function functionParameterBindingName(parameter: FunctionParameter): string {
	if (parameter.kind === 'TS_THIS_PARAMETER') return 'this';
	const binding = parameter.binding;
	if (binding === undefined) return '';
	if (binding.kind === 'JS_IDENTIFIER_BINDING') return binding.nameToken ?? '';
	return binding.text;
}

/** The explicit return type of a function-like node, or undefined when absent or not function-like. */
export function functionReturnType(node: AnyJsAstNode): AnyTsReturnType | undefined {
	switch (node.kind) {
		case 'TS_CONSTRUCTOR_TYPE':
		case 'TS_FUNCTION_TYPE':
			return node.returnType;
		case 'JS_GETTER_CLASS_MEMBER':
		case 'JS_GETTER_OBJECT_MEMBER':
		case 'TS_GETTER_SIGNATURE_CLASS_MEMBER':
			return node.returnType?.ty;
		case 'TS_CONSTRUCT_SIGNATURE_TYPE_MEMBER':
		case 'TS_GETTER_SIGNATURE_TYPE_MEMBER':
			return node.typeAnnotation?.ty;
		case 'JS_ARROW_FUNCTION_EXPRESSION':
		case 'JS_FUNCTION_DECLARATION':
		case 'JS_FUNCTION_EXPORT_DEFAULT_DECLARATION':
		case 'JS_FUNCTION_EXPRESSION':
		case 'JS_METHOD_CLASS_MEMBER':
		case 'JS_METHOD_OBJECT_MEMBER':
		case 'TS_CALL_SIGNATURE_TYPE_MEMBER':
		case 'TS_DECLARE_FUNCTION_DECLARATION':
		case 'TS_DECLARE_FUNCTION_EXPORT_DEFAULT_DECLARATION':
		case 'TS_METHOD_SIGNATURE_CLASS_MEMBER':
		case 'TS_METHOD_SIGNATURE_TYPE_MEMBER':
			return node.returnTypeAnnotation?.ty;
		default:
			return undefined;
	}
}

/** The parameter named by a `value is T` / `asserts value` return type, if any. */
export function typePredicateParameterName(node: AnyJsAstNode): string | undefined {
	const returnType = functionReturnType(node);
	if (returnType?.kind !== 'TS_PREDICATE_RETURN_TYPE' && returnType?.kind !== 'TS_ASSERTS_RETURN_TYPE')
		return undefined;
	const name = returnType.parameterName;
	return name?.kind === 'JS_REFERENCE_IDENTIFIER' ? name.valueToken : undefined;
}
