// Read-only: my cloud_workspaces rows in production (created after a timestamp), for polling.
import { neon } from "@neondatabase/serverless";
const key = process.env.NEON_API_KEY!, project = process.env.NEON_PROJECT_ID!;
const h = { Authorization: `Bearer ${key}`, Accept: "application/json" };
const branches = (await (await fetch(`https://console.neon.tech/api/v2/projects/${project}/branches`, { headers: h })).json()) as { branches: Array<{ id: string; default: boolean; name: string }> };
const main = branches.branches.find((b) => b.default)!;
const uri = (await (await fetch(`https://console.neon.tech/api/v2/projects/${project}/connection_uri?branch_id=${main.id}&database_name=neondb&role_name=neondb_owner&pooled=true`, { headers: h })).json()) as { uri?: string };
const sql = neon(uri.uri!);
const since = process.argv[2] ?? "2026-09-02T07:00:00Z";
const rows = await sql`select id, name, status, branch, provider_sandbox_id, environment_id, created_at from cloud_workspaces where organization_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' and created_at > ${since}::timestamptz and status <> 'deleted' order by created_at desc limit 5`;
console.log(JSON.stringify(rows));
console.log("cloud-* branches:", JSON.stringify(branches.branches.filter((b) => b.name.startsWith("cloud-")).map((b) => b.name)));
process.exit(0);
