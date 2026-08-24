import { createMcpToken, listMcpTokens, revokeMcpToken } from "./tokens";

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "issue": {
    const name = rest.join(" ") || "default";
    const issued = await createMcpToken(name);
    console.log(`\nToken issued for "${issued.name}".`);
    console.log("It is shown once and only the hash is stored — save it now.\n");
    console.log(`  ${issued.token}\n`);
    break;
  }
  case "list": {
    const rows = await listMcpTokens();
    if (rows.length === 0) {
      console.log("No tokens issued yet. Run: pnpm mcp:issue <name>");
      break;
    }
    for (const r of rows) {
      const used = r.lastUsedAt ? r.lastUsedAt.toISOString().slice(0, 16).replace("T", " ") : "never used";
      console.log(`  ${r.id}  ${r.name.padEnd(20)} ${r.revoked ? "REVOKED" : "active "}  ${used}`);
    }
    break;
  }
  case "revoke": {
    const id = rest[0];
    if (!id) {
      console.error("Usage: pnpm mcp:revoke <token-id>");
      process.exit(1);
    }
    await revokeMcpToken(id);
    console.log(`Revoked ${id}.`);
    break;
  }
  default:
    console.error("Usage: pnpm mcp:issue <name> | pnpm mcp:list | pnpm mcp:revoke <id>");
    process.exit(1);
}

process.exit(0);
