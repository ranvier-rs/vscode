import type { CollectionRequest, ApiResponseData } from '../shared/types';
import { evaluateAssertions, type AssertionResult } from './assertion-evaluator';

export type BatchRequestResult = {
    request: CollectionRequest;
    response: ApiResponseData | null;
    assertions: AssertionResult[];
    status: 'passed' | 'failed' | 'error' | 'skipped';
    error?: string;
};

export type BatchSummary = {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    skipped: number;
    totalDurationMs: number;
    results: BatchRequestResult[];
};

export type BatchProgress = {
    current: number;
    total: number;
    requestName: string;
};

/**
 * Execute a batch of requests sequentially.
 * Calls `sendFn` for each request and evaluates assertions.
 * Supports cancellation via `signal` and progress reporting via `onProgress`.
 */
export async function runBatch(
    requests: CollectionRequest[],
    sendFn: (req: CollectionRequest) => Promise<ApiResponseData>,
    options: {
        bail?: boolean;
        signal?: AbortSignal;
        onProgress?: (progress: BatchProgress) => void;
    } = {},
): Promise<BatchSummary> {
    const results: BatchRequestResult[] = [];
    let totalDurationMs = 0;
    let bailed = false;

    for (let i = 0; i < requests.length; i++) {
        const request = requests[i];
        if (!request) continue;

        if (options.signal?.aborted || bailed) {
            results.push({
                request,
                response: null,
                assertions: [],
                status: 'skipped',
            });
            continue;
        }

        options.onProgress?.({
            current: i + 1,
            total: requests.length,
            requestName: request.name,
        });

        try {
            const response = await sendFn(request);
            totalDurationMs += response.durationMs;

            const assertions = request.assertions
                ? evaluateAssertions(request.assertions, response)
                : [];

            const allPassed = assertions.every(a => a.passed);
            const status: BatchRequestResult['status'] =
                response.status === 0 ? 'error'
                    : !allPassed ? 'failed'
                        : 'passed';

            results.push({ request, response, assertions, status });

            if (status === 'failed' && options.bail) {
                bailed = true;
            }
        } catch (e: any) {
            results.push({
                request,
                response: null,
                assertions: [],
                status: 'error',
                error: e?.message || 'Request failed',
            });

            if (options.bail) {
                bailed = true;
            }
        }
    }

    const summary: BatchSummary = {
        total: requests.length,
        passed: results.filter(r => r.status === 'passed').length,
        failed: results.filter(r => r.status === 'failed').length,
        errors: results.filter(r => r.status === 'error').length,
        skipped: results.filter(r => r.status === 'skipped').length,
        totalDurationMs,
        results,
    };

    return summary;
}
