<script lang="ts">
	import { page } from '$app/stores';
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let redirectTo = $derived($page.url.searchParams.get('redirect') ?? '/');
	let busy = $state(false);
</script>

<svelte:head><title>Sign in · MyTube</title></svelte:head>

<div class="grid min-h-screen place-items-center bg-bg px-4">
	<div class="w-full max-w-sm">
		<div class="mb-6 flex items-center justify-center gap-2">
			<div class="grid h-9 w-9 place-items-center rounded-lg bg-accent text-bg"><Icon name="play" size={20} /></div>
			<span class="text-xl font-semibold">MyTube</span>
		</div>

		<form
			method="POST"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update();
					busy = false;
				};
			}}
			class="card flex flex-col gap-3 p-6"
		>
			<input type="hidden" name="redirect" value={redirectTo} />
			<label class="text-sm text-fg-muted" for="secret">
				{data.usesPassword ? 'Password' : 'Access token'}
			</label>
			<input
				id="secret"
				name="secret"
				type="password"
				class="input"
				autocomplete="current-password"
				placeholder={data.usesPassword ? 'Your password' : 'mt_…'}
				autofocus
			/>
			{#if form?.error}
				<p class="text-sm text-red-400">{form.error}</p>
			{/if}
			<button class="btn-primary mt-1" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
		</form>
		<p class="mt-4 text-center text-xs text-fg-faint">Programmatic clients use a bearer token instead.</p>
	</div>
</div>
