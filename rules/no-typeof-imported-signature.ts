import {defineRule, registerDiagnostic, semantic} from '@biomejs/runtime/plugin';
import {globalUtilityName, isImportedTypeof} from '../shared/imported-typeof.ts';
import {resolvedTypeMatches, typeArguments} from '../shared/type-alias-resolution.ts';

// `ReturnType` is left out on purpose: deriving a result type from an imported function is fine.
const SIGNATURE_UTILITIES: ReadonlySet<string> = new Set(['Parameters', 'InstanceType', 'ConstructorParameters']);

/** Ban reaching into an imported function or class signature; the owner module should export the type. */
export const noTypeofImportedSignature = defineRule({
	query: semantic('TS_REFERENCE_TYPE'),
	run(node, context) {
		const utility = globalUtilityName(node, context.model, SIGNATURE_UTILITIES);
		const [argument] = typeArguments(node);
		if (utility === undefined || argument === undefined) return;

		const queriesImport = resolvedTypeMatches(argument, context.model, (type, matches) => {
			if (type.kind === 'TS_PARENTHESIZED_TYPE') return type.ty !== undefined && matches(type.ty);
			return type.kind === 'TS_TYPEOF_TYPE' && isImportedTypeof(type, context.model);
		});
		if (!queriesImport) return;

		registerDiagnostic(
			node,
			'error',
			`noTypeofImportedSignature: \`${utility}<typeof …>\` reaches into an imported signature. Export a named type from the owner module (such as a \`*Document\` or \`*Input\` type) and import it.`
		);
	}
});
