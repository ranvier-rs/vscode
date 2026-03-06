import type { RequestAssertion, ApiResponseData } from '../shared/types';

export type AssertionResult = {
    assertion: RequestAssertion;
    passed: boolean;
    actual: unknown;
    message: string;
};

/**
 * Evaluate assertions against an API response.
 * Supports targets: status, body.*, header.*, latency
 * Operators: ==, !=, >, <, >=, <=, exists, not_exists, contains, matches
 */
export function evaluateAssertions(
    assertions: RequestAssertion[],
    response: ApiResponseData,
): AssertionResult[] {
    return assertions.map(a => evaluateOne(a, response));
}

function evaluateOne(assertion: RequestAssertion, response: ApiResponseData): AssertionResult {
    const actual = resolveTarget(assertion.target, response);
    const passed = applyOperator(assertion.operator, actual, assertion.expected);
    const message = passed
        ? `${assertion.target} ${assertion.operator} ${formatValue(assertion.expected)}`
        : `Expected ${assertion.target} ${assertion.operator} ${formatValue(assertion.expected)}, got ${formatValue(actual)}`;

    return { assertion, passed, actual, message };
}

function resolveTarget(target: string, response: ApiResponseData): unknown {
    if (target === 'status') return response.status;
    if (target === 'latency') return response.durationMs;

    if (target.startsWith('header.')) {
        const headerName = target.slice(7).toLowerCase();
        for (const [k, v] of Object.entries(response.headers)) {
            if (k.toLowerCase() === headerName) return v;
        }
        return undefined;
    }

    if (target.startsWith('body.') || target === 'body') {
        const path = target === 'body' ? '' : target.slice(5);
        return resolvePath(response.body, path);
    }

    return undefined;
}

/**
 * Resolve a dot-notation + array index path against a value.
 * Supports: "items[0].id", "nested.field", "array[2]"
 */
function resolvePath(value: unknown, path: string): unknown {
    if (!path) return value;

    const segments = parsePath(path);
    let current = value;

    for (const segment of segments) {
        if (current === null || current === undefined) return undefined;

        if (typeof segment === 'number') {
            if (!Array.isArray(current)) return undefined;
            current = current[segment];
        } else {
            if (typeof current !== 'object') return undefined;
            current = (current as Record<string, unknown>)[segment];
        }
    }

    return current;
}

function parsePath(path: string): (string | number)[] {
    const segments: (string | number)[] = [];
    const re = /([^.\[\]]+)|\[(\d+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(path)) !== null) {
        if (match[2] !== undefined) {
            segments.push(parseInt(match[2], 10));
        } else if (match[1] !== undefined) {
            segments.push(match[1]);
        }
    }
    return segments;
}

function applyOperator(operator: string, actual: unknown, expected: unknown): boolean {
    switch (operator) {
        case '==':
            return looseEquals(actual, expected);
        case '!=':
            return !looseEquals(actual, expected);
        case '>':
            return toNumber(actual) > toNumber(expected);
        case '<':
            return toNumber(actual) < toNumber(expected);
        case '>=':
            return toNumber(actual) >= toNumber(expected);
        case '<=':
            return toNumber(actual) <= toNumber(expected);
        case 'exists':
            return actual !== undefined && actual !== null;
        case 'not_exists':
            return actual === undefined || actual === null;
        case 'contains':
            return String(actual).includes(String(expected));
        case 'matches': {
            try {
                const re = new RegExp(String(expected));
                return re.test(String(actual));
            } catch {
                return false;
            }
        }
        default:
            return false;
    }
}

function looseEquals(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    // Compare numbers vs strings loosely
    if (typeof a === 'number' && typeof b === 'string') return a === Number(b);
    if (typeof a === 'string' && typeof b === 'number') return Number(a) === b;
    // JSON comparison for objects
    if (typeof a === 'object' && typeof b === 'object') {
        return JSON.stringify(a) === JSON.stringify(b);
    }
    return String(a) === String(b);
}

function toNumber(v: unknown): number {
    if (typeof v === 'number') return v;
    const n = Number(v);
    return isNaN(n) ? 0 : n;
}

function formatValue(v: unknown): string {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    if (typeof v === 'string') return `"${v}"`;
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
}
