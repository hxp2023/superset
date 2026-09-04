import { quote } from "shell-quote";

/**
 * The shell command that puts a branch back on top of the trunk after the
 * layer beneath it merged.
 *
 * A native stack is GitHub's to repair: it already rebased the remote branch,
 * so `gh stack sync` mirrors that state down and cascades the rest of the
 * stack. An inferred chain has nothing on the server side, so the branch is
 * replayed onto the fresh trunk from the merged layer's last commit — the
 * boundary that leaves out the commits the trunk now carries as a squash.
 */
export function buildRestackCommand({
	source,
	trunk,
	mergedHeadOid,
}: {
	source: "github" | "inferred";
	trunk: string;
	mergedHeadOid: string;
}): string {
	if (source === "github") return "gh stack sync";
	return [
		`git fetch origin ${quote([trunk])}`,
		`git rebase --onto ${quote([`origin/${trunk}`])} ${quote([mergedHeadOid])}`,
	].join(" && ");
}
