import {testRule} from './rule-tester.mts';

testRule('no-mock-module.ts', {
	valid: [
		"mock.method(service, 'load');",
		'mock.fn();',
		't.mock.timers.enable();',
		'module.exports = {};',
		"other.module('./db.ts');",
		"mock['module']('./db.ts');"
	],
	invalid: [
		{code: "mock.module('./db.ts', {namedExports: {}});", errors: 1},
		{code: "t.mock.module('./db.ts');", errors: 1},
		{code: "context.mock.module('node:fs');", errors: 1},
		{code: "mock?.module('./db.ts');", errors: 1}
	]
});
