import type {AnyTsType, SemanticModel} from '@biomejs/runtime/plugin';
import {defineRule, registerDiagnostic, semantic} from '@biomejs/runtime/plugin';
import {globalUtilityName, isImportedTypeof} from '../shared/imported-typeof.ts';
import {typeArguments} from '../shared/type-alias-resolution.ts';

const DERIVING_UTILITIES: ReadonlySet<string> = new Set([
	'Awaited',
	'InstanceType',
	'NonNullable',
	'Parameters',
	'ReturnType'
]);

function unwrapParentheses(type: AnyTsType | undefined): AnyTsType | undefined {
	let current = type;
	while (current?.kind === 'TS_PARENTHESIZED_TYPE') current = current.ty;
	return current;
}

/** Whether a type is a chain of deriving utilities ending in `typeof` an import: `Awaited<ReturnType<typeof f>>`. */
function derivesFromImport(type: AnyTsType | undefined, model: SemanticModel): boolean {
	const unwrapped = unwrapParentheses(type);
	if (
		unwrapped?.kind !== 'TS_REFERENCE_TYPE' ||
		globalUtilityName(unwrapped, model, DERIVING_UTILITIES) === undefined
	) {
		return false;
	}
	const argument = unwrapParentheses(typeArguments(unwrapped)[0]);
	if (argument?.kind === 'TS_TYPEOF_TYPE') return isImportedTypeof(argument, model);
	return derivesFromImport(argument, model);
}

/** Ban re-exporting a type derived from an imported value, which makes this module a second owner of that type. */
export const noExportedDerivedAlias = defineRule({
	query: semantic('TS_TYPE_ALIAS_DECLARATION'),
	run(node, context) {
		const name = node.bindingIdentifier;
		if (name?.kind !== 'TS_IDENTIFIER_BINDING' || context.model.asBinding(name)?.isExported() !== true) return;
		if (!derivesFromImport(node.ty, context.model)) return;

		registerDiagnostic(
			name,
			'error',
			`noExportedDerivedAlias: Type "${name.nameToken}" is derived from an imported value and re-exported. Export a named type from the owner module and import it from there.`
		);
	}
});
