import {defineRule, registerDiagnostic, semantic} from '@biomejs/runtime/plugin';
import {FUNCTION_KINDS, functionReturnType} from '../shared/function-parameters.ts';
import {resolvedTypeMatches, typeArguments, typeReferenceName} from '../shared/type-alias-resolution.ts';

/** Ban function contracts that return unknown instead of a parsed domain type. */
export const noUnknownReturns = defineRule({
	query: semantic(...FUNCTION_KINDS),
	run(node, context) {
		const type = functionReturnType(node);
		if (type === undefined || type.kind === 'TS_PREDICATE_RETURN_TYPE' || type.kind === 'TS_ASSERTS_RETURN_TYPE')
			return;
		const resolvesToUnknown = resolvedTypeMatches(type, context.model, (resolved, matches) => {
			if (resolved.kind === 'TS_UNKNOWN_TYPE') return true;
			if (resolved.kind === 'TS_PARENTHESIZED_TYPE') return resolved.ty !== undefined && matches(resolved.ty);
			if (resolved.kind === 'TS_UNION_TYPE') return resolved.types.some(matches);
			if (resolved.kind !== 'TS_REFERENCE_TYPE') return false;
			const name = typeReferenceName(resolved);
			if (name !== 'Promise' && name !== 'PromiseLike') return false;
			const [value] = typeArguments(resolved);
			return value !== undefined && matches(value);
		});
		if (!resolvesToUnknown) return;
		registerDiagnostic(
			type,
			'error',
			'noUnknownReturns: This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.'
		);
	}
});
