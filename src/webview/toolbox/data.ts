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
        id: "nodes",
        label: "Nodes",
        items: [
            {
                label: "Transition Node",
                description: "Standard processing node with async handler",
                snippet: `#[transition]
async fn \${1:node_name}(input: \${2:InputType}) -> Outcome<\${3:OutputType}, anyhow::Error> {
    Outcome::Next(input)
}`
            },
            {
                label: "Stateful Node",
                description: "Node with internal state (struct)",
                snippet: `#[derive(RanvierNode)]
struct \${1:MyNode} {
    #[port]
    input: Receiver<\${2:String}>,
}

impl \${1:MyNode} {
    async fn process(&mut self, msg: \${2:String}) {
        // Handle logic
    }
}`
            }
        ]
    },
    {
        id: "adapters",
        label: "Adapters",
        items: [
            {
                label: "Ingress Adapter",
                description: "Entry point adapter for external signals",
                snippet: `#[adapter(kind = "ingress")]
struct \${1:MyIngress};`
            }
        ]
    },
    {
        id: "logic",
        label: "Logic Patterns",
        items: [
            {
                label: "Filter Logic",
                description: "Conditionally forward or drop messages",
                snippet: `if \${1:condition} {
    Outcome::Next(\${2:value})
} else {
    Outcome::Stay
}`
            }
        ]
    }
];
