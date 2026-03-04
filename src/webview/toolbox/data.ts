export interface TemplateItem {
    label: string;
    description: string;
    snippet: string;
    detail?: string;
}

export interface TemplateCategory {
    id: string;
    label: string;
    items: TemplateItem[];
}

export const templates: TemplateCategory[] = [
    {
        id: "transitions",
        label: "Transitions",
        items: [
            {
                label: "Basic Transition",
                description: "Implement the Transition trait for a processing step",
                snippet: `use ranvier::prelude::*;
use async_trait::async_trait;

struct \${1:MyStep};

#[async_trait]
impl Transition<\${2:InputType}, \${3:OutputType}> for \${1:MyStep} {
    type Error = String;
    type Resources = ();

    async fn run(
        &self,
        input: \${2:InputType},
        _res: &(),
        _bus: &mut Bus,
    ) -> Outcome<\${3:OutputType}, String> {
        Outcome::Next(input.into())
    }
}`,
                detail: "v0.17 Transition trait impl pattern"
            },
            {
                label: "Transition with Resources",
                description: "Transition that accesses shared resources via the Resources associated type",
                snippet: `use ranvier::prelude::*;
use async_trait::async_trait;

struct \${1:DbStep};

#[async_trait]
impl Transition<\${2:Request}, \${3:Response}> for \${1:DbStep} {
    type Error = String;
    type Resources = \${4:AppResources};

    async fn run(
        &self,
        input: \${2:Request},
        res: &\${4:AppResources},
        _bus: &mut Bus,
    ) -> Outcome<\${3:Response}, String> {
        let result = res.db().query(&input).await.map_err(|e| e.to_string())?;
        Outcome::Next(result)
    }
}`,
                detail: "Access typed resources in a transition step"
            },
            {
                label: "Branching Transition",
                description: "Transition that conditionally branches or stays",
                snippet: `use ranvier::prelude::*;
use async_trait::async_trait;

struct \${1:FilterStep};

#[async_trait]
impl Transition<\${2:Input}, \${3:Output}> for \${1:FilterStep} {
    type Error = String;
    type Resources = ();

    async fn run(
        &self,
        input: \${2:Input},
        _res: &(),
        _bus: &mut Bus,
    ) -> Outcome<\${3:Output}, String> {
        if \${4:condition} {
            Outcome::Next(input.into())
        } else {
            Outcome::Stay
        }
    }
}`,
                detail: "Use Outcome::Stay to halt propagation"
            }
        ]
    },
    {
        id: "pipelines",
        label: "Pipelines",
        items: [
            {
                label: "Simple Axon Pipeline",
                description: "Build a linear pipeline with Axon builder",
                snippet: `use ranvier::prelude::*;

let axon = Axon::<\${1:Input}, \${1:Input}, String>::new("\${2:pipeline_name}")
    .then(\${3:StepOne})
    .then(\${4:StepTwo});`,
                detail: "v0.17 Axon builder chaining Transition steps"
            },
            {
                label: "Multi-Step Pipeline",
                description: "Axon pipeline with multiple typed transitions",
                snippet: `use ranvier::prelude::*;

let axon = Axon::<\${1:RawInput}, \${1:RawInput}, String>::new("\${2:name}")
    .then(\${3:ValidateStep})
    .then(\${4:TransformStep})
    .then(\${5:PersistStep});

let result = axon.run(\${6:input}).await;
match result {
    Ok(output) => println!("Pipeline completed: {:?}", output),
    Err(e) => eprintln!("Pipeline failed: {}", e),
}`,
                detail: "Run a multi-step pipeline and handle the result"
            },
            {
                label: "Pipeline with Bus",
                description: "Pipeline that shares state through the Bus",
                snippet: `use ranvier::prelude::*;

let mut bus = Bus::new();
bus.insert(\${1:MyCapability}::new());

let axon = Axon::<\${2:Input}, \${2:Input}, String>::new("\${3:name}")
    .then(\${4:StepOne})
    .then(\${5:StepTwo});

let result = axon.run_with_bus(\${6:input}, &mut bus).await;`,
                detail: "Inject capabilities into the pipeline via Bus"
            }
        ]
    },
    {
        id: "bus-resources",
        label: "Bus & Resources",
        items: [
            {
                label: "Insert Bus Capability",
                description: "Add a typed capability to the Bus for downstream steps",
                snippet: `use ranvier::prelude::*;

let mut bus = Bus::new();
bus.insert(\${1:MyCapability}::new());

// Read it back in a transition
let cap = bus.read::<\${1:MyCapability}>();`,
                detail: "Bus is a type-map for cross-step data sharing"
            },
            {
                label: "Custom Capability Struct",
                description: "Define a capability struct for Bus insertion",
                snippet: `use ranvier::prelude::*;

#[derive(Debug, Clone)]
struct \${1:AppConfig} {
    \${2:db_url}: String,
    \${3:max_retries}: u32,
}

impl \${1:AppConfig} {
    fn new(\${2:db_url}: impl Into<String>, \${3:max_retries}: u32) -> Self {
        Self {
            \${2:db_url}: \${2:db_url}.into(),
            \${3:max_retries},
        }
    }
}

// Usage:
// bus.insert(AppConfig::new("postgres://...", 3));
// let config = bus.read::<AppConfig>();`,
                detail: "Any Clone + Send + Sync + 'static type can be a capability"
            },
            {
                label: "Bus Read in Transition",
                description: "Access a Bus capability inside a Transition step",
                snippet: `#[async_trait]
impl Transition<\${1:Input}, \${2:Output}> for \${3:MyStep} {
    type Error = String;
    type Resources = ();

    async fn run(
        &self,
        input: \${1:Input},
        _res: &(),
        bus: &mut Bus,
    ) -> Outcome<\${2:Output}, String> {
        let config = bus.read::<\${4:AppConfig}>()
            .ok_or_else(|| "AppConfig not found in bus".to_string())?;
        // Use config...
        Outcome::Next(input.into())
    }
}`,
                detail: "Read typed data from Bus within a transition"
            }
        ]
    },
    {
        id: "error-handling",
        label: "Error Handling",
        items: [
            {
                label: "Custom Error Type",
                description: "Define a domain-specific error enum with Serialize/Deserialize",
                snippet: `use serde::{Serialize, Deserialize};
use thiserror::Error;

#[derive(Debug, Clone, Error, Serialize, Deserialize)]
enum \${1:AppError} {
    #[error("validation failed: {0}")]
    Validation(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("internal error: {0}")]
    Internal(String),
}`,
                detail: "v0.17 pattern: derive Error + Serialize + Deserialize"
            },
            {
                label: "Transition with Custom Error",
                description: "Use a custom error type as Transition::Error",
                snippet: `#[async_trait]
impl Transition<\${1:Input}, \${2:Output}> for \${3:MyStep} {
    type Error = \${4:AppError};
    type Resources = ();

    async fn run(
        &self,
        input: \${1:Input},
        _res: &(),
        _bus: &mut Bus,
    ) -> Outcome<\${2:Output}, \${4:AppError}> {
        if !input.is_valid() {
            return Outcome::Abort(\${4:AppError}::Validation(
                "Invalid input".into(),
            ));
        }
        Outcome::Next(input.into())
    }
}`,
                detail: "Use Outcome::Abort to propagate typed errors"
            },
            {
                label: "Error Conversion",
                description: "Map external errors into your domain error type",
                snippet: `impl From<std::io::Error> for \${1:AppError} {
    fn from(err: std::io::Error) -> Self {
        \${1:AppError}::Internal(err.to_string())
    }
}

impl From<serde_json::Error> for \${1:AppError} {
    fn from(err: serde_json::Error) -> Self {
        \${1:AppError}::Validation(err.to_string())
    }
}`,
                detail: "Implement From for seamless ? operator usage"
            }
        ]
    },
    {
        id: "resilience",
        label: "Resilience",
        items: [
            {
                label: "DLQ Retry Policy",
                description: "Configure dead-letter queue with retry-then-DLQ policy",
                snippet: `use ranvier::prelude::*;

let axon = Axon::<\${1:Input}, \${1:Input}, String>::new("\${2:name}")
    .then(\${3:ProcessStep})
    .with_dlq_policy(DlqPolicy::RetryThenDlq {
        max_attempts: \${4:3},
        backoff_ms: \${5:100},
    });`,
                detail: "v0.17 DLQ: automatic retry with exponential backoff before dead-lettering"
            },
            {
                label: "DLQ Immediate Policy",
                description: "Send failures directly to DLQ without retry",
                snippet: `use ranvier::prelude::*;

let axon = Axon::<\${1:Input}, \${1:Input}, String>::new("\${2:name}")
    .then(\${3:ProcessStep})
    .with_dlq_policy(DlqPolicy::Immediate);`,
                detail: "Skip retries and dead-letter on first failure"
            },
            {
                label: "State Persistence",
                description: "Enable state persistence for pipeline checkpoint/resume",
                snippet: `use ranvier::prelude::*;

let axon = Axon::<\${1:Input}, \${1:Input}, String>::new("\${2:name}")
    .then(\${3:StepOne})
    .then(\${4:StepTwo})
    .with_persistence(\${5:FileStore}::new("\${6:./state}"));

// Pipeline can resume from last successful checkpoint on restart`,
                detail: "Checkpoint-based persistence for long-running pipelines"
            }
        ]
    }
];

