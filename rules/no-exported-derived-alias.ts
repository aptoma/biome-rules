import {defineRule, registerDiagnostic, semantic} from '@biomejs/runtime/plugin';
import {containsImportedTypeof, globalUtilityName} from '../shared/imported-typeof.ts';

const DERIVING_UTILITIES: ReadonlySet<string> = new Set([
	'Awaited',
	'InstanceType',
	'NonNullable',
	'Parameters',
	'ReturnType'
]);

/** Ban re-exporting a type derived from an imported value, which makes this module a second owner of that type. */
export const noExportedDerivedAlias = defineRule({
	query: semantic('TS_TYPE_ALIAS_DECLARATION'),
	run(node, context) {
		const name = node.bindingIdentifier;
		const type = node.ty;
		if (name?.kind !== 'TS_IDENTIFIER_BINDING' || type?.kind !== 'TS_REFERENCE_TYPE') return;
		if (context.model.asBinding(name)?.isExported() !== true) return;
		if (globalUtilityName(type, context.model, DERIVING_UTILITIES) === undefined) return;
		if (!containsImportedTypeof(type, context.model)) return;

		registerDiagnostic(
			name,
			'error',
			`noExportedDerivedAlias: Type "${name.nameToken}" is derived from an imported value and re-exported. Export a named type from the owner module and import it from there.`
		);
	}
});
