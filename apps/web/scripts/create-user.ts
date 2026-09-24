/**
 * Create an operator-provisioned RIO user (public sign-up is disabled).
 *
 *   docker compose ... exec -it web pnpm admin:create-user \
 *     --email owner@example.com --name "Owner" --org rio-california --role ORG_ADMIN [--super-admin]
 *
 * The password is read from the terminal with echo disabled (or from stdin when
 * piped, for automation). It is never accepted as a CLI flag, so it never lands
 * in shell history or `ps` output.
 */
import { parseArgs } from "node:util";
import { closeDb } from "@rio-gps/db";
import { ZodError } from "zod";
import { createUserWithMembership, ProvisioningError } from "../src/lib/admin-users";

async function readPassword(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0] ?? "";
  }
  process.stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (c === "\u0003") {
          stdin.setRawMode(false);
          return reject(new Error("aborted"));
        }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      org: { type: "string" },
      role: { type: "string", default: "VIEWER" },
      "super-admin": { type: "boolean", default: false }
    }
  });
  if (!values.email || !values.org) {
    console.error("Usage: create-user --email <email> --name <name> --org <slug> --role <ORG_ADMIN|FLEET_MANAGER|DISPATCHER|VIEWER> [--super-admin]");
    process.exit(2);
  }
  const password = await readPassword("Password (min 12 chars, hidden): ");
  if (process.stdin.isTTY) {
    const confirm = await readPassword("Confirm password: ");
    if (confirm !== password) {
      console.error("Passwords do not match");
      process.exit(2);
    }
  }
  const result = await createUserWithMembership({
    email: values.email,
    name: values.name ?? values.email,
    password,
    organizationSlug: values.org,
    role: values.role as never,
    superAdmin: values["super-admin"]
  });
  console.log(JSON.stringify({ event: "user.created", userId: result.userId, role: result.role, organizationId: result.organizationId }));
}

main()
  .catch((err) => {
    if (err instanceof ZodError) console.error("Invalid input:", err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    else if (err instanceof ProvisioningError) console.error(err.message);
    else console.error("create-user failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