/**
 * Learning Paths
 *
 * Curated sequences of examples from the Ranvier manifest,
 * ordered from foundational to advanced concepts.
 */
export interface LearningPath {
    id: string;
    label: string;
    description: string;
    steps: LearningPathStep[];
}

export interface LearningPathStep {
    example: string;
    label: string;
    description: string;
}

export const learningPaths: LearningPath[] = [
    {
        id: "quick-start",
        label: "Quick Start",
        description: "Core concepts from hello-world to routing in 5 steps",
        steps: [
            {
                example: "hello-world",
                label: "Hello World",
                description: "Minimal Axon pipeline with a single transition step"
            },
            {
                example: "typed-state-tree",
                label: "Typed State Tree",
                description: "Typed state management with Bus capabilities"
            },
            {
                example: "testing-patterns",
                label: "Testing Patterns",
                description: "Unit and integration testing for transitions and pipelines"
            },
            {
                example: "custom-error-types",
                label: "Custom Error Types",
                description: "Domain error enums with thiserror and serde"
            },
            {
                example: "routing-demo",
                label: "Routing Demo",
                description: "Basic HTTP routing with Axum integration"
            }
        ]
    },
    {
        id: "http-services",
        label: "HTTP Services",
        description: "Build production HTTP services from routing to auth",
        steps: [
            {
                example: "routing-params",
                label: "Routing Params",
                description: "Path and query parameter extraction"
            },
            {
                example: "flat-api",
                label: "Flat API",
                description: "Simple REST API with flat resource structure"
            },
            {
                example: "session",
                label: "Session",
                description: "Server-side session management"
            },
            {
                example: "multipart-upload",
                label: "Multipart Upload",
                description: "File upload handling with multipart form data"
            },
            {
                example: "websocket",
                label: "WebSocket",
                description: "Bidirectional real-time communication"
            },
            {
                example: "sse-streaming",
                label: "SSE Streaming",
                description: "Server-sent events for one-way streaming"
            },
            {
                example: "openapi",
                label: "OpenAPI",
                description: "Auto-generated OpenAPI spec from route definitions"
            },
            {
                example: "auth-jwt-role",
                label: "Auth JWT Role",
                description: "JWT authentication with role-based access control"
            }
        ]
    },
    {
        id: "advanced-patterns",
        label: "Advanced Patterns",
        description: "Resilience, persistence, and multi-tenant architectures",
        steps: [
            {
                example: "order-processing",
                label: "Order Processing",
                description: "Multi-step order workflow with state machines"
            },
            {
                example: "retry-dlq",
                label: "Retry & DLQ",
                description: "Dead-letter queue with retry policies and backoff"
            },
            {
                example: "state-persistence",
                label: "State Persistence",
                description: "Checkpoint-based persistence for pipeline recovery"
            },
            {
                example: "multitenancy",
                label: "Multitenancy",
                description: "Tenant isolation with shared infrastructure"
            }
        ]
    }
];
