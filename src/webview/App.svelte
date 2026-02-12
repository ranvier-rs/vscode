<script lang="ts">
  import Circuit from "./circuit/Circuit.svelte";
  import Toolbox from "./toolbox/Toolbox.svelte";

  // Extend global window interface (or cast to any) to read the view type injected by the extension
  const viewType = (window as any).ranvierViewType || "circuit";
</script>

{#if viewType === "toolbox"}
  <Toolbox />
{:else}
  <Circuit />
{/if}
