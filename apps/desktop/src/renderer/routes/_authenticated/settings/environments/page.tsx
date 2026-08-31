import { createFileRoute } from "@tanstack/react-router";
import { EnvironmentsSettings } from "./components/EnvironmentsSettings";

export const Route = createFileRoute("/_authenticated/settings/environments/")({
	component: EnvironmentsSettingsPage,
});

function EnvironmentsSettingsPage() {
	return <EnvironmentsSettings />;
}
