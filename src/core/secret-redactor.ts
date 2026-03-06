const SECRET_PATTERNS = [/token/i, /key/i, /secret/i, /password/i, /credential/i, /auth/i];

export type RedactionStrategy = 'redact' | 'strip' | 'include';

export function isSecretField(name: string): boolean {
    return SECRET_PATTERNS.some(p => p.test(name));
}

/**
 * Deep-traverse an object and redact values of secret-looking fields.
 */
export function redactSecrets<T>(data: T, strategy: RedactionStrategy): T {
    if (strategy === 'include') return data;
    return deepRedact(data, strategy) as T;
}

function deepRedact(value: unknown, strategy: RedactionStrategy): unknown {
    if (value === null || value === undefined) return value;

    if (Array.isArray(value)) {
        return value.map(item => deepRedact(item, strategy));
    }

    if (typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            if (isSecretField(key) && typeof val === 'string') {
                result[key] = strategy === 'strip' ? '' : '<<REDACTED>>';
            } else {
                result[key] = deepRedact(val, strategy);
            }
        }
        return result;
    }

    return value;
}

/**
 * Replace <<REDACTED>> placeholders with <<FILL>> markers for import.
 */
export function convertRedactedToPlaceholders<T>(data: T): T {
    if (data === null || data === undefined) return data;
    if (typeof data === 'string') {
        return (data === '<<REDACTED>>' ? '<<FILL>>' : data) as T;
    }
    if (Array.isArray(data)) {
        return data.map(item => convertRedactedToPlaceholders(item)) as T;
    }
    if (typeof data === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
            result[key] = convertRedactedToPlaceholders(val);
        }
        return result as T;
    }
    return data;
}
