import type {AnyJsExpression, JsCallExpression} from '@biomejs/runtime/plugin';

function memberName(expression: AnyJsExpression | undefined): string | undefined {
	if (expression?.kind !== 'JS_STATIC_MEMBER_EXPRESSION' || expression.member?.kind !== 'JS_NAME') return undefined;
	return expression.member.valueToken;
}

/** Whether an expression is the node:test mock tracker: the `mock` import or a test context's `t.mock`. */
function isMockTracker(expression: AnyJsExpression | undefined): boolean {
	if (expression?.kind === 'JS_IDENTIFIER_EXPRESSION') return expression.name?.valueToken === 'mock';
	return memberName(expression) === 'mock';
}

/** Whether a call is `mock.<method>(...)` or `t.mock.<method>(...)`. */
export function isMockTrackerCall(node: JsCallExpression, method: string): boolean {
	const callee = node.callee;
	return (
		callee?.kind === 'JS_STATIC_MEMBER_EXPRESSION' && memberName(callee) === method && isMockTracker(callee.object)
	);
}
