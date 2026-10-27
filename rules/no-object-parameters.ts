import {defineRule, registerDiagnostic, semantic} from '@biomejs/runtime/plugin';
import {
	FUNCTION_PARAMETER_KINDS,
	functionParameterBindingName,
	functionParameterType
} from '../shared/function-parameters.ts';
import {resolvedTypeMatches} from '../shared/type-alias-resolution.ts';

/** Ban the broad object type on function inputs, including local aliases to object. */
export const noObjectParameters = defineRule({
	query: semantic(...FUNCTION_PARAMETER_KINDS),
	run(node, context) {
		const type = functionParameterType(node);
		if (type === undefined) return;
		const resolvesToObject = resolvedTypeMatches(type, context.model, (resolved, matches) => {
			if (resolved.kind === 'TS_NON_PRIMITIVE_TYPE') return true;
			if (resolved.kind === 'TS_PARENTHESIZED_TYPE') return resolved.ty !== undefined && matches(resolved.ty);
			return resolved.kind === 'TS_UNION_TYPE' && resolved.types.some(matches);
		});
		if (!resolvesToObject) return;
		registerDiagnostic(
			type,
			'error',
			`noObjectParameters: Parameter \`${functionParameterBindingName(node)}\` uses the broad \`object\` type. Accept a named owner type; parse external input at its boundary before calling this function.`
		);
	}
});
