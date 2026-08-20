import { Button } from "@superset/ui/button";
import { Spinner } from "@superset/ui/spinner";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { LuArrowUpRight, LuCircleCheck } from "react-icons/lu";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import { CopyableCommand } from "renderer/routes/_authenticated/components/CopyableCommand";

const INSTALL_COMMAND = "brew install superset-sh/tap/superset";
const START_COMMAND = "superset auth login && superset start --daemon";

/** Poll fast while this guide is on screen so the new host flips in live. */
const HOST_POLL_INTERVAL_MS = 5_000;

export function AddHostGuide() {
	const navigate = useNavigate();
	const { data: hosts } = cloudTrpc.v2Host.list.useQuery(undefined, {
		refetchInterval: HOST_POLL_INTERVAL_MS,
		// The user is typically off in a terminal on the other machine while
		// this page waits — keep listening even when the window isn't focused.
		refetchIntervalInBackground: true,
	});

	// Hosts present when the guide first loaded are not "the one you just
	// added" — only a machine that appears after that counts as the success.
	const initialIdsRef = useRef<Set<string> | null>(null);
	useEffect(() => {
		if (!hosts || initialIdsRef.current !== null) return;
		initialIdsRef.current = new Set(hosts.map((host) => host.machineId));
	}, [hosts]);
	const newHost =
		hosts?.find(
			(host) =>
				initialIdsRef.current !== null &&
				!initialIdsRef.current.has(host.machineId),
		) ?? null;

	return (
		<div className="mx-auto w-full max-w-xl p-6 select-text">
			<h2 className="text-xl font-semibold">Add a host</h2>
			<p className="mt-2 text-sm text-muted-foreground">
				A workspace lives on the machine that hosts its files, terminals, and
				ports. Add a Mac mini, a spare laptop, or a server, and run workspaces
				on it from here.
			</p>

			<ol className="mt-6 space-y-5">
				<li className="space-y-2">
					<p className="text-sm font-medium">
						1. Install the Superset CLI on the other machine
					</p>
					<CopyableCommand command={INSTALL_COMMAND} />
				</li>
				<li className="space-y-2">
					<p className="text-sm font-medium">
						2. Sign in and start the host there
					</p>
					<CopyableCommand command={START_COMMAND} />
					<p className="text-xs text-muted-foreground">
						No browser on that machine? Use an API key instead. See the{" "}
						<a
							href="https://docs.superset.sh/remote-workspaces"
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground"
						>
							remote workspaces guide
							<LuArrowUpRight className="size-3" />
						</a>
						.
					</p>
				</li>
				<li className="space-y-2">
					<p className="text-sm font-medium">3. That&apos;s it</p>
					{newHost ? (
						<div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
							<div className="flex min-w-0 items-center gap-2">
								<LuCircleCheck className="size-4 shrink-0 text-emerald-500" />
								<p className="truncate text-sm">
									<span className="font-medium">{newHost.name}</span> is
									connected.
								</p>
							</div>
							<Button
								type="button"
								size="sm"
								onClick={() => {
									void navigate({
										to: "/settings/hosts/$hostId",
										params: { hostId: newHost.machineId },
									});
								}}
							>
								Open host settings
							</Button>
						</div>
					) : (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Spinner className="size-3.5 shrink-0" />
							Waiting for the host to come online. It appears here
							automatically.
						</div>
					)}
				</li>
			</ol>

			<p className="mt-8 text-xs text-muted-foreground">
				Prefer a dedicated machine over your main workstation: everything the
				host can reach (files, terminals, agent runs) becomes reachable by the
				devices you grant access to.
			</p>
		</div>
	);
}
