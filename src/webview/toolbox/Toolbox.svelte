<script lang="ts">
    import { onMount } from "svelte";
    import { templates, type TemplateItem } from "./data";

    // Simulate VS Code API for now (real interface will be added later)
    declare function acquireVsCodeApi(): {
        postMessage: (message: any) => void;
    };

    let vscode: any;
    try {
        vscode = acquireVsCodeApi();
    } catch (e) {
        // Fallback for browser dev if needed
        vscode = { postMessage: console.log };
    }

    function handleItemClick(item: TemplateItem) {
        vscode.postMessage({
            type: "insert-snippet",
            payload: {
                snippet: item.snippet,
            },
        });
    }

    function handleDragStart(event: DragEvent, item: TemplateItem) {
        if (event.dataTransfer) {
            event.dataTransfer.setData("text/plain", item.snippet);
            event.dataTransfer.setData(
                "application/vnd.code.snippet",
                item.snippet,
            );
            event.dataTransfer.effectAllowed = "copy";
        }
    }
</script>

<div class="toolbox">
    <div class="header">
        <span class="title">Template Toolbox</span>
    </div>
    <div class="scroll-area">
        {#each templates as category}
            <div class="category">
                <div class="category-header">{category.label}</div>
                <div class="items">
                    {#each category.items as item}
                        <div
                            class="item"
                            role="button"
                            tabindex="0"
                            draggable="true"
                            on:click={() => handleItemClick(item)}
                            on:dragstart={(e) => handleDragStart(e, item)}
                            on:keydown={(e) =>
                                e.key === "Enter" && handleItemClick(item)}
                            title={item.description}
                        >
                            <div class="item-label">{item.label}</div>
                            <div class="item-desc">{item.description}</div>
                        </div>
                    {/each}
                </div>
            </div>
        {/each}
    </div>
</div>

<style>
    .toolbox {
        height: 100%;
        display: flex;
        flex-direction: column;
        background-color: var(--vscode-sideBar-background);
        color: var(--vscode-foreground);
        font-family: var(--vscode-font-family);
    }

    .header {
        padding: 8px 12px;
        border-bottom: 1px solid var(--vscode-panel-border);
        font-weight: 600;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        background-color: var(--vscode-sideBarSectionHeader-background);
        color: var(--vscode-sideBarTitle-foreground);
    }

    .scroll-area {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
    }

    .category {
        margin-bottom: 12px;
    }

    .category-header {
        font-size: 11px;
        font-weight: 700;
        color: var(--vscode-sideBarSectionHeader-foreground);
        margin-bottom: 6px;
        opacity: 0.8;
        text-transform: uppercase;
    }

    .items {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .item {
        padding: 6px 8px;
        border: 1px solid transparent;
        border-radius: 4px;
        cursor: grab;
        background-color: var(--vscode-list-hoverBackground);
        /* Actually we want transparent by default, hover gets background */
        background-color: transparent;
        transition: all 0.1s ease;
    }

    .item:hover {
        background-color: var(--vscode-list-hoverBackground);
        border-color: var(--vscode-list-focusOutline);
    }

    .item:active {
        background-color: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
        cursor: grabbing;
    }

    .item-label {
        font-size: 12px;
        font-weight: 500;
    }

    .item-desc {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin-top: 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
