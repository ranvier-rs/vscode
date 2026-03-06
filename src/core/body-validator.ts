/**
 * Lightweight JSON Schema body validator for real-time validation in API Explorer.
 * Validates a parsed JSON body against a JSON Schema, returning diagnostic messages.
 */

export type ValidationSeverity = 'error' | 'warning' | 'info';

export type ValidationDiagnostic = {
    path: string;
    severity: ValidationSeverity;
    message: string;
};

export type ValidationSummary = {
    valid: number;
    warnings: number;
    errors: number;
    diagnostics: ValidationDiagnostic[];
};

/**
 * Validate a body value against a JSON Schema.
 * Returns diagnostics (path, severity, message).
 */
export function validateBody(body: unknown, schema: unknown): ValidationSummary {
    const diagnostics: ValidationDiagnostic[] = [];
    if (!schema || typeof schema !== 'object') {
        return { valid: 0, warnings: 0, errors: 0, diagnostics };
    }

    validateNode(body, schema as JsonSchema, '', diagnostics);

    const errors = diagnostics.filter(d => d.severity === 'error').length;
    const warnings = diagnostics.filter(d => d.severity === 'warning').length;
    const valid = diagnostics.length === 0 ? 1 : 0;

    return { valid, warnings, errors, diagnostics };
}

type JsonSchema = {
    type?: string | string[];
    properties?: Record<string, JsonSchema>;
    required?: string[];
    items?: JsonSchema;
    enum?: unknown[];
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    format?: string;
    additionalProperties?: boolean | JsonSchema;
    oneOf?: JsonSchema[];
    anyOf?: JsonSchema[];
    allOf?: JsonSchema[];
};

function validateNode(
    value: unknown,
    schema: JsonSchema,
    path: string,
    diagnostics: ValidationDiagnostic[],
) {
    // allOf
    if (schema.allOf) {
        for (const sub of schema.allOf) {
            validateNode(value, sub, path, diagnostics);
        }
        return;
    }

    // anyOf / oneOf — check if at least one matches (don't report sub-diagnostics)
    if (schema.anyOf || schema.oneOf) {
        const variants = schema.anyOf || schema.oneOf || [];
        const anyValid = variants.some(sub => {
            const subDiags: ValidationDiagnostic[] = [];
            validateNode(value, sub, path, subDiags);
            return subDiags.length === 0;
        });
        if (!anyValid && variants.length > 0) {
            diagnostics.push({
                path: path || '(root)',
                severity: 'error',
                message: `Value does not match any of the ${schema.anyOf ? 'anyOf' : 'oneOf'} schemas`,
            });
        }
        return;
    }

    // Type check
    if (schema.type) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type];
        const actualType = getJsonType(value);
        if (!types.includes(actualType) && actualType !== 'null') {
            diagnostics.push({
                path: path || '(root)',
                severity: 'error',
                message: `Expected type ${types.join(' | ')}, got ${actualType}`,
            });
            return; // Don't validate further on type mismatch
        }
    }

    // Enum
    if (schema.enum) {
        const found = schema.enum.some(e => JSON.stringify(e) === JSON.stringify(value));
        if (!found) {
            diagnostics.push({
                path: path || '(root)',
                severity: 'error',
                message: `Value must be one of: ${schema.enum.map(e => JSON.stringify(e)).join(', ')}`,
            });
        }
    }

    // String constraints
    if (typeof value === 'string') {
        if (schema.minLength !== undefined && value.length < schema.minLength) {
            diagnostics.push({
                path: path || '(root)',
                severity: 'error',
                message: `String length ${value.length} is less than minimum ${schema.minLength}`,
            });
        }
        if (schema.maxLength !== undefined && value.length > schema.maxLength) {
            diagnostics.push({
                path: path || '(root)',
                severity: 'error',
                message: `String length ${value.length} exceeds maximum ${schema.maxLength}`,
            });
        }
        if (schema.pattern) {
            try {
                if (!new RegExp(schema.pattern).test(value)) {
                    diagnostics.push({
                        path: path || '(root)',
                        severity: 'warning',
                        message: `Value does not match pattern: ${schema.pattern}`,
                    });
                }
            } catch {
                // Invalid regex in schema, skip
            }
        }
    }

    // Number constraints
    if (typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) {
            diagnostics.push({
                path: path || '(root)',
                severity: 'error',
                message: `Value ${value} is less than minimum ${schema.minimum}`,
            });
        }
        if (schema.maximum !== undefined && value > schema.maximum) {
            diagnostics.push({
                path: path || '(root)',
                severity: 'error',
                message: `Value ${value} exceeds maximum ${schema.maximum}`,
            });
        }
    }

    // Object validation
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;

        // Required fields
        if (schema.required) {
            for (const req of schema.required) {
                if (!(req in obj)) {
                    diagnostics.push({
                        path: path ? `${path}.${req}` : req,
                        severity: 'error',
                        message: `Missing required field: ${req}`,
                    });
                }
            }
        }

        // Property validation
        if (schema.properties) {
            for (const [key, propSchema] of Object.entries(schema.properties)) {
                if (key in obj) {
                    const childPath = path ? `${path}.${key}` : key;
                    validateNode(obj[key], propSchema, childPath, diagnostics);
                }
            }
        }
    }

    // Array validation
    if (Array.isArray(value) && schema.items) {
        for (let i = 0; i < value.length; i++) {
            validateNode(value[i], schema.items, `${path}[${i}]`, diagnostics);
        }
    }
}

function getJsonType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value; // 'string', 'number', 'boolean', 'object'
}
