import type {AnyJsAstNode, TsAsExpression, TsTypeAssertionExpression} from '@biomejs/runtime/plugin';
import {ast, defineRule, registerDiagnostic} from '@biomejs/runtime/plugin';

type TypeAssertionExpression = TsAsExpression | TsTypeAssertionExpression;

function isTypeAssertionExpression(node: AnyJsAstNode | undefined): node is TypeAssertionExpression {
	return node?.kind === 'TS_AS_EXPRESSION' || node?.kind === 'TS_TYPE_ASSERTION_EXPRESSION';
}

function isConstAssertion(node: TypeAssertionExpression): boolean {
	return (
		node.ty?.kind === 'TS_REFERENCE_TYPE' &&
		node.ty.name?.kind === 'JS_REFERENCE_IDENTIFIER' &&
		node.ty.name.valueToken === 'const'
	);
}

/** An expression can only be the asserted operand of a parent assertion, never its type. */
function isOutermostAssertionInChain(node: TypeAssertionExpression): boolean {
	let parent = node.parent;
	while (parent?.kind === 'JS_PARENTHESIZED_EXPRESSION') parent = parent.parent;
	return !isTypeAssertionExpression(parent);
}

function isForbiddenAssertionChain(node: TypeAssertionExpression): boolean {
	let assertionCount = 0;
	let hasNonConstAssertion = false;
	let current: AnyJsAstNode | undefined = node;

	while (isTypeAssertionExpression(current)) {
		assertionCount += 1;
		hasNonConstAssertion ||= !isConstAssertion(current);
		current = current.expression;
		while (current?.kind === 'JS_PARENTHESIZED_EXPRESSION') current = current.expression;
	}

	return assertionCount > 1 && hasNonConstAssertion;
}

/** Disallow nested TypeScript type assertions, while permitting chains made only of const assertions. */
export const noChainedTypeAssertions = defineRule({
	query: ast('TS_AS_EXPRESSION', 'TS_TYPE_ASSERTION_EXPRESSION'),
	run(node) {
		if (!isOutermostAssertionInChain(node) || !isForbiddenAssertionChain(node)) return;
		registerDiagnostic(
			node,
			'error',
			'noChainedTypeAssertions: This assertion chain discards type evidence. Keep the original precise type, or parse untrusted input at its boundary before narrowing it.'
		);
	}
});
