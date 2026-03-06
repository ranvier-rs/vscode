import type { ServerConnectionManager } from './server-connection';

export type GenerateResult = {
    body: unknown;
    source: 'server' | 'client';
};

/**
 * Generate an empty template for a route.
 * Prefers server-side generation via Inspector, falls back to client-side.
 */
export async function generateTemplate(
    connection: ServerConnectionManager | undefined,
    method: string,
    path: string,
    cachedSchema?: unknown,
): Promise<GenerateResult> {
    // Try server-side first
    if (connection?.connectionState === 'connected') {
        try {
            const body = await connection.fetchSample(method, path, 'empty');
            if (body !== null) return { body, source: 'server' };
        } catch {
            // Fall through to client-side
        }
    }

    // Client-side fallback using cached schema
    if (cachedSchema) {
        return {
            body: generateFromSchema(cachedSchema, 'empty'),
            source: 'client',
        };
    }

    return { body: {}, source: 'client' };
}

/**
 * Generate a sample with random values for a route.
 * Prefers server-side generation via Inspector, falls back to client-side.
 */
export async function generateSample(
    connection: ServerConnectionManager | undefined,
    method: string,
    path: string,
    cachedSchema?: unknown,
): Promise<GenerateResult> {
    // Try server-side first
    if (connection?.connectionState === 'connected') {
        try {
            const body = await connection.fetchSample(method, path, 'random');
            if (body !== null) return { body, source: 'server' };
        } catch {
            // Fall through to client-side
        }
    }

    // Client-side fallback using cached schema
    if (cachedSchema) {
        return {
            body: generateFromSchema(cachedSchema, 'random'),
            source: 'client',
        };
    }

    return { body: {}, source: 'client' };
}

/**
 * Client-side schema-to-JSON generator.
 * Handles basic JSON Schema types with optional random values.
 */
function generateFromSchema(schema: unknown, mode: 'empty' | 'random'): unknown {
    if (!schema || typeof schema !== 'object') return null;
    const s = schema as Record<string, unknown>;

    // Handle $ref (basic — only fragment refs)
    if (typeof s.$ref === 'string') return null;

    // Handle allOf — merge properties
    if (Array.isArray(s.allOf)) {
        const merged: Record<string, unknown> = {};
        for (const sub of s.allOf) {
            const val = generateFromSchema(sub, mode);
            if (val && typeof val === 'object' && !Array.isArray(val)) {
                Object.assign(merged, val);
            }
        }
        return merged;
    }

    // Handle oneOf — pick first
    if (Array.isArray(s.oneOf) && s.oneOf.length > 0) {
        const idx = mode === 'random' ? Math.floor(Math.random() * s.oneOf.length) : 0;
        return generateFromSchema(s.oneOf[idx], mode);
    }

    // Handle anyOf — pick first
    if (Array.isArray(s.anyOf) && s.anyOf.length > 0) {
        return generateFromSchema(s.anyOf[0], mode);
    }

    // Handle enum
    if (Array.isArray(s.enum) && s.enum.length > 0) {
        if (mode === 'random') return s.enum[Math.floor(Math.random() * s.enum.length)];
        return s.enum[0];
    }

    // Handle const
    if (s.const !== undefined) return s.const;

    const type = s.type as string | undefined;

    if (type === 'object') {
        const props = s.properties as Record<string, unknown> | undefined;
        if (!props) return {};
        const obj: Record<string, unknown> = {};
        for (const [key, propSchema] of Object.entries(props)) {
            obj[key] = generateFromSchema(propSchema, mode);
        }
        return obj;
    }

    if (type === 'array') {
        const items = s.items;
        if (!items) return [];
        const minItems = (s.minItems as number) || 0;
        const count = mode === 'random' ? Math.max(1, minItems) : minItems;
        return Array.from({ length: count }, () => generateFromSchema(items, mode));
    }

    if (type === 'string') {
        if (mode === 'empty') return '';
        const format = s.format as string | undefined;
        switch (format) {
            case 'email': return 'user@example.com';
            case 'uri':
            case 'url': return 'https://example.com';
            case 'uuid': return crypto.randomUUID?.() ?? '00000000-0000-0000-0000-000000000000';
            case 'date': return new Date().toISOString().split('T')[0];
            case 'date-time': return new Date().toISOString();
            case 'ipv4': return '127.0.0.1';
            case 'ipv6': return '::1';
        }
        const minLength = (s.minLength as number) || 0;
        if (minLength > 0) return 'a'.repeat(minLength);
        return 'example';
    }

    if (type === 'integer' || type === 'number') {
        if (mode === 'empty') return 0;
        const min = (s.minimum as number) ?? 0;
        const max = (s.maximum as number) ?? (min + 100);
        if (type === 'integer') return Math.floor(Math.random() * (max - min + 1)) + min;
        return Math.round((Math.random() * (max - min) + min) * 100) / 100;
    }

    if (type === 'boolean') {
        return mode === 'random' ? Math.random() > 0.5 : false;
    }

    if (type === 'null') return null;

    return null;
}
