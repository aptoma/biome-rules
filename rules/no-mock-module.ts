import {ast, defineRule, registerDiagnostic} from '@biomejs/runtime/plugin';
import {isMockTrackerCall} from '../shared/node-test-mock.ts';

/** Ban module mocking, which swaps out imports behind the code under test. */
export const noMockModule = defineRule({
	query: ast('JS_CALL_EXPRESSION'),
	run(node) {
		if (!isMockTrackerCall(node, 'module')) return;
		registerDiagnostic(
			node,
			'error',
			'noMockModule: `mock.module()` replaces a whole module behind the code under test. Pass the dependency in explicitly, or exercise the real module.'
		);
	}
});
