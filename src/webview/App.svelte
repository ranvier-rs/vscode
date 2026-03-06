<script lang="ts">
  import Circuit from "./circuit/Circuit.svelte";
  import Toolbox from "./toolbox/Toolbox.svelte";
  import ApiExplorer from "./api-explorer/ApiExplorer.svelte";

  // Extend global window interface (or cast to any) to read the view type injected by the extension
  const viewType = (window as any).ranvierViewType || "circuit";
</script>

{#if viewType === "toolbox"}
  <Toolbox />
{:else if viewType === "api-explorer"}
  <ApiExplorer />
{:else}
  <Circuit />
{/if}
